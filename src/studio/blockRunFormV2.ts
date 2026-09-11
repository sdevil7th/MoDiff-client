import type { CustomNodeType } from '../stores/useFlowStore';
import { blockProjectionNodeIdV2, createBlockRootNodeV2, expandBlockGraphV2ForExecution } from './blockRuntimeV2';
import {
  blockInstanceValueV2,
  normalizeBlockInstanceV2,
  type BlockInstanceV2,
  type BlockJsonValue,
} from './blockSchemaV2';
import { getFormDefaultsForModel, STUDIO_MODE_DESCRIPTIONS, STUDIO_MODEL_PROFILES } from './modelProfiles';
import {
  REGISTERED_BLOCK_V2_ROUTES,
  selectedRegisteredBlockArtifactV2,
  type RegisteredBlockV2Route,
} from './registeredBlockV2Routes';
import type { StudioFormState, StudioMode, StudioModelType } from './types';

type RegisteredBlockRunFormV2 = Readonly<{
  form: StudioFormState;
  instance: BlockInstanceV2;
  route: RegisteredBlockV2Route;
}>;

type OutputLike = Readonly<{
  nodeId?: unknown;
  formSnapshot?: unknown;
  graphSnapshot?: unknown;
}>;

const CONTROL_TO_FORM_FIELD: Readonly<Record<string, keyof StudioFormState>> = Object.freeze({
  auto_offload: 'autoOffload',
  batch_size: 'batchSize',
  conditioning_scale: 'conditioningScale',
  control_image: 'controlImage',
  control_mode: 'controlMode',
  control_video: 'controlVideo',
  guidance_scale: 'guidanceScale',
  guidance_scale_2: 'guidanceScale2',
  height: 'height',
  image: 'referenceImages',
  input_audio: 'sourceAudio',
  input_image: 'referenceImages',
  input_video: 'sourceVideo',
  ip_adapter_image: 'ipAdapterImage',
  ip_adapter_scale: 'ipAdapterScale',
  lyrics: 'lyrics',
  mask_image: 'maskImage',
  mask_video: 'maskVideo',
  max_sequence_length: 'maxSequenceLength',
  negative_prompt: 'negativePrompt',
  num_frames: 'numFrames',
  num_images_per_prompt: 'batchSize',
  num_inference_steps: 'steps',
  offload_mode: 'offloadMode',
  output_type: 'outputType',
  reviewed_variant: 'modelRepo',
  prompt: 'prompt',
  quantization_mode: 'quantizationMode',
  reference_audio: 'referenceAudio',
  reference_images: 'referenceImages',
  reference_video: 'referenceVideos',
  reference_videos: 'referenceVideos',
  seed: 'seed',
  source_audio: 'sourceAudio',
  source_video: 'sourceVideo',
  strength: 'strength',
  width: 'width',
  modelVariant: 'modelRepo',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function studioModelType(value: unknown): value is StudioModelType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_MODEL_PROFILES, value);
}

function studioMode(value: unknown): value is StudioMode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STUDIO_MODE_DESCRIPTIONS, value);
}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z0-9])/gu, (_match, next: string) => next.toUpperCase());
}

function formFieldForControl(controlId: string, bindingFieldId: string, form: StudioFormState) {
  const candidates = [
    CONTROL_TO_FORM_FIELD[controlId],
    CONTROL_TO_FORM_FIELD[bindingFieldId],
    snakeToCamel(controlId),
    snakeToCamel(bindingFieldId),
    controlId,
    bindingFieldId,
  ];
  return candidates.find(
    (candidate): candidate is keyof StudioFormState =>
      typeof candidate === 'string' && Object.prototype.hasOwnProperty.call(form, candidate),
  );
}

export function projectBlockControlValueV2(value: BlockJsonValue, current: StudioFormState[keyof StudioFormState]) {
  if (typeof current === 'number') {
    if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'value')) {
      return projectBlockControlValueV2(value.value as BlockJsonValue, current);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return numeric;
    }
    return current;
  }
  if (typeof current === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return current;
  }
  if (typeof current === 'string') return typeof value === 'string' ? value : current;
  if (Array.isArray(current)) return Array.isArray(value) ? value : current;
  return value;
}

