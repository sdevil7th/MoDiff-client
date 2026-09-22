import type { StudioMode, StudioModelType, StudioOutput } from './types';
import { STUDIO_MODE_DESCRIPTIONS, STUDIO_MODEL_LABELS } from './modelProfiles';

type InputValue = string | number | boolean | null | (string | number | boolean | null)[];
type InputField = {
  value: InputValue;
  source: 'literal' | 'connected' | 'override';
  sourceNodeId?: string;
  sourcePortId?: string;
};
export type ResolvedExecutionInputs = {
  schemaVersion: 1;
  source: 'backend-execution';
  taskId: string;
  attemptIndex: number;
  nodeId: string;
  nodes: {
    nodeId: string;
    module: string;
    action: string;
    fields: Record<string, InputField>;
    omittedFields: Record<string, string>;
  }[];
  summary: Record<string, InputValue>;
  ambiguousFields: string[];
  unavailableFields: string[];
  uncapturedNodeIds: string[];
  truncated: boolean;
  /** Backend recognition of concrete graph contracts, separate from consumed values. */
  graphTasks?: { loaderId: string; pipelineClass: string; task: string | null }[];
};

const inputNames: Record<string, string> = {
  prompt: 'prompt',
  prompt_2: 'prompt2',
  prompt_3: 'prompt3',
  negative_prompt: 'negativePrompt',
  negative_prompt_2: 'negativePrompt2',
  seed: 'seed',
  width: 'width',
  height: 'height',
  num_inference_steps: 'steps',
  steps: 'steps',
  guidance_scale: 'guidanceScale',
  true_cfg_scale: 'trueCfgScale',
  max_sequence_length: 'maxSequenceLength',
  num_images_per_prompt: 'imagesPerPrompt',
  num_frames: 'numFrames',
  fps: 'fps',
  frame_rate: 'fps',
  audio_duration: 'audioDuration',
  sample_rate: 'sampleRate',
  strength: 'strength',
  repo_id: 'repo',
  model_id: 'repo',
  revision: 'revision',
  dtype: 'dtype',
  device: 'device',
  model_type: 'modelType',
  pipeline_class: 'modelType',
  auto_offload: 'autoOffload',
  offload_mode: 'offloadMode',
  output_type: 'outputType',
  quant_config: 'quantConfig',
  conditioning_scale: 'conditioningScale',
  control_mode: 'controlMode',
  control_guidance_start: 'controlGuidanceStart',
  control_guidance_end: 'controlGuidanceEnd',
  prompt_embeds_scale: 'reduxPromptEmbedsScale',
  pooled_prompt_embeds_scale: 'reduxPooledPromptEmbedsScale',
  processing_resolution: 'processingResolution',
  match_input_resolution: 'matchInputResolution',
  depth_convention: 'depthConvention',
  use_kv_cache: 'attentionContextReuse',
};
// Mirror the backend's scoped capture contract. Auxiliary revisions must never
// overwrite the base model's identity; unknown fields still reject the receipt.
const nodeInputNames: Record<string, Record<string, string>> = {
  'DiffusersImage.ControlComponent': {
    model_id: 'controlComponentRepo',
    revision: 'controlComponentRevision',
    shared_conditions: 'controlComponentSharedConditions',
  },
  'DiffusersImage.ImagePromptAdapter': {
    adapter_model: 'ipAdapterRepo',
    revision: 'ipAdapterRevision',
    weight_name: 'ipAdapterWeight',
    expected_sha256: 'ipAdapterSha256',
    image_encoder_model: 'ipAdapterEncoderRepo',
    image_encoder_revision: 'ipAdapterEncoderRevision',
    image_encoder_sha256: 'ipAdapterEncoderSha256',
    scale: 'ipAdapterScale',
    layer_scales: 'ipAdapterLayerScales',
  },
};
const summaryNames = new Set([
  ...Object.values(inputNames),
  ...Object.values(nodeInputNames).flatMap(Object.values),
  'dataOperationType',
]);
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 16_384;
const scalar = (value: unknown): value is Exclude<InputValue, unknown[]> =>
  value === null ||
  typeof value === 'boolean' ||
  text(value) ||
  (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
const inputValue = (value: unknown): value is InputValue =>
  scalar(value) || (Array.isArray(value) && value.length <= 16 && value.every(scalar));
const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 4096 && value.every(text);

export function coerceResolvedExecutionInputs(
  value: unknown,
  identity: { taskId?: string | null; nodeId: string; attemptIndex?: number },
): ResolvedExecutionInputs | undefined {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.source !== 'backend-execution' ||
    !text(value.taskId) ||
    !value.taskId ||
    value.taskId !== identity.taskId ||
    value.nodeId !== identity.nodeId ||
    value.attemptIndex !== (identity.attemptIndex ?? 0) ||
    !Number.isSafeInteger(value.attemptIndex) ||
    Number(value.attemptIndex) < 0 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 256 ||
    !record(value.summary) ||
    !stringList(value.ambiguousFields) ||
    !stringList(value.unavailableFields) ||
    !stringList(value.uncapturedNodeIds) ||
    typeof value.truncated !== 'boolean'
  )
    return undefined;
  if ([...value.ambiguousFields, ...value.unavailableFields].some((key) => !summaryNames.has(key))) return undefined;
  const seen = new Set<string>();
  const candidates = new Map<string, Set<string>>();
  const unavailable = new Set<string>();
  for (const node of value.nodes) {
    if (
      !record(node) ||
      !text(node.nodeId) ||
      seen.has(node.nodeId) ||
      !text(node.module) ||
      !text(node.action) ||
      !record(node.fields) ||
      !record(node.omittedFields)
    )
      return undefined;
    seen.add(node.nodeId);
    const scope = `${node.module.replace(/^modules\./u, '')}.${node.action}`;
    const names = hasOwn(nodeInputNames, scope) ? nodeInputNames[scope]! : inputNames;
    const fields = node.fields;
    const canonicalName = (key: string) => {
      if (
        scope === 'Text.ProcessText' &&
        key === 'pipeline_class' &&
        record(fields.pipeline_class) &&
        fields.pipeline_class.value === 'BuiltinDataOperationV1'
      )
        return 'dataOperationType';
      return hasOwn(names, key) ? names[key] : undefined;
    };
    for (const [key, field] of Object.entries(node.fields)) {
      const canonical = canonicalName(key);
      if (
        !canonical ||
        !record(field) ||
        !inputValue(field.value) ||
        !['literal', 'connected', 'override'].includes(String(field.source))
      )
        return undefined;
      if (
        field.source === 'connected' &&
        (!text(field.sourceNodeId) || !field.sourceNodeId || !text(field.sourcePortId) || !field.sourcePortId)
      )
        return undefined;
      const values = candidates.get(canonical) ?? new Set<string>();
      values.add(JSON.stringify(field.value));
      candidates.set(canonical, values);
    }
    for (const [key, reason] of Object.entries(node.omittedFields)) {
      const canonical = canonicalName(key);
      if (!canonical || !text(reason)) return undefined;
      unavailable.add(canonical);
    }
  }
  const expectedAmbiguous = [...candidates]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key)
    .sort();
  if (JSON.stringify([...value.ambiguousFields].sort()) !== JSON.stringify(expectedAmbiguous)) return undefined;
  if (value.truncated) for (const key of candidates.keys()) unavailable.add(key);
  if (JSON.stringify([...value.unavailableFields].sort()) !== JSON.stringify([...unavailable].sort())) return undefined;
  const expected = Object.fromEntries(
    [...candidates]
      .filter(([key, values]) => !value.truncated && values.size === 1 && !unavailable.has(key))
      .map(([key, values]) => [key, JSON.parse([...values][0]!)]),
  );
  if (
    Object.keys(value.summary).length !== Object.keys(expected).length ||
    Object.entries(value.summary).some(
      ([key, item]) =>
        !summaryNames.has(key) || !inputValue(item) || JSON.stringify(item) !== JSON.stringify(expected[key]),
    )
  )
    return undefined;
  let graphTasks: ResolvedExecutionInputs['graphTasks'];
  if (value.graphTasks !== undefined) {
    if (
      !Array.isArray(value.graphTasks) ||
      value.graphTasks.length > 256 ||
      value.truncated ||
      value.uncapturedNodeIds.length > 0
    )
      return undefined;
    const owners = new Set<string>();
    graphTasks = [];
    for (const item of value.graphTasks) {
      if (
        !record(item) ||
        !text(item.loaderId) ||
        !text(item.pipelineClass) ||
        !(item.task === null || (text(item.task) && /^[a-z][a-z0-9_]*$/u.test(item.task))) ||
        owners.has(item.loaderId)
      )
        return undefined;
      const owner = value.nodes.find((node) => record(node) && node.nodeId === item.loaderId);
      if (
        !record(owner) ||
        owner.module !== 'modules.ModularDiffusers' ||
        owner.action !== 'ModelsLoader' ||
        !record(owner.fields) ||
        !record(owner.fields.model_type) ||
        owner.fields.model_type.value !== item.pipelineClass
      )
        return undefined;
      owners.add(item.loaderId);
      graphTasks.push({ loaderId: item.loaderId, pipelineClass: item.pipelineClass, task: item.task });
    }
  }
  if (graphTasks) {
    const loaders = value.nodes.filter(
      (node) => record(node) && node.module === 'modules.ModularDiffusers' && node.action === 'ModelsLoader',
    );
    if (loaders.length !== graphTasks.length) return undefined;
  }
  // Shared backend bounds plus envelope/summary overhead. JSON input only;
  // never stringify live model objects or retain unknown extension fields.
  if (JSON.stringify(value).length > 800_000) return undefined;
  return JSON.parse(
    JSON.stringify({
      ...(graphTasks ? { graphTasks } : {}),
      schemaVersion: 1,
      source: 'backend-execution',
      taskId: value.taskId,
      attemptIndex: value.attemptIndex,
      nodeId: value.nodeId,
      nodes: value.nodes.map((node) => ({
        nodeId: node.nodeId,
        module: node.module,
        action: node.action,
        fields: Object.fromEntries(
          Object.entries(node.fields).map(([key, field]) => {
            const item = field as InputField;
            return [
              key,
              {
                value: item.value,
                source: item.source,
                ...(item.source === 'connected'
                  ? { sourceNodeId: item.sourceNodeId, sourcePortId: item.sourcePortId }
                  : {}),
              },
            ];
          }),
        ),
        omittedFields: node.omittedFields,
      })),
      summary: value.summary,
      ambiguousFields: value.ambiguousFields,
      unavailableFields: value.unavailableFields,
      uncapturedNodeIds: value.uncapturedNodeIds,
      truncated: value.truncated,
    }),
  ) as ResolvedExecutionInputs;
}

