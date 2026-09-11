import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { connectionTypesAreCompatible } from '../theme/connectionTypes';
import { compositeChildNodeId } from './compositeNodes';
import {
  huggingFaceClusterParameterProjection,
  validateHuggingFaceClusterInstance,
  type HuggingFaceClusterInstance,
} from './huggingFaceClusterInstance';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import type { StudioExecutionSpec, StudioGraphRole } from './types';

export type HuggingFaceClusterPendingField = {
  role: StudioGraphRole;
  field: string;
  purpose: 'binding' | 'source_handle' | 'target_handle';
};

export type HuggingFaceClusterPersistedBinding = {
  schemaVersion: 1;
  admissionId: string;
  source: string;
  persistence: 'instance_input' | 'execution_parameter' | 'sealed';
  input?: string;
};

export type HuggingFaceClusterExecutionSkeleton = {
  schemaVersion: 1;
  definitionId: string;
  instanceId: string;
  admissionId: string;
  adapterContractId: string;
  studioExecutionSpec: {
    id: string;
    contentHash: string;
    executionProfileId: string;
  };
  claim: 'materialized_graph_skeleton';
  executable: false;
  bindingsComplete: boolean;
  nodes: CustomNodeType[];
  edges: Edge[];
  nodeIdsByRole: Partial<Record<StudioGraphRole, string>>;
  missingBindingSources: string[];
  pendingFields: HuggingFaceClusterPendingField[];
};

export type HuggingFaceClusterExecutableGraph = Omit<
  HuggingFaceClusterExecutionSkeleton,
  'claim' | 'executable' | 'nodes'
> & {
  claim: 'qualification_execution_graph' | 'manual_execution_graph';
  executable: true;
  runtimeAuthority?: {
    schemaVersion: 1;
    executionFingerprint: string;
    runtimeFingerprint: string;
    checkedAt: number;
  };
  nodes: CustomNodeType[];
};

export type HuggingFaceClusterStudioExecutionSpecRuntimeReceipt = {
  schemaVersion: 1;
  id: string;
  contentHash: string;
  nodes: Partial<Record<StudioGraphRole, string>>;
};

export type HuggingFaceClusterCanonicalExecutionSnapshot = {
  schemaVersion: 1;
  definitionId: string;
  instanceId: string;
  admissionId: string;
  adapterContractId: string;
  studioExecutionSpec: HuggingFaceClusterExecutionSkeleton['studioExecutionSpec'];
  nodes: Array<{
    role: string;
    module: string;
    action: string;
    params: Array<{
      field: string;
      display: string | null;
      type: string | string[] | null;
      value: unknown;
      default: unknown;
    }>;
  }>;
  edges: Array<{
    sourceRole: string;
    sourceHandle: string;
    targetRole: string;
    targetHandle: string;
  }>;
};

export type HuggingFaceClusterMaterializerInput = {
  definition: HuggingFaceNodeLibraryDefinition;
  instance: HuggingFaceClusterInstance;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  executionSpec: StudioExecutionSpec;
  nodesRegistry: Record<string, NodeData>;
  bindingValues?: Readonly<Record<string, unknown>>;
  expanded?: boolean;
};

export type HuggingFaceClusterSkeletonReconciliationInput = {
  definition: HuggingFaceNodeLibraryDefinition;
  instance: HuggingFaceClusterInstance;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  executionSpec: StudioExecutionSpec;
  skeleton: HuggingFaceClusterExecutionSkeleton;
  currentNodes: readonly CustomNodeType[];
  bindingValues?: Readonly<Record<string, unknown>>;
  expanded?: boolean;
};

const NODE_PADDING = 24;

function invalid(message: string): never {
  throw new Error(`Cannot materialize Hugging Face Cluster Node: ${message}`);
}

function cloneNodeData(value: NodeData): NodeData {
  return JSON.parse(JSON.stringify(value)) as NodeData;
}

function executionNodeId(instanceId: string, role: StudioGraphRole) {
  return compositeChildNodeId(instanceId, `diffusers.cluster-execution:${encodeURIComponent(role)}`);
}

