#!/usr/bin/env python3
"""Create a labeled contact sheet from rendered slide images."""

from __future__ import annotations

import argparse
import math
import re
from pathlib import Path


def natural_key(path: Path) -> list[object]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name)]


def main() -> int:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise SystemExit("Pillow is required: python3 -m pip install Pillow") from exc

    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--thumb-width", type=int, default=480)
    args = parser.parse_args()

    paths = sorted(
        [path for path in args.input_dir.iterdir() if path.suffix.lower() in {".png", ".jpg", ".jpeg"}],
        key=natural_key,
    )
    if not paths:
        raise SystemExit(f"No images found in {args.input_dir}")

    with Image.open(paths[0]) as first:
        ratio = first.height / first.width
    thumb_height = round(args.thumb_width * ratio)
    label_height = 34
    gutter = 18
    columns = max(1, args.columns)
    rows = math.ceil(len(paths) / columns)
    width = columns * args.thumb_width + (columns + 1) * gutter
    height = rows * (thumb_height + label_height) + (rows + 1) * gutter
    sheet = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()

    for index, path in enumerate(paths):
        row, column = divmod(index, columns)
        x = gutter + column * (args.thumb_width + gutter)
        y = gutter + row * (thumb_height + label_height + gutter)
        with Image.open(path) as image:
            image = image.convert("RGB")
            image.thumbnail((args.thumb_width, thumb_height))
            frame = Image.new("RGB", (args.thumb_width, thumb_height), "#ECECEC")
            frame.paste(image, ((args.thumb_width - image.width) // 2, (thumb_height - image.height) // 2))
            sheet.paste(frame, (x, y))
        label = f"{index + 1:02d}  {path.name}"
        draw.text((x, y + thumb_height + 8), label, fill="#222222", font=font)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, quality=92)
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
