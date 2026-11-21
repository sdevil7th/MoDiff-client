import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from './operationAuthoring';
import type { ModelSetupAdapterAuthority } from './modelSetupAdapters';
import { operationOwnsModel } from './operationContracts';
import { operationAuthoring } from './operationAuthoringHint';
import { parseAdapterAuthoringPolicy } from '../studio/optionalRuntimes';
import { nodeConnectionSemanticsAreCompatible } from './nodeConnectionMatching';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { deepEqual } from '../utils/deepEqual';

const ADAPTER = 'modules.DiffusersAudio.LoadAdapter';
const nodeKey = (node: CustomNodeType) => `${node.data.module}.${node.data.action}`;
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** New authoring authority comes only from current discovery and the selected
 * immutable profile. Saved signals and nominal socket types are insufficient. */
export function selectedAudioAdapterPolicy(
  owner: CustomNodeType,
  graph: OperationGraph,
  tail: readonly { target: string; targetHandle: string }[],
  authority: ModelSetupAdapterAuthority | undefined,
) {
  const refresh = 'Refresh current audio model capabilities before editing LoRA.';
  if (
    !authority?.studioModelCapabilitiesAuthoritative ||
    authority.studioExecutionSpecInvalid ||
    authority.discoveryRequests.nodes.status !== 'success' ||
    authority.discoveryRequests.capabilities.status !== 'success'
  )
    return refresh;
  const operation = operationAuthoring(owner)?.operation;
  const current = authority.operationContracts.filter(
    (item) =>
      item.pipelineClass === operation?.pipelineClass &&
      item.task === operation.task &&
      item.operationId === operation.operationId &&
      item.nodeKey === nodeKey(owner) &&
      operationOwnsModel(item),
  );
  const supports = authority.pipelineSupport.filter((item) => item.pipelineClass === operation?.pipelineClass);
  const tasks = supports.flatMap((item) => item.tasks.filter((task) => task.task === operation?.task));
  if (
    current.length !== 1 ||
    tasks.length !== 1 ||
    !deepEqual(current[0], operation) ||
    !tasks[0]!.operationIds.includes(operation!.operationId)
  )
    return refresh;
  const task = tasks[0]!;
  const literal = (name: string) => {
    const field = owner.data.params[name];
    if (
      !field ||
      field.value === null ||
      field.dataSource ||
      graph.edges.some((edge) => edge.target === owner.id && edge.targetHandle === name)
    )
      return undefined;
    return field.value ?? field.default;
  };
  const pipeline = literal('pipeline_class'),
    repository = literal('model_id'),
    revision = literal('revision');
  if (
    pipeline !== operation!.pipelineClass ||
    !record(repository) ||
    repository.source !== 'hub' ||
    typeof repository.value !== 'string' ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/u.test(revision)
  )
    return 'Select a reviewed audio model and exact revision before editing LoRA.';
  const matches = authority.studioModelCapabilities.flatMap((capability) =>
    (capability.executionProfiles ?? []).filter(
      (profile) =>
        profile.model_type === capability.modelType &&
        profile.pipeline_class === pipeline &&
        profile.loader_module === owner.data.module &&
        profile.loader_action === owner.data.action &&
        profile.execution_path === 'direct-diffusers-audio' &&
        task.executionProfileIds.includes(profile.id) &&
        [profile.default_repo, profile.fallback_repo, ...(profile.compatible_repos ?? [])].includes(
          repository.value as string,
        ),
    ),
  );
  if (matches.length !== 1)
    return 'The selected audio model profile is unavailable or ambiguous. Refresh capabilities.';
  const profile = matches[0]!;
  if (!Object.prototype.hasOwnProperty.call(profile, 'adapterAuthoring'))
    return 'The selected audio model has no reviewed LoRA authoring policy.';
  let policy;
  try {
    policy = parseAdapterAuthoringPolicy(
      profile.adapterAuthoring,
      profile.modes,
      profile.repository_revisions,
      profile,
    );
  } catch {
    return 'The selected audio adapter authoring policy is invalid. Refresh capabilities.';
  }
  if (
    policy.mediaKind !== 'audio' ||
    policy.adapterNodeKey !== ADAPTER ||
    policy.maxOwnedAdapters !== 1 ||
    !profile.modes.some((mode) => mode === task.task) ||
    !policy.tasks.includes(task.task) ||
    !policy.repositoryRevisions.some((pair) => pair.repo === repository.value && pair.revision === revision) ||
    !profile.repository_revisions?.some((pair) => pair.repo === repository.value && pair.revision === revision)
  )
    return 'The selected audio model policy does not authorize this task and revision.';
  const loader = authority.nodesRegistry[nodeKey(owner)],
    adapter = authority.nodesRegistry[ADAPTER];
  const signal = owner.data.params.pipeline?.signal?.value;
  const actionModes = record(signal) && record(signal.actions) && adapter ? signal.actions[adapter.action] : undefined;
  if (
    !loader ||
    !adapter ||
    `${loader.module}.${loader.action}` !== nodeKey(owner) ||
    `${adapter.module}.${adapter.action}` !== ADAPTER ||
    literal('mode') !== task.task ||
    !record(signal) ||
    signal.schemaVersion !== 1 ||
    signal.library !== 'diffusers' ||
    signal.mediaKind !== 'audio' ||
    signal.pipelineClass !== pipeline ||
    signal.mode !== task.task ||
    signal.repository !== repository.value ||
    !Array.isArray(actionModes) ||
    !actionModes.includes(task.task)
  )
    return 'Refresh the selected audio pipeline signal before editing LoRA.';
  const input = adapter.params.pipeline,
    output = adapter.params.output,
    pipelineField = owner.data.params.pipeline;
  const forwarding = input?.onSignal,
    compatibility = input?.signalCompatibility;
  if (
    !record(forwarding) ||
    Object.keys(forwarding).sort().join() !== 'action,target' ||
    forwarding.action !== 'signal' ||
    forwarding.target !== 'output' ||
    !record(compatibility) ||
    Object.keys(compatibility).sort().join() !== 'action,required' ||
    compatibility.required !== true ||
    compatibility.action !== '$node' ||
    output?.signal?.direction !== 'output' ||
    output.signal.origin !== 'pipeline'
  )
    return 'Refresh the registered audio adapter signal forwarding contract before editing LoRA.';
  if (
    pipelineField?.display !== 'output' ||
    pipelineField.type !== 'audio_diffusion_pipeline' ||
    loader.params.pipeline?.display !== 'output' ||
    loader.params.pipeline.type !== pipelineField.type ||
    input?.display !== 'input' ||
    input.type !== pipelineField.type ||
    output?.display !== 'output' ||
    output.type !== pipelineField.type ||
    !connectionTypesAreCompatible(pipelineField.type, input.type) ||
    !nodeConnectionSemanticsAreCompatible(owner.data, 'pipeline', adapter, 'pipeline')
  )
    return 'The backend audio adapter does not declare compatible pipeline sockets. Refresh capabilities.';
  if (tail.length !== 1) return 'Keep one declared audio generation consumer before editing LoRA.';
  const consumer = graph.nodes.find((node) => node.id === tail[0]!.target);
  const declared = consumer && operationAuthoring(consumer)?.operation;
  const consumers = authority.operationContracts.filter(
    (item) =>
      item.pipelineClass === pipeline &&
      item.task === task.task &&
      item.operationId === declared?.operationId &&
      item.nodeKey === (consumer && nodeKey(consumer)),
  );
  if (
    !consumer ||
    consumers.length !== 1 ||
    !deepEqual(consumers[0], declared) ||
    !task.operationIds.includes(declared!.operationId) ||
    !declared!.ports.some((port) => port.direction === 'output' && port.types.includes('audio')) ||
    consumer.data.params[tail[0]!.targetHandle]?.type !== pipelineField.type
  )
    return 'Keep the current declared audio generation consumer before editing LoRA.';
  return policy;
}
