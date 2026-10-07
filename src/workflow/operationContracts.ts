/** Reviewed value-transfer meaning; neither tensor compatibility nor execution permission. */
export type OperationControl = {
  technique: 'classifier_free' | 'embedded_distilled';
  parameter: 'scale' | 'rescale' | 'enabled' | 'formulation' | 'start' | 'stop' | 'technique';
  compatibilityScope: string;
  scaleMeaning: 'cfg_prediction_mix' | 'distilled_model_embedding';
  enabled: 'boolean_field' | 'scale_gt_one' | 'always' | 'model_config';
  enabledField: string | null;
  formulation: 'boolean_field' | 'original' | 'diffusers' | 'embedded';
  formulationField: string | null;
  selectorField: string | null;
  selectorValue: string | boolean | null;
  negativeConditioning: 'pipeline_scoped_when_enabled' | 'none';
  negativeConditioningScope: string | null;
  negativePromptField?: string;
  negativePromptPolicy?: 'empty_string_is_condition';
};

/** Backend declarations, not execution permission or a graph recipe. */
export type OperationSemantics = {
  kind: 'value' | 'media' | 'component' | 'conditioning' | 'latents' | 'state' | 'pipeline' | 'opaque';
  scope: string | null;
  state: string | null;
  owner: 'same_loader' | 'none';
  members: { name: string; type: string }[];
  control?: OperationControl;
  suppliedBy?: { input: string; members: string[] };
};
export type OperationPort = {
  name: string;
  semanticName: string;
  direction: 'input' | 'output';
  roles: ('value' | 'component' | 'pipeline')[];
  types: string[];
  required: boolean;
  hidden: boolean;
  semantics?: OperationSemantics;
};

export type OperationContract = {
  pipelineClass: string;
  task: string | null;
  operationId: string;
  nodeKey: string;
  nodeType: string;
  blockName: string | null;
  decomposition: 'block' | 'bundle' | 'loader' | 'pipeline' | 'integrated';
  support: 'declared';
  ports: OperationPort[];
  workflowId?: string | null;
  binding?: { pipelineClass: string; values: Record<string, string> };
};

export function operationOwnsModel(
  operation: OperationContract | null | undefined,
): operation is OperationContract & { decomposition: 'loader' | 'integrated' } {
  return operation?.decomposition === 'loader' || operation?.decomposition === 'integrated';
}

const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const CONTRACT_KEYS = [
  'pipelineClass',
  'operationId',
  'nodeKey',
  'nodeType',
  'blockName',
  'decomposition',
  'support',
  'ports',
];
const PORT_KEYS = ['name', 'semanticName', 'direction', 'roles', 'types', 'required'];

export function invalid(): never {
  throw new Error('Invalid backend operation contract.');
}

export function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(result, key))
  )
    invalid();
  return result;
}

export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || RESERVED.has(value)) invalid();
  return value;
}

function parsePort(
  value: unknown,
  v2: boolean,
  wholePipeline: boolean,
  v3: boolean,
  scope: string,
  workflowId: string | null,
): OperationPort {
  const item = record(value, [...PORT_KEYS, ...(v2 ? ['hidden'] : []), ...(v3 ? ['semantics'] : [])]);
  const pipelineRole =
    wholePipeline && Array.isArray(item.roles) && item.roles.length === 1 && item.roles[0] === 'pipeline';
  if (
    (item.direction !== 'input' && item.direction !== 'output') ||
    !Array.isArray(item.roles) ||
    item.roles.length === 0 ||
    item.roles.length > 2 ||
    (!pipelineRole && !item.roles.every((role) => role === 'value' || role === 'component')) ||
    new Set(item.roles).size !== item.roles.length ||
    typeof item.required !== 'boolean' ||
    (item.direction === 'output' &&
      (item.required ||
        (!pipelineRole &&
          (item.roles.length !== 1 || (item.roles[0] !== 'value' && !(v3 && item.roles[0] === 'component')))))) ||
    (v2 && typeof item.hidden !== 'boolean') ||
    !Array.isArray(item.types) ||
    item.types.length === 0 ||
    item.types.length > 16
  )
    invalid();
  const types = item.types.map(identifier);
  if (new Set(types).size !== types.length) invalid();
  return {
    name: identifier(item.name),
    semanticName: identifier(item.semanticName),
    direction: item.direction,
    roles: [...item.roles] as OperationPort['roles'],
    types,
    required: item.required,
    hidden: v2 ? (item.hidden as boolean) : false,
    ...(v3 ? { semantics: parseSemantics(item.semantics, scope, workflowId) } : {}),
  };
}