function executionEdgeId(
  instanceId: string,
  sourceRole: StudioGraphRole,
  sourceHandle: string,
  targetRole: StudioGraphRole,
  targetHandle: string,
) {
  return compositeChildNodeId(
    instanceId,
    `diffusers.cluster-execution-edge:${encodeURIComponent(sourceRole)}:${encodeURIComponent(sourceHandle)}:${encodeURIComponent(targetRole)}:${encodeURIComponent(targetHandle)}`,
  );
}

function instanceBindingValues(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
) {
  const values = Object.fromEntries(
    huggingFaceClusterParameterProjection(instance, definition).map((field) => [field.name, field.value]),
  );
  return Object.fromEntries(
    admission.instanceInputBindings.map(({ bindingSource, input }) => [bindingSource, values[input]]),
  );
}

export function resolveHuggingFaceClusterBindingValues(
  definition: HuggingFaceNodeLibraryDefinition,
  requestedInstance: HuggingFaceClusterInstance,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  bindingValues: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const instance = validateHuggingFaceClusterInstance(requestedInstance, definition);
  if (
    !instance.execution ||
    instance.execution.admissionId !== admission.id ||
    JSON.stringify(instance.execution.studioExecutionSpec) !== JSON.stringify(admission.studioExecutionSpec) ||
    admission.definitionId !== definition.id ||
    admission.status !== 'admitted' ||
    !admission.artifact
  )
    invalid('binding values do not belong to the selected reviewed execution admission.');
  if (
    Object.keys(bindingValues).some((source) => !admission.executionParameterSources.includes(source)) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'artifact') &&
      admission.sealedBindingValues.artifact !== admission.artifact.repo) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'pipelineClass') &&
      definition.provider === 'diffusers' &&
      definition.integrationStatus !== 'equivalent_standard_route' &&
      admission.sealedBindingValues.pipelineClass !==
        (definition.definitionKind === 'studio_execution_composite'
          ? definition.blocksClass
          : definition.pipelineClass)) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'pipelineClass') &&
      definition.provider === 'diffusers' &&
      definition.integrationStatus === 'equivalent_standard_route' &&
      (typeof admission.sealedBindingValues.pipelineClass !== 'string' ||
        !admission.sealedBindingValues.pipelineClass)) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'pipelineClass') &&
      definition.provider === 'transformers' &&
      admission.sealedBindingValues.pipelineClass !== definition.blocksClass) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'executionProfileId') &&
      admission.sealedBindingValues.executionProfileId !== admission.studioExecutionSpec?.executionProfileId) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'defaultRevision') &&
      admission.sealedBindingValues.defaultRevision !== admission.artifact.revision) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'mode') &&
      admission.sealedBindingValues.mode !== admission.studioMode) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'empty') &&
      admission.sealedBindingValues.empty !== '') ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'true') &&
      admission.sealedBindingValues.true !== true) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'false') &&
      admission.sealedBindingValues.false !== false) ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'ordinary') &&
      admission.sealedBindingValues.ordinary !== 'ordinary') ||
    (Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, 'fp16') &&
      admission.sealedBindingValues.fp16 !== 'fp16')
  )
    invalid('sealed or planner binding values do not match the reviewed admission.');
  return {
    ...admission.sealedBindingValues,
    ...instanceBindingValues(instance, definition, admission),
    ...instance.execution.parameterOverrides,
    ...bindingValues,
  };
}

function boundValue(param: NodeParams, value: unknown) {
  if (
    typeof value === 'string' &&
    (param.display === 'modelselect' || (param.value !== null && typeof param.value === 'object'))
  ) {
    return { source: 'hub', value };
  }
  return value;
}

/*
 * Schema-v6 registered Blocks were originally pinned while ModelsLoader
 * published this exact menu.  That menu is presentation metadata owned by the
 * global node catalog, not execution authority for an individual Block.  If a
 * newly reviewed pipeline is allowed to extend the captured menu, every
 * otherwise-unrelated registered Block changes identity and existing saved
 * instances become historical.
 *
 * Keep the pre-Cosmos schema-v6 bytes for compatibility and add only the
 * selected pipeline when a newer registered route needs it.  Ordinary library
 * ModelsLoader nodes continue to receive the complete live catalog; this
 * projection applies only to the sealed pipelineClass binding inside an exact
 * registered execution skeleton.
 */
