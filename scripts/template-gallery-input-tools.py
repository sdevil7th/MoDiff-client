"""Deterministic preparation tools for gallery-only multimodal inputs.

Every command derives a reviewable input from an already reviewed source asset.
The generated file is still an input, never gallery proof by itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

try:
    import cv2
except ModuleNotFoundError:
    cv2 = None

try:
    import numpy as np
except ModuleNotFoundError:
    np = None


def require_opencv(command: str) -> None:
    if cv2 is None or np is None:
        raise RuntimeError(
            f"{command} requires OpenCV and NumPy, but they are not installed in the MoDiff app runtime. "
            "Install the app's gallery-media extra (`uv sync --extra gallery-media`) and retry."
        )


def require_ffmpeg() -> str:
    configured = os.environ.get("MODIFF_FFMPEG")
    if configured:
        return configured
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "browser-preview-video requires the app's imageio-ffmpeg runtime."
        ) from error
    return get_ffmpeg_exe()


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
    require_opencv("harbor-control-video")
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


def grayscale_control_video(args: argparse.Namespace) -> None:
    """Preserve a source clip's real motion while removing appearance cues."""

    require_opencv("grayscale-control-video")
    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise ValueError(f"Could not decode {args.input}")
    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height)
    )
    if not writer.isOpened():
        capture.release()
        raise RuntimeError(f"Could not open video writer for {args.output}")
    written = 0
    while written < args.frames:
        ok, frame = capture.read()
        if not ok:
            break
        fitted = fit_cover(frame, args.width, args.height)
        gray = cv2.cvtColor(fitted, cv2.COLOR_BGR2GRAY)
        if args.blur > 0:
            kernel = max(3, int(args.blur) * 2 + 1)
            gray = cv2.GaussianBlur(gray, (kernel, kernel), 0)
        writer.write(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
        written += 1
    capture.release()
    writer.release()
    if written != args.frames:
        raise ValueError(f"Control source must provide {args.frames} frames; decoded {written}.")
    write_metadata(
        args.output,
        "grayscale-control-video",
        [args.input],
        {"width": args.width, "height": args.height, "frames": written, "fps": args.fps, "blur": args.blur},
    )


def normalize_video(args: argparse.Namespace) -> None:
    """Create an exact-length gallery input while preserving the source timeline.

    Gallery proofs lock their frame count and delivery rate. Source clips often
    use a different cadence, so reading the first N frames either shortens the
    action or changes its duration. Sample evenly over an explicit source-time
    window instead. This is deterministic and does not synthesize motion.
    """

    require_opencv("normalize-video")
    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise ValueError(f"Could not decode {args.input}")
    source_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    source_fps = float(capture.get(cv2.CAP_PROP_FPS) or args.fps)
    if source_frames <= 0 or source_fps <= 0:
        capture.release()
        raise RuntimeError("Source video did not expose a valid frame count and frame rate")

    source_duration = source_frames / source_fps
    start_seconds = max(0.0, float(args.start_seconds))
    requested_duration = float(args.duration_seconds) if args.duration_seconds > 0 else source_duration - start_seconds
    end_seconds = min(source_duration, start_seconds + requested_duration)
    if end_seconds <= start_seconds:
        capture.release()
        raise ValueError("normalize-video source window is empty")

    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height)
    )
    if not writer.isOpened():
        capture.release()
        raise RuntimeError(f"Could not open video writer for {args.output}")

    sampled_indices: list[int] = []
    for output_index in range(args.frames):
        phase = output_index / max(1, args.frames - 1)
        source_time = start_seconds + (end_seconds - start_seconds) * phase
        source_index = min(source_frames - 1, max(0, round(source_time * source_fps)))
        capture.set(cv2.CAP_PROP_POS_FRAMES, source_index)
        ok, frame = capture.read()
        if not ok:
            writer.release()
            capture.release()
            raise ValueError(f"Could not decode source frame {source_index}")
        writer.write(fit_cover(frame, args.width, args.height))
        sampled_indices.append(source_index)

    writer.release()
    capture.release()
    write_metadata(
        args.output,
        "normalize-video",
        [args.input],
        {
            "width": args.width,
            "height": args.height,
            "frames": args.frames,
            "fps": args.fps,
            "sourceFps": source_fps,
            "sourceFrameCount": source_frames,
            "startSeconds": start_seconds,
            "durationSeconds": end_seconds - start_seconds,
            "firstSourceFrame": sampled_indices[0],
            "lastSourceFrame": sampled_indices[-1],
        },
    )


