#!/usr/bin/env python3
"""Write one root-level fade transition to every slide in a PPTX."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SLIDE_RE = re.compile(r"^ppt/slides/slide\d+\.xml$")

ET.register_namespace("a", A_NS)
ET.register_namespace("p", P_NS)
ET.register_namespace("r", R_NS)


def patch_slide(data: bytes) -> bytes:
    root = ET.fromstring(data)
    for child in list(root):
        if child.tag == f"{{{P_NS}}}transition":
            root.remove(child)

    transition = ET.Element(f"{{{P_NS}}}transition", {"spd": "fast"})
    ET.SubElement(transition, f"{{{P_NS}}}fade")

    children = list(root)
    insert_at = len(children)
    for index, child in enumerate(children):
        if child.tag in {f"{{{P_NS}}}timing", f"{{{P_NS}}}extLst"}:
            insert_at = index
            break
    root.insert(insert_at, transition)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    source = args.input.resolve()
    output = args.output.resolve()
    if not source.is_file() or not zipfile.is_zipfile(source):
        raise SystemExit(f"Invalid PPTX input: {source}")
    if output.exists() and not args.force:
        raise SystemExit(f"Output exists; pass --force to replace it: {output}")
    if source == output:
        raise SystemExit("Use a distinct output path to preserve the source candidate")

    output.parent.mkdir(parents=True, exist_ok=True)
    patched = 0
    with tempfile.NamedTemporaryFile(prefix="fade-transitions-", suffix=".pptx", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(source, "r") as src, zipfile.ZipFile(
            temporary, "w", compression=zipfile.ZIP_DEFLATED
        ) as dst:
            for info in src.infolist():
                data = src.read(info.filename)
                if SLIDE_RE.match(info.filename):
                    data = patch_slide(data)
                    patched += 1
                dst.writestr(info, data)
        shutil.move(str(temporary), output)
    finally:
        temporary.unlink(missing_ok=True)

    print(json.dumps({"input": str(source), "output": str(output), "slidesPatched": patched}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
