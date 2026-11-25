/** A complete, reviewed, silent clip reproduced from a saved native run. */
export type RetainedVideoPreview = {
  mediaHash: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
};

export function retainedVideoPreviewMatches(
  preview: RetainedVideoPreview | undefined,
  media: {
    mediaHash?: string;
    width?: number;
    height?: number;
    frames?: number;
    fps?: number;
    durationSeconds?: number;
  },
) {
  if (!preview) return false;
  return (
    /^sha256:decoded-video-(framemd5|rgba):[a-f0-9]{64}$/u.test(preview.mediaHash) &&
    preview.mediaHash === media.mediaHash &&
    preview.width === media.width &&
    preview.height === media.height &&
    Number.isSafeInteger(preview.width) &&
    Number.isSafeInteger(preview.height) &&
    preview.width >= 480 &&
    preview.height >= 480 &&
    Number.isSafeInteger(preview.frames) &&
    preview.frames >= 2 &&
    preview.frames === media.frames &&
    Number.isFinite(preview.fps) &&
    preview.fps > 0 &&
    preview.fps <= 120 &&
    (media.fps === undefined || Math.abs(media.fps - preview.fps) < 0.001) &&
    Math.abs(Number(media.durationSeconds) - preview.frames / preview.fps) <= 0.005
  );
}
