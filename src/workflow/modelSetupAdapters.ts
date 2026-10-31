import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { DiscoveryRequestState, NodeData, RuntimeStatus } from '../stores/useNodeStore';
import type { StudioImageAdapterAuthoringPolicy, StudioModelProfile } from '../studio/types';
import type { WorkflowModelDescriptor } from './workflowChoices';
import type { OperationContract } from './operationContracts';
import type { PipelineSupport } from './operationCatalog';
import type { OperationGraph } from './operationAuthoring';
import { operationOwnsModel } from './operationContracts';
import { operationAuthoring } from './operationAuthoringHint';
import { acceptsOperationValue } from './operationFieldValue';
import { createNodeFromRegistry } from './nodeFactory';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { hasInlineScalarControl } from '../studio/inlineScalarControl';
import { MAX_ORDERED_ADAPTERS, orderedAdapterChainLinks } from '../studio/adapterChainLinks';
import { parseImageAdapterAuthoringPolicy } from '../studio/optionalRuntimes';
import { declaredImagePipelineStageTail } from './operationScope';
import { deepEqual } from '../utils/deepEqual';
import { selectedAudioAdapterPolicy } from './selectedAudioAdapterAuthority';
import {
  restoreVisualOperationGroups,
  unpackVisualOperationGroups,
  visualOperationGroup,
} from './visualOperationGroups';

const NATIVE = 'modules.ModularDiffusers.Lora';
const DIRECT = 'modules.DiffusersImage.LoadAdapter';
const AUDIO = 'modules.DiffusersAudio.LoadAdapter';
const key = (node: CustomNodeType) => `${node.data.module}.${node.data.action}`;
export function isModelSetupAdapter(node: CustomNodeType) {
  return [NATIVE, DIRECT, AUDIO].includes(key(node));
}

