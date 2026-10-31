import type { StudioMode, StudioModelType, StudioOutput } from './types';
import { STUDIO_MODE_DESCRIPTIONS, STUDIO_MODEL_LABELS } from './modelProfiles';
import type { WeightLoadingMode } from '../types/api';

type InputValue = string | number | boolean | null | (string | number | boolean | null)[];
export type ModelWeightFormat = 'native' | 'fp8r' | 'nvfp4';
export type TextGenerationOperation = 'standard' | 'enhance_prompt' | 'enhance_prompt_append_details';
export type PromptEnhancementSystemMode = 't2i' | 'i2i' | 't2i_bbox' | 'i2i_bbox';
type InputField = {
  value: InputValue;
  source: 'literal' | 'connected' | 'override';
  sourceNodeId?: string;
  sourcePortId?: string;
};
type AccountingOrigin = Omit<InputField, 'value'>;
export type ExecutionFieldAccounting = {
  schemaVersion: 1;
  fields: Record<
    string,
    AccountingOrigin &
      (
        | {
            disposition: 'consumed' | 'inactive' | 'superseded';
            inputValue: InputValue;
            value: InputValue;
            reason?: string;
          }
        | { disposition: 'metadata'; reason: 'presentation-contract'; sha256: string }
      )
  >;
  inputProjections: Record<string, ExecutionAccountingProjection & AccountingOrigin>;
  outputProjections: Record<string, ExecutionAccountingProjection>;
  unaccountedFields: string[];
  omittedFields: Record<string, string>;
  complete: boolean;
};
type ExecutionAccountingProjection = {
  kind: 'disabled-quantization-v1' | 'execution-recipe-v1';
  values: Record<string, InputValue>;
  sha256: string;
};
export type AppliedAdapters =
  | {
      schemaVersion: 1;
      status: 'complete';
      source: 'backend-adapter-application';
      applicationId: string;
      observation: 'activated' | 'reused';
      adapters: {
        adapterName: string;
        scale: number;
        descriptorSha256: string;
        artifact:
          | { source: 'hub'; repository: string; revision: string; weightName: string; sha256: string }
          | { source: 'local'; weightName: string; sha256: string };
        scheduler: null | { className: string; configSha256: string };
      }[];
      stateSha256: string;
    }
  | { schemaVersion: 1; status: 'unavailable' | 'truncated'; reason: string };
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
    fields: Record<string, InputField> & {
      weight_loading_mode?: InputField & { value: WeightLoadingMode };
      weight_format?: InputField & { value: ModelWeightFormat };
      operation?: InputField & { value: TextGenerationOperation };
    };
    omittedFields: Record<string, string>;
    fieldAccounting?: ExecutionFieldAccounting;
    appliedAdapters?: AppliedAdapters;
  }[];
  summary: Record<string, InputValue> & {
    weightLoadingMode?: WeightLoadingMode;
    weightFormat?: ModelWeightFormat;
    textOperation?: TextGenerationOperation;
    systemPromptMode?: PromptEnhancementSystemMode;
  };
  ambiguousFields: string[];
  unavailableFields: string[];
  uncapturedNodeIds: string[];
  truncated: boolean;
  /** Backend recognition of concrete graph contracts, separate from consumed values. */
  graphTasks?: { loaderId: string; pipelineClass: string; task: string | null }[];
  /** Optional accounting never changes the legacy consumed-input summary. */
  fieldAccountingStatus?: { schemaVersion: 1; truncated: boolean };
  appliedAdaptersStatus?: { schemaVersion: 1; truncated: boolean };
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
  weight_loading_mode: 'weightLoadingMode',
  attention_backend: 'attentionBackend',
  vae_slicing: 'vaeSlicing',
  enable_vae_slicing: 'vaeSlicing',
  vae_tiling: 'vaeTiling',
  enable_vae_tiling: 'vaeTiling',
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
  'Image.Load': {
    ...inputNames,
    alpha_channel: 'imageAlphaChannel',
    source_hashes: 'imageSourceHashes',
    source_widths: 'imageSourceWidths',
    source_heights: 'imageSourceHeights',
    source_modes: 'imageSourceModes',
  },
  'Image.Resize': {
    ...inputNames,
    method: 'imageResizeMethod',
    interpolation: 'imageInterpolation',
    multiple_of: 'imageSizeMultiple',
  },
  'ImageOperations.ResizeImage': { ...inputNames, fit_mode: 'imageFitMode', resampling: 'imageResampling' },
  'ImageOperations.CropImage': { ...inputNames, x: 'imageCropLeft', y: 'imageCropTop' },
  'ImageOperations.MaskComposite': {
    ...inputNames,
    mask_channel: 'imageMaskChannel',
    invert_mask: 'imageMaskInverted',
  },
  'Image.Save': { ...inputNames, filename: 'imageSaveFilename', quality: 'imageSaveQuality' },
  'ModularDiffusers.ModelsLoader': { ...inputNames, weight_format: 'weightFormat' },
  'DiffusersImage.LoadPipeline': { ...inputNames, mode: 'executionMode' },
  ...Object.fromEntries(
    [
      'Generate',
      'Edit',
      'Inpaint',
      'ControlGenerate',
      'ControlEdit',
      'ControlInpaint',
      'LayerDecompose',
      'UnconditionalGenerate',
      'PredictMap',
      'EncodeInputs',
      'Denoise',
      'DecodeLatents',
    ].map((action) => [`DiffusersImage.${action}`, { ...inputNames, executed_task: 'executedTask' }]),
  ),
  'HuggingFaceTransformers.PredictDepth': { ...inputNames, executed_task: 'executedTask' },
  'HuggingFaceTransformers.GenerateImageVideoText': {
    ...inputNames,
    executed_task: 'executedTask',
    operation: 'textOperation',
    enhancement_max_new_tokens: 'enhancementMaxNewTokens',
    prompt_adapter_id: 'promptAdapterId',
    system_prompt_mode: 'systemPromptMode',
    system_prompt_sha256: 'systemPromptSha256',
    rendered_prompt_sha256: 'renderedPromptSha256',
    rendered_prompt_utf8_bytes: 'renderedPromptUtf8Bytes',
    rendered_input_ids_sha256: 'renderedInputIdsSha256',
    reference_source_sha256: 'referenceSourceSha256',
    processed_pixel_sha256: 'processedPixelSha256',
    processed_pixel_shape: 'processedPixelShape',
    processed_grid_sha256: 'processedGridSha256',
    processed_grid_shape: 'processedGridShape',
  },
  'ImageOperations.ProcessImage': { ...inputNames, executed_task: 'executedTask' },
  'ModularDiffusers.Guider': {
    ...inputNames,
    guider: 'guiderType',
    enabled: 'guidanceEnabled',
    use_original_formulation: 'guidanceOriginalFormulation',
    guidance_rescale: 'guidanceRescale',
    start: 'guidanceStart',
    stop: 'guidanceStop',
  },
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
const taskOwnerFields: Record<string, string> = {
  'modules.ModularDiffusers.ModelsLoader': 'model_type',
  'modules.DiffusersImage.LoadPipeline': 'pipeline_class',
  'modules.HuggingFaceTransformers.LoadDepthEstimationModel': 'pipeline_class',
  'modules.HuggingFaceTransformers.LoadImageTextToTextModel': 'pipeline_class',
  'modules.ImageOperations.ProcessImage': 'pipeline_class',
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

// Shape-only parsing. The CLI proof reader verifies the state digest and joins
// actual application observations to the executed owner and ordered graph.
function appliedAdapters(value: unknown, scope: string): AppliedAdapters | undefined {
  const bounded = (item: unknown, maximum: number): item is string =>
    typeof item === 'string' &&
    item.length > 0 &&
    [...item].length <= maximum &&
    item === item.trim() &&
    ![...item].some((character) => character.charCodeAt(0) < 32);
  const sha = (item: unknown) => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item);
  const repository = (item: unknown) =>
    bounded(item, 256) &&
    item.split('/').length === 2 &&
    item.split('/').every((part) => part.length <= 96 && /^\w(?:[\w.-]*\w)?$/u.test(part)) &&
    !item.includes('--') &&
    !item.includes('..') &&
    !item.endsWith('.git');
  if (scope !== 'ModularDiffusers.ModelsLoader' || !record(value) || value.schemaVersion !== 1) return undefined;
  if (value.status !== 'complete') {
    if (
      !exactKeys(value, ['schemaVersion', 'status', 'reason']) ||
      typeof value.reason !== 'string' ||
      !(value.status === 'truncated'
        ? value.reason === 'record-size-limit'
        : value.status === 'unavailable' &&
          ['unobserved-application', 'owner-invalidated', 'unsupported-owner', 'unsupported-projection'].includes(
            String(value.reason),
          ))
    )
      return undefined;
    return value as AppliedAdapters;
  }
  if (
    !exactKeys(value, [
      'schemaVersion',
      'status',
      'source',
      'applicationId',
      'observation',
      'adapters',
      'stateSha256',
    ]) ||
    value.source !== 'backend-adapter-application' ||
    typeof value.applicationId !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(value.applicationId) ||
    (value.observation !== 'activated' && value.observation !== 'reused') ||
    !Array.isArray(value.adapters) ||
    value.adapters.length > 32 ||
    typeof value.stateSha256 !== 'string' ||
    !/^sha256:applied-adapters-v1:[a-f0-9]{64}$/u.test(value.stateSha256)
  )
    return undefined;
  const names = new Set();
  for (const item of value.adapters) {
    if (
      !record(item) ||
      !exactKeys(item, ['adapterName', 'scale', 'descriptorSha256', 'artifact', 'scheduler']) ||
      !bounded(item.adapterName, 128) ||
      !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u.test(item.adapterName) ||
      names.has(item.adapterName) ||
      typeof item.scale !== 'number' ||
      !Number.isFinite(item.scale) ||
      item.scale < -20 ||
      item.scale > 20 ||
      !sha(item.descriptorSha256) ||
      !record(item.artifact)
    )
      return undefined;
    names.add(item.adapterName);
    const artifact = item.artifact;
    if (
      !exactKeys(artifact, [
        'source',
        'weightName',
        'sha256',
        ...(artifact.source === 'hub' ? ['repository', 'revision'] : []),
      ]) ||
      (artifact.source !== 'hub' && artifact.source !== 'local') ||
      !sha(artifact.sha256) ||
      !bounded(artifact.weightName, 256) ||
      /[\\:]/u.test(artifact.weightName) ||
      artifact.weightName.split('/').length > 64 ||
      !artifact.weightName.endsWith('.safetensors') ||
      artifact.weightName.split('/').some((part) => !part || part === '.' || part === '..') ||
      (artifact.source === 'hub' &&
        (!repository(artifact.repository) ||
          typeof artifact.revision !== 'string' ||
          !/^[a-f0-9]{40}$/u.test(artifact.revision)))
    )
      return undefined;
    if (
      item.scheduler !== null &&
      (!record(item.scheduler) ||
        !exactKeys(item.scheduler, ['className', 'configSha256']) ||
        !bounded(item.scheduler.className, 128) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(item.scheduler.className) ||
        typeof item.scheduler.configSha256 !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(item.scheduler.configSha256))
    )
      return undefined;
  }
  if (new TextEncoder().encode(JSON.stringify({ adapters: value.adapters })).byteLength > 32_768) return undefined;
  return value as AppliedAdapters;
}

