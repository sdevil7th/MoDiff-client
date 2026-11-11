/** Bounded editing metadata; this never grants model execution or validates wording quality. */
export const AUTHORED_CONSTRAINT_OPERATION = 'enhance_prompt_constrained_authored_v1';
export const AUTHORED_CONSTRAINT_POLICY = 'constrained-authored-table-v1';
export const AUTHORED_CONSTRAINT_VERSION = 'authored-layout-byte-prefix-v1';

export type AuthoredConstraintLimits = {
  max_regions: number;
  max_references: number;
  max_caption_chars: number;
  max_description_chars: number;
  max_output_bytes: number;
  max_new_tokens: number;
  max_vocabulary_tokens: number;
  max_token_bytes: number;
  max_vocabulary_bytes: number;
  max_trie_nodes: number;
  max_cache_bytes: number;
  build_seconds: number;
  lookup_seconds: number;
  max_request_seconds: number;
};
export type AuthoredLayoutConstraint = {
  schemaVersion: 1;
  version: typeof AUTHORED_CONSTRAINT_VERSION;
  status: 'contract_only';
  operation: typeof AUTHORED_CONSTRAINT_OPERATION;
  layoutPolicy: typeof AUTHORED_CONSTRAINT_POLICY;
  adapterId: string;
  repository: string;
  revision: string;
  transformersVersion: string;
  tokenizersVersion: string;
  tokenizerClass: string;
  ordinaryVocabularyTokens: number;
  ordinaryVocabularySha256: string;
  tokenizerSemanticSha256: string;
  sourcePreTokenizerSha256: string;
  effectivePreTokenizerSha256: string;
  reservedAddedTokenIds: number[];
  trueSpecialTokenIds: number[];
  configuredEosTokenIds: number[];
  effectiveEosTokenIds: number[];
  padTokenId: number;
  preparationRamBytes: number;
  deadlineSeconds: number;
  artifacts: { path: string; byteSize: number; sha256: string }[];
  declarationSha256: string;
  limits: AuthoredConstraintLimits;
};
export type ConsumedAuthoredLayoutConstraint = {
  contract: AuthoredLayoutConstraint;
  authoritativeRowsSha256: string;
  vocabularySha256: string;
  tokenizerSemanticSha256: string;
  renderedInputIdsSha256: string;
  promptTokenCount: number;
  limits: AuthoredConstraintLimits;
};
export type AuthoredConstraintCompletion = {
  version: typeof AUTHORED_CONSTRAINT_VERSION;
  terminalTokenId: number;
  grammarComplete: true;
  rawOutputSha256: string;
  generatedTokens: number;
  constraintFingerprintSha256: string;
};
const invalid = (): never => {
  throw new Error('Invalid authored-layout constraint contract.');
};
const closed = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    return invalid();
  if (Reflect.ownKeys(value).length !== keys.length) return invalid();
  for (const key of keys) {
    const entry = Object.getOwnPropertyDescriptor(value, key);
    if (!entry?.enumerable || !('value' in entry)) return invalid();
  }
  return value as Record<string, unknown>;
};
const integer = (value: unknown, min: number, max: number): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
const text = (value: unknown, max = 256): string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  [...value].every((c) => c.charCodeAt(0) >= 32)
    ? value
    : invalid();
const digest = (value: unknown, prefix = true): string =>
  typeof value === 'string' && (prefix ? /^sha256:[0-9a-f]{64}$/u : /^[0-9a-f]{64}$/u).test(value) ? value : invalid();