export function boundedText(value: unknown, limit = 2048): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > limit ||
    Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    invalid();
  return value;
}

function parseSemantics(value: unknown, pipeline: string, workflowId: string | null): OperationSemantics {
  const hasControl =
    typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'control');
  const hasSupplier =
    typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'suppliedBy');
  const item = record(value, [
    'kind',
    'scope',
    'state',
    'owner',
    'members',
    ...(hasControl ? ['control'] : []),
    ...(hasSupplier ? ['suppliedBy'] : []),
  ]);
  if (
    !['value', 'media', 'component', 'conditioning', 'latents', 'state', 'pipeline', 'opaque'].includes(
      String(item.kind),
    ) ||
    !['same_loader', 'none'].includes(String(item.owner)) ||
    !Array.isArray(item.members) ||
    item.members.length > 256
  )
    invalid();
  const scoped = !['value', 'media'].includes(String(item.kind));
  if (item.owner !== (scoped && item.kind !== 'opaque' ? 'same_loader' : 'none')) invalid();
  const scope = item.kind === 'state' && workflowId ? `${pipeline}:${workflowId}` : pipeline;
  if (item.scope !== (scoped ? scope : null) || (item.kind !== 'state' && item.state !== null)) invalid();
  const members = item.members.map((value) => {
    const member = record(value, ['name', 'type']);
    return { name: identifier(member.name), type: boundedText(member.type, 1024) };
  });
  if (new Set(members.map((m) => m.name)).size !== members.length) invalid();
  if (hasControl && item.kind !== 'value') invalid();
  let suppliedBy: OperationSemantics['suppliedBy'];
  if (hasSupplier) {
    if (item.kind !== 'component') invalid();
    const supplier = record(item.suppliedBy, ['input', 'members']);
    if (!Array.isArray(supplier.members) || !supplier.members.length || supplier.members.length > 16) invalid();
    const names = supplier.members.map(identifier);
    if (new Set(names).size !== names.length) invalid();
    suppliedBy = { input: identifier(supplier.input), members: names };
  }
  return {
    kind: item.kind as OperationSemantics['kind'],
    scope: item.scope as string | null,
    state: item.state === null ? null : identifier(item.state),
    owner: item.owner as OperationSemantics['owner'],
    members,
    ...(hasControl ? { control: parseControl(item.control, pipeline) } : {}),
    ...(suppliedBy ? { suppliedBy } : {}),
  };
}