/** Follow the actual ordered adapter wires, not labels or canvas positions. */
export function modelSetupAdapterChain(graph: OperationGraph, rootId: string) {
  const root = graph.nodes.find((node) => node.id === rootId);
  if (!root || visualOperationGroup(root) !== 'setup') throw new Error('Model Setup is no longer available.');
  const unpacked = unpackVisualOperationGroups(graph);
  const flat = unpacked.graph;
  const owned = new Set(unpacked.members.get(rootId));
  const owners = flat.nodes.filter(
    (node) => owned.has(node.id) && operationOwnsModel(operationAuthoring(node)?.operation),
  );
  if (owners.length !== 1) throw new Error('Choose a Model Setup with one model owner.');
  const owner = owners[0]!;
  const native = Boolean(owner.data.params.lora_list);
  const adapterKey = native ? NATIVE : owner.data.params.pipeline?.type === 'audio_diffusion_pipeline' ? AUDIO : DIRECT;
  const adapters: CustomNodeType[] = [];
  const chainEdges: OperationGraph['edges'] = [];
  const visited = new Set<string>();
  let prefix: { source: string; sourceHandle: string } | null = null;
  let tail: { target: string; targetHandle: string }[] = [];
  if (native) {
    let target = owner.id,
      handle = 'lora_list';
    while (true) {
      const incoming = flat.edges.filter((edge) => edge.target === target && edge.targetHandle === handle);
      if (incoming.length > 1)
        throw new Error('This adapter chain has competing suppliers. Separate stages to inspect it.');
      const edge = incoming[0];
      if (!edge) break;
      const node = flat.nodes.find((item) => item.id === edge.source);
      if (!node || !owned.has(node.id) || key(node) !== adapterKey) {
        prefix = { source: edge.source, sourceHandle: edge.sourceHandle! };
        chainEdges.push(edge);
        break;
      }
      if (visited.has(node.id) || edge.sourceHandle !== 'lora') throw new Error('This adapter chain is invalid.');
      visited.add(node.id);
      adapters.unshift(node);
      chainEdges.push(edge);
      target = node.id;
      handle = 'previous_loras';
    }
    tail = [{ target: owner.id, targetHandle: 'lora_list' }];
  } else {
    if (!owner.data.params.pipeline) throw new Error('This model does not declare an adapter input.');
    prefix = { source: owner.id, sourceHandle: 'pipeline' };
    let source = owner.id,
      handle = 'pipeline';
    while (true) {
      const outgoing = flat.edges.filter((edge) => edge.source === source && edge.sourceHandle === handle);
      if (outgoing.length !== 1) {
        if (!declaredImagePipelineStageTail(flat, owner.id, outgoing))
          throw new Error('This pipeline has shared or missing consumers. Separate stages before adding adapters.');
        tail = outgoing.map((edge) => ({ target: edge.target, targetHandle: edge.targetHandle! }));
        chainEdges.push(...outgoing);
        break;
      }
      const edge = outgoing[0]!;
      const node = flat.nodes.find((item) => item.id === edge.target);
      chainEdges.push(edge);
      if (!node || !owned.has(node.id) || key(node) !== adapterKey) {
        if (node && key(node) === adapterKey)
          throw new Error(
            'This pipeline adapter is shared outside this setup. Separate stages before editing its chain.',
          );
        tail = [{ target: edge.target, targetHandle: edge.targetHandle! }];
        break;
      }
      if (visited.has(node.id) || edge.targetHandle !== 'pipeline') throw new Error('This adapter chain is invalid.');
      if (flat.edges.filter((edge) => edge.target === node.id && edge.targetHandle === 'pipeline').length !== 1)
        throw new Error('This adapter chain has competing suppliers. Separate stages to inspect it.');
      visited.add(node.id);
      adapters.push(node);
      source = node.id;
      handle = 'output';
    }
  }
  // Structural inspection/removal is bounded independently of current authoring permission.
  if (adapters.length > 32) throw new Error('This setup exceeds the supported 32-adapter inspection bound.');
  if (flat.nodes.some((node) => owned.has(node.id) && isModelSetupAdapter(node) && !visited.has(node.id)))
    throw new Error('This setup has an adapter outside its ordered chain. Separate stages to inspect it.');
  const chainIds = new Set(chainEdges.map((edge) => edge.id));
  if (
    flat.edges.some(
      (edge) =>
        adapters.some((node) => node.id === edge.source) &&
        edge.sourceHandle === (native ? 'lora' : 'output') &&
        !chainIds.has(edge.id),
    )
  )
    throw new Error('An adapter is shared with another consumer. Keep it external or separate these stages.');
  return { root, owner, native, adapterKey, adapters, prefix, tail, chainEdges, unpacked };
}

export function modelSetupAdapterFields(node: CustomNodeType) {
  return Object.fromEntries(
    Object.entries(node.data.params).filter(
      ([, field]) =>
        !field.hidden &&
        (!field.isInput || hasInlineScalarControl(field)) &&
        !['input', 'output'].includes(field.display ?? '') &&
        !field.display?.startsWith('ui_'),
    ),
  );
}

export type ModelSetupAdapterAuthority = {
  nodesRegistry: Record<string, NodeData>;
  studioModelCapabilities: readonly StudioModelProfile[];
  studioModelCapabilitiesAuthoritative: boolean;
  studioExecutionSpecInvalid: boolean;
  operationContracts: readonly OperationContract[];
  pipelineSupport: readonly PipelineSupport[];
  workflowModelDescriptors?: readonly WorkflowModelDescriptor[];
  resourceMode?: 'auto' | 'expert';
  runtimeStatus?: RuntimeStatus | null;
  discoveryRequests: {
    nodes: Pick<DiscoveryRequestState, 'status'>;
    capabilities: Pick<DiscoveryRequestState, 'status'>;
    runtime?: Pick<DiscoveryRequestState, 'status'>;
  };
};

