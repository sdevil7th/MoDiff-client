type Scalar = string | number | boolean | null;
export type MediaIdentity =
  | { kind: 'file'; sha256: string; byteSize: number }
  | { kind: 'image'; sha256: string; byteSize: number; width: number; height: number; mode: string }
  | { kind: 'audio'; sha256: string; byteSize: number; shape: number[]; sampleRate: number; dtype: 'float32-le' };
export type BuiltinMediaEvidence =
  | { schemaVersion: 1; status: 'unavailable' | 'truncated'; reason: string }
  | {
      schemaVersion: 1;
      status: 'complete';
      source: 'native-builtin-media-v1';
      controls: Record<string, Scalar>;
      inputs: Record<string, MediaIdentity[]>;
      outputs: Record<string, MediaIdentity[]>;
      files: Record<
        string,
        { sourceValue: string | [string]; sha256: string; byteSize: number; converted?: boolean }[]
      >;
    };

const imageControls = `pipeline_class operation brightness contrast saturation sharpness gamma temperature tint
filter_operation amount threshold seed x y width height resize_width resize_height resize_fit_mode resize_resampling
stitch_columns stitch_spacing stitch_background stitch_match_size rows columns channel composite_mask_channel composite_invert_mask`;
const audioControls = `pipeline_class operation start_seconds duration_seconds target_sample_rate normalize_peak
boundary_fade_seconds reference_window_seconds target_peak_dbfs max_adjustment_db`;
const videoControls = `pipeline_class operation selection_mode indices timecodes every_n fps interpolation_fps
transition_seconds start_seconds end_seconds columns sync gap background`;
export const BUILTIN_MEDIA_EVIDENCE_SCOPES: Record<
  string,
  { controls: string; inputs: string[]; outputs: string[]; files: string[]; requiredSingleAudioInput?: string }
