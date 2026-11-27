import type { StudioExecutionProfile } from '../studio/types';
import type { useNodesStore, NodeParams } from '../stores/useNodeStore';

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