/** Inspect reviewed pure configuration only; never evaluate a supplier. */
export function requiredAdapterControlsUnavailable(
  graph: OperationGraph,
  owner: CustomNodeType,
  authority: ModelSetupAdapterAuthority,
  controls: NonNullable<StudioImageAdapterAuthoringPolicy['requiredControls']>,
): string | null {
  const fieldValue = (node: CustomNodeType, name: string): unknown => {
    const registered = authority.nodesRegistry[key(node)]?.params[name];
    const field = node.data.params[name];
    if (
      !registered ||
      !field ||
      field.dataSource ||
      field.display === 'output' ||
      JSON.stringify(field.type) !== JSON.stringify(registered.type) ||
      graph.edges.some((edge) => edge.target === node.id && edge.targetHandle === name)
    )
      return undefined;
    const optionalNone =
      (registered.display === 'input' || registered.isInput) &&
      registered.required !== true &&
      field.required !== true &&
      registered.value == null &&
      registered.default == null &&
      field.value == null &&
      field.default == null;
    // Explicit null on a defaulted scalar is ambiguous; it cannot grant the
    // non-null policy default. Only the declared optional input means None.
    if (field.value === null && !optionalNone) return undefined;
    const value = field.value ?? field.default;
    if (value == null) return optionalNone ? null : undefined;
    return acceptsOperationValue(registered, value) ? value : undefined;
  };
  const pureSupplier = (node: CustomNodeType, field: string, nodeKey: string, output: string) => {
    const declaredInput = authority.nodesRegistry[key(node)]?.params[field];
    const actualInput = node.data.params[field];
    if (
      !declaredInput ||
      !actualInput ||
      !(declaredInput.display === 'input' || declaredInput.isInput) ||
      !(actualInput.display === 'input' || actualInput.isInput) ||
      JSON.stringify(actualInput.type) !== JSON.stringify(declaredInput.type)
    )
      return undefined;
    const inputs = graph.edges.filter((edge) => edge.target === node.id && edge.targetHandle === field);
    if (inputs.length !== 1 || inputs[0]!.sourceHandle !== output) return undefined;
    const supplier = graph.nodes.find((candidate) => candidate.id === inputs[0]!.source);
    const registered = authority.nodesRegistry[nodeKey];
    if (
      !supplier ||
      key(supplier) !== nodeKey ||
      !registered ||
      `${registered.module}.${registered.action}` !== nodeKey ||
      supplier.data.params[output]?.display !== 'output' ||
      registered.params[output]?.display !== 'output' ||
      JSON.stringify(supplier.data.params[output]?.type) !== JSON.stringify(registered.params[output]?.type)
    )
      return undefined;
    return supplier;
  };
  const effective: Record<string, unknown> = {};
  const recipeField = owner.data.params.execution_recipe;
  const recipeEdges = graph.edges.filter(
    (edge) => edge.target === owner.id && edge.targetHandle === 'execution_recipe',
  );
  if (recipeField?.dataSource) return 'Use an unambiguous execution recipe connection before editing LoRA.';
  if (recipeEdges.length || recipeField?.value != null || recipeField?.default != null) {
    const registeredInput = authority.nodesRegistry[key(owner)]?.params.execution_recipe;
    if (
      !registeredInput ||
      recipeField?.type !== registeredInput.type ||
      registeredInput.type !== 'diffusers_execution_recipe'
    )
      return 'Refresh the declared execution recipe controls before editing LoRA.';
    const recipe = pureSupplier(
      owner,
      'execution_recipe',
      'modules.DiffusersRuntime.DiffusersExecutionRecipe',
      'execution_recipe',
    );
    if (!recipe) return 'Use a reviewed, unambiguous execution recipe before editing LoRA.';
    const mode = fieldValue(recipe, 'offload_mode');
    const placement = fieldValue(recipe, 'device_map');
    if (typeof mode !== 'string' || typeof placement !== 'string')
      return 'Keep required execution recipe controls literal before editing LoRA.';
    effective.offload_mode = mode;
    effective.auto_offload = mode !== 'none';
    // The direct loader gives a non-none raw placement priority over recipe placement.
    const rawPlacement = fieldValue(owner, 'device_map');
    effective.device_map =
      typeof rawPlacement === 'string' && rawPlacement && rawPlacement !== 'none' ? rawPlacement : placement;
    const quantEdges = graph.edges.filter(
      (edge) => edge.target === recipe.id && edge.targetHandle === 'quantization_config',
    );
    if (quantEdges.length) {
      const quantizer = pureSupplier(
        recipe,
        'quantization_config',
        'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
        'quantization_config',
      );
      const backend = quantizer && fieldValue(quantizer, 'backend');
      const overrides = quantizer && fieldValue(quantizer, 'component_overrides');
      if (backend !== 'none' || typeof overrides !== 'string' || overrides.length > 4096)
        return 'Select the declared disabled quantizer before editing LoRA.';
      try {
        const parsed: unknown = JSON.parse(overrides.trim() || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length)
          return 'Keep the disabled quantizer free of component overrides before editing LoRA.';
      } catch {
        return 'Keep the disabled quantizer free of component overrides before editing LoRA.';
      }
    } else if (fieldValue(recipe, 'quantization_config') !== null) {
      return 'Use a declared unconnected or disabled quantizer before editing LoRA.';
    }
  }
  for (const [name, expected] of Object.entries(controls)) {
    const literal = fieldValue(owner, name);
    // A connected loader control is ambiguous even when a recipe would
    // override it; do not grant authoring through uninspected suppliers.
    if (literal === undefined) return `Keep the required ${name} control declared and literal before editing LoRA.`;
    const actual = Object.prototype.hasOwnProperty.call(effective, name) ? effective[name] : literal;
    if (actual !== expected)
      return `Set the effective ${name} control to ${expected === null ? 'an unconnected optional input' : String(expected)} before editing LoRA.`;
  }
  return null;
}