const REGISTERED_BLOCK_V2_MODEL_TYPE_CANONICAL_BASELINE = Object.freeze({
  '': '',
  DummyCustomPipeline: 'Custom',
  StableDiffusionXLModularPipeline: 'Stable Diffusion XL',
  QwenImageModularPipeline: 'Qwen-Image-2512',
  QwenImageEditModularPipeline: 'Qwen-Image-Edit',
  QwenImageEditPlusModularPipeline: 'Qwen-Image-Edit-2511',
  QwenImageLayeredModularPipeline: 'Qwen-Image-Layered',
  FluxModularPipeline: 'Flux',
  FluxKontextModularPipeline: 'Flux Kontext',
  Flux2KleinModularPipeline: 'Flux 2 Klein Distilled',
  Flux2KleinBaseModularPipeline: 'Flux 2 Klein Base',
  ZImageModularPipeline: 'Z-Image',
  WanModularPipeline: 'WAN2 T2V',
  WanImage2VideoModularPipeline: 'WAN2 I2V',
  MiniMaxMusic3ModularPipeline: 'MiniMax Music 3',
  AnimaModularPipeline: 'Anima',
  HeliosModularPipeline: 'Helios',
  HeliosPyramidModularPipeline: 'Helios Pyramid',
  HeliosPyramidDistilledModularPipeline: 'Helios Pyramid Distilled',
  WanAnimate2ModularPipeline: 'Wan Animate 2',
  WanAnimate2DistilledModularPipeline: 'Wan Animate 2 Distilled',
  Cosmos3OmniModularPipeline: 'Cosmos 3 Omni (Contract only)',
  Ideogram4ModularPipeline: 'Ideogram 4 (Contract only)',
  Krea2ModularPipeline: 'Krea 2 (Contract only)',
  Krea2TurboModularPipeline: 'Krea 2 Turbo (Contract only)',
  StableDiffusion3ModularPipeline: 'Stable Diffusion 3 (Contract only)',
  Cosmos3DistilledModularPipeline: 'Cosmos 3 Distilled (Contract only)',
  MiniMaxH3ModularPipeline: 'MiniMax H3 (Contract only)',
  LTX25ModularPipeline: 'LTX-2.5 (Contract only)',
} satisfies Record<string, unknown>);

const REGISTERED_BLOCK_V2_CURRENT_MODEL_LABELS = new Set([
  'Cosmos3DistilledModularPipeline',
  'MiniMaxH3ModularPipeline',
]);

function registeredBlockV2SealedOptions(param: NodeParams, source: string, value: unknown): NodeParams['options'] {
  if (
    source !== 'pipelineClass' ||
    typeof value !== 'string' ||
    !value ||
    !param.options ||
    Array.isArray(param.options)
  )
    return param.options;
  const selected = Object.prototype.hasOwnProperty.call(param.options, value) ? param.options[value] : value;
  return {
    ...REGISTERED_BLOCK_V2_MODEL_TYPE_CANONICAL_BASELINE,
    // The canonical menu is compatibility-only. The pipeline selected by the
    // exact admission must retain its current reviewed display label even
    // when that pipeline previously existed in the baseline as catalog-only.
    // This keeps unrelated options byte-stable while avoiding a misleading
    // "Contract only" label on a structurally admitted ModelsLoader.
    ...(REGISTERED_BLOCK_V2_CURRENT_MODEL_LABELS.has(value) ? { [value]: selected } : {}),
  };
}