function parseControl(value: unknown, pipeline: string): OperationControl {
  const hasNegativePrompt =
    typeof value === 'object' &&
    value !== null &&
    (Object.prototype.hasOwnProperty.call(value, 'negativePromptField') ||
      Object.prototype.hasOwnProperty.call(value, 'negativePromptPolicy'));
  const item = record(value, [
    'technique',
    'parameter',
    'compatibilityScope',
    'scaleMeaning',
    'enabled',
    'enabledField',
    'formulation',
    'formulationField',
    'selectorField',
    'selectorValue',
    'negativeConditioning',
    'negativeConditioningScope',
    ...(hasNegativePrompt ? ['negativePromptField', 'negativePromptPolicy'] : []),
  ]);
  if (
    !['classifier_free', 'embedded_distilled'].includes(String(item.technique)) ||
    !['scale', 'rescale', 'enabled', 'formulation', 'start', 'stop', 'technique'].includes(String(item.parameter)) ||
    !['boolean_field', 'scale_gt_one', 'always', 'model_config'].includes(String(item.enabled)) ||
    !['boolean_field', 'original', 'diffusers', 'embedded'].includes(String(item.formulation)) ||
    !['pipeline_scoped_when_enabled', 'none'].includes(String(item.negativeConditioning))
  )
    invalid();
  const cfg = item.technique === 'classifier_free';
  const negativePromptField = hasNegativePrompt ? identifier(item.negativePromptField) : undefined;
  if (hasNegativePrompt && (!cfg || item.negativePromptPolicy !== 'empty_string_is_condition')) invalid();
  const compatibilityScope = boundedText(item.compatibilityScope, 128);
  compatibilityScope.split('.').forEach(identifier);
  const enabledField = item.enabledField === null ? null : identifier(item.enabledField);
  const formulationField = item.formulationField === null ? null : identifier(item.formulationField);
  const selectorField = item.selectorField === null ? null : identifier(item.selectorField);
  const selectorValue =
    item.selectorValue === null || typeof item.selectorValue === 'boolean'
      ? item.selectorValue
      : identifier(item.selectorValue);
  if (
    ['boolean_field', 'scale_gt_one'].includes(String(item.enabled)) !== (enabledField !== null) ||
    (item.formulation === 'boolean_field') !== (formulationField !== null) ||
    (selectorField === null) !== (selectorValue === null) ||
    (typeof selectorValue === 'string' && selectorValue !== 'ClassifierFreeGuidance')
  )
    invalid();
  if (
    item.scaleMeaning !== (cfg ? 'cfg_prediction_mix' : 'distilled_model_embedding') ||
    item.negativeConditioning !== (cfg ? 'pipeline_scoped_when_enabled' : 'none') ||
    item.negativeConditioningScope !== (cfg ? pipeline : null) ||
    (cfg
      ? item.formulation === 'embedded'
      : item.formulation !== 'embedded' || (selectorField !== null && typeof selectorValue !== 'boolean'))
  )
    invalid();
  return {
    technique: item.technique as OperationControl['technique'],
    parameter: item.parameter as OperationControl['parameter'],
    compatibilityScope,
    scaleMeaning: item.scaleMeaning as OperationControl['scaleMeaning'],
    enabled: item.enabled as OperationControl['enabled'],
    enabledField,
    formulation: item.formulation as OperationControl['formulation'],
    formulationField,
    selectorField,
    selectorValue,
    negativeConditioning: item.negativeConditioning as OperationControl['negativeConditioning'],
    negativeConditioningScope: item.negativeConditioningScope as string | null,
    ...(hasNegativePrompt ? { negativePromptField, negativePromptPolicy: 'empty_string_is_condition' as const } : {}),
  };
}

/**
 * Do not narrow pipeline names through Studio's closed model-family union.
 * Port meaning remains scoped to pipelineClass; matching types/names alone is
 * insufficient to approve a connection, model change or upstream block call.
 */