export function applyResolvedExecutionInputs(output: StudioOutput, candidate: unknown): StudioOutput {
  const receipt = coerceResolvedExecutionInputs(candidate, output);
  if (!receipt) return output;
  const next = {
    ...output,
    resolvedExecutionInputs: receipt,
    promptSettingsHash: undefined,
    exactTemplateCompatible: false,
  };
  const tasks = new Set(receipt.graphTasks?.map((item) => item.task));
  const task = [...tasks][0];
  if (tasks.size === 1 && task && hasOwn(STUDIO_MODE_DESCRIPTIONS, task)) next.mode = task as StudioMode;
  const model = outputModelKey(next);
  if (hasOwn(STUDIO_MODEL_LABELS, model)) {
    next.modelType = model as StudioModelType;
    next.modelLabel = STUDIO_MODEL_LABELS[next.modelType];
  } else next.modelLabel = model === 'uncaptured-model' ? 'Model not uniquely captured' : model;
  for (const key of ['prompt', 'negativePrompt', 'repo'] as const) {
    if (typeof receipt.summary[key] === 'string') next[key] = receipt.summary[key];
    else if (resolvedInputUnavailable(receipt, key)) next[key] = '';
  }
  for (const key of ['seed', 'width', 'height', 'steps', 'guidanceScale'] as const) {
    const value = outputNumericInputValue(next, key);
    if (value !== undefined) next[key] = value;
  }
  if (next.provenance)
    next.provenance = { ...next.provenance, promptSettingsHash: undefined, exactTemplateCompatible: false };
  return next;
}

