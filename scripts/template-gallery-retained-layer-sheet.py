#!/usr/bin/env python3
"""Reproduce retained review-sheet bytes and bind lossless layers to native media.

The optional font is supplied by the operator. Its bytes are never bundled;
the receipt records its basename and hash. The portable default uses Pillow.
This processor neither runs a model nor changes an approved original file.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps, ImageStat, __version__, features


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def rgba(path: Path, *, layer: bool = False) -> tuple[Image.Image, bytes]:
    path = path.resolve(strict=True)
    if not path.is_file() or not 0 < path.stat().st_size <= 64 * 1024**2:
        raise ValueError("Review input is missing or exceeds its finite file limit")
    body = path.read_bytes()
    with Image.open(io.BytesIO(body)) as opened:
        if opened.width * opened.height > 32 * 1024**2:
            raise ValueError("Review input exceeds its finite pixel limit")
        opened.load()
        if layer and opened.mode != "RGBA":
            raise ValueError("Lossless layers must retain their native RGBA channels")
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    return image, body


def reproduce(source: Image.Image, layers: list[Image.Image], settings: dict, *, font: Path | None):
    if len(layers) != 3 or any(layer.size != layers[0].size for layer in layers):
        raise ValueError("This retained layout requires three equally sized RGBA layers")
    recomposed = Image.new("RGBA", layers[0].size, (0, 0, 0, 0))
    for layer in layers:
        recomposed = Image.alpha_composite(recomposed, layer)
    resized_source = source.resize(recomposed.size, Image.Resampling.LANCZOS).convert("RGB")
    errors = ImageStat.Stat(ImageChops.difference(resized_source, recomposed.convert("RGB"))).mean
    maximum = max(errors)
    if maximum > 8:
        raise ValueError(f"Recomposition exceeds the 8/255 boundary: {maximum:.3f}")
    main_font = ImageFont.truetype(str(font), 20) if font else ImageFont.load_default(size=20)
    small_font = ImageFont.truetype(str(font), 19) if font else ImageFont.load_default(size=19)
    canvas = Image.new("RGB", (1536, 1108), "#121820")
    draw = ImageDraw.Draw(canvas)

    def tile(image: Image.Image, title: str, column: int, row: int):
        image = image.convert("RGBA").resize((512, 512), Image.Resampling.LANCZOS)
        checker = Image.new("RGBA", (512, 512))
        checker_draw = ImageDraw.Draw(checker)
        for y in range(0, 512, 16):
            for x in range(0, 512, 16):
                checker_draw.rectangle((x, y, x + 15, y + 15),
                                       fill="#d6d8dd" if (x // 16 + y // 16) % 2 else "#f4f5f7")
        canvas.paste(Image.alpha_composite(checker, image).convert("RGB"), (column * 512, row * 554 + 42))
        draw.text((column * 512 + 12, row * 554 + 8), title, font=main_font, fill="white")

    tile(source, "Exact source · review resize", 0, 0)
    tile(recomposed, "Recomposition · original layer order", 1, 0)
    for index, layer in enumerate(layers):
        column, row = ((2, 0), (0, 1), (1, 1))[index]
        tile(layer, f"Layer {index} · checkerboard = transparent", column, row)
    width, height = layers[0].size
    lines = ["Current native template", f"{width} × {height} · 3 RGBA layers",
             f"{settings['steps']} steps · seed {settings['seed']} · guidance {settings['guidanceScale']:g}",
             "Full BF16 · Auto · model CPU offload", "", "Recomposition: PASS", "Maximum channel mean error:",
             f"{maximum:.2f} / 255 (limit 8)", "", "Actual source pixels retained",
             "before encoding and after completion.", "", "Generated layers are unchanged.",
             "Display tiles resized for review only.", "Awaiting visual/rights approval."]
    for index, line in enumerate(lines):
        draw.text((1038, 570 + index * 30), line, font=small_font,
                  fill="#b3ddc2" if index in (5, 7) else "white")
    return canvas, {"meanAbsoluteRgb": errors, "maxMeanAbsoluteError": maximum, "threshold": 8, "status": "pass"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--layers", required=True, nargs=3, type=Path)
    parser.add_argument("--run-provenance", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--derivative-provenance", required=True, type=Path)
    parser.add_argument("--font", type=Path)
    parser.add_argument("--expected-approved-sha256")
    args = parser.parse_args()
    if args.output.exists() or args.derivative_provenance.exists():
        raise ValueError("Reproduction must use new paths; approved originals are never overwritten")
    run_path = args.run_provenance.resolve(strict=True)
    if not 0 < run_path.stat().st_size <= 16 * 1024**2:
        raise ValueError("Run provenance exceeds its finite file limit")
    run = json.loads(run_path.read_bytes())
    settings = run["template"]["lockedSettings"]
    plan = run["graph"]["executionPlan"]
    if (settings["layers"] != 3 or settings["dtype"] != "bfloat16"
            or plan["resourceMode"] != "auto" or plan["offloadMode"] != "model_cpu"):
        raise ValueError("Retained caption requires its actual three-layer BF16 Auto/model-CPU recipe")
    source, source_body = rgba(args.source)
    source_hash = "sha256:bytes:" + digest(source_body)
    if source_hash not in {item["contentHash"] for item in run["inputs"]["items"]}:
        raise ValueError("Source bytes are not bound to the native run")
    items = run["output"]["items"]
    if len(items) != 3:
        raise ValueError("Native provenance must retain all three output images")
    layers, exports = [], []
    for index, path in enumerate(args.layers):
        image, body = rgba(path, layer=True)
        encoded = io.BytesIO()
        image.save(encoded, format="WEBP", quality=100)
        native_hash = "sha256:" + digest(encoded.getvalue())
        if native_hash != items[index]["encodedSha256"]:
            raise ValueError("Lossless layer does not reproduce the native quality-100 WebP bytes")
        layers.append(image)
        exports.append({"index": index, "encodedSha256": "sha256:bytes:" + digest(body),
                        "rgbaPixelSha256": digest(image.tobytes()), "nativeEncodedSha256": native_hash,
                        "width": image.width, "height": image.height, "mode": "RGBA"})
    font = args.font.resolve(strict=True) if args.font else None
    if font and (not font.is_file() or not 0 < font.stat().st_size <= 32 * 1024**2):
        raise ValueError("Selected font exceeds its finite file limit")
    sheet, metrics = reproduce(source, layers, settings, font=font)
    encoded_sheet = io.BytesIO()
    sheet.save(encoded_sheet, format="PNG")
    body = encoded_sheet.getvalue()
    if args.expected_approved_sha256 and digest(body) != args.expected_approved_sha256:
        raise ValueError("Reproduction differs from the exact approved sheet; original bytes remain untouched")
    record = {"schemaVersion": 1, "format": "modiff.gallery.reviewed-derivative.v1", "templateId": run["template"]["id"],
              "kind": "layered_contact_sheet", "layout": "source-recomposition-three-layers-metrics-3x2",
              "sourceOutputCollectionHash": run["output"]["collectionHash"],
              "sourceItemHashes": [item["decodedSha256"] for item in items], "sourceInputHash": source_hash,
              "decodedMediaHash": None, "encodedMediaHash": "sha256:bytes:" + digest(body),
              "processor": {"path": "scripts/template-gallery-retained-layer-sheet.py",
                            "contentHash": "sha256:bytes:" + digest(Path(__file__).read_bytes()),
                            "role": "byte-identical-retained-sheet-reproduction"},
              "losslessExports": {"schemaVersion": 1, "verification": "native-webp-quality-100-byte-reproduction",
                                  "items": exports}, "recomposition": metrics,
              "toolchain": {"pillow": __version__, "webp": features.version_module("webp"),
                            "font": {"name": font.name, "sha256": digest(font.read_bytes())} if font else {"name": "pillow-default"}},
              "creationTimeReviewCaptionPreserved": True}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.derivative_provenance.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as handle:
        handle.write(body)
    with args.derivative_provenance.open("x", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2, ensure_ascii=False)
    print(json.dumps({"encodedMediaHash": record["encodedMediaHash"], "losslessLayers": len(exports),
                      "maxMeanAbsoluteError": metrics["maxMeanAbsoluteError"], "approvedBytesMatched": bool(args.expected_approved_sha256)}))


if __name__ == "__main__":
    main()
