#!/usr/bin/env python3
"""Create an auditable source/recomposition/layer review sheet."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageStat


def checkerboard(size: tuple[int, int], square: int = 24) -> Image.Image:
    width, height = size
    image = Image.new("RGBA", size, (216, 216, 216, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, height, square):
        for x in range(0, width, square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill=(176, 176, 176, 255))
    return image


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    result = checkerboard(size)
    preview = image.copy()
    preview.thumbnail(size, Image.Resampling.LANCZOS)
    x = (size[0] - preview.width) // 2
    y = (size[1] - preview.height) // 2
    result.alpha_composite(preview, (x, y))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--layers", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--recomposed-output", type=Path)
    parser.add_argument("--run-provenance", type=Path)
    parser.add_argument("--derivative-provenance", type=Path)
    args = parser.parse_args()

    if len(args.layers) not in (3, 4):
        raise SystemExit(f"Expected three or four layers, received {len(args.layers)}")

    layers = [Image.open(path).convert("RGBA") for path in args.layers]
    layer_size = layers[0].size
    if any(layer.size != layer_size for layer in layers):
        raise SystemExit("All decomposition layers must have identical dimensions")

    recomposed = Image.new("RGBA", layer_size, (0, 0, 0, 0))
    for layer in layers:
        recomposed = Image.alpha_composite(recomposed, layer)

    if args.recomposed_output:
        args.recomposed_output.parent.mkdir(parents=True, exist_ok=True)
        recomposed.save(args.recomposed_output, format="PNG", optimize=True)

    source = Image.open(args.source).convert("RGBA")
    source_at_layer_size = source.resize(layer_size, Image.Resampling.LANCZOS).convert("RGB")
    recomposed_rgb = recomposed.convert("RGB")
    mean_absolute_rgb = ImageStat.Stat(ImageChops.difference(source_at_layer_size, recomposed_rgb)).mean
    max_mean_absolute_error = max(mean_absolute_rgb)
    if max_mean_absolute_error > 8:
        raise SystemExit(
            f"Recomposition exceeds the 8/255 mean-absolute-error boundary: {max_mean_absolute_error:.3f}"
        )
    labels = ["Source", "Recomposed", *[f"Layer {index + 1}" for index in range(len(layers))]]
    images = [source, recomposed, *layers]
    cell_size = (512, 512)
    label_height = 42
    columns = 3
    rows = 2
    sheet = Image.new("RGB", (columns * cell_size[0], rows * (cell_size[1] + label_height)), (20, 20, 20))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=20)

    for index, (label, image) in enumerate(zip(labels, images, strict=True)):
        column = index % columns
        row = index // columns
        x = column * cell_size[0]
        y = row * (cell_size[1] + label_height)
        sheet.paste(contain(image, cell_size).convert("RGB"), (x, y))
        draw.rectangle((x, y + cell_size[1], x + cell_size[0], y + cell_size[1] + label_height), fill=(20, 20, 20))
        draw.text((x + 14, y + cell_size[1] + 10), label, fill=(245, 245, 245), font=font)

    if len(images) == 5:
        x = 2 * cell_size[0]
        y = cell_size[1] + label_height
        draw.rectangle((x, y, x + cell_size[0], y + cell_size[1] + label_height), fill=(32, 32, 32))
        metrics = [
            "Review metrics",
            "3 generated RGBA layers",
            f"Recomposition MAE: {max_mean_absolute_error:.2f} / 255",
            "Required threshold: <= 8 / 255",
            "Source + every layer hash-bound",
        ]
        for line_index, line in enumerate(metrics):
            draw.text((x + 32, y + 54 + line_index * 48), line, fill=(245, 245, 245), font=font)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, format="WEBP", quality=95, method=6)

    if bool(args.run_provenance) != bool(args.derivative_provenance):
        raise SystemExit("--run-provenance and --derivative-provenance must be supplied together")
    if args.run_provenance:
        provenance = json.loads(args.run_provenance.read_text(encoding="utf-8"))
        output_items = provenance.get("output", {}).get("items", [])
        layer_hashes = [item.get("decodedSha256") for item in output_items]
        expected_encoded_hashes = [item.get("encodedSha256") for item in output_items]
        encoded_layer_hashes = [f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}" for path in args.layers]
        if encoded_layer_hashes != expected_encoded_hashes:
            raise SystemExit("Layer encoded-byte hashes do not match the captured run provenance")

        source_hash = f"sha256:bytes:{hashlib.sha256(args.source.read_bytes()).hexdigest()}"
        input_hashes = {item.get("contentHash") for item in provenance.get("inputs", {}).get("items", [])}
        if source_hash not in input_hashes:
            raise SystemExit("Source image is not bound to the captured run provenance")

        derivative = {
            "schemaVersion": 1,
            "format": "modiff.gallery.reviewed-derivative.v1",
            "templateId": provenance.get("template", {}).get("id"),
            "kind": "layered_contact_sheet",
            "layout": (
                "source-recomposition-three-layers-metrics-3x2"
                if len(layers) == 3
                else "source-recomposition-four-layers-3x2"
            ),
            "sourceOutputCollectionHash": provenance.get("output", {}).get("collectionHash"),
            "sourceItemHashes": layer_hashes,
            "sourceInputHash": source_hash,
            "decodedMediaHash": None,
            "encodedMediaHash": f"sha256:bytes:{hashlib.sha256(args.output.read_bytes()).hexdigest()}",
            "processor": {
                "path": "scripts/template-gallery-layer-sheet.py",
                "contentHash": f"sha256:bytes:{hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}",
            },
            "recomposition": {
                "meanAbsoluteRgb": [round(value, 6) for value in mean_absolute_rgb],
                "maxMeanAbsoluteError": round(max_mean_absolute_error, 6),
                "threshold": 8,
                "status": "pass",
            },
        }
        args.derivative_provenance.parent.mkdir(parents=True, exist_ok=True)
        args.derivative_provenance.write_text(f"{json.dumps(derivative, indent=2)}\n", encoding="utf-8")


if __name__ == "__main__":
    main()
