import { isOptionDescriptor } from '../studio/runtimeOptions';
import type { NodeParamOptions, NodeParams } from '../stores/useNodeStore';

const DIRECT_IMAGE_FILTER = 'modules.ImageOperations.FilterImage';
const DIRECT_FRAME_EXTRACT = 'modules.Video.FrameExtract';
const FILTER_LABELS = {
  gaussian_blur: 'Gaussian Blur',
  box_blur: 'Box Blur',
  sharpen: 'Sharpen',
  unsharp_mask: 'Unsharp Mask',
  glow: 'Glow',
  film_grain: 'Film Grain',
  chromatic_aberration: 'Chromatic Aberration',
};

const FRAME_SELECTION_LABELS = {
  first: 'First Frame',
  last: 'Last Frame',
  first_last: 'First and Last Frames',
  indices: 'Frame Indices',
  timecodes: 'Timecodes',
  every_n: 'Every N Frames',
};

const UTILITY_OPTION_LABELS: Record<string, Record<string, Record<string, string>>> = {
  'modules.Audio.ProcessAudio': {
    operation: { audio_trim: 'Trim Audio', audio_join: 'Join Audio', audio_loudness_match: 'Match Loudness' },
  },
  'modules.Video.ProcessVideo': {
    operation: {
      video_frame_extract: 'Extract Frames',
      frame_interpolation: 'Interpolate Frames',
      video_stitch: 'Stitch Clips',
      video_trim: 'Trim Video',
      video_reverse: 'Reverse Video',
      video_tile: 'Tile Clips',
    },
    selection_mode: FRAME_SELECTION_LABELS,
  },
  'modules.ImageOperations.ProcessImage': {
    operation: {
      image_adjustment: 'Adjust Image',
      image_filter: 'Filter Image',
      image_crop: 'Crop Image',
      image_upscale: 'Resize Image',
      image_stitch: 'Stitch Images',
      image_tile: 'Split into Tiles',
      image_channels: 'Extract Channels',
      mask_composite: 'Composite with Mask',
    },
    filter_operation: FILTER_LABELS,
  },
  [DIRECT_IMAGE_FILTER]: { operation: FILTER_LABELS },
  [DIRECT_FRAME_EXTRACT]: { mode: FRAME_SELECTION_LABELS },
};

/** Label stock enum values without replacing saved choices or authored option labels. */
export function builtinUtilityOptionPresentation(identity: string, field: string, options: NodeParamOptions) {
  const labels = UTILITY_OPTION_LABELS[identity]?.[field];
  if (!labels || !Array.isArray(options)) return options;
  const hasLabel = (value: string) => Object.prototype.hasOwnProperty.call(labels, value);
  return options.map((option) => {
    if (typeof option === 'string' && hasLabel(option)) return { value: option, label: labels[option] };
    if (isOptionDescriptor(option) && option.label === option.value && hasLabel(option.value))
      return { ...option, label: labels[option.value] };
    return option;
  });
}

const EXTRACT_DETAIL_FIELDS = ['indices', 'timecodes', 'every_n'];
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

function inactiveFilterControls(filter: NodeParams | undefined) {
  const value = savedSelector(filter);
  if (!value || !Object.prototype.hasOwnProperty.call(FILTER_LABELS, value)) return [];
  const inactive: string[] = [];
  if (value !== 'unsharp_mask') inactive.push('threshold');
  if (value !== 'film_grain') inactive.push('seed');
  return inactive;
}

function inactiveFrameSelectionControls(selection: NodeParams | undefined) {
  const value = savedSelector(selection);
  if (!value || !Object.prototype.hasOwnProperty.call(FRAME_SELECTION_LABELS, value)) return [];
  return EXTRACT_DETAIL_FIELDS.filter((field) => field !== value);
}

/** Filter only the ordinary utility presentation. Keep saved settings and handle IDs available. */
export function builtinUtilityOperationPresentation(identity: string, params: Record<string, NodeParams>) {
  if (identity === DIRECT_IMAGE_FILTER)
    return { inactive: new Set(inactiveFilterControls(params.operation)), continuation: false };
  if (identity === DIRECT_FRAME_EXTRACT)
    return { inactive: new Set(inactiveFrameSelectionControls(params.mode)), continuation: false };
  if (!Object.prototype.hasOwnProperty.call(FIELDS_BY_UTILITY, identity)) return undefined;
  const fields = FIELDS_BY_UTILITY[identity]!;
  const operation = savedSelector(params.operation);
  if (!operation || !Object.prototype.hasOwnProperty.call(fields, operation)) return undefined;
  const active = new Set(fields[operation]);

  if (operation === 'video_frame_extract') {
    for (const key of inactiveFrameSelectionControls(params.selection_mode)) active.delete(key);
  }
  if (operation === 'image_filter') {
    for (const key of inactiveFilterControls(params.filter_operation)) active.delete(key);
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