/** A typed socket describes transport, not permission to author an adapter.
 * Imported graphs remain inspectable; executable edits require current authority. */
function modelSetupAdapterAuthoringLimit(
  chain: ReturnType<typeof modelSetupAdapterChain>,
  authority?: ModelSetupAdapterAuthority,
): string | number {
  const refresh = 'Refresh model capabilities before adding LoRA.';
  if (
    !authority?.studioModelCapabilitiesAuthoritative ||
    authority.studioExecutionSpecInvalid ||
    authority.discoveryRequests.capabilities.status !== 'success' ||
    authority.discoveryRequests.nodes.status !== 'success'
  )
    return refresh;
  const { owner, native, adapterKey, unpacked } = chain;
  if (adapterKey === AUDIO) {
    const policy = selectedAudioAdapterPolicy(owner, unpacked.graph, chain.tail, authority);
    if (typeof policy === 'string') return policy;
    if (policy.requiredControls) {
      const reason = requiredAdapterControlsUnavailable(unpacked.graph, owner, authority, policy.requiredControls);
      if (reason) return reason;
    }
    return policy.maxOwnedAdapters;
  }
  const operation = operationAuthoring(owner)?.operation;
  const current = authority.operationContracts.filter(
    (item) =>
      item.pipelineClass === operation?.pipelineClass &&
      item.task === operation.task &&
      item.operationId === operation.operationId &&
      item.nodeKey === key(owner) &&
      operationOwnsModel(item),
  );
  const task = authority.pipelineSupport
    .find((item) => item.pipelineClass === operation?.pipelineClass)
    ?.tasks.find((item) => item.task === operation?.task);
  if (current.length !== 1 || !task?.operationIds.includes(operation!.operationId)) return refresh;
  if (
    chain.tail.length > 1 &&
    chain.tail.some(({ target }) => {
      const stage = unpacked.graph.nodes.find((node) => node.id === target);
      const selected = stage && operationAuthoring(stage)?.operation;
      const declared = authority.operationContracts.filter(
        (item) =>
          item.pipelineClass === operation!.pipelineClass &&
          item.task === operation!.task &&
          item.operationId === selected?.operationId &&
          item.nodeKey === (stage && key(stage)) &&
          item.nodeType === selected?.nodeType &&
          item.decomposition === 'bundle',
      );
      return (
        declared.length !== 1 || !task.operationIds.includes(selected!.operationId) || !deepEqual(declared[0], selected)
      );
    })
  )
    return refresh;
  if (
    !unpacked.graph.nodes.some(
      (node) =>
        node.data.operationAuthoring?.operation.pipelineClass === operation!.pipelineClass &&
        node.data.operationAuthoring.operation.task === operation!.task &&
        Object.values(node.data.params).some(
          (field) =>
            field.display === 'output' &&
            (field.type === 'image' || (Array.isArray(field.type) && field.type.includes('image'))),
        ),
    )
  )
    return 'Select a declared image workflow before adding LoRA.';
  const fields = owner.data.params;
  const value = (name: string) =>
    Object.prototype.hasOwnProperty.call(fields, name) &&
    !unpacked.graph.edges.some((edge) => edge.target === owner.id && edge.targetHandle === name)
      ? (fields[name]!.value ?? fields[name]!.default)
      : undefined;
  const pipeline = value(native ? 'model_type' : 'pipeline_class');
  const repository = value(native ? 'repo_id' : 'model_id');
  const revision = value('revision');
  if (
    pipeline !== operation?.pipelineClass ||
    !repository ||
    typeof repository !== 'object' ||
    !('source' in repository) ||
    !('value' in repository) ||
    repository.source !== 'hub' ||
    typeof repository.value !== 'string' ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(revision)
  )
    return 'Select a reviewed image model and exact revision before adding LoRA.';
  const publicMatches = authority.studioModelCapabilities.flatMap((capability) =>
    (capability.executionProfiles ?? [])
      .filter(
        (profile) =>
          profile.pipeline_class === pipeline &&
          profile.model_type === capability.modelType &&
          profile.loader_module === owner.data.module &&
          profile.loader_action === owner.data.action &&
          task.executionProfileIds.includes(profile.id) &&
          (native || value('execution_profile_id') === profile.id) &&
          [profile.default_repo, profile.fallback_repo, ...(profile.compatible_repos ?? [])].includes(
            repository.value as string,
          ),
      )
      .map((profile) => ({ capability, profile, evaluationOnly: false })),
  );
  const evaluationMatches = (authority.workflowModelDescriptors ?? []).flatMap((descriptor) => {
    const profile = descriptor.adapterAuthoringProfile;
    return descriptor.evaluationOnly &&
      profile &&
      descriptor.profileId === profile.id &&
      descriptor.modelType === profile.model_type &&
      descriptor.pipeline === profile.pipeline_class &&
      descriptor.repo === profile.default_repo &&
      profile.pipeline_class === pipeline &&
      profile.loader_module === owner.data.module &&
      profile.loader_action === owner.data.action &&
      task.executionProfileIds.includes(profile.id) &&
      (native || value('execution_profile_id') === profile.id) &&
      profile.default_repo === repository.value
      ? [{ capability: undefined, profile, evaluationOnly: true }]
      : [];
  });
  const matches = [...publicMatches, ...evaluationMatches];
  if (matches.length !== 1)
    return 'The selected image model profile is unavailable or ambiguous. Refresh capabilities.';
  const { capability, profile, evaluationOnly } = matches[0]!;
  if (evaluationOnly) {
    if (authority.resourceMode !== 'expert') return 'Select Custom memory before editing evaluation model LoRA.';
    const runtime = authority.runtimeStatus;
    const requirement = profile.optionalRuntimeRequirement;
    const readyState = (state: string) => state === 'base_satisfied' || state === 'active';
    const requirements = task.runtimeRequirements.filter((row) => row.executionProfileIds.includes(profile.id));
    if (
      authority.discoveryRequests.runtime?.status !== 'success' ||
      runtime?.ready !== true ||
      !runtime.runtimeEnvironment?.profileVerified ||
      !runtime.runtimeEnvironment?.executionReady ||
      task.dependencies !== 'ready' ||
      !requirement ||
      requirement.executionProfileIds.length !== 1 ||
      requirement.executionProfileIds[0] !== profile.id ||
      !readyState(requirement.state) ||
      !requirements.length ||
      requirements.some((row) => !readyState(row.state))
    )
      return 'Refresh the verified evaluation runtime and model capabilities before editing LoRA.';
  }
  const adapter = authority.nodesRegistry[adapterKey];
  const loader = authority.nodesRegistry[key(owner)];
  if (
    !adapter ||
    !loader ||
    `${adapter.module}.${adapter.action}` !== adapterKey ||
    `${loader.module}.${loader.action}` !== key(owner)
  )
    return refresh;
  let maxOwnedAdapters = MAX_ORDERED_ADAPTERS;
  if (Object.prototype.hasOwnProperty.call(profile, 'adapterAuthoring')) {
    try {
      const policy = parseImageAdapterAuthoringPolicy(
        profile.adapterAuthoring,
        profile.modes,
        profile.repository_revisions,
        profile,
      );
      const binding = current[0]!.binding;
      const executionMode =
        binding && Object.prototype.hasOwnProperty.call(binding, 'executionMode') ? binding.executionMode : task.task;
      const workflowField = native ? 'workflow_id' : 'mode';
      const registryWorkflow = loader.params[workflowField]?.value ?? loader.params[workflowField]?.default;
      const boundWorkflow = Object.prototype.hasOwnProperty.call(binding?.values ?? {}, workflowField);
      const declaredWorkflow = native ? current[0]!.workflowId : undefined;
      const workflow = native
        ? boundWorkflow
          ? binding!.values[workflowField]
          : (declaredWorkflow ?? registryWorkflow)
        : (binding?.values[workflowField] ?? registryWorkflow);
      const legacyBlankWorkflow =
        native &&
        !boundWorkflow &&
        typeof declaredWorkflow === 'string' &&
        declaredWorkflow.length > 0 &&
        registryWorkflow === '' &&
        value(workflowField) === '';
      if (
        policy.adapterNodeKey !== adapterKey ||
        typeof executionMode !== 'string' ||
        !profile.modes.some((mode) => mode === executionMode) ||
        !policy.tasks.includes(executionMode) ||
        typeof workflow !== 'string' ||
        (value(workflowField) !== workflow && !legacyBlankWorkflow) ||
        !policy.repositoryRevisions.some((pair) => pair.repo === repository.value && pair.revision === revision)
      )
        return 'The selected image model policy does not authorize this adapter task and revision.';
      if (policy.requiredControls) {
        const unavailable = requiredAdapterControlsUnavailable(
          unpacked.graph,
          owner,
          authority,
          policy.requiredControls,
        );
        if (unavailable) return unavailable;
      }
      maxOwnedAdapters = policy.maxOwnedAdapters;
    } catch {
      return 'The selected image adapter authoring policy is invalid. Refresh capabilities.';
    }
  } else {
    const canonical = native
      ? authority.studioModelCapabilities.find((item) => item.modelType === pipeline)
      : undefined;
    if (capability?.supportsLora !== true || (canonical && canonical.supportsLora !== true))
      return 'The selected image model does not support LoRA.';
  }
  if (!profile.repository_revisions?.some((pair) => pair.repo === repository.value && pair.revision === revision))
    return 'The selected image model revision is not declared by the backend. Refresh capabilities.';
  const input = native ? fields.lora_list : fields.pipeline;
  const declaredInput = loader.params[native ? 'lora_list' : 'pipeline'];
  const output = adapter.params[native ? 'lora' : 'output'];
  const transport = adapter.params[native ? 'previous_loras' : 'pipeline'];
  if (
    !input ||
    !declaredInput ||
    JSON.stringify(input.type) !== JSON.stringify(declaredInput.type) ||
    !output ||
    !transport ||
    output.display !== 'output' ||
    transport.display !== 'input' ||
    !connectionTypesAreCompatible(output.type, input.type) ||
    !connectionTypesAreCompatible(output.type, transport.type)
  )
    return 'The backend adapter definition does not declare compatible chain sockets. Refresh capabilities.';
  return maxOwnedAdapters;
}

