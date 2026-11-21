import type { NodeParams } from '../stores/useNodeStore';

const AUDIO_FIELDS: Record<string, readonly string[]> = {
  audio_trim: ['start_seconds', 'duration_seconds', 'target_sample_rate', 'normalize_peak'],
  audio_join: ['reference', 'boundary_fade_seconds'],
  audio_loudness_match: ['reference', 'reference_window_seconds', 'target_peak_dbfs', 'max_adjustment_db'],
};

const VIDEO_FIELDS: Record<string, readonly string[]> = {
  video_frame_extract: ['selection_mode', 'images', 'selected_indices', 'timestamps'],
  frame_interpolation: ['interpolation_fps', 'video'],
  video_stitch: ['transition_seconds', 'video'],
  video_trim: ['start_seconds', 'end_seconds', 'video'],
  video_reverse: ['video'],
  video_tile: ['columns', 'sync', 'gap', 'background', 'video'],
};

const EXTRACT_DETAIL_FIELDS = ['indices', 'timecodes', 'every_n'];
const EXTRACT_BOUNDARIES = ['first', 'last', 'first_last'];
const ALL_AUDIO_FIELDS = new Set(Object.values(AUDIO_FIELDS).flat());
const ALL_VIDEO_FIELDS = new Set([...Object.values(VIDEO_FIELDS).flat(), ...EXTRACT_DETAIL_FIELDS, 'fps']);

function savedSelector(field: NodeParams | undefined) {
  if (field?.isConnected) return undefined;
  const value = field?.value ?? field?.default;
  return typeof value === 'string' ? value : undefined;
}

/** Filter only the ordinary utility presentation. Keep saved settings and handle IDs available. */
export function builtinMediaOperationPresentation(identity: string, params: Record<string, NodeParams>) {
  const operation = savedSelector(params.operation);
  if (!operation) return undefined;

  if (identity === 'modules.Audio.ProcessAudio' && Object.prototype.hasOwnProperty.call(AUDIO_FIELDS, operation)) {
    const active = AUDIO_FIELDS[operation]!;
    return {
      inactive: new Set([...ALL_AUDIO_FIELDS].filter((field) => !active.includes(field))),
      continuation: operation === 'audio_join',
    };
  }

  if (identity === 'modules.Video.ProcessVideo' && Object.prototype.hasOwnProperty.call(VIDEO_FIELDS, operation)) {
    const active = new Set(VIDEO_FIELDS[operation]);
    if (operation === 'video_frame_extract') {
      const selection = savedSelector(params.selection_mode);
      if (selection && EXTRACT_DETAIL_FIELDS.includes(selection)) active.add(selection);
      else if (!selection || !EXTRACT_BOUNDARIES.includes(selection)) {
        for (const field of EXTRACT_DETAIL_FIELDS) active.add(field);
      }
    }
    return { inactive: new Set([...ALL_VIDEO_FIELDS].filter((field) => !active.has(field))) };
  }
  return undefined;
}