def browser_preview_video(args: argparse.Namespace) -> None:
    """Create a silent browser-safe derivative without replacing a provenance source."""

    if args.input == args.output:
        raise ValueError("browser-preview-video input and output must be different files")
    ffmpeg = require_ffmpeg()
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-v",
            "error",
            "-i",
            str(args.input),
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            str(args.crf),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(args.output),
        ],
        check=True,
    )
    write_metadata(
        args.output,
        "browser-preview-video",
        [args.input],
        {
            "videoCodec": "libx264",
            "pixelFormat": "yuv420p",
            "muted": True,
            "fastStart": True,
            "crf": args.crf,
        },
    )


def outpaint_canvas_video(args: argparse.Namespace) -> None:
    require_opencv("outpaint-canvas-video")
    source = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    capture = None
    if source is None:
        capture = cv2.VideoCapture(str(args.input))
        if not capture.isOpened():
            raise ValueError(f"Could not decode {args.input}")
    if args.center_width <= args.overlap * 2 or args.center_width > args.width:
        raise ValueError("center width must fit the canvas and remain wider than twice the overlap")
    left = (args.width - args.center_width) // 2
    writer = cv2.VideoWriter(
        str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height)
    )
    mask_writer = cv2.VideoWriter(
        str(args.mask_output), cv2.VideoWriter_fourcc(*"mp4v"), args.fps, (args.width, args.height), False
    )
    if not writer.isOpened() or not mask_writer.isOpened():
        raise RuntimeError("Could not open outpaint source or mask video writer")
    mask = np.full((args.height, args.width), 255, dtype=np.uint8)
    preserved_left = left + args.overlap
    preserved_right = left + args.center_width - args.overlap
    cv2.rectangle(mask, (preserved_left, 0), (preserved_right, args.height), 0, thickness=-1)
    if args.feather > 0:
        blur = max(3, int(args.feather) * 2 + 1)
        mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    for index in range(args.frames):
        if capture is not None:
            ok, source = capture.read()
            if not ok:
                capture.release()
                writer.release()
                mask_writer.release()
                raise ValueError(f"Outpaint source must provide {args.frames} frames; decoded {index}.")
        phase = index / max(1, args.frames - 1)
        center = fit_cover(
            source,
            args.center_width,
            args.height,
            scale=1.0 + args.zoom * phase,
            pan_x=0.48 + 0.04 * phase,
        )
        canvas = np.zeros((args.height, args.width, 3), dtype=np.uint8)
        canvas[:, left : left + args.center_width] = center
        writer.write(canvas)
        mask_writer.write(mask)
    if capture is not None:
        capture.release()
    writer.release()
    mask_writer.release()
    settings = {
        "width": args.width,
        "height": args.height,
        "centerWidth": args.center_width,
        "centerLeft": left,
        "frames": args.frames,
        "fps": args.fps,
        "overlap": args.overlap,
        "feather": args.feather,
        "zoom": args.zoom,
    }
    write_metadata(args.output, "outpaint-canvas-video", [args.input], settings)
    write_metadata(args.mask_output, "outpaint-canvas-video-mask", [args.input, args.output], settings)


def largest_component(mask: np.ndarray, minimum_area: int) -> np.ndarray:
    require_opencv("red-object-mask-video")
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return np.zeros_like(mask)
    candidates = [(index, int(stats[index, cv2.CC_STAT_AREA])) for index in range(1, count)]
    index, area = max(candidates, key=lambda item: item[1])
    if area < minimum_area:
        return np.zeros_like(mask)
    return np.where(labels == index, 255, 0).astype(np.uint8)


def red_object_mask_video(args: argparse.Namespace) -> None:
    require_opencv("red-object-mask-video")
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