/**
 * Match an embedded, self-validating instance to an exact registered source.
 *
 * The compiled definition hash is intentionally not compared here. Historical
 * output snapshots remain valid provenance after the compiler schema evolves;
 * their own embedded definition/graph/interface hashes are still validated by
 * normalizeBlockInstanceV2. Auto authority performs the stronger current-pin
 * check separately before issuing a receipt.
 */
export function registeredBlockV2RouteForInstance(instance: BlockInstanceV2) {
  const source = instance.definitionSnapshot.source;
  if (
    instance.definitionSnapshot.ownership.kind !== 'registered' ||
    instance.definitionSnapshot.ownership.definitionMutable ||
    (source.kind !== 'diffusers_catalog' && source.kind !== 'transformers_catalog') ||
    !source.executionAdmissionId ||
    instance.definitionRef.definitionId !== source.executionAdmissionId
  ) {
    return null;
  }
  return (
    REGISTERED_BLOCK_V2_ROUTES.find(
      (candidate) =>
        candidate.admissionId === source.executionAdmissionId &&
        candidate.definitionId === source.manifestDefinitionId &&
        candidate.definitionContentHash === source.manifestContentHash &&
        candidate.provider === source.library &&
        candidate.libraryRevision === source.libraryRevision &&
        candidate.pipelineClass === source.pipelineClass &&
        candidate.workflowId === source.workflow &&
        candidate.artifact.repo === source.repository &&
        candidate.artifact.revision === source.repositoryRevision,
    ) ?? null
  );
}

export function registeredBlockRunFormV2(
  instanceValue: BlockInstanceV2,
  resourceMode: StudioFormState['resourceMode'],
): RegisteredBlockRunFormV2 | null {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const route = registeredBlockV2RouteForInstance(instance);
  if (!route || !studioModelType(route.pipelineClass) || !studioMode(route.studioMode)) return null;

  const projected = {
    ...getFormDefaultsForModel(route.pipelineClass),
    modelType: route.pipelineClass,
    modelRepo: route.artifact.repo,
    mode: route.studioMode,
    resourceMode,
  } as StudioFormState & Record<string, unknown>;
  instance.effectiveInterface.controls.forEach((control) => {
    const value = blockInstanceValueV2(instance, control.controlId);
    if (value === undefined) return;
    const field = formFieldForControl(control.controlId, control.binding.fieldId, projected);
    if (!field) return;
    (projected as Record<string, unknown>)[field] = projectBlockControlValueV2(value, projected[field]);
    if (
      field === 'seed' &&
      isRecord(value) &&
      typeof value.isRandom === 'boolean' &&
      Object.prototype.hasOwnProperty.call(projected, 'randomSeed')
    ) {
      projected.randomSeed = value.isRandom;
    }
  });
  if (!selectedRegisteredBlockArtifactV2(route, projected.modelRepo)) return null;
  return { form: projected, instance, route };
}

/** Display/provenance only: a saved User Node does not inherit admission or
 * Auto authority. Read its actual executable loader and fields, never the
 * global Studio form or the registered ancestor's unmodified parameter map. */
