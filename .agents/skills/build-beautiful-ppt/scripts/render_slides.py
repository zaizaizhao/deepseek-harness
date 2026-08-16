#!/usr/bin/env python3
"""Render PPTX slides to PNG through local LibreOffice and Poppler."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def resolve_executable(explicit: str | None, candidates: tuple[str, ...]) -> str:
    if explicit:
        path = shutil.which(explicit) or (explicit if Path(explicit).is_file() else None)
        if path:
            return str(path)
        raise SystemExit(f"Executable not found: {explicit}")
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    raise SystemExit(f"Required executable not found: {' or '.join(candidates)}")


def resolve_fontconfig_environment() -> tuple[dict[str, str], str | None]:
    """Give bundled/headless LibreOffice a usable system-font configuration.

    Some macOS agent runtimes launch LibreOffice with an empty Fontconfig
    configuration.  Latin text may still render, while CJK glyphs become empty
    squares.  Prefer an existing caller setting; otherwise use the first common
    system configuration that exists.
    """

    env = os.environ.copy()
    configured = env.get("FONTCONFIG_FILE")
    if configured and Path(configured).is_file():
        return env, configured
    for candidate in (
        "/opt/homebrew/etc/fonts/fonts.conf",
        "/usr/local/etc/fonts/fonts.conf",
        "/etc/fonts/fonts.conf",
    ):
        if Path(candidate).is_file():
            env["FONTCONFIG_FILE"] = candidate
            return env, candidate
    return env, None


def run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    result = subprocess.run(command, check=False, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(
            f"Command failed ({result.returncode}): {' '.join(command)}\n{result.stdout}\n{result.stderr}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pptx", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--soffice")
    parser.add_argument("--pdftoppm")
    parser.add_argument("--dpi", type=int, default=144)
    parser.add_argument("--pdf-output", type=Path)
    args = parser.parse_args()

    pptx = args.pptx.resolve()
    if not pptx.is_file():
        raise SystemExit(f"PPTX does not exist: {pptx}")
    soffice = resolve_executable(args.soffice, ("soffice", "libreoffice"))
    pdftoppm = resolve_executable(args.pdftoppm, ("pdftoppm",))
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    render_env, fontconfig_file = resolve_fontconfig_environment()

    for old in output_dir.glob("slide-*.png"):
        old.unlink()

    with tempfile.TemporaryDirectory(prefix="render-slides-") as temp_name:
        temp_dir = Path(temp_name)
        run(
            [soffice, "--headless", "--convert-to", "pdf", "--outdir", str(temp_dir), str(pptx)],
            env=render_env,
        )
        pdf = temp_dir / f"{pptx.stem}.pdf"
        if not pdf.is_file():
            candidates = list(temp_dir.glob("*.pdf"))
            if len(candidates) != 1:
                raise SystemExit("LibreOffice did not produce exactly one PDF")
            pdf = candidates[0]
        prefix = temp_dir / "page"
        run([pdftoppm, "-png", "-r", str(args.dpi), str(pdf), str(prefix)], env=render_env)
        pages = sorted(temp_dir.glob("page-*.png"), key=lambda p: int(p.stem.split("-")[-1]))
        if not pages:
            raise SystemExit("pdftoppm produced no slide images")
        for index, page in enumerate(pages, start=1):
            shutil.copy2(page, output_dir / f"slide-{index}.png")
        if args.pdf_output:
            args.pdf_output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pdf, args.pdf_output)

    print(
        json.dumps(
            {
                "pptx": str(pptx),
                "outputDir": str(output_dir),
                "slides": len(pages),
                "fontconfigFile": fontconfig_file,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
