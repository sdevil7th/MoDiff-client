/** Backend authoring metadata and advisory instance selectors, never eligibility. */
export type AncillaryParentIdentity = {
  authoringRecipeId: string;
  baseSpecId: string;
  baseSpecContentHash: string;
  executionProfileId: string;
  pipelineClass: string;
  task: string;
};
export type AncillaryInstanceBinding = {
  contractId: string;
  contentHash: string;
  parent: AncillaryParentIdentity & { authoringContentHash: string };
  parentRoleNodes: Record<string, string>;
  roleNodes: Record<string, string>;
};
export type AncillaryExecutionPurpose =
  | { schemaVersion: 1; kind: 'workflow'; bindings: AncillaryInstanceBinding[]; target: null }
  | {
      schemaVersion: 1;
      kind: 'explicit_preview';
      bindings: [AncillaryInstanceBinding];
      target: { nodeId: string; outputField: string };
    };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const PARENT_KEYS = [
  'authoringRecipeId',
  'baseSpecId',
  'baseSpecContentHash',
  'executionProfileId',
  'pipelineClass',
  'task',
] as const;
export function invalidAncillary(detail: string): never {
  throw new Error(`Invalid ancillary operation: ${detail}`);
}

function unicodeBytes(value: string): number {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalidAncillary('unpaired surrogate.');
    } else if (code >= 0xdc00 && code <= 0xdfff) invalidAncillary('unpaired surrogate.');
  }
  return new TextEncoder().encode(value).byteLength;
}
export function text(value: unknown, maximum = 128, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value || value.length > maximum || (pattern && !pattern.test(value)))
    invalidAncillary('invalid text identity.');
  if ([...value].some((character) => character.charCodeAt(0) < 32)) invalidAncillary('identity contains a control.');
  if (unicodeBytes(value) > maximum) invalidAncillary('text exceeds its byte limit.');
  return value;
}
export function record(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAncillary('expected a closed object.');
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key)))
    invalidAncillary('unknown or missing keys.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) invalidAncillary('expected enumerable data fields.');
  }
  return value as Record<string, unknown>;
}
export function collection(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    invalidAncillary('invalid collection count.');
  return value;
}
/** Copy finite plain JSON before hashing; getters/toJSON are never invoked. */
export function boundedCopy(value: unknown, maximum: number): unknown {
  let entries = 0,
    strings = 0;
  function visit(item: unknown, depth: number): unknown {
    if (++entries > 8192 || depth > 16) invalidAncillary('JSON structural limit.');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))
        invalidAncillary('invalid JSON number.');
      return item;
    }
    if (typeof item === 'string') {
      strings += unicodeBytes(item);
      if (strings > maximum) invalidAncillary('JSON string budget.');
      return item;
    }
    if (!item || typeof item !== 'object') invalidAncillary('plain JSON required.');
    if (Array.isArray(item)) {
      if (item.length > 8192 || Reflect.ownKeys(item).length !== item.length + 1)
        invalidAncillary('dense JSON arrays required.');
      return Array.from({ length: item.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, index);
        if (!descriptor?.enumerable || !('value' in descriptor)) invalidAncillary('data array members required.');
        return visit(descriptor.value, depth + 1);
      });
    }
    const prototype = Object.getPrototypeOf(item),
      keys = Reflect.ownKeys(item);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length > 2048)
      invalidAncillary('plain bounded mappings required.');
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string') invalidAncillary('symbol JSON keys refused.');
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) invalidAncillary('data mapping members required.');
      visit(key, depth + 1);
      Object.defineProperty(copy, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  }
  const copy = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > maximum)
    invalidAncillary('serialized JSON byte budget.');
  return copy;
}
export function parent(value: unknown, bound: boolean) {
  const result = record(value, [...PARENT_KEYS, ...(bound ? ['authoringContentHash'] : [])]);
  for (const key of PARENT_KEYS) text(result[key], 128, ID);
  text(result.baseSpecContentHash, 64, /^studio-spec-v1-[0-9a-f]{8}$/u);
  if (bound) text(result.authoringContentHash, 64, /^studio-authoring-v1-[0-9a-f]{8}$/u);
  return result;
}

export function parseAncillaryBindings(value: unknown): AncillaryInstanceBinding[] {
  const items = collection(boundedCopy(value, 128 * 1024), 4, 1),
    ids = new Set<string>();
  return items.map((raw) => {
    const item = record(raw, ['contractId', 'contentHash', 'parent', 'parentRoleNodes', 'roleNodes']);
    const id = text(item.contractId, 128, ID);
    text(item.contentHash, 64, /^studio-ancillary-v1-[0-9a-f]{8}$/u);
    if (ids.has(id)) invalidAncillary('duplicate instance binding.');
    ids.add(id);
    parent(item.parent, true);
    const nodeIds = new Set<string>();
    for (const key of ['parentRoleNodes', 'roleNodes']) {
      const map = item[key];
      if (
        !map ||
        typeof map !== 'object' ||
        Array.isArray(map) ||
        !Object.keys(map).length ||
        Object.keys(map).length > 2048
      )
        invalidAncillary('invalid role map.');
      for (const [role, id] of Object.entries(map)) {
        text(role, 128, ID);
        const nodeId = text(id, 512);
        if (nodeIds.has(nodeId)) invalidAncillary('colliding role node identities.');
        nodeIds.add(nodeId);
      }
    }
    return item as AncillaryInstanceBinding;
  });
}

/** Presence is checked separately from legacy hint validity: never downgrade a claim. */
export function ancillaryBindingsFromHint(value: unknown): AncillaryInstanceBinding[] | undefined {
  if (!value || typeof value !== 'object' || !('ancillaryBindings' in value)) return undefined;
  if (Array.isArray(value)) invalidAncillary('claimed binding must belong to an object hint.');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'ancillaryBindings');
  if (!descriptor?.enumerable || !('value' in descriptor))
    invalidAncillary('claimed binding must be an own data property.');
  return parseAncillaryBindings(descriptor.value);
}