function bindExecutionNodes(
  definition: HuggingFaceNodeLibraryDefinition,
  instance: HuggingFaceClusterInstance,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
  executionSpec: StudioExecutionSpec,
  requestedNodes: readonly CustomNodeType[],
  bindingValues: Readonly<Record<string, unknown>>,
  expanded: boolean,
) {
  const nodes = requestedNodes.map((node) => {
    const data = cloneNodeData(node.data);
    data.params = Object.fromEntries(
      Object.entries(data.params).map(([field, param]) => [
        field,
        {
          ...param,
          fieldOptions: {
            ...param.fieldOptions,
            // The managed finalizer has already dispatched and awaited every
            // dynamic field action required by this execution schema. Merely
            // rendering an expanded Cluster must not dispatch those actions
            // again and race a sealed/persisted value back to its default.
            suppressInitialFieldAction: true,
          },
        },
      ]),
    );
    return { ...node, data };
  });
  const nodesByRole = new Map<StudioGraphRole, CustomNodeType>();
  const nodeIdsByRole: Partial<Record<StudioGraphRole, string>> = {};
  for (const [role, nodeKey] of executionSpec.roles) {
    const expectedId = executionNodeId(instance.instanceId, role);
    const node = nodes.find((candidate) => candidate.id === expectedId);
    if (
      !node ||
      `${node.data.module}.${node.data.action}` !== nodeKey ||
      node.parentId !== instance.instanceId ||
      node.data.huggingFaceClusterRole !== 'execution' ||
      node.data.huggingFaceClusterInstanceId !== instance.instanceId ||
      node.data.huggingFaceClusterExecutionAdmissionId !== admission.id ||
      node.data.huggingFaceClusterExecutionSpecId !== executionSpec.id ||
      node.data.huggingFaceClusterExecutionRole !== role ||
      node.data.uiState?.disabled !== true
    )
      invalid(`execution role ${role} is absent or has stale ownership.`);
    node.hidden = !expanded;
    nodesByRole.set(role, node);
    nodeIdsByRole[role] = node.id;
  }
  if (nodes.length !== nodesByRole.size) invalid('the execution skeleton contains undeclared nodes.');

  const intrinsicValues = resolveHuggingFaceClusterBindingValues(definition, instance, admission, bindingValues);
  const missingBindingSources = new Set<string>();
  const pendingFields: HuggingFaceClusterPendingField[] = [];
  for (const [role, field, source] of executionSpec.bindings) {
    const node = nodesByRole.get(role);
    if (!node) invalid(`binding role ${role} is absent.`);
    const param = node.data.params[field];
    if (!param) {
      pendingFields.push({ role, field, purpose: 'binding' });
      continue;
    }
    if (param.display === 'output') invalid(`binding ${role}.${field} targets an output field.`);
    const input = admission.instanceInputBindings.find((binding) => binding.bindingSource === source)?.input;
    const persistence = input
      ? 'instance_input'
      : admission.executionParameterSources.includes(source)
        ? 'execution_parameter'
        : 'sealed';
    const huggingFaceClusterBinding: HuggingFaceClusterPersistedBinding = {
      schemaVersion: 1,
      admissionId: admission.id,
      source,
      persistence,
      ...(input ? { input } : {}),
    };
    const value = intrinsicValues[source];
    node.data.params[field] = {
      ...param,
      ...(value === undefined ? {} : { value: boundValue(param, value) }),
      ...(persistence === 'sealed' ? { options: registeredBlockV2SealedOptions(param, source, value) } : {}),
      disabled: persistence === 'sealed' ? true : param.disabled,
      fieldOptions: {
        ...param.fieldOptions,
        huggingFaceClusterBinding,
      },
    };
    if (value === undefined) missingBindingSources.add(source);
  }

  const edges = executionSpec.edges.map(([sourceRole, sourceHandle, targetRole, targetHandle]) => {
    const source = nodesByRole.get(sourceRole);
    const target = nodesByRole.get(targetRole);
    if (!source || !target) invalid('the Studio edge references an absent role.');
    const sourceParam = source.data.params[sourceHandle];
    const targetParam = target.data.params[targetHandle];
    if (!sourceParam) pendingFields.push({ role: sourceRole, field: sourceHandle, purpose: 'source_handle' });
    if (!targetParam) pendingFields.push({ role: targetRole, field: targetHandle, purpose: 'target_handle' });
    if (sourceParam && targetParam) {
      if (sourceParam.display !== 'output' || targetParam.display !== 'input')
        invalid(`edge ${sourceRole}.${sourceHandle} -> ${targetRole}.${targetHandle} has incompatible directions.`);
      if (!connectionTypesAreCompatible(sourceParam.type, targetParam.type))
        invalid(`edge ${sourceRole}.${sourceHandle} -> ${targetRole}.${targetHandle} has incompatible types.`);
    }
    return {
      id: executionEdgeId(instance.instanceId, sourceRole, sourceHandle, targetRole, targetHandle),
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle,
      type: 'default',
      hidden: !expanded,
    } satisfies Edge;
  });
  const uniquePendingFields = [
    ...new Map(
      pendingFields.map((pending) => [`${pending.role}\0${pending.field}\0${pending.purpose}`, pending] as const),
    ).values(),
  ].sort((left, right) =>
    `${left.role}\0${left.field}\0${left.purpose}`.localeCompare(`${right.role}\0${right.field}\0${right.purpose}`),
  );
  const missing = [...missingBindingSources].sort();
  return {
    nodes,
    edges,
    nodeIdsByRole,
    missingBindingSources: missing,
    pendingFields: uniquePendingFields,
    bindingsComplete: missing.length === 0 && uniquePendingFields.length === 0,
  };
}

