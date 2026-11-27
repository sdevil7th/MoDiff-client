import type { NodeParams } from '../stores/useNodeStore';

export function nodeControlGate(identity: string) {
  if (identity === 'modules.ModularDiffusers.Guider') return 'enabled';
  if (identity === 'modules.ModularDiffusers.ModelsLoader' || identity === 'modules.ModularDiffusers.AutoModelLoader')
    return 'auto_offload';
  return undefined;
}

export function literalControlIsOff(field: NodeParams | undefined) {
  return (field?.value ?? field?.default) === false && !field?.isConnected && !field?.signal;
}

/** Display only. Typed sockets and saved fallback settings keep their original identities. */
export function orderedActiveNodeControls(
  identity: string,
  params: Record<string, NodeParams>,
  fullParams: Record<string, NodeParams>,
  connectedGate: boolean,
) {
  const gate = nodeControlGate(identity);
  const entries = Object.entries(params);
  if (!gate || !fullParams[gate]) return entries;
  const off = !connectedGate && literalControlIsOff(fullParams[gate]);
  if (gate === 'auto_offload') return entries.filter(([key]) => key !== 'offload_mode' || !off);
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