def rect_mask_video(args: argparse.Namespace) -> None:
    require_opencv("rect-mask-video")
    capture = cv2.VideoCapture(str(args.input))
    if not capture.isOpened():
        raise ValueError(f"Could not decode {args.input}")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = capture.get(cv2.CAP_PROP_FPS) or args.fps
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    capture.release()
    if width <= 0 or height <= 0 or frame_count <= 0:
        raise RuntimeError("Source video did not expose valid dimensions and frame count")
    left = round(width * args.left)
    top = round(height * args.top)
    right = round(width * args.right)
    bottom = round(height * args.bottom)
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError("Normalized rectangle must define a non-empty region inside the video frame")
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.rectangle(mask, (left, top), (right, bottom), 255, thickness=-1)
    if args.feather > 0:
        blur = max(3, int(args.feather) * 2 + 1)
        mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    writer = cv2.VideoWriter(str(args.output), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height), False)
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer for {args.output}")
    for _ in range(frame_count):
        writer.write(mask)
    writer.release()
    write_metadata(
        args.output,
        "rect-mask-video",
        [args.input],
        {
            "frames": frame_count,
            "fps": fps,
            "left": args.left,
            "top": args.top,
            "right": args.right,
            "bottom": args.bottom,
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


def polygon_mask_image(args: argparse.Namespace) -> None:
    with Image.open(args.input) as source:
        width, height = source.size
    points = []
    for item in args.points.split(","):
        try:
            x_value, y_value = (float(value) for value in item.split(":"))
        except (TypeError, ValueError) as error:
            raise ValueError("--points must be comma-separated normalized x:y pairs") from error
        if not 0 <= x_value <= 1 or not 0 <= y_value <= 1:
            raise ValueError("polygon mask points must stay inside the normalized 0..1 image bounds")
        points.append((round(width * x_value), round(height * y_value)))
    if len(points) < 3:
        raise ValueError("polygon-mask-image requires at least three points")
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).polygon(points, fill=255)
    if args.expand > 0:
        kernel_size = max(3, int(args.expand) * 2 + 1)
        mask = mask.filter(ImageFilter.MaxFilter(kernel_size))
    if args.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=args.feather))
    mask.save(args.output)
    write_metadata(
        args.output,
        "polygon-mask-image",
        [args.input],
        {"points": args.points, "expand": args.expand, "feather": args.feather},
    )


def grabcut_mask_image(args: argparse.Namespace) -> None:
    require_opencv("grabcut-mask-image")
    source = cv2.imread(str(args.input), cv2.IMREAD_COLOR)
    if source is None:
        raise ValueError(f"Could not decode {args.input}")
    height, width = source.shape[:2]
    left = round(width * args.left)
    top = round(height * args.top)
    right = round(width * args.right)
    bottom = round(height * args.bottom)
    if right <= left or bottom <= top:
        raise ValueError("grabcut bounds must define a non-empty rectangle")
    labels = np.zeros((height, width), np.uint8)
    background_model = np.zeros((1, 65), np.float64)
    foreground_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(
        source,
        labels,
        (left, top, right - left, bottom - top),
        background_model,
        foreground_model,
        args.iterations,
        cv2.GC_INIT_WITH_RECT,
    )
    mask = np.where((labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    mask = largest_component(mask, args.minimum_area)
    if args.close > 0:
        close_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (args.close * 2 + 1, args.close * 2 + 1))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel)
    if args.expand > 0:
        expand_kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (args.expand * 2 + 1, args.expand * 2 + 1)
        )
        mask = cv2.dilate(mask, expand_kernel, iterations=1)
    if args.feather > 0:
        blur = max(3, int(args.feather) * 2 + 1)
        mask = cv2.GaussianBlur(mask, (blur, blur), 0)
    cv2.imwrite(str(args.output), mask)
    write_metadata(
        args.output,
        "grabcut-mask-image",
        [args.input],
        {
            "left": args.left,
            "top": args.top,
            "right": args.right,
            "bottom": args.bottom,
            "iterations": args.iterations,
            "minimumArea": args.minimum_area,
            "close": args.close,
            "expand": args.expand,
            "feather": args.feather,
        },
    )


