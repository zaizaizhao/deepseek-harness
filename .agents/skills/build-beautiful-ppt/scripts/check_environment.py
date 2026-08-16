#!/usr/bin/env python3
"""Report local presentation build and QA capabilities without installing anything."""

from __future__ import annotations

import argparse
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def command_version(command: str | None, args: list[str]) -> dict[str, object]:
    if not command:
        return {"available": False, "path": None, "version": None}
    try:
        result = subprocess.run(
            [command, *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        text = (result.stdout or result.stderr).strip().splitlines()
        return {
            "available": result.returncode == 0,
            "path": command,
            "version": text[0] if text else None,
        }
    except (OSError, subprocess.SubprocessError) as exc:
        return {"available": False, "path": command, "version": None, "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, help="Write the report to this JSON file.")
    parser.add_argument(
        "--require-fallback",
        action="store_true",
        help="Fail unless Node.js 18+, npm, LibreOffice, and pdftoppm are available.",
    )
    args = parser.parse_args()

    node_path = shutil.which("node")
    npm_path = shutil.which("npm")
    soffice_path = shutil.which("soffice") or shutil.which("libreoffice")
    pdftoppm_path = shutil.which("pdftoppm")

    report: dict[str, object] = {
        "platform": platform.platform(),
        "python": {"available": True, "path": sys.executable, "version": platform.python_version()},
        "node": command_version(node_path, ["--version"]),
        "npm": command_version(npm_path, ["--version"]),
        "libreoffice": command_version(soffice_path, ["--version"]),
        "pdftoppm": command_version(pdftoppm_path, ["-v"]),
    }

    node_ok = False
    node_version = report["node"].get("version") if isinstance(report["node"], dict) else None
    if isinstance(node_version, str):
        try:
            node_ok = int(node_version.lstrip("v").split(".", 1)[0]) >= 18
        except ValueError:
            node_ok = False

    requirements = {
        "node18": node_ok,
        "npm": bool(report["npm"].get("available")) if isinstance(report["npm"], dict) else False,
        "renderer": bool(report["libreoffice"].get("available")) if isinstance(report["libreoffice"], dict) else False,
        "pdf_rasterizer": bool(report["pdftoppm"].get("available")) if isinstance(report["pdftoppm"], dict) else False,
    }
    report["portableFallbackReady"] = all(requirements.values())
    report["requirements"] = requirements

    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(rendered + "\n", encoding="utf-8")

    if args.require_fallback and not report["portableFallbackReady"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
