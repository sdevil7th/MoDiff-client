import type { StudioExecutionProfile } from '../studio/types';
import type { useNodesStore, NodeParams } from '../stores/useNodeStore';

export const EXECUTION_RECIPE_NODE = 'modules.DiffusersRuntime.DiffusersExecutionRecipe';
const recipeSwitches = {
  layerwise_casting: ['layerwise_casting_components', 'layerwise_storage_dtype', 'layerwise_compute_dtype'],
  channels_last: ['channels_last_components'],
};

/** Project only the approved recipe switches. Control keys can be raw fields or bound stage control IDs. */
export function visibleExecutionRecipeControls(
  displayed: Record<string, NodeParams>,
  fields: Record<string, NodeParams>,
  connected: (key: string) => boolean,
  controlId: (key: string) => string | undefined = (key) => key,
) {
  const parent = new Map<string, string>();
  const hidden = new Set<string>();
  const supplied = (key: string) =>
    fields[key]?.dataSource || fields[key]?.isConnected || fields[key]?.signal || connected(key);
  for (const [gate, options] of Object.entries(recipeSwitches)) {
    const toggleId = controlId(gate);
    const toggle = fields[gate];
    if (
      !toggleId ||
      !displayed[toggleId] ||
      displayed[toggleId].hidden ||
      !toggle ||
      !['bool', 'boolean'].includes(String(toggle.type))
    )
      continue;
    const off = literalControlIsOff(toggle) && !supplied(gate);
    for (const key of options) {
      const id = controlId(key);
      if (!id || !displayed[id]) continue;
      parent.set(id, toggleId);
      if (off && !supplied(key)) hidden.add(id);
    }
  }
  if (!parent.size) return displayed;
  const visible: Record<string, NodeParams> = {};
  for (const [id, field] of Object.entries(displayed)) {
    const toggleId = parent.get(id);
    if (toggleId) visible[toggleId] = displayed[toggleId]!;
    if (!hidden.has(id)) visible[id] = field;
  }
  return visible;
}

export function nodeControlGate(identity: string) {
  if (identity === 'modules.ModularDiffusers.Guider') return 'enabled';
  if (identity === 'modules.ModularDiffusers.ModelsLoader' || identity === 'modules.ModularDiffusers.AutoModelLoader')
    return 'auto_offload';
  return undefined;
}

export function literalControlIsOff(field: NodeParams | undefined) {
  return (field?.value ?? field?.default) === false && !field?.isConnected && !field?.signal;
}

/** The offload choice still has a consumer when a model's declared LoRA policy requires it. This is display only; adapter authoring performs the full review. */
export function adapterConsumesOffloadMode(
  params: Record<string, NodeParams>,
  catalog: Pick<ReturnType<typeof useNodesStore.getState>, 'workflowModelDescriptors' | 'studioModelCapabilities'>,
) {
  const repo = params.repo_id?.value ?? params.repo_id?.default;
  const pipeline = params.model_type?.value ?? params.model_type?.default;
  if (
    !repo ||
    typeof repo !== 'object' ||
    !('source' in repo) ||
    repo.source !== 'hub' ||
    !('value' in repo) ||
    typeof repo.value !== 'string' ||
    typeof pipeline !== 'string'
  )
    return false;
  const required = (
    profile: Pick<
      StudioExecutionProfile,
      'pipeline_class' | 'default_repo' | 'fallback_repo' | 'compatible_repos' | 'adapterAuthoring'
    >,
  ) =>
    profile.pipeline_class === pipeline &&
    [profile.default_repo, profile.fallback_repo, ...(profile.compatible_repos ?? [])].includes(repo.value as string) &&
    Object.prototype.hasOwnProperty.call(profile.adapterAuthoring?.requiredControls ?? {}, 'offload_mode');
  return (
    catalog.workflowModelDescriptors.some((d) => d.adapterAuthoringProfile && required(d.adapterAuthoringProfile)) ||
    catalog.studioModelCapabilities.some((c) => c.executionProfiles?.some(required))
  );
}

/** Display only. Typed sockets and saved fallback settings keep their original identities. */
export function orderedActiveNodeControls(
  identity: string,
  params: Record<string, NodeParams>,
  fullParams: Record<string, NodeParams>,
  connectedGate: boolean,
  modeRequiredByAdapter = false,
) {
  const gate = nodeControlGate(identity);
  const entries = Object.entries(params);
  if (!gate || !fullParams[gate]) return entries;
  const off = !connectedGate && literalControlIsOff(fullParams[gate]);
  if (gate === 'auto_offload')
    return entries.filter(([key]) => key !== 'offload_mode' || !off || modeRequiredByAdapter);
  return [
    ...entries.filter(([key]) => key === gate),
    ...entries.filter(
      ([key, field]) =>
        key !== gate &&
        (!off ||
          field.isInput ||
          field.display === 'input' ||
          field.display === 'output' ||
          field.display?.startsWith('ui_')),
    ),
  ];
}