/**
 * Materialize one admitted Studio execution spec under an isolated Cluster.
 *
 * This is phase one only. Dynamic Modular action fields may not exist until
 * backend field actions run, and no finalization/resource proof is issued
 * here. The returned nodes therefore stay explicitly non-executable even when
 * every static binding value is present.
 */
export function materializeHuggingFaceClusterExecutionSkeleton({
  definition,
  instance: requestedInstance,
  admission,
  executionSpec,
  nodesRegistry,
  bindingValues = {},
  expanded = false,
}: HuggingFaceClusterMaterializerInput): HuggingFaceClusterExecutionSkeleton {
  const instance = validateHuggingFaceClusterInstance(requestedInstance, definition);
  if (
    admission.definitionId !== definition.id ||
    admission.status !== 'admitted' ||
    admission.claim !== 'static_graph_contract_compatible' ||
    admission.executable !== false ||
    admission.publication.readiness !== 'graph_qualified' ||
    !admission.publication.insertable ||
    !admission.adapterContractId ||
    !admission.studioExecutionSpec ||
    !admission.artifact ||
    admission.reasons.length
  )
    invalid('the backend execution admission is absent, rejected, or malformed.');
  if (
    !instance.execution ||
    instance.execution.admissionId !== admission.id ||
    JSON.stringify(instance.execution.studioExecutionSpec) !== JSON.stringify(admission.studioExecutionSpec)
  )
    invalid('the Cluster Node instance has not selected this exact admitted execution contract.');
  const adapter = definition.graphAdapterContracts.find((candidate) => candidate.id === admission.adapterContractId);
  if (!adapter) invalid('the admitted graph adapter is not part of this exact workflow definition.');
  const providerMatches =
    definition.provider === 'diffusers'
      ? definition.integrationStatus === 'reviewed_modiff_contract' ||
        definition.integrationStatus === 'reviewed_modular_workflow_route'
        ? executionSpec.pipelineClass === definition.pipelineClass &&
          executionSpec.executionPath === 'modular-diffusers'
        : definition.integrationStatus === 'reviewed_diffusers_composite'
          ? (executionSpec.executionPath === 'direct-diffusers-image' ||
              executionSpec.executionPath === 'direct-diffusers-video' ||
              executionSpec.executionPath === 'direct-diffusers-audio') &&
            executionSpec.pipelineClass === definition.blocksClass
          : definition.integrationStatus === 'equivalent_standard_route' &&
            (executionSpec.executionPath === 'direct-diffusers-image' ||
              executionSpec.executionPath === 'direct-diffusers-video') &&
            executionSpec.pipelineClass === admission.sealedBindingValues.pipelineClass
      : executionSpec.pipelineClass === definition.blocksClass &&
        executionSpec.executionPath.startsWith('direct-huggingface-');
  if (
    executionSpec.id !== admission.studioExecutionSpec.id ||
    executionSpec.contentHash !== admission.studioExecutionSpec.contentHash ||
    executionSpec.executionProfileId !== admission.studioExecutionSpec.executionProfileId ||
    executionSpec.modelType !== definition.pipelineClass ||
    executionSpec.mode !== admission.studioMode ||
    !providerMatches ||
    executionSpec.defaultRepo !== admission.artifact.repo
  )
    invalid('the Studio execution specification does not match the admission receipt.');
  const specBindingSources = [...new Set(executionSpec.bindings.map(([, , source]) => source))].sort();
  if (JSON.stringify(specBindingSources) !== JSON.stringify([...admission.bindingSources].sort()))
    invalid('the Studio binding sources do not match the backend admission contract.');

  const xCoordinates = executionSpec.roles.map(([, , x]) => x);
  const yCoordinates = executionSpec.roles.map(([, , , y]) => y);
  const minimumX = Math.min(...xCoordinates);
  const minimumY = Math.min(...yCoordinates);
  const nodes = executionSpec.roles.map(([role, nodeKey, x, y]) => {
    const registryNode = nodesRegistry[nodeKey];
    if (!registryNode || `${registryNode.module}.${registryNode.action}` !== nodeKey)
      invalid(`the live node registry does not contain ${nodeKey}.`);
    const id = executionNodeId(instance.instanceId, role);
    const reviewedPosition = { x: x - minimumX + NODE_PADDING, y: y - minimumY + NODE_PADDING };
    const position = instance.presentation.executionLayout[role] ?? reviewedPosition;
    return {
      id,
      type: registryNode.type,
      parentId: instance.instanceId,
      // Match expanded User Nodes: children keep their reviewed graph
      // coordinates and the containing frame grows around their measured
      // cards. `extent: parent` clamps tall nodes before React Flow has
      // measured them and can place them above the Cluster header.
      extent: undefined,
      expandParent: true,
      hidden: !expanded,
      position: { ...position },
      selected: false,
      dragging: false,
      data: {
        ...cloneNodeData(registryNode),
        studioRole: undefined,
        studioOwned: undefined,
        huggingFaceClusterRole: 'execution' as const,
        huggingFaceClusterInstanceId: instance.instanceId,
        huggingFaceClusterSemanticId: id,
        huggingFaceClusterExecutionAdmissionId: admission.id,
        huggingFaceClusterExecutionSpecId: executionSpec.id,
        huggingFaceClusterExecutionRole: role,
        huggingFaceClusterExecutionPosition: { ...position },
        uiState: {
          ...registryNode.uiState,
          disabled: true,
          validationSeverity: 'warning',
          validationMessage: 'Cluster execution fields and runtime/resource proof are not finalized yet.',
        },
      },
    } satisfies CustomNodeType;
  });
  const bound = bindExecutionNodes(definition, instance, admission, executionSpec, nodes, bindingValues, expanded);
  return {
    schemaVersion: 1,
    definitionId: definition.id,
    instanceId: instance.instanceId,
    admissionId: admission.id,
    adapterContractId: admission.adapterContractId,
    studioExecutionSpec: {
      id: executionSpec.id,
      contentHash: executionSpec.contentHash,
      executionProfileId: executionSpec.executionProfileId,
    },
    claim: 'materialized_graph_skeleton',
    executable: false,
    bindingsComplete: bound.bindingsComplete,
    nodes: bound.nodes,
    edges: bound.edges,
    nodeIdsByRole: bound.nodeIdsByRole,
    missingBindingSources: bound.missingBindingSources,
    pendingFields: bound.pendingFields,
  };
}

