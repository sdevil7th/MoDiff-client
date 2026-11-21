import type { NodeParams } from '../stores/useNodeStore';

const EXTRACT_DETAIL_FIELDS = ['indices', 'timecodes', 'every_n'];
const EXTRACT_BOUNDARIES = ['first', 'last', 'first_last'];
const FILTER_TYPES = [
  'gaussian_blur',
  'box_blur',
  'sharpen',
  'unsharp_mask',
  'glow',
  'film_grain',
  'chromatic_aberration',
];
const FIELDS_BY_UTILITY: Record<string, Record<string, readonly string[]>> = {
  'modules.Audio.ProcessAudio': {
    audio_trim: ['start_seconds', 'duration_seconds', 'target_sample_rate', 'normalize_peak'],
    audio_join: ['reference', 'boundary_fade_seconds'],
    audio_loudness_match: ['reference', 'reference_window_seconds', 'target_peak_dbfs', 'max_adjustment_db'],
  },
  'modules.Video.ProcessVideo': {
    video_frame_extract: ['selection_mode', 'images', 'selected_indices', 'timestamps', ...EXTRACT_DETAIL_FIELDS],
    frame_interpolation: ['interpolation_fps', 'video'],
    video_stitch: ['transition_seconds', 'video'],
    video_trim: ['start_seconds', 'end_seconds', 'video'],
    video_reverse: ['video'],
    video_tile: ['columns', 'sync', 'gap', 'background', 'video'],
  },
  'modules.ImageOperations.ProcessImage': {
    image_adjustment: ['brightness', 'contrast', 'saturation', 'sharpness', 'gamma', 'temperature', 'tint'],
    image_filter: ['filter_operation', 'amount', 'threshold', 'seed'],
    image_crop: ['x', 'y', 'width', 'height'],
    image_upscale: ['resize_width', 'resize_height', 'resize_fit_mode', 'resize_resampling'],
    image_stitch: ['stitch_columns', 'stitch_spacing', 'stitch_background', 'stitch_match_size'],
    image_tile: ['rows', 'columns'],
    image_channels: ['channel'],
    mask_composite: ['mask', 'composite_mask_channel', 'composite_invert_mask'],
  },
  'modules.Text.ProcessText': {
    text_select: ['index', 'selection_mode', 'ignore_empty_lines', 'strip_line'],
    data_conversion: ['target_type'],
    graph_utility: ['alternate_source', 'condition'],
  },
};

function savedSelector(field: NodeParams | undefined) {
  if (field?.isConnected) return undefined;
  const value = field?.value ?? field?.default;
  return typeof value === 'string' ? value : undefined;
}

/** Filter only the ordinary utility presentation. Keep saved settings and handle IDs available. */
export function builtinUtilityOperationPresentation(identity: string, params: Record<string, NodeParams>) {
  if (!Object.prototype.hasOwnProperty.call(FIELDS_BY_UTILITY, identity)) return undefined;
  const fields = FIELDS_BY_UTILITY[identity]!;
  const operation = savedSelector(params.operation);
  if (!operation || !Object.prototype.hasOwnProperty.call(fields, operation)) return undefined;
  const active = new Set(fields[operation]);

  if (operation === 'video_frame_extract') {
    const selection = savedSelector(params.selection_mode);
    if (selection && [...EXTRACT_DETAIL_FIELDS, ...EXTRACT_BOUNDARIES].includes(selection)) {
      for (const field of EXTRACT_DETAIL_FIELDS) {
        if (field !== selection) active.delete(field);
      }
    }
  }
  if (operation === 'image_filter') {
    const filter = savedSelector(params.filter_operation);
    if (filter && FILTER_TYPES.includes(filter)) {
      if (filter !== 'unsharp_mask') active.delete('threshold');
      if (filter !== 'film_grain') active.delete('seed');
    }
  }
  const inactive = new Set(
    Object.values(fields)
      .flat()
      .filter((field) => !active.has(field)),
  );
  // The saved generic FPS value is unused. Frame extraction reads the source FPS,
  // and interpolation exposes its own target FPS.
  if (identity === 'modules.Video.ProcessVideo') inactive.add('fps');
  return { inactive, continuation: operation === 'audio_join' };
}