export function userBlockRunFormV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  if (instance.definitionSnapshot.ownership.kind !== 'user') return null;
  const graph = expandBlockGraphV2ForExecution([createBlockRootNodeV2(instance)], []);
  const loaders = graph.nodes.filter(
    ({ data }) => data.module === 'modules.ModularDiffusers' && data.action === 'ModelsLoader',
  );
  if (loaders.length !== 1) return null;
  const params = loaders[0]!.data.params;
  const modelType = params.model_type?.value ?? params.model_type?.default;
  const workflowId = params.workflow_id?.value ?? params.workflow_id?.default;
  const repo = params.repo_id?.value ?? params.repo_id?.default;
  const repository = isRecord(repo) ? repo.value : repo;
  if (!studioModelType(modelType) || typeof repository !== 'string' || !repository) return null;
  const modes = new Set(
    REGISTERED_BLOCK_V2_ROUTES.filter(
      (route) => route.pipelineClass === modelType && route.workflowId === workflowId,
    ).map((route) => route.studioMode),
  );
  if (modes.size !== 1) return null;
  const mode = [...modes][0];
  if (!studioMode(mode)) return null;
  const projected: StudioFormState = {
    ...getFormDefaultsForModel(modelType),
    modelType,
    modelRepo: repository,
    mode,
    resourceMode: 'expert',
  };
  const values = new Map<keyof StudioFormState, BlockJsonValue>();
  for (const node of graph.nodes) {
    for (const [fieldId, param] of Object.entries(node.data.params)) {
      if (param.display === 'output') continue;
      const value = param.value === undefined ? param.default : param.value;
      if (value === undefined) continue;
      const field = formFieldForControl(fieldId, fieldId, projected);
      if (!field || ['modelType', 'modelRepo', 'mode', 'resourceMode'].includes(field)) continue;
      const normalized = projectBlockControlValueV2(value as BlockJsonValue, projected[field]);
      if (values.has(field) && JSON.stringify(values.get(field)) !== JSON.stringify(normalized)) return null;
      values.set(field, normalized as BlockJsonValue);
      if (field === 'seed' && isRecord(value) && typeof value.isRandom === 'boolean')
        projected.randomSeed = value.isRandom;
    }
  }
  values.forEach((value, field) => {
    (projected as unknown as Record<string, unknown>)[field] = value;
  });
  return { form: projected, instance };
}

export function userBlockRunFormForFlowV2(nodes: readonly CustomNodeType[], targetNodeId: string | undefined) {
  const candidates = nodes.filter((node) => node.data.blockInstanceV2 && (!targetNodeId || node.id === targetNodeId));
  if (candidates.length !== 1) return null;
  return userBlockRunFormV2(candidates[0]!.data.blockInstanceV2!);
}

/**
 * Derive submission metadata from the exact root being run. A graph-wide run
 * with multiple executable registered roots is ambiguous and fails closed;
 * callers must target one root explicitly.
 */
export function registeredBlockRunFormForFlowV2(
  nodes: readonly CustomNodeType[],
  targetNodeId: string | undefined,
  resourceMode: StudioFormState['resourceMode'],
  options: { rejectAmbiguous?: boolean } = {},
) {
  const candidates = nodes.flatMap((node) => {
    if (!node.data.blockInstanceV2) return [];
    const projected = registeredBlockRunFormV2(node.data.blockInstanceV2, resourceMode);
    return projected ? [{ nodeId: node.id, ...projected }] : [];
  });
  if (targetNodeId) return candidates.find(({ nodeId }) => nodeId === targetNodeId) ?? null;
  if (candidates.length > 1) {
    if (options.rejectAmbiguous === false) return null;
    throw new Error(
      'This graph contains multiple executable registered Blocks. Select one Block and run it explicitly so output provenance is unambiguous.',
    );
  }
  return candidates[0] ?? null;
}

/** Normalize an existing output from its immutable V2 graph snapshot. */
export function blockOutputRunFormV2(value: OutputLike) {
  if (typeof value.nodeId !== 'string' || !isRecord(value.graphSnapshot)) return null;
  const graphNodes = Array.isArray(value.graphSnapshot.nodes) ? value.graphSnapshot.nodes : [];
  const resourceMode = isRecord(value.formSnapshot) && value.formSnapshot.resourceMode === 'auto' ? 'auto' : 'expert';
  const candidates = graphNodes.flatMap((rawNode) => {
    if (!isRecord(rawNode) || !isRecord(rawNode.data) || rawNode.data.blockInstanceV2 === undefined) return [];
    try {
      const projected =
        registeredBlockRunFormV2(rawNode.data.blockInstanceV2 as BlockInstanceV2, resourceMode) ??
        userBlockRunFormV2(rawNode.data.blockInstanceV2 as BlockInstanceV2);
      if (!projected) return [];
      const previewNodeIds = projected.instance.previewStates.map(({ binding }) =>
        blockProjectionNodeIdV2(projected.instance.instanceId, binding.nodeId),
      );
      return previewNodeIds.includes(value.nodeId as string) ? [projected] : [];
    } catch {
      return [];
    }
  });
  return candidates.length === 1 ? candidates[0]! : null;
}