/** Editing permission and Add capacity are separate: full chains remain editable. */
export function modelSetupAdapterEditUnavailable(
  chain: ReturnType<typeof modelSetupAdapterChain>,
  authority?: ModelSetupAdapterAuthority,
): string | null {
  const limit = modelSetupAdapterAuthoringLimit(chain, authority);
  return typeof limit === 'string'
    ? limit
    : chain.adapters.length > limit
      ? `This setup exceeds its ${limit}-adapter authoring limit.`
      : null;
}

export function modelSetupAdapterAddUnavailable(
  chain: ReturnType<typeof modelSetupAdapterChain>,
  authority?: ModelSetupAdapterAuthority,
): string | null {
  const limit = modelSetupAdapterAuthoringLimit(chain, authority);
  return typeof limit === 'string'
    ? limit
    : chain.adapters.length >= limit
      ? `This setup supports at most ${limit} owned adapters.`
      : null;
}

export function validateModelSetupAdapterSelection(node: CustomNodeType) {
  const fields = node.data.params;
  const selection = fields.model?.value ?? fields.model_id?.value ?? fields.adapter_path?.value;
  if (
    !selection ||
    typeof selection !== 'object' ||
    !('source' in selection) ||
    !('value' in selection) ||
    (selection.source !== 'hub' && selection.source !== 'local') ||
    typeof selection.value !== 'string' ||
    !selection.value.trim()
  )
    throw new Error('Select a Hub or local LoRA before adding it.');
  if (selection.source === 'hub') {
    const revision = fields.revision?.value ?? fields.revision?.default;
    const hash = fields.expected_sha256?.value ?? fields.expected_sha256?.default;
    const weight = fields.weight_name?.value ?? fields.weight_name?.default;
    if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision))
      throw new Error('A Hub LoRA requires its exact lowercase 40-character commit revision.');
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
      throw new Error('A Hub LoRA requires the expected SHA-256 of its weight file.');
    if (
      typeof weight !== 'string' ||
      !weight.endsWith('.safetensors') ||
      weight.includes('\\') ||
      weight.startsWith('/') ||
      weight.split('/').some((part) => !part || part === '..' || part === '.')
    )
      throw new Error('Select a contained .safetensors weight file for the Hub LoRA.');
  }
}

