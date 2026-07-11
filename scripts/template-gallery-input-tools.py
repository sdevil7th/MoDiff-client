"""Deterministic preparation tools for gallery-only multimodal inputs.

Every command derives a reviewable input from an already reviewed source asset.
The generated file is still an input, never gallery proof by itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def write_metadata(output: Path, command: str, inputs: list[Path], settings: dict) -> None:
    payload = {
        "schemaVersion": 1,
        "role": "template-gallery-input",
        "command": command,
        "inputs": [
            {"path": str(path.resolve()), "contentHash": sha256(path), "byteSize": path.stat().st_size}
            for path in inputs
        ],
        "settings": settings,
        "output": {
            "path": str(output.resolve()),
            "contentHash": sha256(output),
            "byteSize": output.stat().st_size,
        },
    }
    output.with_suffix(f"{output.suffix}.input.json").write_text(
        json.dumps(payload, indent=2) + "\n", encoding="utf-8"
    )


def fit_cover(frame: np.ndarray, width: int, height: int, scale: float = 1.0, pan_x: float = 0.5) -> np.ndarray:
    source_height, source_width = frame.shape[:2]
    ratio = max(width / source_width, height / source_height) * scale
    resized = cv2.resize(
        frame,
        (max(width, round(source_width * ratio)), max(height, round(source_height * ratio))),
        interpolation=cv2.INTER_LANCZOS4,
    )
    extra_x = resized.shape[1] - width
    extra_y = resized.shape[0] - height
    left = int(np.clip(round(extra_x * pan_x), 0, extra_x))
    top = max(0, extra_y // 2)
    return resized[top : top + height, left : left + width]


def harbor_control_video(args: argparse.Namespace) -> None:
    source = cv2.imread(str(args.input), cv2.IMREAD_GRAYSCALE)
    if source is None:
        raise ValueError(f"Could not decode {args.input}")
    source_bgr = cv2.cvtColor(source, cv2.COLOR_GRAY2BGR)
    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height)
    )
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer for {args.output}")
    for index in range(args.frames):
        phase = index / max(1, args.frames - 1)
        frame = fit_cover(
            source_bgr,
            args.width,
            args.height,
            scale=1.0 + 0.012 * phase,
            pan_x=0.48 + 0.04 * phase,
        )
        writer.write(frame)
    writer.release()
    write_metadata(
        args.output,
        "harbor-control-video",
        [args.input],
        {"width": args.width, "height": args.height, "frames": args.frames, "fps": args.fps},
    )


def largest_component(mask: np.ndarray, minimum_area: int) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return np.zeros_like(mask)
    candidates = [(index, int(stats[index, cv2.CC_STAT_AREA])) for index in range(1, count)]
    index, area = max(candidates, key=lambda item: item[1])
    if area < minimum_area:
        return np.zeros_like(mask)
    return np.where(labels == index, 255, 0).astype(np.uint8)


def red_object_mask_video(args: argparse.Namespace) -> None:
    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise ValueError(f"Could not decode {args.input}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS) or args.fps
    writer = cv2.VideoWriter(str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height), False)
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer for {args.output}")
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (args.kernel, args.kernel))
    frames = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        low_red = cv2.inRange(hsv, (0, args.saturation, args.value), (12, 255, 255))
        high_red = cv2.inRange(hsv, (168, args.saturation, args.value), (179, 255, 255))
        mask = cv2.bitwise_or(low_red, high_red)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = largest_component(mask, args.minimum_area)
        mask = cv2.dilate(mask, kernel, iterations=args.dilate)
        if args.feather > 0:
            blur = max(1, args.feather * 2 + 1)
            mask = cv2.GaussianBlur(mask, (blur, blur), 0)
        writer.write(mask)
        frames += 1
    capture.release()
    writer.release()
    if frames == 0:
        raise RuntimeError("No frames were decoded")
    write_metadata(
        args.output,
        "red-object-mask-video",
        [args.input],
        {
            "frames": frames,
            "fps": fps,
            "saturation": args.saturation,
            "value": args.value,
            "kernel": args.kernel,
            "minimumArea": args.minimum_area,
            "dilate": args.dilate,
            "feather": args.feather,
        },
    )


def rect_mask_image(args: argparse.Namespace) -> None:
    with Image.open(args.input) as source:
        width, height = source.size
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    box = (
        round(width * args.left),
        round(height * args.top),
        round(width * args.right),
        round(height * args.bottom),
    )
    draw.rounded_rectangle(box, radius=round(min(width, height) * args.radius), fill=255)
    if args.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=args.feather))
    mask.save(args.output)
    write_metadata(
        args.output,
        "rect-mask-image",
        [args.input],
        {
            "left": args.left,
            "top": args.top,
            "right": args.right,
            "bottom": args.bottom,
            "radius": args.radius,
            "feather": args.feather,
        },
    )


def canny_control_image(args: argparse.Namespace) -> None:
    source = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if source is None:
        raise ValueError(f"Could not decode {args.input}")
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.2)
    edges = cv2.Canny(gray, args.low, args.high, L2gradient=True)
    cv2.imwrite(str(args.output), cv2.cvtColor(edges, cv2.COLOR_GRAY2BGR))
    write_metadata(
        args.output,
        "canny-control-image",
        [args.input],
        {"low": args.low, "high": args.high},
    )


def path_argument(value: str) -> Path:
    return Path(value).resolve()


def output_argument(value: str) -> Path:
    output = Path(value).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    harbor = commands.add_parser("harbor-control-video")
    harbor.add_argument("--input", required=True, type=path_argument)
    harbor.add_argument("--output", required=True, type=output_argument)
    harbor.add_argument("--width", type=int, default=832)
    harbor.add_argument("--height", type=int, default=480)
    harbor.add_argument("--frames", type=int, default=81)
    harbor.add_argument("--fps", type=float, default=16.0)
    harbor.set_defaults(handler=harbor_control_video)

    red = commands.add_parser("red-object-mask-video")
    red.add_argument("--input", required=True, type=path_argument)
    red.add_argument("--output", required=True, type=output_argument)
    red.add_argument("--fps", type=float, default=16.0)
    red.add_argument("--saturation", type=int, default=105)
    red.add_argument("--value", type=int, default=55)
    red.add_argument("--kernel", type=int, default=9)
    red.add_argument("--minimum-area", type=int, default=180)
    red.add_argument("--dilate", type=int, default=2)
    red.add_argument("--feather", type=int, default=3)
    red.set_defaults(handler=red_object_mask_video)

    rect = commands.add_parser("rect-mask-image")
    rect.add_argument("--input", required=True, type=path_argument)
    rect.add_argument("--output", required=True, type=output_argument)
    rect.add_argument("--left", required=True, type=float)
    rect.add_argument("--top", required=True, type=float)
    rect.add_argument("--right", required=True, type=float)
    rect.add_argument("--bottom", required=True, type=float)
    rect.add_argument("--radius", type=float, default=0.02)
    rect.add_argument("--feather", type=float, default=3.0)
    rect.set_defaults(handler=rect_mask_image)

    canny = commands.add_parser("canny-control-image")
    canny.add_argument("--input", required=True, type=path_argument)
    canny.add_argument("--output", required=True, type=output_argument)
    canny.add_argument("--low", type=int, default=80)
    canny.add_argument("--high", type=int, default=180)
    canny.set_defaults(handler=canny_control_image)

    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