// Mirror only the backend's bounded accounting policy, not arbitrary objects or
// new execution authority. Cryptographic and graph joins belong to the recorder.
const accountingNames: Record<string, string[]> = {
  'DiffusersImage.LoadPipeline': `model_id pipeline_class mode revision conditioning_kind conditioning_model_id
    conditioning_revision dtype device quantization_mode quantized_components device_map auto_offload offload_mode
    enable_vae_slicing enable_vae_tiling low_cpu_mem_usage`.split(/\s+/u),
  'DiffusersRuntime.PipelineQuantizationConfigV2':
    'backend components dtype excluded_modules component_overrides'.split(' '),
  'DiffusersRuntime.DiffusersExecutionRecipe': `device_map max_memory device_map_overrides offload_mode device
    attention_backend attention_components vae_slicing vae_tiling layerwise_casting layerwise_casting_components
    layerwise_storage_dtype layerwise_compute_dtype channels_last channels_last_components regional_compile
    compile_components compile_backend compile_mode compile_fullgraph compile_dynamic denoiser_cache cache_threshold cache_options`.split(
    /\s+/u,
  ),
  'DiffusersImage.UnconditionalGenerate':
    'image_contract batch_size seed num_inference_steps eta class_label output_type'.split(' '),
  'Image.Preview': ['device', 'export'],
};
const accountingPorts: Record<string, [Record<string, string>, Record<string, string>]> = {
  'DiffusersImage.LoadPipeline': [{ execution_recipe: 'execution-recipe-v1' }, {}],
  'DiffusersRuntime.PipelineQuantizationConfigV2': [{}, { quantization_config: 'disabled-quantization-v1' }],
  'DiffusersRuntime.DiffusersExecutionRecipe': [
    { quantization_config: 'disabled-quantization-v1' },
    { execution_recipe: 'execution-recipe-v1' },
  ],
  'DiffusersImage.UnconditionalGenerate': [{}, {}],
  'Image.Preview': [{}, {}],
};
const accountingReasons = new Set([
  'adapter-inactive',
  'feature-disabled',
  'connected-recipe',
  'loader-normalization',
  'presentation-contract',
  'already-decoded-image',
  'unsupported-contract',
]);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => hasOwn(value, key));
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const originKeys = (value: Record<string, unknown>) =>
  value.source === 'connected' ? ['source', 'sourceNodeId', 'sourcePortId'] : ['source'];