def placement_guide_image(args: argparse.Namespace) -> None:
    with Image.open(args.input) as source_file:
        source = source_file.convert("RGBA")
    width, height = source.size
    box = (
        round(width * args.left),
        round(height * args.top),
        round(width * args.right),
        round(height * args.bottom),
    )
    overlay = Image.new("RGBA", source.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    color = (0, 220, 255, 230)
    fill = (0, 220, 255, 22)
    draw.rounded_rectangle(box, radius=args.radius, outline=color, width=args.line_width, fill=fill)
    guided = Image.alpha_composite(source, overlay).convert("RGB")
    guided.save(args.output)
    write_metadata(
        args.output,
        "placement-guide-image",
        [args.input],
        {
            "left": args.left,
            "top": args.top,
            "right": args.right,
            "bottom": args.bottom,
            "lineWidth": args.line_width,
            "radius": args.radius,
            "instruction": "Place the complete subject inside the cyan box and remove the guide in the generated output.",
        },
    )


def outpaint_canvas_image(args: argparse.Namespace) -> None:
    with Image.open(args.input) as source_file:
        source = source_file.convert("RGB")
    if args.width and args.height:
        source = ImageOps.fit(
            source,
            (args.width, args.height),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.5),
        )
    source_width, source_height = source.size
    width = source_width + args.left + args.right
    height = source_height + args.top + args.bottom
    canvas = Image.new("RGB", (width, height), args.fill_color)
    canvas.paste(source, (args.left, args.top))
    canvas.save(args.output)

    mask = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(mask)
    preserved = (
        max(0, args.left + args.overlap),
        max(0, args.top + args.overlap),
        min(width, args.left + source_width - args.overlap),
        min(height, args.top + source_height - args.overlap),
    )
    draw.rectangle(preserved, fill=0)
    if args.feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(radius=args.feather))
    mask.save(args.mask_output)

    settings = {
        "left": args.left,
        "right": args.right,
        "top": args.top,
        "bottom": args.bottom,
        "overlap": args.overlap,
        "feather": args.feather,
        "fillColor": args.fill_color,
        "sourcePlacement": {"x": args.left, "y": args.top},
        "canvasSize": {"width": width, "height": height},
    }
    write_metadata(args.output, "outpaint-canvas-image", [args.input], settings)
    write_metadata(args.mask_output, "outpaint-canvas-mask", [args.input, args.output], settings)