> = {
  'Image.Load': { controls: 'alpha_channel', inputs: [], outputs: ['image'], files: ['file'] },
  'Image.Preview': { controls: 'device export', inputs: ['image'], outputs: ['output', 'filtered'], files: [] },
  'ImageOperations.ProcessImage': {
    controls: imageControls,
    inputs: ['image', 'mask'],
    outputs: ['output'],
    files: [],
  },
  'Audio.Load': { controls: '', inputs: [], outputs: ['audio'], files: ['file'] },
  'Audio.ProcessAudio': { controls: audioControls, inputs: ['source', 'reference'], outputs: ['output'], files: [] },
  'Audio.Export': { controls: 'filename sample_rate', inputs: ['audio'], outputs: ['file'], files: [] },
  'HuggingFaceSpeech.TranscribeAudio': {
    controls: '',
    inputs: ['audio'],
    outputs: [],
    files: [],
    requiredSingleAudioInput: 'audio',
  },
  'HuggingFaceSpeech.TranscribeCTCAudio': {
    controls: '',
    inputs: ['audio'],
    outputs: [],
    files: [],
    requiredSingleAudioInput: 'audio',
  },
  'Video.ProcessVideo': {
    controls: videoControls,
    inputs: ['videos'],
    outputs: ['images', 'video'],
    files: ['videos'],
  },
  'Video.UpscaleVideo': {
    controls: 'pipeline_class operation tile_size tile_overlap device fps',
    inputs: ['video'],
    outputs: ['video_out'],
    files: ['video'],
  },
  'Video.Export': { controls: 'filename quality fps', inputs: ['video'], outputs: ['file'], files: [] },
};
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length && names.every((n) => has(v, n));
const uint = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const digest = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
function fileSource(value: unknown, legacyAudioSelection: boolean): value is string | [string] {
  if (typeof value === 'string') return value.length <= 16384;
  // Older Audio.Load receipts retained the file picker's one-item selection.
  return (
    legacyAudioSelection &&
    Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === 'string' &&
    value[0].length > 0 &&
    value[0].length <= 16384
  );
}
function identity(v: unknown): v is MediaIdentity {
  if (!record(v) || !digest(v.sha256) || !uint(v.byteSize) || v.byteSize > 256 * 1024 * 1024) return false;
  if (v.kind === 'file') return keys(v, ['kind', 'sha256', 'byteSize']);
  if (v.kind === 'image')
    return (
      keys(v, ['kind', 'sha256', 'byteSize', 'width', 'height', 'mode']) &&
      uint(v.width) &&
      v.width > 0 &&
      uint(v.height) &&
      v.height > 0 &&
      typeof v.mode === 'string' &&
      v.mode.length <= 16
    );
  return (
    v.kind === 'audio' &&
    keys(v, ['kind', 'sha256', 'byteSize', 'shape', 'sampleRate', 'dtype']) &&
    v.dtype === 'float32-le' &&
    uint(v.sampleRate) &&
    v.sampleRate > 0 &&
    Array.isArray(v.shape) &&
    v.shape.length === 2 &&
    v.shape.every((n) => uint(n) && n > 0) &&
    v.shape[0] * v.shape[1] * 4 === v.byteSize
  );
}
export function parseBuiltinMediaEvidence(value: unknown, scope: string): BuiltinMediaEvidence | undefined {
  if (!has(BUILTIN_MEDIA_EVIDENCE_SCOPES, scope) || !record(value) || value.schemaVersion !== 1) return undefined;
  if (value.status === 'unavailable' || value.status === 'truncated')
    return keys(value, ['schemaVersion', 'status', 'reason']) &&
      typeof value.reason === 'string' &&
      value.reason.length > 0 &&
      value.reason.length <= 128
      ? (value as BuiltinMediaEvidence)
      : undefined;
  if (
    value.status !== 'complete' ||
    value.source !== 'native-builtin-media-v1' ||
    !keys(value, ['schemaVersion', 'source', 'status', 'controls', 'inputs', 'outputs', 'files']) ||
    !record(value.controls) ||
    !record(value.inputs) ||
    !record(value.outputs) ||
    !record(value.files)
  )
    return undefined;
  const declaration = BUILTIN_MEDIA_EVIDENCE_SCOPES[scope]!;
  const controls = new Set(declaration.controls.split(/\s+/u).filter(Boolean));
  if (
    Object.entries(value.controls).some(
      ([name, v]) =>
        !controls.has(name) ||
        !(
          v === null ||
          typeof v === 'boolean' ||
          (typeof v === 'number' && Number.isFinite(v)) ||
          (typeof v === 'string' && v.length <= 16384)
        ),
    )
  )
    return undefined;
  for (const section of ['inputs', 'outputs'] as const) {
    const ports = value[section];
    if (!record(ports)) return undefined;
    if (
      Object.entries(ports).some(
        ([port, items]) =>
          !declaration[section].includes(port) || !Array.isArray(items) || items.length > 16 || !items.every(identity),
      )
    )
      return undefined;
  }
  if (declaration.requiredSingleAudioInput) {
    const audio = value.inputs[declaration.requiredSingleAudioInput];
    if (!Array.isArray(audio) || audio.length !== 1 || audio[0]?.kind !== 'audio') return undefined;
  }
  if (
    Object.entries(value.files).some(
      ([port, items]) =>
        !declaration.files.includes(port) ||
        !Array.isArray(items) ||
        items.length > 16 ||
        items.some(
          (v) =>
            !record(v) ||
            !keys(v, ['sourceValue', 'sha256', 'byteSize', ...(has(v, 'converted') ? ['converted'] : [])]) ||
            !fileSource(v.sourceValue, scope === 'Audio.Load' && port === 'file' && items.length === 1) ||
            !digest(v.sha256) ||
            !uint(v.byteSize) ||
            v.byteSize > 256 * 1024 * 1024 ||
            (has(v, 'converted') && typeof v.converted !== 'boolean'),
        ),
    )
  )
    return undefined;
  if (JSON.stringify(value).length > 196608) return undefined;
  return structuredClone(value) as BuiltinMediaEvidence;
}