const accountingOrigin = (value: Record<string, unknown>) =>
  value.source === 'literal' ||
  value.source === 'override' ||
  (value.source === 'connected' &&
    text(value.sourceNodeId) &&
    Boolean(value.sourceNodeId) &&
    text(value.sourcePortId) &&
    Boolean(value.sourcePortId));

function fieldAccounting(value: unknown, scope: string): ExecutionFieldAccounting | undefined {
  if (
    !record(value) ||
    !hasOwn(accountingNames, scope) ||
    value.schemaVersion !== 1 ||
    !exactKeys(value, [
      'schemaVersion',
      'fields',
      'inputProjections',
      'outputProjections',
      'unaccountedFields',
      'omittedFields',
      'complete',
    ]) ||
    !record(value.fields) ||
    !record(value.inputProjections) ||
    !record(value.outputProjections) ||
    !record(value.omittedFields) ||
    !stringList(value.unaccountedFields) ||
    typeof value.complete !== 'boolean'
  )
    return undefined;
  // Bound the new section separately; legacy records retain their old budget.
  if (
    JSON.stringify(value).replace(
      /[\u007f-\uffff]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    ).length > 65_536
  )
    return undefined;
  const allowed = accountingNames[scope]!;
  for (const [name, item] of Object.entries(value.fields)) {
    if (!allowed.includes(name) || !record(item) || !accountingOrigin(item)) return undefined;
    if (item.disposition === 'metadata') {
      if (
        name !== 'image_contract' ||
        item.reason !== 'presentation-contract' ||
        !digest(item.sha256) ||
        !exactKeys(item, ['disposition', 'reason', 'sha256', ...originKeys(item)])
      )
        return undefined;
    } else {
      if (
        !['consumed', 'inactive', 'superseded'].includes(String(item.disposition)) ||
        !inputValue(item.inputValue) ||
        !inputValue(item.value) ||
        !exactKeys(item, [
          'disposition',
          'inputValue',
          'value',
          ...originKeys(item),
          ...(item.disposition === 'consumed' ? [] : ['reason']),
        ]) ||
        (item.disposition !== 'consumed' && !accountingReasons.has(String(item.reason)))
      )
        return undefined;
    }
  }
  const ports = accountingPorts[scope]!;
  for (const [index, label] of ['inputProjections', 'outputProjections'].entries()) {
    const projections = value[label] as Record<string, unknown>;
    const expected = ports[index]!;
    for (const [port, projection] of Object.entries(projections)) {
      if (
        !hasOwn(expected, port) ||
        !record(projection) ||
        projection.kind !== expected[port] ||
        !record(projection.values) ||
        !digest(projection.sha256) ||
        !exactKeys(projection, ['kind', 'values', 'sha256', ...(index === 0 ? originKeys(projection) : [])]) ||
        (index === 0 && !accountingOrigin(projection))
      )
        return undefined;
      const values = projection.values;
      if (projection.kind === 'disabled-quantization-v1') {
        if (!exactKeys(values, ['backend', 'disabled']) || values.backend !== 'none' || values.disabled !== true)
          return undefined;
      } else {
        const keys = accountingNames['DiffusersRuntime.DiffusersExecutionRecipe']!.filter(
          (key) => key !== 'device_map_overrides',
        );
        if (
          !exactKeys(values, [...keys, 'schema_version', 'device_map_strategy', 'quantization']) ||
          values.schema_version !== 1 ||
          values.quantization !== 'none' ||
          values.max_memory !== '{}' ||
          values.cache_options !== '{}' ||
          !Object.values(values).every(inputValue)
        )
          return undefined;
      }
    }
    if (value.complete && Object.keys(expected).some((port) => !hasOwn(projections, port))) return undefined;
  }
  if (
    Object.entries(value.omittedFields).some(([key, reason]) => !text(key) || !text(reason)) ||
    value.complete !== (Object.keys(value.omittedFields).length === 0 && value.unaccountedFields.length === 0)
  )
    return undefined;
  return value as ExecutionFieldAccounting;
}