def canny_control_image(args: argparse.Namespace) -> None:
    require_opencv("canny-control-image")
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

    grayscale = commands.add_parser("grayscale-control-video")
    grayscale.add_argument("--input", required=True, type=path_argument)
    grayscale.add_argument("--output", required=True, type=output_argument)
    grayscale.add_argument("--width", type=int, default=832)
    grayscale.add_argument("--height", type=int, default=480)
    grayscale.add_argument("--frames", type=int, default=81)
    grayscale.add_argument("--fps", type=float, default=16.0)
    grayscale.add_argument("--blur", type=int, default=1)
    grayscale.set_defaults(handler=grayscale_control_video)

    normalize = commands.add_parser("normalize-video")
    normalize.add_argument("--input", required=True, type=path_argument)
    normalize.add_argument("--output", required=True, type=output_argument)
    normalize.add_argument("--width", type=int, default=832)
    normalize.add_argument("--height", type=int, default=480)
    normalize.add_argument("--frames", type=int, default=81)
    normalize.add_argument("--fps", type=float, default=16)
    normalize.add_argument("--start-seconds", type=float, default=0)
    normalize.add_argument("--duration-seconds", type=float, default=0)
    normalize.set_defaults(handler=normalize_video)

    browser_preview = commands.add_parser("browser-preview-video")
    browser_preview.add_argument("--input", required=True, type=path_argument)
    browser_preview.add_argument("--output", required=True, type=output_argument)
    browser_preview.add_argument("--crf", type=int, default=20)
    browser_preview.set_defaults(handler=browser_preview_video)

    outpaint_video = commands.add_parser("outpaint-canvas-video")
    outpaint_video.add_argument("--input", required=True, type=path_argument)
    outpaint_video.add_argument("--output", required=True, type=output_argument)
    outpaint_video.add_argument("--mask-output", required=True, type=output_argument)
    outpaint_video.add_argument("--width", type=int, default=832)
    outpaint_video.add_argument("--height", type=int, default=480)
    outpaint_video.add_argument("--center-width", type=int, default=512)
    outpaint_video.add_argument("--frames", type=int, default=33)
    outpaint_video.add_argument("--fps", type=float, default=16.0)
    outpaint_video.add_argument("--overlap", type=int, default=16)
    outpaint_video.add_argument("--feather", type=int, default=4)
    outpaint_video.add_argument("--zoom", type=float, default=0.008)
    outpaint_video.set_defaults(handler=outpaint_canvas_video)

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

    rect_video = commands.add_parser("rect-mask-video")
    rect_video.add_argument("--input", required=True, type=path_argument)
    rect_video.add_argument("--output", required=True, type=output_argument)
    rect_video.add_argument("--fps", type=float, default=16.0)
    rect_video.add_argument("--left", required=True, type=float)
    rect_video.add_argument("--top", required=True, type=float)
    rect_video.add_argument("--right", required=True, type=float)
    rect_video.add_argument("--bottom", required=True, type=float)
    rect_video.add_argument("--feather", type=int, default=3)
    rect_video.set_defaults(handler=rect_mask_video)

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

    polygon = commands.add_parser("polygon-mask-image")
    polygon.add_argument("--input", required=True, type=path_argument)
    polygon.add_argument("--output", required=True, type=output_argument)
    polygon.add_argument("--points", required=True)
    polygon.add_argument("--expand", type=int, default=4)
    polygon.add_argument("--feather", type=float, default=3.0)
    polygon.set_defaults(handler=polygon_mask_image)

    grabcut = commands.add_parser("grabcut-mask-image")
    grabcut.add_argument("--input", required=True, type=path_argument)
    grabcut.add_argument("--output", required=True, type=output_argument)
    grabcut.add_argument("--left", required=True, type=float)
    grabcut.add_argument("--top", required=True, type=float)
    grabcut.add_argument("--right", required=True, type=float)
    grabcut.add_argument("--bottom", required=True, type=float)
    grabcut.add_argument("--iterations", type=int, default=8)
    grabcut.add_argument("--minimum-area", type=int, default=500)
    grabcut.add_argument("--close", type=int, default=2)
    grabcut.add_argument("--expand", type=int, default=4)
    grabcut.add_argument("--feather", type=int, default=3)
    grabcut.set_defaults(handler=grabcut_mask_image)

    guide = commands.add_parser("placement-guide-image")
    guide.add_argument("--input", required=True, type=path_argument)
    guide.add_argument("--output", required=True, type=output_argument)
    guide.add_argument("--left", required=True, type=float)
    guide.add_argument("--top", required=True, type=float)
    guide.add_argument("--right", required=True, type=float)
    guide.add_argument("--bottom", required=True, type=float)
    guide.add_argument("--line-width", type=int, default=6)
    guide.add_argument("--radius", type=int, default=18)
    guide.set_defaults(handler=placement_guide_image)

    outpaint = commands.add_parser("outpaint-canvas-image")
    outpaint.add_argument("--input", required=True, type=path_argument)
    outpaint.add_argument("--output", required=True, type=output_argument)
    outpaint.add_argument("--mask-output", required=True, type=output_argument)
    outpaint.add_argument("--left", type=int, default=256)
    outpaint.add_argument("--right", type=int, default=256)
    outpaint.add_argument("--top", type=int, default=0)
    outpaint.add_argument("--bottom", type=int, default=0)
    outpaint.add_argument("--overlap", type=int, default=24)
    outpaint.add_argument("--feather", type=float, default=8.0)
    outpaint.add_argument("--fill-color", default="black")
    outpaint.add_argument("--width", type=int, default=0)
    outpaint.add_argument("--height", type=int, default=0)
    outpaint.set_defaults(handler=outpaint_canvas_image)

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
