/** A complete, reviewed clip from a saved native run. */
export type RetainedVideoPreview = {
  mediaHash: string;
  decodedAudioHash?: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
};

export function retainedVideoPreviewMatches(
  preview: RetainedVideoPreview | undefined,
  media: {
    mediaHash?: string;
    decodedAudioHash?: string;
    width?: number;
    height?: number;
    frames?: number;
    fps?: number;
    durationSeconds?: number;
  },
  nativeTurntable = false,
) {
  if (!preview) return false;
  // Render 3D produces a square native orbit rather than a video-generation
  // delivery. The reviewed hash, dimensions, frame count and cadence still bind it.
  const dimensionsMatchTask = nativeTurntable
    ? preview.width >= 64 && preview.width === preview.height
    : preview.width >= 480 && preview.height >= 480;
  return (
    /^sha256:decoded-video-(framemd5|rgba):[a-f0-9]{64}$/u.test(preview.mediaHash) &&
    preview.mediaHash === media.mediaHash &&
    (preview.decodedAudioHash === undefined ||
      /^sha256:decoded-audio-pcm-s16le-48000-stereo:[a-f0-9]{64}$/u.test(preview.decodedAudioHash)) &&
    preview.decodedAudioHash === media.decodedAudioHash &&
    preview.width === media.width &&
    preview.height === media.height &&
    Number.isSafeInteger(preview.width) &&
    Number.isSafeInteger(preview.height) &&
    dimensionsMatchTask &&
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