// Captured observations only: neither an operation label nor an RGB hash grants
// model, source-region, proposal Apply or resource authority.
function textGenerationInputValue(key: string, value: InputValue): boolean {
  const positiveInteger = (item: unknown): item is number =>
    typeof item === 'number' && Number.isSafeInteger(item) && item > 0;
  const fingerprint = (item: unknown) => typeof item === 'string' && /^sha256:[0-9a-f]{64}$/u.test(item);
  switch (key) {
    case 'operation':
      return value === 'standard' || value === 'enhance_prompt' || value === 'enhance_prompt_append_details';
    case 'enhancement_max_new_tokens':
      return positiveInteger(value) && value <= 3584;
    case 'prompt_adapter_id':
      return typeof value === 'string' && /^[a-z][a-z0-9-]{0,127}$/u.test(value);
    case 'system_prompt_mode':
      return value === 't2i' || value === 'i2i' || value === 't2i_bbox' || value === 'i2i_bbox';
    case 'system_prompt_sha256':
      return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
    case 'rendered_prompt_sha256':
    case 'rendered_input_ids_sha256':
    case 'processed_pixel_sha256':
    case 'processed_grid_sha256':
      return fingerprint(value);
    case 'rendered_prompt_utf8_bytes':
      return positiveInteger(value) && value <= 524_288;
    case 'reference_source_sha256':
      return Array.isArray(value) && value.length <= 10 && value.every(fingerprint);
    case 'processed_pixel_shape':
      return Array.isArray(value) && value.length === 2 && value.every(positiveInteger);
    case 'processed_grid_shape':
      return (
        Array.isArray(value) && value.length === 2 && positiveInteger(value[0]) && value[0] <= 10 && value[1] === 3
      );
    default:
      return true;
  }
}

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
  const accounting = new Map<string, ExecutionFieldAccounting>();
  const applications = new Map<string, AppliedAdapters>();
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
    if (hasOwn(node, 'appliedAdapters')) {
      const parsed = appliedAdapters(node.appliedAdapters, scope);
      if (!parsed) return undefined;
      applications.set(node.nodeId, parsed);
    }
    if (hasOwn(node, 'fieldAccounting')) {
      const parsed = fieldAccounting(node.fieldAccounting, scope);
      if (!parsed) return undefined;
      accounting.set(node.nodeId, parsed);
    }
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
        (scope === 'HuggingFaceTransformers.GenerateImageVideoText' && !textGenerationInputValue(key, field.value)) ||
        (canonical === 'weightLoadingMode' && field.value !== 'cpu' && field.value !== 'cuda') ||
        (canonical === 'weightFormat' &&
          field.value !== 'native' &&
          field.value !== 'fp8r' &&
          field.value !== 'nvfp4') ||
        (field.source !== 'literal' && field.source !== 'connected' && field.source !== 'override')
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
      const owner: unknown = value.nodes.find((node) => record(node) && node.nodeId === item.loaderId);
      const field = record(owner) ? taskOwnerFields[`${owner.module}.${owner.action}`] : undefined;
      if (
        !record(owner) ||
        !field ||
        !record(owner.fields) ||
        !record(owner.fields[field]) ||
        owner.fields[field].value !== item.pipelineClass
      )
        return undefined;
      owners.add(item.loaderId);
      graphTasks.push({ loaderId: item.loaderId, pipelineClass: item.pipelineClass, task: item.task });
    }
  }
  if (graphTasks) {
    const loaders = value.nodes.filter(
      (node) => record(node) && hasOwn(taskOwnerFields, `${node.module}.${node.action}`),
    );
    if (loaders.length !== graphTasks.length) return undefined;
  }
  let fieldAccountingStatus: ResolvedExecutionInputs['fieldAccountingStatus'];
  if (hasOwn(value, 'fieldAccountingStatus')) {
    const status = value.fieldAccountingStatus;
    if (
      !record(status) ||
      !exactKeys(status, ['schemaVersion', 'truncated']) ||
      status.schemaVersion !== 1 ||
      typeof status.truncated !== 'boolean' ||
      (!status.truncated && accounting.size === 0)
    )
      return undefined;
    fieldAccountingStatus = { schemaVersion: 1, truncated: status.truncated };
  } else if (accounting.size > 0) return undefined;
  let appliedAdaptersStatus: ResolvedExecutionInputs['appliedAdaptersStatus'];
  if (hasOwn(value, 'appliedAdaptersStatus')) {
    const status = value.appliedAdaptersStatus;
    if (
      !record(status) ||
      !exactKeys(status, ['schemaVersion', 'truncated']) ||
      status.schemaVersion !== 1 ||
      typeof status.truncated !== 'boolean' ||
      (!status.truncated && applications.size === 0)
    )
      return undefined;
    appliedAdaptersStatus = { schemaVersion: 1, truncated: status.truncated };
  } else if (applications.size > 0) return undefined;
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
        ...(accounting.has(node.nodeId) ? { fieldAccounting: accounting.get(node.nodeId) } : {}),
        ...(applications.has(node.nodeId) ? { appliedAdapters: applications.get(node.nodeId) } : {}),
      })),
      summary: value.summary,
      ambiguousFields: value.ambiguousFields,
      unavailableFields: value.unavailableFields,
      uncapturedNodeIds: value.uncapturedNodeIds,
      truncated: value.truncated,
      ...(fieldAccountingStatus ? { fieldAccountingStatus } : {}),
      ...(appliedAdaptersStatus ? { appliedAdaptersStatus } : {}),
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
  if (!receipt)
    return output.legacyRecordedFields && !output.legacyRecordedFields.includes('modelType')
      ? 'uncaptured-model'
      : output.modelType;
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
  if (output.legacyRecordedFields && !output.legacyRecordedFields.includes(key)) return undefined;
  return key === 'numFrames' || key === 'fps' ? output.formSnapshot[key] : output[key];
}

/** Actual decoded media metadata is preferable to requested generation dimensions. */
export function outputMediaSizeLabel(output: StudioOutput): string | undefined {
  const item = output.mediaItems?.find((item) => Number(item.width) > 0 && Number(item.height) > 0);
  const width = item?.width ?? outputNumericInputValue(output, 'width');
  const height = item?.height ?? outputNumericInputValue(output, 'height');
  return width && height ? `${width}x${height}` : undefined;
}
