import { boundedCopy, collection, parent, record, text, invalidAncillary, PARENT_KEYS } from './ancillaryBindings';
import type { AncillaryParentIdentity } from './ancillaryBindings';
export { ancillaryBindingsFromHint, parseAncillaryBindings, invalidAncillary } from './ancillaryBindings';
export type { AncillaryParentIdentity, AncillaryInstanceBinding, AncillaryExecutionPurpose } from './ancillaryBindings';
import type { NativeEnhancementModelReceipt, PromptEnhancementMode } from './promptEnhancementSummary';
import { hashString, stableStringify } from './stableHash';

export type AncillaryVerification = {
  schemaVersion: 1;
  supportedPromptModes: PromptEnhancementMode[];
  runtimeInputs: {
    role: string;
    modelField: string;
    revisionField: string;
    dtypeField: string;
    deviceField: string;
    quantizationField: string;
  };
  requestInputs: {
    role: string;
    operationField: string;
    maxNewTokensField: string;
    minNewTokensField: string;
    maxInputTokensField: string;
    maxImagePixelsField: string;
  };
  adapter: { id: string; declarationSha256: NativeEnhancementModelReceipt['receiptDigest'] };
  systemPromptsSha256: string;
  systemPromptSha256ByMode: Record<PromptEnhancementMode, string>;
  chatTemplateSha256: string;
  modelReceipt: Omit<NativeEnhancementModelReceipt, 'receiptDigest' | 'runtime'> & {
    runtime: Omit<NativeEnhancementModelReceipt['runtime'], 'dtype' | 'device' | 'quantization'>;
  };
  quantizationRecipes: NativeEnhancementModelReceipt['runtime']['quantization'][];
};
export type AncillaryOperation = {
  schemaVersion: 1;
  id: string;
  contentHash: string;
  parent: AncillaryParentIdentity;
  executionPurpose: 'explicit_preview';
  sourceRegions: false;
  verification?: AncillaryVerification;
  roles: [string, string, number, number][];
  edges: [string, string, string, string][];
  bindings: {
    owner: {
      role: string;
      promptField: string;
      layoutField: string;
      referenceSource: { role: string; field: string } | null;
    };
    request: { role: string; promptField: string; layoutField: string; imagesField: string };
    output: { role: string; field: string };
  };
  initialValues: [string, string, string | number | boolean | null | { source: 'hub'; value: string }][];
  fieldOverrides?: [string, string, { hidden: boolean }][];
  adapter: { id: string; declarationSha256: string };
};
export type AncillaryParentContext = AncillaryParentIdentity & { parentRoles: readonly string[] };

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
const NODE = /^modules\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/u;
const IDENTITY_FIELDS = new Set([
  'model_type',
  'repo_id',
  'model_id',
  'revision',
  'execution_profile_id',
  'trust_remote_code',
  'workflow_id',
  'pipeline_class',
]);
export function parseAncillaryOperations(value: unknown, context: AncillaryParentContext): AncillaryOperation[] {
  const ids = new Set<string>();
  return collection(boundedCopy(value, 128 * 1024), 4, 1).map((raw) => {
    const item = record(boundedCopy(raw, 32768), [
      'schemaVersion',
      'id',
      'contentHash',
      'parent',
      'executionPurpose',
      'roles',
      'edges',
      'bindings',
      'initialValues',
      'adapter',
      'sourceRegions',
      ...(raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'verification')
        ? ['verification']
        : []),
      ...(raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'fieldOverrides')
        ? ['fieldOverrides']
        : []),
    ]);
    const id = text(item.id, 128, ID);
    if (
      item.schemaVersion !== 1 ||
      item.executionPurpose !== 'explicit_preview' ||
      item.sourceRegions !== false ||
      ids.has(id)
    )
      invalidAncillary('unsupported or duplicate declaration.');
    ids.add(id);
    const selected = parent(item.parent, false);
    for (const key of PARENT_KEYS) if (selected[key] !== context[key]) invalidAncillary('parent selection differs.');
    const roles = new Set<string>();
    for (const raw of collection(item.roles, 16, 1)) {
      const row = collection(raw, 4, 4),
        role = text(row[0], 128, ID);
      if (
        roles.has(role) ||
        typeof row[1] !== 'string' ||
        !NODE.test(row[1]) ||
        !row.slice(2).every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000)
      )
        invalidAncillary('invalid child roles.');
      roles.add(role);
    }
    const childRole = (value: unknown) => {
      const name = text(value, 128, ID);
      if (!roles.has(name)) invalidAncillary('unknown child role.');
      return name;
    };
    const field = (value: unknown) => text(value, 64, FIELD);
    const targets = new Set<string>(),
      edges = collection(item.edges, 32);
    for (const raw of edges) {
      const row = collection(raw, 4, 4),
        from = childRole(row[0]),
        to = childRole(row[2]);
      field(row[1]);
      const key = `${to}:${field(row[3])}`;
      if (from === to || targets.has(key)) invalidAncillary('duplicate/cyclic target edge.');
      targets.add(key);
    }
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (role: string) => {
      if (active.has(role)) invalidAncillary('cyclic child graph.');
      if (visited.has(role)) return;
      active.add(role);
      for (const edge of edges as string[][]) if (edge[0] === role) visit(edge[2]!);
      active.delete(role);
      visited.add(role);
    };
    roles.forEach(visit);
    const bindings = record(item.bindings, ['owner', 'request', 'output']);
    const owner = record(bindings.owner, ['role', 'promptField', 'layoutField', 'referenceSource']);
    if (!context.parentRoles.includes(text(owner.role, 128, ID))) invalidAncillary('unknown parent owner role.');
    field(owner.promptField);
    field(owner.layoutField);
    if (owner.referenceSource !== null) {
      const reference = record(owner.referenceSource, ['role', 'field']);
      if (!context.parentRoles.includes(text(reference.role, 128, ID))) invalidAncillary('unknown parent media role.');
      field(reference.field);
    }
    const request = record(bindings.request, ['role', 'promptField', 'layoutField', 'imagesField']);
    childRole(request.role);
    field(request.promptField);
    field(request.layoutField);
    field(request.imagesField);
    const output = record(bindings.output, ['role', 'field']);
    childRole(output.role);
    field(output.field);
    const adapter = record(item.adapter, ['id', 'declarationSha256']);
    text(adapter.id, 128, /^[a-z][a-z0-9-]{0,127}$/u);
    text(adapter.declarationSha256, 71, /^sha256:[0-9a-f]{64}$/u);
    const verification = Object.prototype.hasOwnProperty.call(item, 'verification')
      ? parseAncillaryVerification(item.verification, adapter)
      : undefined;
    if (verification) {
      childRole(verification.runtimeInputs.role);
      if (verification.requestInputs.role !== request.role) invalidAncillary('verification request role differs.');
    }
    const assigned = new Set<string>();
    for (const raw of collection(item.initialValues, 32)) {
      const row = collection(raw, 3, 3),
        role = childRole(row[0]),
        name = field(row[1]),
        key = `${role}:${name}`,
        value = row[2];
      const source = verification?.modelReceipt.source,
        runtimeInputs = verification?.runtimeInputs;
      const modelIdentity = source && runtimeInputs && role === runtimeInputs.role && name === runtimeInputs.modelField;
      const revisionIdentity =
        source && runtimeInputs && role === runtimeInputs.role && name === runtimeInputs.revisionField;
      if (modelIdentity) {
        const selection = record(value, ['source', 'value']);
        if (selection.source !== 'hub' || selection.value !== source.repository)
          invalidAncillary('initial model selection differs from verification.');
      }
      if (revisionIdentity && value !== source.revision)
        invalidAncillary('initial revision differs from verification.');
      if (
        (IDENTITY_FIELDS.has(name) && !modelIdentity && !revisionIdentity) ||
        assigned.has(key) ||
        !(
          value === null ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isFinite(value)) ||
          (typeof value === 'string' && new TextEncoder().encode(value).byteLength <= 4096) ||
          modelIdentity
        )
      )
        invalidAncillary('invalid initial input.');
      assigned.add(key);
    }
    if (
      verification &&
      (!assigned.has(`${verification.runtimeInputs.role}:${verification.runtimeInputs.modelField}`) ||
        !assigned.has(`${verification.runtimeInputs.role}:${verification.runtimeInputs.revisionField}`))
    )
      invalidAncillary('verification needs its exact declared initial model and pin.');
    if (Object.prototype.hasOwnProperty.call(item, 'fieldOverrides')) {
      const selected = new Set<string>();
      for (const raw of collection(item.fieldOverrides, 32)) {
        const row = collection(raw, 3, 3),
          role = childRole(row[0]),
          name = field(row[1]);
        const override = record(row[2], ['hidden']);
        if (typeof override.hidden !== 'boolean' || selected.has(`${role}:${name}`))
          invalidAncillary('invalid or duplicate selected field presentation.');
        selected.add(`${role}:${name}`);
      }
    }
    const { contentHash, ...semantic } = item;
    if (contentHash !== `studio-ancillary-v1-${hashString(stableStringify(semantic))}`)
      invalidAncillary('stale child content hash.');
    return item as AncillaryOperation;
  });
}