const ids = (value: unknown, max = 512): number[] => {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return invalid();
  const rows = Array.from({ length: value.length }, (_, index) => {
    const item = Object.getOwnPropertyDescriptor(value, index);
    return item?.enumerable && 'value' in item ? integer(item.value, 0, 1000000) : invalid();
  });
  if (new Set(rows).size !== rows.length) return invalid();
  return rows;
};
export function parseAuthoredConstraintLimits(value: unknown): AuthoredConstraintLimits {
  const caps = {
    max_regions: 32,
    max_references: 10,
    max_caption_chars: 131072,
    max_description_chars: 4096,
    max_output_bytes: 262144,
    max_new_tokens: 3584,
    max_vocabulary_tokens: 300000,
    max_token_bytes: 512,
    max_vocabulary_bytes: 16777216,
    max_trie_nodes: 2000000,
    max_cache_bytes: 16777216,
    build_seconds: 10,
    lookup_seconds: 2,
    max_request_seconds: 1800,
  };
  const row = closed(value, Object.keys(caps));
  for (const [key, cap] of Object.entries(caps)) integer(row[key], 1, cap);
  return row as AuthoredConstraintLimits;
}
export function parseAuthoredLayoutConstraint(value: unknown): AuthoredLayoutConstraint {
  const item = closed(value, [
    'schemaVersion',
    'version',
    'status',
    'operation',
    'layoutPolicy',
    'adapterId',
    'repository',
    'revision',
    'transformersVersion',
    'tokenizersVersion',
    'tokenizerClass',
    'ordinaryVocabularyTokens',
    'ordinaryVocabularySha256',
    'tokenizerSemanticSha256',
    'sourcePreTokenizerSha256',
    'effectivePreTokenizerSha256',
    'reservedAddedTokenIds',
    'trueSpecialTokenIds',
    'configuredEosTokenIds',
    'effectiveEosTokenIds',
    'padTokenId',
    'preparationRamBytes',
    'deadlineSeconds',
    'artifacts',
    'declarationSha256',
    'limits',
  ]);
  if (
    item.schemaVersion !== 1 ||
    item.version !== AUTHORED_CONSTRAINT_VERSION ||
    item.status !== 'contract_only' ||
    item.operation !== AUTHORED_CONSTRAINT_OPERATION ||
    item.layoutPolicy !== AUTHORED_CONSTRAINT_POLICY
  )
    invalid();
  for (const key of ['adapterId', 'repository', 'transformersVersion', 'tokenizersVersion', 'tokenizerClass'])
    text(item[key]);
  if (!/^[0-9a-f]{40}$/u.test(text(item.revision, 40))) invalid();
  const count = integer(item.ordinaryVocabularyTokens, 1, 300000);
  for (const key of [
    'ordinaryVocabularySha256',
    'tokenizerSemanticSha256',
    'sourcePreTokenizerSha256',
    'effectivePreTokenizerSha256',
    'declarationSha256',
  ])
    digest(item[key]);
  const reserved = ids(item.reservedAddedTokenIds),
    specials = ids(item.trueSpecialTokenIds);
  const configured = ids(item.configuredEosTokenIds, 16),
    effective = ids(item.effectiveEosTokenIds, 16);
  if (
    reserved.some((id) => id < count) ||
    specials.some((id) => !reserved.includes(id)) ||
    configured.some((id) => !specials.includes(id)) ||
    effective.some((id) => !configured.includes(id)) ||
    !reserved.includes(integer(item.padTokenId, count, 1000000))
  )
    invalid();
  integer(item.preparationRamBytes, 1, 268435456);
  const deadline = integer(item.deadlineSeconds, 1, 1800);
  const limits = parseAuthoredConstraintLimits(item.limits);
  if (limits.max_vocabulary_tokens < count || limits.max_request_seconds !== deadline) invalid();
  if (!Array.isArray(item.artifacts) || item.artifacts.length !== 3 || Reflect.ownKeys(item.artifacts).length !== 4)
    invalid();
  const names = ['tokenizer.json', 'tokenizer_config.json', 'generation_config.json'];
  for (let index = 0; index < 3; index++) {
    const entry = Object.getOwnPropertyDescriptor(item.artifacts, index);
    if (!entry?.enumerable || !('value' in entry)) invalid();
    const row = closed(entry!.value, ['path', 'byteSize', 'sha256']);
    if (row.path !== names[index]) invalid();
    integer(row.byteSize, 1, 24 * 1024 ** 2);
    digest(row.sha256, false);
  }
  if (JSON.stringify(item).length > 16384) invalid();
  return item as AuthoredLayoutConstraint;
}
export function parseConsumedAuthoredLayoutConstraint(value: unknown): ConsumedAuthoredLayoutConstraint {
  const item = closed(value, [
    'contract',
    'authoritativeRowsSha256',
    'vocabularySha256',
    'tokenizerSemanticSha256',
    'renderedInputIdsSha256',
    'promptTokenCount',
    'limits',
  ]);
  parseAuthoredLayoutConstraint(item.contract);
  for (const key of [
    'authoritativeRowsSha256',
    'vocabularySha256',
    'tokenizerSemanticSha256',
    'renderedInputIdsSha256',
  ])
    digest(item[key]);
  integer(item.promptTokenCount, 1, 32768);
  parseAuthoredConstraintLimits(item.limits);
  return item as ConsumedAuthoredLayoutConstraint;
}
export function parseAuthoredConstraintCompletion(value: unknown): AuthoredConstraintCompletion {
  const item = closed(value, [
    'version',
    'terminalTokenId',
    'grammarComplete',
    'rawOutputSha256',
    'generatedTokens',
    'constraintFingerprintSha256',
  ]);
  if (item.version !== AUTHORED_CONSTRAINT_VERSION || item.grammarComplete !== true) invalid();
  integer(item.terminalTokenId, 0, 1000000);
  integer(item.generatedTokens, 1, 3584);
  digest(item.rawOutputSha256);
  digest(item.constraintFingerprintSha256);
  return item as AuthoredConstraintCompletion;
}