type AdapterEdit =
  | { kind: 'add'; values: Record<string, unknown>; registry: Record<string, NodeData> }
  | { kind: 'replace'; nodeId: string; values: Record<string, unknown>; registry: Record<string, NodeData> }
  | { kind: 'remove'; nodeId: string }
  | { kind: 'move'; nodeId: string; offset: -1 | 1 };

/** An explicit workflow edit. Values, suppliers and other branches are retained;
 * the caller commits the complete result through the existing Undo transaction. */
export function planModelSetupAdapterEdit(
  graph: OperationGraph,
  rootId: string,
  edit: AdapterEdit,
  authority?: ModelSetupAdapterAuthority,
): OperationGraph {
  const chain = modelSetupAdapterChain(graph, rootId);
  let maxOwnedAdapters = 32;
  if (edit.kind !== 'remove') {
    const limit = modelSetupAdapterAuthoringLimit(chain, authority);
    if (typeof limit === 'string') throw new Error(limit);
    maxOwnedAdapters = limit;
    if (chain.adapters.length + (edit.kind === 'add' ? 1 : 0) > limit)
      throw new Error(`This setup supports at most ${limit} owned adapters.`);
    if ((edit.kind === 'add' || edit.kind === 'replace') && edit.registry !== authority!.nodesRegistry)
      throw new Error('Refresh model capabilities before adding LoRA.');
  }
  const next = structuredClone(chain.unpacked.graph);
  const adapters = [...chain.adapters];
  if (edit.kind === 'add' || edit.kind === 'replace') {
    const previous = edit.kind === 'replace' ? chain.adapters.find((node) => node.id === edit.nodeId) : undefined;
    if (edit.kind === 'replace' && (!previous || chain.adapterKey !== AUDIO))
      throw new Error('Choose the single owned audio adapter to replace.');
    const node = createNodeFromRegistry(chain.adapterKey, edit.registry, {
      x: chain.owner.position.x,
      y: chain.owner.position.y + 400,
    });
    if (!node) throw new Error('The backend adapter definition is unavailable. Refresh capabilities.');
    const fields = modelSetupAdapterFields(node);
    for (const [name, value] of Object.entries(edit.values)) {
      const field = fields[name];
      if (!field || !acceptsOperationValue(field, value)) throw new Error(`The adapter setting ${name} is invalid.`);
      const supplied = previous && next.edges.some((edge) => edge.target === previous.id && edge.targetHandle === name);
      if (
        supplied &&
        (name !== 'scale' ||
          !deepEqual(value, previous.data.params[name]?.value ?? previous.data.params[name]?.default))
      )
        throw new Error('Keep connected adapter suppliers unchanged before replacing LoRA.');
      node.data.params[name] = { ...field, value: structuredClone(value) as typeof field.value };
    }
    validateModelSetupAdapterSelection(node);
    if (previous) {
      const replacement = {
        ...structuredClone(previous),
        data: { ...structuredClone(previous.data), params: node.data.params },
      };
      adapters[adapters.findIndex((item) => item.id === previous.id)] = replacement;
      next.nodes = next.nodes.map((item) => (item.id === previous.id ? replacement : item));
    } else {
      adapters.push(node);
      next.nodes.push(node);
    }
  } else {
    const index = adapters.findIndex((node) => node.id === edit.nodeId);
    if (index < 0) throw new Error('This adapter is no longer available.');
    if (edit.kind === 'remove') {
      adapters.splice(index, 1);
      next.nodes = next.nodes.filter((node) => node.id !== edit.nodeId);
      next.edges = next.edges.filter((edge) => edge.source !== edit.nodeId && edge.target !== edit.nodeId);
    } else {
      const destination = index + edit.offset;
      if (destination < 0 || destination >= adapters.length) throw new Error('This adapter cannot move further.');
      [adapters[index], adapters[destination]] = [adapters[destination]!, adapters[index]!];
    }
  }
  const chainIds = new Set(chain.chainEdges.map((edge) => edge.id));
  next.edges = next.edges.filter((edge) => !chainIds.has(edge.id));
  const connect = (source: string, sourceHandle: string, target: string, targetHandle: string) => {
    const output = next.nodes.find((node) => node.id === source)?.data.params[sourceHandle];
    const input = next.nodes.find((node) => node.id === target)?.data.params[targetHandle];
    if (
      output?.display !== 'output' ||
      !input ||
      !(input.display === 'input' || input.isInput) ||
      !connectionTypesAreCompatible(output.type, input.type)
    )
      throw new Error('This adapter definition does not declare compatible chain sockets. Nothing changed.');
    next.edges.push({ id: `edge-${nanoid()}`, source, sourceHandle, target, targetHandle, type: 'default' });
  };
  const target = chain.tail[0]!;
  const links = orderedAdapterChainLinks({
    maxOwnedAdapters,
    adapterIds: adapters.map((node) => node.id),
    inputHandles: [chain.native ? 'previous_loras' : 'pipeline'],
    outputHandles: [chain.native ? 'lora' : 'output'],
    target: { nodeId: target.target, handles: [target.targetHandle] },
    ...(chain.prefix ? { source: { nodeId: chain.prefix.source, handles: [chain.prefix.sourceHandle] } } : {}),
  });
  for (const link of links) connect(link.source, link.sourceHandles[0]!, link.target, link.targetHandles[0]!);
  if (!chain.native && chain.tail.length > 1) {
    const last = adapters[adapters.length - 1];
    const source = last ? { source: last.id, sourceHandle: 'output' } : chain.prefix!;
    for (const target of chain.tail.slice(1))
      connect(source.source, source.sourceHandle, target.target, target.targetHandle);
  }
  if (
    !chain.native &&
    adapters
      .slice(1)
      .some((node) => (node.data.params.replace_existing?.value ?? node.data.params.replace_existing?.default) === true)
  )
    throw new Error(
      'Only the first adapter can replace existing adapters. Disable that setting before changing its order.',
    );
  return restoreVisualOperationGroups(next, chain.unpacked);
}