/** Rebind a skeleton after reviewed backend field actions republish its node schemas. */
export function reconcileHuggingFaceClusterExecutionSkeleton({
  definition,
  instance: requestedInstance,
  admission,
  executionSpec,
  skeleton,
  currentNodes,
  bindingValues = {},
  expanded,
}: HuggingFaceClusterSkeletonReconciliationInput): HuggingFaceClusterExecutionSkeleton {
  const instance = validateHuggingFaceClusterInstance(requestedInstance, definition);
  if (
    skeleton.schemaVersion !== 1 ||
    skeleton.claim !== 'materialized_graph_skeleton' ||
    skeleton.executable !== false ||
    skeleton.definitionId !== definition.id ||
    skeleton.instanceId !== instance.instanceId ||
    skeleton.admissionId !== admission.id ||
    skeleton.adapterContractId !== admission.adapterContractId ||
    skeleton.studioExecutionSpec.id !== executionSpec.id ||
    skeleton.studioExecutionSpec.contentHash !== executionSpec.contentHash ||
    skeleton.studioExecutionSpec.executionProfileId !== executionSpec.executionProfileId ||
    admission.status !== 'admitted' ||
    admission.executable !== false ||
    admission.studioExecutionSpec?.id !== executionSpec.id ||
    admission.studioExecutionSpec.contentHash !== executionSpec.contentHash ||
    admission.studioExecutionSpec.executionProfileId !== executionSpec.executionProfileId
  )
    invalid('the dynamic-field reconciliation receipts disagree.');
  const expectedIds = new Set(executionSpec.roles.map(([role]) => executionNodeId(instance.instanceId, role)));
  const selectedNodes = currentNodes.filter((node) => expectedIds.has(node.id));
  const bound = bindExecutionNodes(
    definition,
    instance,
    admission,
    executionSpec,
    selectedNodes,
    bindingValues,
    expanded ?? instance.presentation.expanded,
  );
  return {
    ...skeleton,
    bindingsComplete: bound.bindingsComplete,
    nodes: bound.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        uiState: {
          ...node.data.uiState,
          disabled: true,
          validationSeverity: 'warning',
          validationMessage: bound.bindingsComplete
            ? 'Cluster runtime/resource proof is not finalized yet.'
            : 'Cluster execution fields and runtime/resource proof are not finalized yet.',
        },
      },
    })),
    edges: bound.edges,
    nodeIdsByRole: bound.nodeIdsByRole,
    missingBindingSources: bound.missingBindingSources,
    pendingFields: bound.pendingFields,
  };
}

