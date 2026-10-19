import type { NodeParams } from '../stores/useNodeStore';

type DeclaredField = { name: string; description?: string };
type SelectedBlock = { id: string; contentHash: string };
const SCHEMAS = 'reviewedBlockFieldSchemasV1';
const HASH = /^sha256:[0-9a-f]{64}$/u;
const PARAM_KEYS = new Set(['type', 'display', 'label', 'description', 'default']);

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function invalid(): never {
  throw new Error('The exact reviewed block field schema is unavailable or malformed.');
}

function socketType(value: unknown): value is string | string[] {
  const text = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 64;
  return text(value) || (Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(text));
}

function fieldParams(value: unknown): NodeParams {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !PARAM_KEYS.has(key)) ||
    !socketType(value.type) ||
    typeof value.label !== 'string' ||
    value.label.length > 1024 ||
    (value.display !== undefined && (typeof value.display !== 'string' || value.display.length > 64)) ||
    (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 1024))
  )
    invalid();
  return {
    type: structuredClone(value.type),
    label: value.label,
    ...(typeof value.display === 'string' ? { display: value.display } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'default') ? { default: structuredClone(value.default) } : {}),
  };
}

/** Select backend-authored schema by the immutable block pair; never interpret Python annotations. */
export function selectReviewedBlockFieldParamV2(base: NodeParams, selected?: SelectedBlock): NodeParams {
  const options = base.fieldOptions;
  if (!options || !Object.prototype.hasOwnProperty.call(options, SCHEMAS)) return structuredClone(base);
  const raw = options[SCHEMAS];
  if (
    !selected ||
    !record(raw) ||
    Object.keys(raw).length !== 2 ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.alternatives) ||
    raw.alternatives.length < 2 ||
    raw.alternatives.length > 4096
  )
    invalid();
  const ids = new Set<string>();
  let exact: NodeParams | undefined;
  for (const item of raw.alternatives) {
    if (
      !record(item) ||
      Object.keys(item).length !== 3 ||
      typeof item.blockDefinitionId !== 'string' ||
      item.blockDefinitionId.length > 512 ||
      typeof item.blockContractHash !== 'string' ||
      !HASH.test(item.blockContractHash) ||
      !item.blockDefinitionId.startsWith('diffusers.modular-block:') ||
      !item.blockDefinitionId.endsWith(`:${item.blockContractHash}`) ||
      ids.has(item.blockDefinitionId)
    )
      invalid();
    ids.add(item.blockDefinitionId);
    const params = fieldParams(item.params);
    if (item.blockDefinitionId === selected.id && item.blockContractHash === selected.contentHash) exact = params;
  }
  if (!exact) invalid();
  const retained = { ...base };
  delete retained.fieldOptions;
  for (const key of PARAM_KEYS) delete retained[key as keyof NodeParams];
  const result = { ...structuredClone(retained), ...exact };
  const remaining = { ...options };
  delete remaining[SCHEMAS];
  if (Object.keys(remaining).length) result.fieldOptions = structuredClone(remaining);
  return result;
}

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
  selected?: SelectedBlock,
) {
  const exact = (key: string) => selectReviewedBlockFieldParamV2(registry[key]!, selected);
  if (executionKind === 'loop_member') {
    for (const field of inputs) {
      const key = `iteration_input__${field.name}`;
      if (registry[key]) params[key] = { ...exact(key), hidden: false, required: false };
    }
    for (const field of outputs) {
      for (const prefix of ['iteration_output__', 'iteration_previous__']) {
        const key = `${prefix}${field.name}`;
        if (registry[key]) params[key] = { ...exact(key), hidden: false };
      }
    }
    return;
  }
  for (const field of inputs) {
    const key = registry[field.name]?.display === 'output' ? `state_input__${field.name}` : field.name;
    if (params[key] || !registry[key]) continue;
    const base = exact(key);
    delete base.default;
    delete base.value;
    params[key] = {
      ...base,
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
    params[key] = { ...exact(key), hidden: false };
  }
}
