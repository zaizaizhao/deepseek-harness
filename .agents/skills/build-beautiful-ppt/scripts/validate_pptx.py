#!/usr/bin/env python3
"""Validate a PPTX package with only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
SLIDE_RE = re.compile(r"^ppt/slides/slide(\d+)\.xml$")
NOTES_RE = re.compile(r"^ppt/notesSlides/notesSlide(\d+)\.xml$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def xml_root(archive: zipfile.ZipFile, name: str) -> ET.Element:
    return ET.fromstring(archive.read(name))


def notes_text(root: ET.Element) -> str:
    return "\n".join(node.text or "" for node in root.findall(f".//{{{A_NS}}}t"))


def validate(args: argparse.Namespace) -> tuple[dict[str, object], bool]:
    path: Path = args.pptx.resolve()
    issues: list[str] = []
    warnings: list[str] = []

    if not path.is_file():
        return {"path": str(path), "issues": ["PPTX does not exist"]}, False
    if not zipfile.is_zipfile(path):
        return {"path": str(path), "issues": ["File is not a valid ZIP/PPTX package"]}, False

    with zipfile.ZipFile(path) as archive:
        bad_member = archive.testzip()
        if bad_member:
            issues.append(f"ZIP CRC failure: {bad_member}")

        names = set(archive.namelist())
        required = {"[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels"}
        for name in sorted(required - names):
            issues.append(f"Missing required package part: {name}")

        slides = sorted(
            ((int(match.group(1)), name) for name in names if (match := SLIDE_RE.match(name))),
            key=lambda item: item[0],
        )
        notes = sorted(
            ((int(match.group(1)), name) for name in names if (match := NOTES_RE.match(name))),
            key=lambda item: item[0],
        )
        if not slides:
            issues.append("No slide XML parts found")
        if args.expect_slides is not None and len(slides) != args.expect_slides:
            issues.append(f"Expected {args.expect_slides} slides, found {len(slides)}")

        transition_count = 0
        fade_count = 0
        for _, name in slides:
            try:
                root = xml_root(archive, name)
            except ET.ParseError as exc:
                issues.append(f"Invalid slide XML {name}: {exc}")
                continue
            direct = [child for child in list(root) if child.tag == f"{{{P_NS}}}transition"]
            transition_count += len(direct)
            fade_count += sum(1 for node in direct if node.find(f"{{{P_NS}}}fade") is not None)
            if len(direct) > 1:
                issues.append(f"Multiple root transitions in {name}")

        notes_with_sources = 0
        for _, name in notes:
            try:
                text = notes_text(xml_root(archive, name))
            except ET.ParseError as exc:
                issues.append(f"Invalid notes XML {name}: {exc}")
                continue
            if "[Sources]" in text and "[/Sources]" in text:
                notes_with_sources += 1

        if args.require_sources and notes_with_sources != len(slides):
            issues.append(
                f"Source-note contract failed: {notes_with_sources} slides with Sources blocks for {len(slides)} slides"
            )

        external_relationships: list[dict[str, str]] = []
        external_media: list[dict[str, str]] = []
        for name in sorted(n for n in names if n.endswith(".rels")):
            try:
                root = xml_root(archive, name)
            except ET.ParseError as exc:
                issues.append(f"Invalid relationships XML {name}: {exc}")
                continue
            for rel in root.findall(f"{{{REL_NS}}}Relationship"):
                if rel.attrib.get("TargetMode") != "External":
                    continue
                item = {
                    "part": name,
                    "type": rel.attrib.get("Type", ""),
                    "target": rel.attrib.get("Target", ""),
                }
                external_relationships.append(item)
                relation_type = item["type"].lower()
                if any(kind in relation_type for kind in ("image", "audio", "video", "media")):
                    external_media.append(item)

        if args.require_no_external_media and external_media:
            issues.append(f"Found {len(external_media)} external media relationships")
        if external_relationships and not external_media:
            warnings.append("External relationships exist; they appear to be hyperlinks rather than media")

        report: dict[str, object] = {
            "passed": not issues,
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "slideCount": len(slides),
            "notesCount": len(notes),
            "notesWithSourcesBlocks": notes_with_sources,
            "rootTransitionCount": transition_count,
            "rootFadeTransitionCount": fade_count,
            "chartCount": sum(1 for name in names if re.match(r"^ppt/charts/chart\d+\.xml$", name)),
            "mediaCount": sum(1 for name in names if name.startswith("ppt/media/") and not name.endswith("/")),
            "embeddedFontPartCount": sum(1 for name in names if name.startswith("ppt/fonts/") and not name.endswith("/")),
            "externalRelationshipCount": len(external_relationships),
            "externalMediaRelationshipCount": len(external_media),
            "externalRelationships": external_relationships,
            "issues": issues,
            "warnings": warnings,
        }
    return report, not issues


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pptx", type=Path)
    parser.add_argument("--expect-slides", type=int)
    parser.add_argument("--require-sources", action="store_true")
    parser.add_argument("--require-no-external-media", action="store_true")
    parser.add_argument("--json", type=Path, help="Write the report to this path.")
    args = parser.parse_args()

    report, passed = validate(args)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    print(rendered)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(rendered + "\n", encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
