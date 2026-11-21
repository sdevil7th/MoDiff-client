import { parseAncillaryOperations, type AncillaryOperation } from './ancillaryOperations';
import { isStudioExecutionBindingSource, isStudioGraphRole } from './executionSpecs';
import { hashString, stableStringify } from './stableHash';
import type { StudioExecutionSpec, StudioGraphRole } from './types';
import { record } from '../workflow/operationContracts';

/** Hash-covered authoring data over ordinary nodes, never execution authority. */
export type OperationAuthoringRecipe = {
  schemaVersion: 1;
  canonicalizationVersion: 1;
  id: string;
  baseSpecId: string;
  baseSpecContentHash: string;
  executionProfileIds: string[];
  roles: StudioExecutionSpec['roles'];
  edges: StudioExecutionSpec['edges'];
  bindings: StudioExecutionSpec['bindings'];
  initialValues: Array<[StudioGraphRole, string, string | number | boolean | null]>;
  contentHash: string;
  ancillaryOperations?: AncillaryOperation[];
};
export type OperationAuthoringSelection = {
  authoringRecipeId?: string;
  executionProfileId?: string;
  pipelineClass?: string;
  task?: string;
};
const ID = /^[a-z\d][a-z\d._:-]{0,127}$/;
const FIELD = /^[A-Za-z_][A-Za-z\d_]{0,63}$/;
const NODE = /^modules\.[A-Za-z\d_]+\.[A-Za-z\d_]+$/;
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
function invalid(): never {
  throw new Error('Invalid operation authoring recipe. Refresh model capabilities.');
}
function field(value: unknown): value is string {
  return typeof value === 'string' && FIELD.test(value);
}

export function parseOperationAuthoringRecipe(
  value: unknown,
  expected: OperationAuthoringSelection,
): OperationAuthoringRecipe {
  const claimed = value !== null && typeof value === 'object' && 'ancillaryOperations' in value;
  const ancillary = claimed ? Object.getOwnPropertyDescriptor(value, 'ancillaryOperations') : undefined;
  if (claimed && (!ancillary?.enumerable || !('value' in ancillary))) invalid();
  const raw = record(value, [
    'schemaVersion',
    'canonicalizationVersion',
    'id',
    'baseSpecId',
    'baseSpecContentHash',
    'executionProfileIds',
    'roles',
    'edges',
    'bindings',
    'initialValues',
    'contentHash',
    ...(ancillary ? ['ancillaryOperations'] : []),
  ]);
  if (
    raw.schemaVersion !== 1 ||
    raw.canonicalizationVersion !== 1 ||
    typeof raw.id !== 'string' ||
    !ID.test(raw.id) ||
    raw.id !== expected.authoringRecipeId ||
    typeof raw.baseSpecId !== 'string' ||
    !ID.test(raw.baseSpecId) ||
    typeof raw.baseSpecContentHash !== 'string' ||
    !/^studio-spec-v1-[a-f\d]{8}$/.test(raw.baseSpecContentHash) ||
    !expected.executionProfileId ||
    !Array.isArray(raw.executionProfileIds) ||
    !raw.executionProfileIds.length ||
    raw.executionProfileIds.length > 32 ||
    raw.executionProfileIds.some((id) => typeof id !== 'string' || !ID.test(id)) ||
    new Set(raw.executionProfileIds).size !== raw.executionProfileIds.length ||
    !raw.executionProfileIds.includes(expected.executionProfileId)
  )
    invalid();
  if (!Array.isArray(raw.roles) || raw.roles.length < 2 || raw.roles.length > 32) invalid();
  const roles = raw.roles.map((row): OperationAuthoringRecipe['roles'][number] => {
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      !isStudioGraphRole(row[0]) ||
      typeof row[1] !== 'string' ||
      !NODE.test(row[1]) ||
      !row.slice(2).every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000)
    )
      invalid();
    return [row[0], row[1], row[2] as number, row[3] as number];
  });
  const roleIds = new Set(roles.map(([role]) => role));
  if (roleIds.size !== roles.length) invalid();
  const role = (value: unknown): value is StudioGraphRole => isStudioGraphRole(value) && roleIds.has(value);
  if (!Array.isArray(raw.edges) || !raw.edges.length || raw.edges.length > 128) invalid();
  const targets = new Set<string>();
  const edges = raw.edges.map((row): OperationAuthoringRecipe['edges'][number] => {
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      !role(row[0]) ||
      !field(row[1]) ||
      !role(row[2]) ||
      !field(row[3]) ||
      row[0] === row[2] ||
      targets.has(`${row[2]}:${row[3]}`)
    )
      invalid();
    targets.add(`${row[2]}:${row[3]}`);
    return [row[0], row[1], row[2], row[3]];
  });
  const visited = new Set<StudioGraphRole>(),
    visiting = new Set<StudioGraphRole>();
  function visit(id: StudioGraphRole) {
    if (visiting.has(id)) invalid();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of edges) if (edge[0] === id) visit(edge[2]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of roleIds) visit(id);
  if (
    !Array.isArray(raw.bindings) ||
    !raw.bindings.length ||
    raw.bindings.length > 128 ||
    !Array.isArray(raw.initialValues) ||
    raw.initialValues.length > 128
  )
    invalid();
  const assigned = new Set<string>();
  const bindings = raw.bindings.map((row): OperationAuthoringRecipe['bindings'][number] => {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      !role(row[0]) ||
      !field(row[1]) ||
      !isStudioExecutionBindingSource(row[2]) ||
      assigned.has(`${row[0]}:${row[1]}`)
    )
      invalid();
    assigned.add(`${row[0]}:${row[1]}`);
    return [row[0], row[1], row[2]];
  });
  const initialValues = raw.initialValues.map((row): OperationAuthoringRecipe['initialValues'][number] => {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      !role(row[0]) ||
      !field(row[1]) ||
      IDENTITY_FIELDS.has(row[1]) ||
      assigned.has(`${row[0]}:${row[1]}`) ||
      !(
        row[2] === null ||
        typeof row[2] === 'boolean' ||
        (typeof row[2] === 'number' && Number.isFinite(row[2])) ||
        (typeof row[2] === 'string' && row[2].length <= 4096)
      )
    )
      invalid();
    assigned.add(`${row[0]}:${row[1]}`);
    return [row[0], row[1], row[2]];
  });
  if (ancillary && (!expected.pipelineClass || !expected.task)) invalid();
  const ancillaryOperations = ancillary
    ? parseAncillaryOperations(ancillary.value, {
        authoringRecipeId: raw.id as string,
        baseSpecId: raw.baseSpecId as string,
        baseSpecContentHash: raw.baseSpecContentHash as string,
        executionProfileId: expected.executionProfileId!,
        pipelineClass: expected.pipelineClass!,
        task: expected.task!,
        parentRoles: roles.map(([role]) => role),
      })
    : undefined;
  const semantic = {
    schemaVersion: 1 as const,
    canonicalizationVersion: 1 as const,
    id: raw.id,
    baseSpecId: raw.baseSpecId,
    baseSpecContentHash: raw.baseSpecContentHash,
    executionProfileIds: raw.executionProfileIds as string[],
    roles,
    edges,
    bindings,
    initialValues,
    ...(ancillary ? { ancillaryOperations } : {}),
  };
  const contentHash = `studio-authoring-v1-${hashString(stableStringify(semantic))}`;
  if (raw.contentHash !== contentHash) invalid();
  return { ...semantic, contentHash };
}