/** Hash-covered producer expectations, not a receipt or eligibility grant. */
export function parseAncillaryVerification(value: unknown, adapter?: Record<string, unknown>): AncillaryVerification {
  const item = record(boundedCopy(value, 16384), [
    'schemaVersion',
    'adapter',
    'systemPromptsSha256',
    'systemPromptSha256ByMode',
    'chatTemplateSha256',
    'modelReceipt',
    'quantizationRecipes',
    'runtimeInputs',
    'requestInputs',
    'supportedPromptModes',
  ]);
  if (item.schemaVersion !== 1) invalidAncillary('unsupported verification metadata.');
  const supported = collection(item.supportedPromptModes, 4, 1);
  if (
    new Set(supported).size !== supported.length ||
    supported.some((mode) => mode !== 't2i' && mode !== 'i2i' && mode !== 't2i_bbox' && mode !== 'i2i_bbox')
  )
    invalidAncillary('unsupported or duplicate prompt modes.');
  for (const [name, keys] of [
    ['runtimeInputs', ['role', 'modelField', 'revisionField', 'dtypeField', 'deviceField', 'quantizationField']],
    [
      'requestInputs',
      [
        'role',
        'operationField',
        'maxNewTokensField',
        'minNewTokensField',
        'maxInputTokensField',
        'maxImagePixelsField',
      ],
    ],
  ] as const) {
    const mapping = record(item[name], keys);
    text(mapping.role, 128, ID);
    const fields = keys.filter((key) => key !== 'role').map((key) => text(mapping[key], 64, FIELD));
    if (new Set(fields).size !== fields.length) invalidAncillary('verification control mappings collide.');
  }
  const selectedAdapter = record(item.adapter, ['id', 'declarationSha256']);
  text(selectedAdapter.id, 128, /^[a-z][a-z0-9-]{0,127}$/u);
  text(selectedAdapter.declarationSha256, 71, /^sha256:[0-9a-f]{64}$/u);
  if (adapter && stableStringify(adapter) !== stableStringify(selectedAdapter))
    invalidAncillary('verification adapter differs from the declaration.');
  for (const key of ['systemPromptsSha256', 'chatTemplateSha256']) text(item[key], 71, /^sha256:[0-9a-f]{64}$/u);
  const modes = record(item.systemPromptSha256ByMode, ['t2i', 'i2i', 't2i_bbox', 'i2i_bbox']);
  for (const value of Object.values(modes)) text(value, 64, /^[0-9a-f]{64}$/u);
  const receipt = record(item.modelReceipt, [
    'schemaVersion',
    'library',
    'task',
    'source',
    'loader',
    'security',
    'runtime',
  ]);
  if (receipt.schemaVersion !== 1 || receipt.library !== 'transformers' || receipt.task !== 'image-video-to-text')
    invalidAncillary('foreign verification receipt contract.');
  const source = record(receipt.source, ['kind', 'repository', 'revision']);
  if (source.kind !== 'hub') invalidAncillary('verification requires an immutable Hub selection.');
  text(source.repository, 256, /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u);
  text(source.revision, 40, /^[0-9a-f]{40}$/u);
  const loader = record(receipt.loader, ['preprocessorAutoClass', 'modelAutoClass']);
  if (loader.preprocessorAutoClass !== 'AutoProcessor' || loader.modelAutoClass !== 'AutoModelForImageTextToText')
    invalidAncillary('foreign verification loader.');
  const security = record(receipt.security, [
    'localFilesOnly',
    'trustRemoteCode',
    'safetensorsOnly',
    'hostedInference',
  ]);
  if (
    security.localFilesOnly !== true ||
    security.trustRemoteCode !== false ||
    security.safetensorsOnly !== true ||
    security.hostedInference !== false
  )
    invalidAncillary('unsafe verification security declaration.');
  const runtime = record(receipt.runtime, [
    'transformersVersion',
    'preprocessorClass',
    'modelClass',
    'modelType',
    'architectures',
  ]);
  text(runtime.transformersVersion, 128);
  const identifier = /^[A-Za-z_][A-Za-z0-9_-]{0,255}$/u;
  for (const key of ['preprocessorClass', 'modelClass']) text(runtime[key], 256, identifier);
  if (runtime.modelType !== null) text(runtime.modelType, 256, identifier);
  for (const name of collection(runtime.architectures, 32)) text(name, 256, identifier);
  const recipes = collection(item.quantizationRecipes, 2, 1),
    seen = new Set();
  const nf4 = {
    mode: 'bnb_4bit',
    quantType: 'nf4',
    doubleQuant: true,
    computeDtype: 'bfloat16',
    skipModules: ['lm_head', 'model.visual'],
  };
  for (const recipe of recipes) {
    const key = stableStringify(recipe);
    if (seen.has(key) || (key !== stableStringify({ mode: 'none' }) && key !== stableStringify(nf4)))
      invalidAncillary('unknown or duplicate verification quantization recipe.');
    seen.add(key);
  }
  return item as AncillaryVerification;
}