export function huggingFaceClusterStudioExecutionSpecRuntimeReceipt(
  skeleton: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceClusterStudioExecutionSpecRuntimeReceipt {
  if (
    skeleton.claim !== 'materialized_graph_skeleton' ||
    skeleton.executable !== false ||
    !skeleton.bindingsComplete ||
    skeleton.missingBindingSources.length ||
    skeleton.pendingFields.length ||
    Object.keys(skeleton.nodeIdsByRole).length !== skeleton.nodes.length ||
    skeleton.nodes.some(
      (node) =>
        node.data.huggingFaceClusterRole !== 'execution' ||
        node.data.huggingFaceClusterInstanceId !== skeleton.instanceId ||
        node.data.huggingFaceClusterExecutionAdmissionId !== skeleton.admissionId ||
        node.data.huggingFaceClusterExecutionSpecId !== skeleton.studioExecutionSpec.id ||
        node.data.uiState?.disabled !== true,
    )
  )
    invalid('the skeleton cannot issue a Studio execution-spec runtime receipt.');
  return {
    schemaVersion: 1,
    id: skeleton.studioExecutionSpec.id,
    contentHash: skeleton.studioExecutionSpec.contentHash,
    nodes: { ...skeleton.nodeIdsByRole },
  };
}

/** Enable a complete skeleton only after a volatile runtime/resource join. */
export function authorizeHuggingFaceClusterExecutionSkeleton(
  skeleton: HuggingFaceClusterExecutionSkeleton,
  authority: {
    schemaVersion: 1;
    instanceId: string;
    definitionId: string;
    admissionId: string;
    executionFingerprint: string;
    runtimeFingerprint: string;
    checkedAt: number;
    claim: 'qualification_execution_authorized';
    publicationExecutable: false;
    nodeIds: string[];
  },
): HuggingFaceClusterExecutableGraph {
  huggingFaceClusterStudioExecutionSpecRuntimeReceipt(skeleton);
  const nodeIds = skeleton.nodes.map((node) => node.id).sort();
  if (
    authority.schemaVersion !== 1 ||
    authority.claim !== 'qualification_execution_authorized' ||
    authority.publicationExecutable !== false ||
    authority.instanceId !== skeleton.instanceId ||
    authority.definitionId !== skeleton.definitionId ||
    authority.admissionId !== skeleton.admissionId ||
    !authority.executionFingerprint ||
    !authority.runtimeFingerprint ||
    !Number.isSafeInteger(authority.checkedAt) ||
    authority.checkedAt <= 0 ||
    JSON.stringify([...authority.nodeIds].sort()) !== JSON.stringify(nodeIds)
  )
    invalid('the runtime/resource authority does not match this exact execution skeleton.');
  return {
    ...skeleton,
    claim: 'qualification_execution_graph',
    executable: true,
    runtimeAuthority: {
      schemaVersion: 1,
      executionFingerprint: authority.executionFingerprint,
      runtimeFingerprint: authority.runtimeFingerprint,
      checkedAt: authority.checkedAt,
    },
    nodes: skeleton.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        uiState: {
          ...node.data.uiState,
          disabled: false,
          validationSeverity: undefined,
          validationMessage: undefined,
        },
      },
    })),
  };
}

