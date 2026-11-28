/** Gallery curation evidence for a complete short source clip, never a Run limit. */
export type SourceVideoTiming = {
  schemaVersion: 1;
  sourceMediaHash: string;
  frames: number;
  fps: number;
};

export function sourceVideoTimingMatches(
  timing: SourceVideoTiming | undefined,
  media: { frames?: number; durationSeconds?: number; fps?: number },
) {
  if (
    !timing ||
    timing.schemaVersion !== 1 ||
    !/^sha256:bytes:[a-f0-9]{64}$/u.test(timing.sourceMediaHash) ||
    !Number.isSafeInteger(timing.frames) ||
    timing.frames < 2 ||
    timing.frames > 480 ||
    !Number.isFinite(timing.fps) ||
    timing.fps <= 0 ||
    timing.fps > 120 ||
    media.frames !== timing.frames ||
    !Number.isFinite(media.durationSeconds) ||
    // FFmpeg's text probe rounds duration to centiseconds. Its independently
    // parsed FPS plus the complete decoded frame count retain exact cadence.
    Math.abs(Number(media.durationSeconds) - timing.frames / timing.fps) > (media.fps === undefined ? 0.0001 : 0.005)
  )
    return false;
  const fps = media.fps ?? Number(media.frames) / Number(media.durationSeconds);
  return Number.isFinite(fps) && Math.abs(fps - timing.fps) < 0.001;
}
