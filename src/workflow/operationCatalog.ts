import { parseOptionalRuntimeRequirement, type OptionalRuntimeRequirement } from '../studio/optionalRuntimes';
import {
  boundedText,
  identifier,
  invalid,
  record,
  type OperationContract,
  type OperationPort,
} from './operationContracts';
import { blockValueTypesAreCompatibleV2 } from '../studio/blockValueTypeCompatibilityV2';

export type PipelineTaskSupport = {
  task: string;
  execution: 'adapter' | 'declared' | 'unavailable';
  decomposition: 'stages' | 'pipeline' | 'none';
  operationIds: string[];
  executionProfileIds: string[];
  dependencies: 'ready' | 'blocked' | 'unknown';
  runtimeRequirements: OptionalRuntimeRequirement[];
};
export type PipelineSupport = {
  pipelineClass: string;
  coverage: string;
  reason: string;
  equivalentTo: string[];
  upstreamTasks: { task: string; source: 'auto' | 'modular' | 'export'; workflowId: string | null }[];
  tasks: PipelineTaskSupport[];
};

function array<T>(value: unknown, parse: (value: unknown) => T, limit = 512): T[] {
  if (!Array.isArray(value) || value.length > limit) invalid();
  return value.map(parse);
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) invalid();
  return values;
}

/** Coverage and dependency metadata never replace the backend's execution preflight. */
export function parsePipelineSupport(
  value: unknown,
  schema: unknown,
  operations: OperationContract[],
): PipelineSupport[] {
  if (value === undefined && schema === undefined) return [];
  if (schema !== 1) invalid();
  const pipelines = array(value, (entry) => {
    const item = record(entry, ['pipelineClass', 'coverage', 'reason', 'equivalentTo', 'upstreamTasks', 'tasks']);
    const pipelineClass = identifier(item.pipelineClass);
    if (
      ![
        'executable',
        'equivalent',
        'contract-only',
        'research-blocked',
        'intentionally-excluded',
        'unreviewed',
        'local-adapter',
      ].includes(String(item.coverage))
    )
      invalid();
    const upstreamTasks = array(item.upstreamTasks, (value) => {
      const task = record(value, ['task', 'source', 'workflowId']);
      if (!['auto', 'modular', 'export'].includes(String(task.source))) invalid();
      return {
        task: identifier(task.task),
        source: task.source as 'auto' | 'modular' | 'export',
        workflowId: task.workflowId === null ? null : identifier(task.workflowId),
      };
    });
    const tasks = array(item.tasks, (value) => {
      const task = record(value, [
        'task',
        'execution',
        'decomposition',
        'operationIds',
        'executionProfileIds',
        'dependencies',
        'runtimeRequirements',
      ]);
      const name = identifier(task.task);
      if (
        !['adapter', 'declared', 'unavailable'].includes(String(task.execution)) ||
        !['stages', 'pipeline', 'none'].includes(String(task.decomposition)) ||
        !['ready', 'blocked', 'unknown'].includes(String(task.dependencies))
      )
        invalid();
      const operationIds = unique(array(task.operationIds, (value) => boundedText(value, 257)));
      const executionProfileIds = unique(array(task.executionProfileIds, (value) => boundedText(value, 256)));
      const runtimeRequirements = array(task.runtimeRequirements, parseOptionalRuntimeRequirement);
      const declared = operations.filter((o) => o.pipelineClass === pipelineClass && o.task === name);
      if (operationIds.length !== declared.length || declared.some((o) => !operationIds.includes(o.operationId)))
        invalid();
      const decomposition: PipelineTaskSupport['decomposition'] = declared.some(
        (o) => o.decomposition === 'block' || o.decomposition === 'bundle',
      )
        ? 'stages'
        : declared.some((o) => o.decomposition === 'pipeline')
          ? 'pipeline'
          : 'none';
      if (
        task.decomposition !== decomposition ||
        (task.execution === 'unavailable') !== (operationIds.length === 0) ||
        (task.execution === 'adapter' && !executionProfileIds.length)
      )
        invalid();
      if (
        (task.dependencies === 'unknown') !== (executionProfileIds.length === 0) ||
        (executionProfileIds.length > 0 && !runtimeRequirements.length)
      )
        invalid();
      const blocked = runtimeRequirements.some((r) => r.requiredNow && r.state !== 'active');
      if (executionProfileIds.length && task.dependencies !== (blocked ? 'blocked' : 'ready')) invalid();
      return {
        task: name,
        execution: task.execution as PipelineTaskSupport['execution'],
        decomposition,
        operationIds,
        executionProfileIds,
        dependencies: task.dependencies as PipelineTaskSupport['dependencies'],
        runtimeRequirements,
      };
    });
    unique(tasks.map((t) => t.task));
    return {
      pipelineClass,
      coverage: boundedText(item.coverage),
      reason: boundedText(item.reason),
      equivalentTo: unique(array(item.equivalentTo, identifier)),
      upstreamTasks,
      tasks,
    };
  });
  unique(pipelines.map((p) => p.pipelineClass));
  for (const operation of operations) {
    if (
      operation.task !== null &&
      !pipelines.some(
        (p) => p.pipelineClass === operation.pipelineClass && p.tasks.some((t) => t.task === operation.task),
      )
    )
      invalid();
  }
  return pipelines;
}

// Common operation names, never a model-family dispatch table.
const ORDER = [
  'load_models',
  'prepare_duration',
  'rewrite_prompt',
  'assemble_references',
  'prepare_media',
  'encode_prompt',
  'encode_image',
  'encode_video',
  'image_embeddings',
  'encode_condition',
  'encode_reference',
  'controlnet',
  'ip_adapter',
  'generate_semantics',
  'denoise',
  'decode_latents',
  'postprocess_media',
];
export function operationLabel(operation: OperationContract) {
  return operation.operationId
    .split('.')[1]!
    .replace(/_/gu, ' ')
    .replace(/^./u, (c) => c.toUpperCase());
}
export function operationsForTask(
  operations: OperationContract[],
  pipeline: string,
  task: string,
): OperationContract[] {
  const order = (op: OperationContract) => {
    const index = ORDER.indexOf(op.operationId.split('.')[1]!);
    return index < 0 ? ORDER.length : index;
  };
  return operations
    .filter((o) => o.pipelineClass === pipeline && o.task === task && o.binding)
    .sort((a, b) => order(a) - order(b) || a.operationId.localeCompare(b.operationId));
}

/** Advisory matching only: state and components retain loader ownership. */
export function operationPortCompatibility(
  output: OperationPort,
  input: OperationPort,
): 'incompatible' | 'runtime_validation' | 'compatible' {
  if (
    output.direction !== 'output' ||
    input.direction !== 'input' ||
    !blockValueTypesAreCompatibleV2(output.types, input.types)
  )
    return 'incompatible';
  const left = output.semantics,
    right = input.semantics;
  if (!left || !right) return 'runtime_validation';
  if (left.kind !== right.kind || left.scope !== right.scope || (right.state !== null && left.state !== right.state))
    return 'incompatible';
  if (
    left.kind === 'component' &&
    left.members.length &&
    right.members.length &&
    right.members.some(
      (r) =>
        !left.members.some(
          (l) => l.name === r.name && (l.type === r.type || l.type === 'opaque' || r.type === 'opaque'),
        ),
    )
  )
    return 'incompatible';
  return left.owner === 'same_loader' || right.owner === 'same_loader' || left.kind === 'opaque'
    ? 'runtime_validation'
    : 'compatible';
}