/**
 * Expert mode deliberately submits the concrete graph without claiming Auto,
 * installation, memory-fit, or qualification authority. The backend remains
 * the source of truth for the actual run and returns its normal node/runtime
 * errors. This is distinct from the fail-closed Auto authorization above.
 */
export function authorizeHuggingFaceClusterManualExecutionSkeleton(
  skeleton: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceClusterExecutableGraph {
  huggingFaceClusterStudioExecutionSpecRuntimeReceipt(skeleton);
  return {
    ...skeleton,
    claim: 'manual_execution_graph',
    executable: true,
    nodes: skeleton.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        uiState: {
          ...node.data.uiState,
          disabled: false,
          validationSeverity: undefined,
          validationMessage: undefined,
        },
      },
    })),
  };
}

/**
 * Canonical execution identity for parity checks and cache inputs. Presentation,
 * layout, selection, progress, previews, and disabled-before-admission UI state
 * are intentionally excluded.
 */
export function canonicalHuggingFaceClusterExecutionSnapshot(
  skeleton: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceClusterCanonicalExecutionSnapshot {
  if (
    skeleton.schemaVersion !== 1 ||
    skeleton.claim !== 'materialized_graph_skeleton' ||
    skeleton.executable !== false ||
    !skeleton.bindingsComplete ||
    skeleton.missingBindingSources.length ||
    skeleton.pendingFields.length
  )
    invalid('the skeleton is not complete enough to canonicalize.');
  const rolesByNodeId = new Map<string, string>();
  const nodes = skeleton.nodes
    .map((node) => {
      const role = node.data.huggingFaceClusterExecutionRole;
      if (
        !role ||
        node.data.huggingFaceClusterRole !== 'execution' ||
        node.data.huggingFaceClusterInstanceId !== skeleton.instanceId ||
        node.data.huggingFaceClusterExecutionAdmissionId !== skeleton.admissionId ||
        node.data.huggingFaceClusterExecutionSpecId !== skeleton.studioExecutionSpec.id ||
        rolesByNodeId.has(node.id)
      )
        invalid('the skeleton contains an invalid execution node identity.');
      rolesByNodeId.set(node.id, role);
      return {
        role,
        module: node.data.module,
        action: node.data.action,
        params: Object.entries(node.data.params)
          .map(([field, param]) => ({
            field,
            display: param.display ?? null,
            type: param.type ?? null,
            value: param.value ?? null,
            default: param.default ?? null,
          }))
          .sort((left, right) => left.field.localeCompare(right.field)),
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role));
  if (rolesByNodeId.size !== skeleton.nodes.length) invalid('the skeleton execution roles are not unique.');
  const edges = skeleton.edges
    .map((edge) => {
      const sourceRole = rolesByNodeId.get(edge.source);
      const targetRole = rolesByNodeId.get(edge.target);
      if (!sourceRole || !targetRole || !edge.sourceHandle || !edge.targetHandle)
        invalid('the skeleton contains an invalid execution edge identity.');
      return { sourceRole, sourceHandle: edge.sourceHandle, targetRole, targetHandle: edge.targetHandle };
    })
    .sort((left, right) =>
      `${left.sourceRole}\0${left.sourceHandle}\0${left.targetRole}\0${left.targetHandle}`.localeCompare(
        `${right.sourceRole}\0${right.sourceHandle}\0${right.targetRole}\0${right.targetHandle}`,
      ),
    );
  return {
    schemaVersion: 1,
    definitionId: skeleton.definitionId,
    instanceId: skeleton.instanceId,
    admissionId: skeleton.admissionId,
    adapterContractId: skeleton.adapterContractId,
    studioExecutionSpec: { ...skeleton.studioExecutionSpec },
    nodes,
    edges,
  };
}