export function parseOperationContracts(value: unknown, schemaVersion: unknown): OperationContract[] {
  if (value === undefined && schemaVersion === undefined) return [];
  if (
    (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) ||
    !Array.isArray(value) ||
    value.length > 4096
  )
    invalid();
  const v3 = schemaVersion === 3;
  const v2 = schemaVersion === 2 || v3;
  const identities = new Set<string>();
  return value.map((entry): OperationContract => {
    const item = record(entry, [...CONTRACT_KEYS, ...(v2 ? ['task'] : []), ...(v3 ? ['workflowId', 'binding'] : [])]);
    const workflowId = !v3 || item.workflowId === null ? null : identifier(item.workflowId);
    let binding: OperationContract['binding'];
    if (v3) {
      const value = record(item.binding, ['pipelineClass', 'values']);
      if (
        typeof value.values !== 'object' ||
        !value.values ||
        Array.isArray(value.values) ||
        Object.keys(value.values).length > 16
      )
        invalid();
      binding = {
        pipelineClass: identifier(value.pipelineClass),
        values: Object.fromEntries(
          Object.entries(value.values).map(([key, value]) => [identifier(key), identifier(value)]),
        ),
      };
    }
    const pipelineClass = identifier(item.pipelineClass);
    const nodeType = identifier(item.nodeType);
    const task = !v2 || item.task === null ? null : identifier(item.task);
    const wholePipeline =
      v2 &&
      (item.decomposition === 'loader' ||
        item.decomposition === 'pipeline' ||
        (v3 && item.decomposition === 'integrated'));
    if (
      typeof item.operationId !== 'string' ||
      item.operationId.split('.').length !== 2 ||
      typeof item.nodeKey !== 'string' ||
      !item.nodeKey.startsWith('modules.') ||
      item.nodeKey.split('.').length !== 3 ||
      item.support !== 'declared' ||
      (!wholePipeline && item.decomposition !== 'block' && item.decomposition !== 'bundle') ||
      (wholePipeline && (task === null || nodeType !== item.decomposition)) ||
      (item.decomposition === 'block' ? typeof item.blockName !== 'string' : item.blockName !== null) ||
      !Array.isArray(item.ports) ||
      item.ports.length > 128
    )
      invalid();
    item.operationId.split('.').forEach(identifier);
    item.nodeKey.split('.').forEach(identifier);
    const identity = `${pipelineClass}:${item.operationId}:${task ?? ''}`;
    if (identities.has(identity)) invalid();
    identities.add(identity);
    const ports = item.ports.map((port) =>
      parsePort(port, v2, wholePipeline, v3, binding?.pipelineClass ?? pipelineClass, workflowId),
    );
    if (new Set(ports.map((port) => `${port.direction}:${port.name}`)).size !== ports.length) invalid();
    for (const port of ports) {
      const supplier = port.semantics?.suppliedBy;
      if (supplier) {
        const input = ports.find((p) => p.name === supplier.input && p.direction === 'input');
        if (
          port.direction !== 'input' ||
          !port.roles.includes('component') ||
          supplier.input === port.name ||
          !input ||
          !input.roles.includes('component') ||
          input.types.length !== 1 ||
          input.types[0] !== 'diffusers_modular_pipeline_components' ||
          input.semantics?.kind !== 'component' ||
          input.semantics.scope !== port.semantics!.scope ||
          supplier.members.length !== port.semantics!.members.length ||
          !supplier.members.every((name) => {
            const required = port.semantics!.members.find((m) => m.name === name);
            return required && input.semantics!.members.some((m) => m.name === name && m.type === required.type);
          })
        )
          invalid();
      }
      const control = port.semantics?.control;
      if (!control) continue;
      for (const [name, types] of [
        [control.selectorField, typeof control.selectorValue === 'boolean' ? ['bool', 'boolean'] : ['string', 'text']],
        [control.enabledField, control.enabled === 'boolean_field' ? ['bool', 'boolean'] : ['float', 'int', 'number']],
        [control.formulationField, ['bool', 'boolean']],
        [control.negativePromptField ?? null, ['string', 'text']],
      ] as const) {
        if (name === null) continue;
        const referenced = ports.find((p) => p.name === name && p.direction === 'input');
        if (!referenced || !referenced.types.every((type) => (types as readonly string[]).includes(type))) invalid();
      }
    }
    return {
      pipelineClass,
      task,
      operationId: item.operationId,
      nodeKey: item.nodeKey,
      nodeType,
      blockName: item.blockName === null ? null : identifier(item.blockName),
      decomposition: item.decomposition as OperationContract['decomposition'],
      support: item.support,
      ports,
      ...(v3 ? { workflowId, binding } : {}),
    };
  });
}
