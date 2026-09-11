import type { NodeParams } from '../stores/useNodeStore';

type DeclaredField = { name: string; description?: string };

/** Exact upstream value sockets supplement, never replace, owned Pipeline State.
 * Input/output names may coincide upstream; namespaced outputs preserve inputs.
 * Loop members are recipes executed by their owner, not once-per-graph values.
 */
export function addReviewedValuePortsV2(
  params: Record<string, NodeParams>,
  registry: Record<string, NodeParams>,
  inputs: readonly DeclaredField[],
  outputs: readonly DeclaredField[],
  executionKind: string,
) {
  if (executionKind === 'loop_member') {
    for (const field of inputs) {
      const key = `iteration_input__${field.name}`;
      if (registry[key]) params[key] = { ...structuredClone(registry[key]!), hidden: false, required: false };
    }
    for (const field of outputs) {
      for (const prefix of ['iteration_output__', 'iteration_previous__']) {
        const key = `${prefix}${field.name}`;
        if (registry[key]) params[key] = { ...structuredClone(registry[key]!), hidden: false };
      }
    }
    return;
  }
  for (const field of inputs) {
    const key = registry[field.name]?.display === 'output' ? `state_input__${field.name}` : field.name;
    if (params[key] || !registry[key]) continue;
    const base = structuredClone(registry[key]!);
    delete base.default;
    delete base.value;
    params[key] = {
      ...structuredClone(base),
      display: 'input',
      required: false,
      hidden: false,
      description: `${field.description ?? ''} Unconnected: use the upstream Pipeline State value.`.trim(),
    };
  }
  for (const field of outputs) {
    // Existing media sockets retain their transport adaptation and identities.
    if (params[field.name]?.display === 'output') continue;
    const key = `state_output__${field.name}`;
    const base = registry[key];
    if (base?.display !== 'output') continue;
    params[key] = { ...structuredClone(base), hidden: false };
  }
}
