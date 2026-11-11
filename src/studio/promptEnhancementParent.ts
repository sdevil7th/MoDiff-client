import type { AncillaryParentIdentity } from './ancillaryBindings';
import { invalidAncillary } from './ancillaryBindings';

/** Saved editing context only. Fresh backend metadata must validate every use. */
export type PromptEnhancementParent = {
  schemaVersion: 1;
  parent: AncillaryParentIdentity & { authoringContentHash: string };
  parentRoleNodes: Record<string, string>;
  /** Fingerprint only; original text stays in the actual proposal request node. */
  appliedPairSha256?: `sha256:${string}`;
};

export const PARENT_KEYS = [
  'authoringRecipeId',
  'baseSpecId',
  'baseSpecContentHash',
  'executionProfileId',
  'pipelineClass',
  'task',
  'authoringContentHash',
] as const;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function closed(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidAncillary('prompt enhancement context must be an object.');
  const prototype = Object.getPrototypeOf(value);
  const own = Reflect.ownKeys(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    invalidAncillary('prompt enhancement context has unknown or missing fields.');
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !('value' in property))
      invalidAncillary('prompt enhancement context requires own data fields.');
  }
  return value as Record<string, unknown>;
}

function nodeId(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 512 ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159),
    )
  )
    invalidAncillary('invalid prompt enhancement node identity.');
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalidAncillary('invalid node identity Unicode.');
    } else if (code >= 0xdc00 && code <= 0xdfff) invalidAncillary('invalid node identity Unicode.');
  }
  if (new TextEncoder().encode(value).byteLength > 512) invalidAncillary('node identity exceeds its byte limit.');
  return value;
}

export function parsePromptEnhancementParent(value: unknown): PromptEnhancementParent {
  const applied = Boolean(
    value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'appliedPairSha256'),
  );
  const item = closed(value, ['schemaVersion', 'parent', 'parentRoleNodes', ...(applied ? ['appliedPairSha256'] : [])]);
  if (item.schemaVersion !== 1) invalidAncillary('unsupported prompt enhancement context.');
  const parent = closed(item.parent, PARENT_KEYS);
  for (const key of PARENT_KEYS)
    if (typeof parent[key] !== 'string' || !ID.test(parent[key])) invalidAncillary('invalid parent selection.');
  if (
    !/^studio-spec-v1-[0-9a-f]{8}$/u.test(parent.baseSpecContentHash as string) ||
    !/^studio-authoring-v1-[0-9a-f]{8}$/u.test(parent.authoringContentHash as string)
  )
    invalidAncillary('invalid parent content fingerprint.');
  const roles = item.parentRoleNodes;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) invalidAncillary('invalid parent role map.');
  const keys = Reflect.ownKeys(roles);
  if (!keys.length || keys.length > 64) invalidAncillary('invalid parent role count.');
  closed(
    roles,
    keys.filter((key): key is string => typeof key === 'string'),
  );
  const ids = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || !ID.test(key)) invalidAncillary('invalid parent role identity.');
    const id = nodeId((roles as Record<string, unknown>)[key]);
    if (ids.has(id)) invalidAncillary('duplicate parent node identity.');
    ids.add(id);
  }
  if (applied && (typeof item.appliedPairSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(item.appliedPairSha256)))
    invalidAncillary('invalid applied prompt fingerprint.');
  return structuredClone(item) as PromptEnhancementParent;
}

/** A malformed saved offer is never silently treated as an unsupported model. */
export function promptEnhancementParentFromHint(value: unknown): PromptEnhancementParent | undefined {
  if (!value || typeof value !== 'object' || !('ancillaryParent' in value)) return undefined;
  if (Array.isArray(value)) invalidAncillary('invalid prompt enhancement hint.');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'ancillaryParent');
  if (!descriptor?.enumerable || !('value' in descriptor)) invalidAncillary('invalid prompt enhancement data field.');
  return parsePromptEnhancementParent(descriptor.value);
}

export function remapPromptEnhancementParent(value: PromptEnhancementParent, remap: (id: string) => string) {
  return parsePromptEnhancementParent({
    ...value,
    parentRoleNodes: Object.fromEntries(Object.entries(value.parentRoleNodes).map(([role, id]) => [role, remap(id)])),
  });
}