/** A custom or ambiguous captured model must not inherit the form's filter. */
export function outputModelKey(output: StudioOutput): string {
  const receipt = output.resolvedExecutionInputs;
  if (!receipt) return output.modelType;
  const model = receipt.summary.modelType;
  return !resolvedInputUnavailable(receipt, 'modelType') && typeof model === 'string' && model.trim()
    ? model
    : 'uncaptured-model';
}

export function resolvedInputUnavailable(receipt: ResolvedExecutionInputs, key: string): boolean {
  return (
    receipt.truncated ||
    receipt.ambiguousFields.includes(key) ||
    receipt.unavailableFields.includes(key) ||
    (hasOwn(receipt.summary, key) && (receipt.summary[key] === null || Array.isArray(receipt.summary[key])))
  );
}

export function outputInputDisplay(
  output: StudioOutput,
  key: 'seed' | 'width' | 'height' | 'steps' | 'guidanceScale' | 'numFrames' | 'fps',
): string | number {
  return outputNumericInputValue(output, key) ?? 'Not uniquely captured — see resolved inputs';
}

/** A valid receipt with a missing/ambiguous value must not borrow the form fallback. */
export function outputNumericInputValue(
  output: StudioOutput,
  key: 'seed' | 'width' | 'height' | 'steps' | 'guidanceScale' | 'numFrames' | 'fps',
): number | undefined {
  const receipt = output.resolvedExecutionInputs;
  if (receipt) {
    const raw = receipt.summary[key];
    // Native controls may capture decimal strings. Normalize only presentation;
    // retain the exact receipt and its ambiguity checks, never form fallbacks.
    const value =
      typeof raw === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) ? Number(raw) : raw;
    return !resolvedInputUnavailable(receipt, key) &&
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Math.abs(value) <= Number.MAX_SAFE_INTEGER
      ? value
      : undefined;
  }
  // Old records have no execution receipt. Keep their historical display;
  // the inspector explicitly labels these as legacy form/graph settings.
  return key === 'numFrames' || key === 'fps' ? output.formSnapshot[key] : output[key];
}

/** Actual decoded media metadata is preferable to requested generation dimensions. */
export function outputMediaSizeLabel(output: StudioOutput): string | undefined {
  const item = output.mediaItems?.find((item) => Number(item.width) > 0 && Number(item.height) > 0);
  const width = item?.width ?? outputNumericInputValue(output, 'width');
  const height = item?.height ?? outputNumericInputValue(output, 'height');
  return width && height ? `${width}x${height}` : undefined;
}
