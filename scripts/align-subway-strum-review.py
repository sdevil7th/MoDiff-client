#!/usr/bin/env python3
"""Measure and correct the selected subway guitar candidate's global A/V phase.

This is deliberately a review-stage, audio-only operation:

* the retained 121-frame video is decoded for motion analysis but never re-encoded;
* the selected PCM candidate is delayed by an integral video-frame duration;
* no tempo/time warp is applied unless the measured affine fit clears a conservative
  improvement threshold; and
* the synchronized MP4 copies the original H.264 packet stream byte-for-byte.

Run this with the MoDiff backend environment, which supplies NumPy, SciPy, and
OpenCV:

    ../MoDiff/.venv/bin/python scripts/align-subway-strum-review.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any, Iterable

try:
    import cv2
    import numpy as np
    import scipy
    from scipy.signal import butter, detrend, find_peaks, sosfiltfilt, stft
except ImportError as error:  # pragma: no cover - exercised by the CLI environment guard
    raise SystemExit(
        "This analysis needs the MoDiff backend environment. Run:\n"
        "  ../MoDiff/.venv/bin/python scripts/align-subway-strum-review.py"
    ) from error


ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = ROOT.parent / "MoDiff"
TEMPLATE_ID = "wan_22_ti2v_5b_seed_vault"
SEED = 1_684_710_282
REVIEW_ROOT = ROOT / "artifacts/template-gallery/manual-review"
SOURCE_VIDEO = REVIEW_ROOT / "archive/rejected" / TEMPLATE_ID / f"{TEMPLATE_ID}.mp4"
SOURCE_AUDIO = REVIEW_ROOT / "pending" / TEMPLATE_ID / f"03-seed-{SEED}.wav"
GENERATION_RECORD = (
    REVIEW_ROOT / "candidates" / TEMPLATE_ID / f"candidate-03-seed-{SEED}.generation.json"
)
ALIGNED_AUDIO = (
    REVIEW_ROOT / "candidates" / TEMPLATE_ID / f"candidate-03-seed-{SEED}.strum-aligned.wav"
)
SYNC_PREVIEW = (
    REVIEW_ROOT / "pending" / TEMPLATE_ID / f"03-seed-{SEED}.strum-aligned.sync-preview.mp4"
)
PROVENANCE = (
    REVIEW_ROOT / "candidates" / TEMPLATE_ID / f"candidate-03-seed-{SEED}.strum-alignment.json"
)

EXPECTED_VIDEO_SHA256 = "sha256:91850be62d66ecf829f77269d119de8216bf70ac7223bcb3f5261c2ac9a6edb8"
EXPECTED_AUDIO_SHA256 = "sha256:23ab6bd930325429120c50afcbbd5903d7fe7eae60397d0bc63a197f0c18734c"
EXPECTED_VIDEO_BITSTREAM_SHA256 = (
    "sha256:eaa9a9136c3a083aaafd7c5b1bd1ee1b741d551444be211bdece9f6c9d0f26fd"
)
EXPECTED_DECODED_VIDEO_SHA256 = (
    "sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7"
)

TARGET_WIDTH = 1280
TARGET_HEIGHT = 704
TARGET_FRAMES = 121
TARGET_FPS = 24.0
TARGET_SAMPLE_RATE = 48_000
TARGET_SAMPLES = 242_000
TARGET_CHANNELS = 2
TARGET_SAMPLE_WIDTH = 2

# The first 20 frames include the foreground train and do not provide a stable
# view of the picking hand. Frame 115 is the last full comparison frame after
# reserving filter edge support.
ANALYSIS_START_FRAME = 20
ANALYSIS_END_FRAME = 114
WALL_ROI = (300, 650, 170, 290)
HAND_ROIS = {
    "picking_hand": (835, 880, 295, 390),
    "picking_hand_core": (842, 875, 305, 375),
    "string_crossing": (845, 880, 320, 365),
    "strumming_forearm": (830, 865, 295, 350),
}
ROI_VERTICAL_DRIFT_PIXELS_PER_FRAME = -0.18
MOTION_UPPER_QUARTILE = 75.0
MOTION_BAND_HZ = (2.2, 3.5)
MOTION_FILTER_ORDER = 3

AUDIO_FFT_SIZE = 2048
AUDIO_HOP_SAMPLES = 240
AUDIO_PREEMPHASIS = 0.97
AUDIO_LOG_MAGNITUDE_SCALE = 100.0
AUDIO_FLUX_SMOOTH_BINS = 3

OFFSET_MIN_SECONDS = -0.300
OFFSET_MAX_SECONDS = 0.300
OFFSET_STEP_SECONDS = 0.001
RATE_MIN = 0.960
RATE_MAX = 1.040
RATE_STEP = 0.001
AFFINE_OFFSET_STEP_SECONDS = 0.005
ROBUST_MEAN_WEIGHT = 0.8
ROBUST_MIN_WEIGHT = 0.2
MIN_RATE_DEVIATION_FOR_WARP = 0.005
MIN_OBJECTIVE_GAIN_FOR_WARP = 0.020
MAX_EXPECTED_OFFSET_ERROR_FRAMES = 0.5
EXPECTED_DELAY_FRAMES = 4
OUTPUT_FADE_SECONDS = 0.120


def sha256_uri(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def decoded_pcm_sha256(raw_audio: bytes) -> str:
    return f"sha256:decoded-audio-pcm-s16le:{hashlib.sha256(raw_audio).hexdigest()}"


def canonical_json_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return f"sha256:canonical-json-v1:{hashlib.sha256(encoded).hexdigest()}"


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(f"{json.dumps(value, indent=2)}\n", encoding="utf-8")
    temporary.replace(path)


def find_ffmpeg() -> Path:
    configured = Path(os.environ["MODIFF_FFMPEG"]) if "MODIFF_FFMPEG" in os.environ else None
    if configured and configured.is_file():
        return configured
    roots = [
        BACKEND_ROOT / ".venv/lib",
        BACKEND_ROOT / ".venv.previous/lib",
        BACKEND_ROOT / ".venv/Lib/site-packages/imageio_ffmpeg/binaries",
    ]
    for root in roots:
        if not root.exists():
            continue
        for executable in sorted(root.glob("python*/site-packages/imageio_ffmpeg/binaries/ffmpeg*")):
            if executable.is_file():
                return executable
        for executable in sorted(root.glob("ffmpeg*")):
            if executable.is_file():
                return executable
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return Path(system_ffmpeg)
    raise RuntimeError("Could not find FFmpeg in the backend environment or PATH.")


def run_checked(command: list[str], *, capture_output: bool = True) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        command,
        check=False,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Command failed ({result.returncode}): {' '.join(command)}\n{detail}")
    return result


def command_stdout_sha256(command: list[str]) -> str:
    result = run_checked(command)
    return f"sha256:{hashlib.sha256(result.stdout).hexdigest()}"


def video_bitstream_sha256(ffmpeg: Path, path: Path) -> str:
    return command_stdout_sha256(
        [
            str(ffmpeg),
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-c",
            "copy",
            "-f",
            "data",
            "-",
        ]
    )


def decoded_video_sha256(ffmpeg: Path, path: Path) -> str:
    result = run_checked(
        [
            str(ffmpeg),
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            "0:v:0",
            "-an",
            "-f",
            "framemd5",
            "-",
        ]
    )
    return (
        "sha256:decoded-video-framemd5:"
        f"{hashlib.sha256(result.stdout).hexdigest()}"
    )


def ffmpeg_version(ffmpeg: Path) -> str:
    result = run_checked([str(ffmpeg), "-version"])
    return result.stdout.decode("utf-8", errors="replace").splitlines()[0]


def load_pcm16_stereo(path: Path) -> tuple[np.ndarray, dict[str, Any]]:
    with wave.open(str(path), "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        sample_rate = source.getframerate()
        frames = source.getnframes()
        compression = source.getcomptype()
        raw_audio = source.readframes(frames)
    actual = {
        "frames": frames,
        "sampleRate": sample_rate,
        "channels": channels,
        "sampleWidthBytes": sample_width,
        "compressionType": compression,
        "encodedSha256": sha256_uri(path),
        "decodedSha256": decoded_pcm_sha256(raw_audio),
    }
    expected = {
        "frames": TARGET_SAMPLES,
        "sampleRate": TARGET_SAMPLE_RATE,
        "channels": TARGET_CHANNELS,
        "sampleWidthBytes": TARGET_SAMPLE_WIDTH,
        "compressionType": "NONE",
    }
    mismatches = [
        f"{key}={actual[key]!r}, expected {value!r}"
        for key, value in expected.items()
        if actual[key] != value
    ]
    if mismatches:
        raise RuntimeError(f"Selected audio violates the review contract: {'; '.join(mismatches)}")
    samples = np.frombuffer(raw_audio, dtype="<i2").reshape(frames, channels).copy()
    return samples, actual


def load_video_frames(path: Path) -> tuple[list[np.ndarray], dict[str, Any]]:
    cv2.setNumThreads(1)
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"OpenCV could not open the retained video: {path}")
    metadata = {
        "width": int(round(capture.get(cv2.CAP_PROP_FRAME_WIDTH))),
        "height": int(round(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))),
        "fps": float(capture.get(cv2.CAP_PROP_FPS)),
        "reportedFrames": int(round(capture.get(cv2.CAP_PROP_FRAME_COUNT))),
    }
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).astype(np.float32))
    capture.release()
    expected = {
        "width": TARGET_WIDTH,
        "height": TARGET_HEIGHT,
        "reportedFrames": TARGET_FRAMES,
    }
    mismatches = [
        f"{key}={metadata[key]!r}, expected {value!r}"
        for key, value in expected.items()
        if metadata[key] != value
    ]
    if not math.isclose(metadata["fps"], TARGET_FPS, abs_tol=1e-6):
        mismatches.append(f"fps={metadata['fps']!r}, expected {TARGET_FPS!r}")
    if len(frames) != TARGET_FRAMES:
        mismatches.append(f"decodedFrames={len(frames)!r}, expected {TARGET_FRAMES!r}")
    if mismatches:
        raise RuntimeError(f"Retained video violates the review contract: {'; '.join(mismatches)}")
    metadata["decodedFrames"] = len(frames)
    return frames, metadata


def linear_detrend(signal: np.ndarray) -> np.ndarray:
    return np.asarray(detrend(signal), dtype=np.float64)


def bandpass(signal: np.ndarray, sample_rate: float) -> np.ndarray:
    filter_coefficients = butter(
        MOTION_FILTER_ORDER,
        MOTION_BAND_HZ,
        btype="bandpass",
        fs=sample_rate,
        output="sos",
    )
    return np.asarray(
        sosfiltfilt(filter_coefficients, linear_detrend(np.log1p(signal))),
        dtype=np.float64,
    )


def motion_signals(frames: list[np.ndarray]) -> tuple[dict[str, np.ndarray], list[list[float]]]:
    signals = {name: [0.0] for name in HAND_ROIS}
    camera_shifts: list[list[float]] = [[0.0, 0.0]]
    wall_x0, wall_x1, wall_y0, wall_y1 = WALL_ROI
    for frame_index in range(1, len(frames)):
        previous = frames[frame_index - 1]
        current = frames[frame_index]
        shift, _response = cv2.phaseCorrelate(
            previous[wall_y0:wall_y1, wall_x0:wall_x1],
            current[wall_y0:wall_y1, wall_x0:wall_x1],
        )
        camera_shifts.append([float(shift[0]), float(shift[1])])
        inverse_camera = np.array(
            [[1.0, 0.0, -shift[0]], [0.0, 1.0, -shift[1]]],
            dtype=np.float32,
        )
        stabilized = cv2.warpAffine(
            current,
            inverse_camera,
            (current.shape[1], current.shape[0]),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT,
        )
        frame_difference = np.abs(stabilized - previous)
        vertical_shift = round(ROI_VERTICAL_DRIFT_PIXELS_PER_FRAME * frame_index)
        for name, (x0, x1, y0, y1) in HAND_ROIS.items():
            roi = frame_difference[y0 + vertical_shift : y1 + vertical_shift, x0:x1]
            threshold = np.percentile(roi, MOTION_UPPER_QUARTILE)
            upper_quartile = roi[roi >= threshold]
            signals[name].append(float(np.mean(upper_quartile)))
    return (
        {name: bandpass(np.asarray(signal), TARGET_FPS) for name, signal in signals.items()},
        camera_shifts,
    )


def spectral_flux(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mono = samples.astype(np.float64).mean(axis=1) / 32768.0
    preemphasized = np.concatenate(
        ([mono[0]], mono[1:] - AUDIO_PREEMPHASIS * mono[:-1])
    )
    _frequencies, times, spectrum = stft(
        preemphasized,
        fs=TARGET_SAMPLE_RATE,
        nperseg=AUDIO_FFT_SIZE,
        noverlap=AUDIO_FFT_SIZE - AUDIO_HOP_SAMPLES,
        nfft=AUDIO_FFT_SIZE,
        boundary=None,
        padded=False,
    )
    magnitude = np.log1p(AUDIO_LOG_MAGNITUDE_SCALE * np.abs(spectrum))
    flux = np.concatenate(
        ([0.0], np.maximum(0.0, np.diff(magnitude, axis=1)).sum(axis=0))
    )
    flux = np.convolve(
        flux,
        np.ones(AUDIO_FLUX_SMOOTH_BINS) / AUDIO_FLUX_SMOOTH_BINS,
        mode="same",
    )
    return np.asarray(times), np.asarray(flux)


def normalized(signal: np.ndarray, mask: np.ndarray) -> np.ndarray:
    center = float(np.mean(signal[mask]))
    scale = float(np.std(signal[mask]))
    if scale <= 1e-12:
        raise RuntimeError("Cannot normalize a constant alignment signal.")
    return (signal - center) / scale


def correlation_score(
    video_signals: dict[str, np.ndarray],
    flux_times: np.ndarray,
    flux: np.ndarray,
    *,
    rate: float,
    source_offset_seconds: float,
    frame_times: np.ndarray,
    mask: np.ndarray,
) -> dict[str, Any]:
    source_times = rate * frame_times + source_offset_seconds
    sampled_flux = np.interp(source_times, flux_times, flux, left=0.0, right=0.0)
    audio_signal = bandpass(sampled_flux, TARGET_FPS)
    correlations: dict[str, float] = {}
    for name, video_signal in video_signals.items():
        correlations[name] = float(
            np.mean(
                normalized(video_signal, mask)[mask]
                * normalized(audio_signal, mask)[mask]
            )
        )
    values = list(correlations.values())
    mean_score = float(np.mean(values))
    minimum_score = float(np.min(values))
    objective = ROBUST_MEAN_WEIGHT * mean_score + ROBUST_MIN_WEIGHT * minimum_score
    return {
        "objective": objective,
        "meanCorrelation": mean_score,
        "minimumRoiCorrelation": minimum_score,
        "roiCorrelations": correlations,
        "audioSignal": audio_signal,
    }


def inclusive_grid(start: float, stop: float, step: float) -> Iterable[float]:
    count = round((stop - start) / step)
    for index in range(count + 1):
        yield start + index * step


def best_offset_fit(
    video_signals: dict[str, np.ndarray],
    flux_times: np.ndarray,
    flux: np.ndarray,
    frame_times: np.ndarray,
    mask: np.ndarray,
) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for offset in inclusive_grid(OFFSET_MIN_SECONDS, OFFSET_MAX_SECONDS, OFFSET_STEP_SECONDS):
        score = correlation_score(
            video_signals,
            flux_times,
            flux,
            rate=1.0,
            source_offset_seconds=offset,
            frame_times=frame_times,
            mask=mask,
        )
        candidate = {"rate": 1.0, "sourceOffsetSeconds": offset, **score}
        if best is None or candidate["objective"] > best["objective"]:
            best = candidate
    assert best is not None
    return best


def best_affine_fit(
    video_signals: dict[str, np.ndarray],
    flux_times: np.ndarray,
    flux: np.ndarray,
    frame_times: np.ndarray,
    mask: np.ndarray,
) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for rate in inclusive_grid(RATE_MIN, RATE_MAX, RATE_STEP):
        for offset in inclusive_grid(
            OFFSET_MIN_SECONDS,
            OFFSET_MAX_SECONDS,
            AFFINE_OFFSET_STEP_SECONDS,
        ):
            score = correlation_score(
                video_signals,
                flux_times,
                flux,
                rate=rate,
                source_offset_seconds=offset,
                frame_times=frame_times,
                mask=mask,
            )
            candidate = {"rate": rate, "sourceOffsetSeconds": offset, **score}
            if best is None or candidate["objective"] > best["objective"]:
                best = candidate
    assert best is not None
    return best


def compact_score(score: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in score.items()
        if key != "audioSignal"
    }


def should_time_warp(offset_fit: dict[str, Any], affine_fit: dict[str, Any]) -> bool:
    return (
        abs(float(affine_fit["rate"]) - 1.0) >= MIN_RATE_DEVIATION_FOR_WARP
        and float(affine_fit["objective"]) - float(offset_fit["objective"])
        >= MIN_OBJECTIVE_GAIN_FOR_WARP
    )


def peak_times(signal: np.ndarray, mask: np.ndarray) -> list[float]:
    normalized_signal = normalized(signal, mask)
    peaks, _properties = find_peaks(
        normalized_signal,
        distance=6,
        prominence=0.2,
    )
    return [
        float(frame / TARGET_FPS)
        for frame in peaks
        if mask[frame]
    ]


def nearest_peak_errors(reference: list[float], candidate: list[float]) -> list[float]:
    if not reference or not candidate:
        return []
    return [min(abs(time - other) for other in candidate) for time in reference]


def align_pcm(
    samples: np.ndarray,
    *,
    delay_frames: int,
    fade_seconds: float,
) -> tuple[np.ndarray, dict[str, Any]]:
    if delay_frames < 0:
        raise ValueError("This reviewed alignment expects a non-negative audio delay.")
    delay_samples = round(delay_frames * TARGET_SAMPLE_RATE / TARGET_FPS)
    output = np.zeros_like(samples)
    retained = samples.shape[0] - delay_samples
    if retained <= 0:
        raise ValueError("The requested delay would remove the entire source.")
    output[delay_samples:] = samples[:retained]
    fade_samples = min(round(fade_seconds * TARGET_SAMPLE_RATE), retained)
    if fade_samples:
        phase = np.arange(fade_samples, dtype=np.float64) / max(1, fade_samples - 1)
        gain = np.cos((math.pi / 2) * phase)
        faded = np.rint(output[-fade_samples:].astype(np.float64) * gain[:, None])
        output[-fade_samples:] = np.clip(faded, -32768, 32767).astype("<i2")
    return output, {
        "delayVideoFrames": delay_frames,
        "delaySamples": delay_samples,
        "delaySeconds": delay_samples / TARGET_SAMPLE_RATE,
        "retainedSourceSamples": retained,
        "truncatedTailSamples": delay_samples,
        "truncatedTailSeconds": delay_samples / TARGET_SAMPLE_RATE,
        "outputFadeSamples": fade_samples,
        "outputFadeSeconds": fade_samples / TARGET_SAMPLE_RATE,
        "outputFadeCurve": "half-cosine",
        "tempoRate": 1.0,
        "timeWarpApplied": False,
    }


def write_pcm16_stereo(path: Path, samples: np.ndarray) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    with wave.open(str(temporary), "wb") as target:
        target.setnchannels(TARGET_CHANNELS)
        target.setsampwidth(TARGET_SAMPLE_WIDTH)
        target.setframerate(TARGET_SAMPLE_RATE)
        target.writeframes(samples.astype("<i2", copy=False).tobytes())
    temporary.replace(path)
    _samples, metadata = load_pcm16_stereo(path)
    return metadata


def mux_preview(ffmpeg: Path, video: Path, audio: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    run_checked(
        [
            str(ffmpeg),
            "-y",
            "-v",
            "error",
            "-i",
            str(video),
            "-i",
            str(audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "256k",
            "-ar",
            str(TARGET_SAMPLE_RATE),
            "-ac",
            str(TARGET_CHANNELS),
            "-shortest",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            str(temporary),
        ]
    )
    temporary.replace(output)


def validate_source_hashes() -> dict[str, Any]:
    required = (SOURCE_VIDEO, SOURCE_AUDIO, GENERATION_RECORD)
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise RuntimeError(f"Required retained input is missing: {', '.join(missing)}")
    video_hash = sha256_uri(SOURCE_VIDEO)
    audio_hash = sha256_uri(SOURCE_AUDIO)
    if video_hash != EXPECTED_VIDEO_SHA256:
        raise RuntimeError(
            f"Retained video changed: {video_hash}; expected {EXPECTED_VIDEO_SHA256}"
        )
    if audio_hash != EXPECTED_AUDIO_SHA256:
        raise RuntimeError(
            f"Selected candidate changed: {audio_hash}; expected {EXPECTED_AUDIO_SHA256}"
        )
    generation = json.loads(GENERATION_RECORD.read_text(encoding="utf-8"))
    if generation.get("templateId") != TEMPLATE_ID or generation.get("seed") != SEED:
        raise RuntimeError("The candidate generation record does not identify the selected take.")
    final_media_hash = (generation.get("media") or {}).get("encodedSha256")
    if final_media_hash != EXPECTED_AUDIO_SHA256:
        raise RuntimeError(
            "The candidate generation record does not bind the selected reviewed WAV."
        )
    return {
        "videoEncodedSha256": video_hash,
        "audioEncodedSha256": audio_hash,
        "generationRecordSha256": sha256_uri(GENERATION_RECORD),
        "generationRecordCanonicalSha256": canonical_json_sha256(generation),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze and globally phase-align the selected subway strumming candidate."
    )
    parser.add_argument(
        "--analyze-only",
        action="store_true",
        help="Print the deterministic decision without writing aligned media.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace this script's existing derived aligned media and provenance.",
    )
    args = parser.parse_args()

    outputs = (ALIGNED_AUDIO, SYNC_PREVIEW, PROVENANCE)
    existing = [str(path) for path in outputs if path.exists()]
    if existing and not args.analyze_only and not args.overwrite:
        parser.error(
            "derived output already exists; pass --overwrite to reproduce it: "
            f"{', '.join(existing)}"
        )

    try:
        input_hashes = validate_source_hashes()
        ffmpeg = find_ffmpeg()
        source_bitstream_hash = video_bitstream_sha256(ffmpeg, SOURCE_VIDEO)
        source_decoded_video_hash = decoded_video_sha256(ffmpeg, SOURCE_VIDEO)
        if source_bitstream_hash != EXPECTED_VIDEO_BITSTREAM_SHA256:
            raise RuntimeError(
                f"Retained H.264 bitstream changed: {source_bitstream_hash}; "
                f"expected {EXPECTED_VIDEO_BITSTREAM_SHA256}"
            )
        if source_decoded_video_hash != EXPECTED_DECODED_VIDEO_SHA256:
            raise RuntimeError(
                f"Retained decoded frames changed: {source_decoded_video_hash}; "
                f"expected {EXPECTED_DECODED_VIDEO_SHA256}"
            )

        samples, source_audio_metadata = load_pcm16_stereo(SOURCE_AUDIO)
        frames, source_video_metadata = load_video_frames(SOURCE_VIDEO)
        video_signals, camera_shifts = motion_signals(frames)
        flux_times, flux = spectral_flux(samples)
        frame_times = np.arange(TARGET_FRAMES, dtype=np.float64) / TARGET_FPS
        mask = (
            (np.arange(TARGET_FRAMES) >= ANALYSIS_START_FRAME)
            & (np.arange(TARGET_FRAMES) <= ANALYSIS_END_FRAME)
        )

        baseline = correlation_score(
            video_signals,
            flux_times,
            flux,
            rate=1.0,
            source_offset_seconds=0.0,
            frame_times=frame_times,
            mask=mask,
        )
        offset_fit = best_offset_fit(
            video_signals,
            flux_times,
            flux,
            frame_times,
            mask,
        )
        affine_fit = best_affine_fit(
            video_signals,
            flux_times,
            flux,
            frame_times,
            mask,
        )
        if should_time_warp(offset_fit, affine_fit):
            raise RuntimeError(
                "This take unexpectedly justified a tempo warp. Stop for a fresh human review "
                "instead of silently changing the accepted alignment policy."
            )

        measured_delay_frames = -float(offset_fit["sourceOffsetSeconds"]) * TARGET_FPS
        if abs(measured_delay_frames - EXPECTED_DELAY_FRAMES) > MAX_EXPECTED_OFFSET_ERROR_FRAMES:
            raise RuntimeError(
                f"Measured delay drifted to {measured_delay_frames:.3f} frames; expected "
                f"{EXPECTED_DELAY_FRAMES} ± {MAX_EXPECTED_OFFSET_ERROR_FRAMES}."
            )
        chosen_source_offset = -EXPECTED_DELAY_FRAMES / TARGET_FPS
        chosen = correlation_score(
            video_signals,
            flux_times,
            flux,
            rate=1.0,
            source_offset_seconds=chosen_source_offset,
            frame_times=frame_times,
            mask=mask,
        )
        normalized_video_signals = [
            normalized(signal, mask) for signal in video_signals.values()
        ]
        composite_video_signal = np.mean(normalized_video_signals, axis=0)
        visual_peaks = peak_times(composite_video_signal, mask)
        aligned_audio_peaks = peak_times(chosen["audioSignal"], mask)
        peak_errors = nearest_peak_errors(visual_peaks, aligned_audio_peaks)

        decision = {
            "operation": "delay_audio_only",
            "measuredBestSourceOffsetSeconds": float(offset_fit["sourceOffsetSeconds"]),
            "measuredBestDelaySeconds": -float(offset_fit["sourceOffsetSeconds"]),
            "measuredBestDelayVideoFrames": measured_delay_frames,
            "chosenSourceTimeMap": "source_time = video_time - 4/24 seconds",
            "chosenDelayVideoFrames": EXPECTED_DELAY_FRAMES,
            "chosenDelaySeconds": EXPECTED_DELAY_FRAMES / TARGET_FPS,
            "chosenDelaySamples": round(
                EXPECTED_DELAY_FRAMES * TARGET_SAMPLE_RATE / TARGET_FPS
            ),
            "tempoRate": 1.0,
            "timeWarpApplied": False,
            "timeWarpReason": (
                "The affine optimum is within the no-warp deadband and does not improve the "
                "robust objective enough to justify altering tempo."
            ),
        }
        analysis = {
            "format": "modiff.strum-motion-audio-onset-alignment.v1",
            "analysisFrameRangeInclusive": [
                ANALYSIS_START_FRAME,
                ANALYSIS_END_FRAME,
            ],
            "analysisTimeRangeSeconds": [
                ANALYSIS_START_FRAME / TARGET_FPS,
                ANALYSIS_END_FRAME / TARGET_FPS,
            ],
            "occlusionExclusion": (
                "Frames 0-19 are excluded because the foreground train obscures or contaminates "
                "the picking-hand motion measurement."
            ),
            "wallStabilizationRoi": list(WALL_ROI),
            "handRois": {name: list(roi) for name, roi in HAND_ROIS.items()},
            "roiVerticalDriftPixelsPerFrame": ROI_VERTICAL_DRIFT_PIXELS_PER_FRAME,
            "motionStatistic": f"mean of pixels at or above percentile {MOTION_UPPER_QUARTILE:g}",
            "motionBandHz": list(MOTION_BAND_HZ),
            "motionFilterOrder": MOTION_FILTER_ORDER,
            "audioFftSize": AUDIO_FFT_SIZE,
            "audioHopSamples": AUDIO_HOP_SAMPLES,
            "audioPreemphasis": AUDIO_PREEMPHASIS,
            "offsetSearchSeconds": {
                "min": OFFSET_MIN_SECONDS,
                "max": OFFSET_MAX_SECONDS,
                "step": OFFSET_STEP_SECONDS,
            },
            "affineSearch": {
                "rateMin": RATE_MIN,
                "rateMax": RATE_MAX,
                "rateStep": RATE_STEP,
                "offsetStepSeconds": AFFINE_OFFSET_STEP_SECONDS,
            },
            "objectiveWeights": {
                "meanRoiCorrelation": ROBUST_MEAN_WEIGHT,
                "minimumRoiCorrelation": ROBUST_MIN_WEIGHT,
            },
            "baseline": compact_score(baseline),
            "bestOffsetOnly": compact_score(offset_fit),
            "bestAffine": compact_score(affine_fit),
            "chosenFrameQuantizedFit": compact_score(chosen),
            "objectiveImprovementOverBaseline": (
                float(chosen["objective"]) - float(baseline["objective"])
            ),
            "visualMotionPeakTimesSeconds": visual_peaks,
            "alignedAudioPeakTimesSeconds": aligned_audio_peaks,
            "nearestPeakAbsoluteErrorsSeconds": peak_errors,
            "nearestPeakMeanAbsoluteErrorSeconds": (
                float(np.mean(peak_errors)) if peak_errors else None
            ),
            "nearestPeakMedianAbsoluteErrorSeconds": (
                float(np.median(peak_errors)) if peak_errors else None
            ),
            "cameraShiftSummaryPixels": {
                "horizontalMin": float(np.min(np.asarray(camera_shifts)[:, 0])),
                "horizontalMax": float(np.max(np.asarray(camera_shifts)[:, 0])),
                "verticalMin": float(np.min(np.asarray(camera_shifts)[:, 1])),
                "verticalMax": float(np.max(np.asarray(camera_shifts)[:, 1])),
            },
        }

        if args.analyze_only:
            print(
                json.dumps(
                    {
                        "analyzeOnly": True,
                        "decision": decision,
                        "analysis": analysis,
                    },
                    indent=2,
                )
            )
            return 0

        aligned_samples, pcm_operation = align_pcm(
            samples,
            delay_frames=EXPECTED_DELAY_FRAMES,
            fade_seconds=OUTPUT_FADE_SECONDS,
        )
        aligned_audio_metadata = write_pcm16_stereo(ALIGNED_AUDIO, aligned_samples)
        mux_preview(ffmpeg, SOURCE_VIDEO, ALIGNED_AUDIO, SYNC_PREVIEW)
        output_bitstream_hash = video_bitstream_sha256(ffmpeg, SYNC_PREVIEW)
        output_decoded_video_hash = decoded_video_sha256(ffmpeg, SYNC_PREVIEW)
        if output_bitstream_hash != source_bitstream_hash:
            raise RuntimeError(
                "The synchronized preview did not preserve the source H.264 packet stream."
            )
        if output_decoded_video_hash != source_decoded_video_hash:
            raise RuntimeError(
                "The synchronized preview did not preserve the source decoded video frames."
            )

        provenance = {
            "schemaVersion": 1,
            "format": "modiff.manual-review.strum-alignment.v1",
            "templateId": TEMPLATE_ID,
            "status": "ready_for_sync_review",
            "selectedCandidate": {
                "candidateIndex": 3,
                "seed": SEED,
                "path": str(SOURCE_AUDIO),
                **source_audio_metadata,
                "generationRecord": str(GENERATION_RECORD),
                "generationRecordSha256": input_hashes["generationRecordSha256"],
                "generationRecordCanonicalSha256": input_hashes[
                    "generationRecordCanonicalSha256"
                ],
            },
            "sourceVideo": {
                "path": str(SOURCE_VIDEO),
                **source_video_metadata,
                "encodedSha256": input_hashes["videoEncodedSha256"],
                "videoBitstreamSha256": source_bitstream_hash,
                "decodedVideoSha256": source_decoded_video_hash,
            },
            "decision": decision,
            "analysis": analysis,
            "pcmOperation": pcm_operation,
            "outputs": {
                "alignedAudio": {
                    "path": str(ALIGNED_AUDIO),
                    **aligned_audio_metadata,
                },
                "syncPreview": {
                    "path": str(SYNC_PREVIEW),
                    "encodedSha256": sha256_uri(SYNC_PREVIEW),
                    "videoBitstreamSha256": output_bitstream_hash,
                    "decodedVideoSha256": output_decoded_video_hash,
                    "videoCodecOperation": "stream-copy",
                    "audioCodec": "AAC",
                    "audioBitrate": "256k",
                },
            },
            "validation": {
                "sourceHashesMatchedRetainedEvidence": True,
                "alignedAudioContractPassed": True,
                "videoBitstreamUnchanged": True,
                "decodedVideoFramesUnchanged": True,
                "videoRegenerated": False,
                "humanSyncReviewStillRequired": True,
            },
            "software": {
                "python": sys.version.split()[0],
                "numpy": np.__version__,
                "scipy": scipy.__version__,
                "opencv": cv2.__version__,
                "ffmpeg": ffmpeg_version(ffmpeg),
                "script": str(Path(__file__).resolve()),
                "scriptSha256": sha256_uri(Path(__file__).resolve()),
            },
        }
        write_json_atomic(PROVENANCE, provenance)
        print(
            json.dumps(
                {
                    "status": provenance["status"],
                    "decision": decision,
                    "metrics": {
                        "baselineObjective": baseline["objective"],
                        "alignedObjective": chosen["objective"],
                        "alignedMeanCorrelation": chosen["meanCorrelation"],
                        "nearestPeakMeanAbsoluteErrorSeconds": analysis[
                            "nearestPeakMeanAbsoluteErrorSeconds"
                        ],
                    },
                    "alignedAudio": str(ALIGNED_AUDIO),
                    "syncPreview": str(SYNC_PREVIEW),
                    "provenance": str(PROVENANCE),
                    "videoBitstreamSha256": output_bitstream_hash,
                },
                indent=2,
            )
        )
        return 0
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as error:
        print(f"Alignment failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
