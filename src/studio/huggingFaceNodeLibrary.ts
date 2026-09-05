export type HuggingFaceNodeLibraryIntegrationStatus =
  | 'reviewed_modiff_contract'
  | 'reviewed_modular_workflow_route'
  | 'reviewed_diffusers_composite'
  | 'reviewed_transformers_contract'
  | 'contract_only'
  | 'equivalent_standard_route';

export type HuggingFaceNodeLibraryProvider = 'diffusers' | 'transformers';

export type HuggingFaceNodeLibraryField = {
  name: string;
  type: string;
  required: boolean;
  default: unknown;
  description: string;
};

export type HuggingFaceNodeLibraryComponent = {
  name: string;
  type: string;
  creationMethod: string;
  reuseKey: string[];
};

export type HuggingFaceNodeLibraryStep = {
  path: string;
  className: string;
  kind: 'auto' | 'sequential' | 'loop' | 'block';
  description: string;
};

export type HuggingFaceNodeLibraryBlockField = HuggingFaceNodeLibraryField & {
  kwargsType: string | null;
};

export type HuggingFaceNodeLibraryVariadicInput = {
  kwargsType: string;
  type: string;
  required: boolean;
  default: unknown;
  description: string;
};

export type HuggingFaceNodeLibraryBlockComponent = {
  name: string;
  type: string;
  description: string;
  creationMethod: string;
  defaultConfig: unknown;
};

export type HuggingFaceNodeLibraryBlockConfig = {
  name: string;
  default: unknown;
  description: string;
};

export type HuggingFaceNodeLibraryBlockDefinition = {
  schemaVersion: 1;
  provider: HuggingFaceNodeLibraryProvider;
  id: string;
  className: string;
  kind: 'auto' | 'conditional' | 'sequential' | 'loop' | 'block';
  description: string;
  inputs: HuggingFaceNodeLibraryBlockField[];
  variadicInputs: HuggingFaceNodeLibraryVariadicInput[];
  requiredInputs: string[];
  outputs: HuggingFaceNodeLibraryBlockField[];
  components: HuggingFaceNodeLibraryBlockComponent[];
  configs: HuggingFaceNodeLibraryBlockConfig[];
  contentHash: string;
};

export type HuggingFaceNodeLibraryBlockPlacement = {
  path: string[];
  legacyPath: string;
  order: number;
  blockDefinitionId: string;
};

export type HuggingFaceNodeLibraryBlockRole =
  | 'workflow'
  | 'text_encoder'
  | 'vae_encoder'
  | 'image_encoder'
  | 'video_encoder'
  | 'semantic_generator'
  | 'prompt_transform'
  | 'duration'
  | 'condition_encoder'
  | 'reference_encoder'
  | 'before_encode'
  | 'denoise'
  | 'decoder'
  | 'after_decode';

export type HuggingFaceNodeLibraryBlockRoleAdapter = {
  schemaVersion: 1;
  id: string;
  blockDefinitionId: string;
  role: HuggingFaceNodeLibraryBlockRole;
  adapterKind: 'workflow_root' | 'pipeline_state_block';
  executionClaim: 'structural_adapter_only';
};

export type HuggingFaceNodeLibraryContainerStateAdapter = {
  schemaVersion: 1;
  id: string;
  blockDefinitionId: string;
  className: string;
  containerKind: 'loop';
  iteration: {
    input: string;
    cardinality: 'value' | 'length';
    index: 'k';
  };
  stateInitializers: Array<{
    name: string;
    operation: 'empty_list' | 'none' | 'none_if_missing';
  }>;
  publishedState: string[];
  progressSemantics: 'container_default' | 'steps_per_iteration';
  executionClaim: 'container_state_adapter_only';
};

export type HuggingFaceNodeLibraryGraphAdapterStateEdge = {
  producerAction: string;
  producerOutput: string;
  consumerAction: string;
  consumerInput: string;
};

export type HuggingFaceNodeLibraryGraphAdapterContract = {
  schemaVersion: 1;
  id: string;
  source: 'mode' | 'state_flow' | 'workflow';
  adapterId: string;
  upstreamWorkflowId: string;
  requiredInputs: string[];
  actionSequence: string[];
  stateEdges: HuggingFaceNodeLibraryGraphAdapterStateEdge[];
  upstreamBlockSequence: string[];
};

export type HuggingFaceNodeLibraryExecutionAdmission = {
  schemaVersion: 4;
  id: string;
  definitionId: string;
  studioMode: string;
  bindingSources: string[];
  instanceInputBindings: Array<{
    bindingSource: string;
    input: string;
  }>;
  executionParameterSources: string[];
  sealedBindingValues: Record<string, string | boolean | number>;
  modelDependencies: Array<{
    id: string;
    kind: string;
    repo: string;
    revision: string;
  }>;
  dynamicFieldActions: Array<{
    role: string;
    field: string;
    event: 'onChange' | 'onSignal';
    valueSource: string;
  }>;
  adapterContractId: string | null;
  studioExecutionSpec: {
    id: string;
    contentHash: string;
    executionProfileId: string;
  } | null;
  artifact: {
    repo: string;
    revision: string;
  } | null;
  status: 'admitted' | 'rejected';
  claim: 'static_graph_contract_compatible' | 'rejected';
  executable: false;
  publication: {
    schemaVersion: 1;
    readiness: 'catalog_only' | 'graph_qualified';
    insertable: boolean;
    executable: false;
    autoEligible: false;
    liveProof: boolean;
    reasons: Array<{ code: string; message: string }>;
  };
  reasons: Array<{ code: string; message: string }>;
};

export type HuggingFaceNodeLibraryDefinition = {
  schemaVersion: 5 | 6;
  id: string;
  provider: HuggingFaceNodeLibraryProvider;
  publisher: 'huggingface';
  surface: 'diffusers_cluster_nodes' | 'transformers_cluster_nodes';
  definitionKind: 'modular_pipeline_workflow' | 'studio_execution_composite';
  ownership: 'library';
  mutable: false;
  libraryRevision: string;
  pipelineClass: string;
  blocksClass: string;
  pipelineKind: 'auto' | 'sequential' | 'loop' | 'block';
  workflowId: string;
  workflowKind: 'auto' | 'sequential' | 'loop' | 'block';
  taskId: string;
  taskContractId: string;
  label: string;
  description: string;
  integrationStatus: HuggingFaceNodeLibraryIntegrationStatus;
  executionClaim: 'discovery_only';
  executionAdmissions: HuggingFaceNodeLibraryExecutionAdmission[];
  graphAdapterContracts: HuggingFaceNodeLibraryGraphAdapterContract[];
  inputs: HuggingFaceNodeLibraryField[];
  outputs: HuggingFaceNodeLibraryField[];
  requiredInputs: string[];
  requiredInputAlternatives: string[][];
  stateKeys: string[];
  components: HuggingFaceNodeLibraryComponent[];
  steps: HuggingFaceNodeLibraryStep[];
  blockContractHash: string;
  rootBlockDefinitionId: string;
  blockPlacements: HuggingFaceNodeLibraryBlockPlacement[];
  suggestedInputs?: {
    schemaVersion: 1;
    values: Record<string, unknown>;
    source: {
      kind: 'publisher_example' | 'modiff_task_starter';
      label: string;
      url: string;
    };
  };
  contentHash: string;
};

export type HuggingFaceNodeLibraryTaskContract = {
  schemaVersion: 5 | 6;
  id: string;
  provider: HuggingFaceNodeLibraryProvider;
  taskId: string;
  label: string;
  definitionIds: string[];
};

export type HuggingFaceNodeLibrary = {
  schemaVersion: 5 | 6;
  diffusersRevision: string;
  providers: HuggingFaceNodeLibraryProvider[];
  taskContracts: HuggingFaceNodeLibraryTaskContract[];
  definitions: HuggingFaceNodeLibraryDefinition[];
  blockDefinitions: HuggingFaceNodeLibraryBlockDefinition[];
  blockRoleAdapters: HuggingFaceNodeLibraryBlockRoleAdapter[];
  containerStateAdapters: HuggingFaceNodeLibraryContainerStateAdapter[];
};

const IMMUTABLE_REVISION = /^[0-9a-f]{40}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/;
const DEFINITION_ID =
  /^(?:diffusers\.(?:modular|composite)|transformers\.composite):[A-Za-z_][A-Za-z0-9_]{0,127}:[A-Za-z_][A-Za-z0-9_.-]{0,255}$/;
const TASK_CONTRACT_ID = /^(?:diffusers|transformers)\.task\.[A-Za-z_][A-Za-z0-9_.-]{0,255}\.v1$/;
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const BLOCK_DEFINITION_ID =
  /^(?:diffusers\.(?:modular-block|composite-block)|transformers\.composite-block):[A-Za-z_][A-Za-z0-9_]{0,255}:sha256:[0-9a-f]{64}$/;
const BLOCK_ROLE_ADAPTER_ID = /^diffusers\.modular-block-role:[A-Za-z_][A-Za-z0-9_]{0,255}:sha256:[0-9a-f]{64}$/;
const CONTAINER_STATE_ADAPTER_ID =
  /^diffusers\.modular-container-state:[A-Za-z_][A-Za-z0-9_]{0,255}:sha256:[0-9a-f]{64}$/;
const GRAPH_ADAPTER_ID =
  /^(?:diffusers\.modular-adapter:[A-Za-z_][A-Za-z0-9_]{0,255}:[A-Za-z_][A-Za-z0-9_.-]{0,255}:(?:mode|state_flow|workflow):[A-Za-z_][A-Za-z0-9_.-]{0,255}|(?:diffusers|transformers)\.composite-adapter:[A-Za-z_][A-Za-z0-9_]{0,255}:[A-Za-z_][A-Za-z0-9_.-]{0,255})$/;
const CLUSTER_ADMISSION_ID =
  /^(?:diffusers\.cluster-admission:[A-Za-z_][A-Za-z0-9_]{0,255}:[A-Za-z_][A-Za-z0-9_.-]{0,255}:(?:mode|state_flow|workflow):[A-Za-z_][A-Za-z0-9_.-]{0,255}|transformers\.cluster-admission:[A-Za-z_][A-Za-z0-9_]{0,255}:[A-Za-z_][A-Za-z0-9_.-]{0,255})$/;
const STUDIO_SPEC_HASH = /^studio-spec-v1-[0-9a-f]{8}$/;
const BLOCK_KINDS = new Set(['auto', 'conditional', 'sequential', 'loop', 'block']);
const INTEGRATION_STATUSES = new Set([
  'reviewed_modiff_contract',
  'reviewed_modular_workflow_route',
  'reviewed_diffusers_composite',
  'reviewed_transformers_contract',
  'contract_only',
  'equivalent_standard_route',
]);
const MAX_TASK_CONTRACTS = 256;
const MAX_DEFINITIONS = 512;
const MAX_BLOCK_DEFINITIONS = 2048;
const MAX_BLOCK_ROLE_ADAPTERS = 2048;
const MAX_CONTAINER_STATE_ADAPTERS = 64;
const MAX_FIELDS = 512;
const MAX_STEPS = 1024;
const MAX_PLACEMENTS = 2048;
const MAX_PATH_DEPTH = 64;
const MAX_ADAPTERS = 64;
const BLOCK_ROLES = new Set<HuggingFaceNodeLibraryBlockRole>([
  'workflow',
  'text_encoder',
  'vae_encoder',
  'image_encoder',
  'video_encoder',
  'semantic_generator',
  'prompt_transform',
  'duration',
  'condition_encoder',
  'reference_encoder',
  'before_encode',
  'denoise',
  'decoder',
  'after_decode',
]);
const SEALED_EXECUTION_BINDING_SOURCES = new Set([
  'artifact',
  'pipelineClass',
  'executionProfileId',
  'defaultRevision',
  'kind',
  'repo',
  'revision',
  'empty',
  'true',
  'false',
  'addAlpha',
  'removeAlpha',
  'ordinary',
  'fp16',
  'classifierFreeGuidance',
  'controlnetKind',
  'controlnetLoadClass',
  'controlnetRepo',
  'controlnetRevision',
  'controlnetRouteVariant',
  'controlnetWeightVariant',
  'ipAdapterRepo',
  'ipAdapterRevision',
  'ipAdapterWeightName',
  'adapterWeightName',
  'anyToAnyText',
  'anyToAnyImage',
  'transcribe',
  'translate',
  'mode',
  'defaultWorkflow',
  'workflowId',
  'semanticGeneratorBlock',
  'workflowBeforeEncodeBlock',
  'workflowTextEncoderBlock',
  'workflowImageEncoderBlock',
  'workflowImageEmbeddingsBlock',
  'workflowVaeEncoderBlock',
  'workflowDenoiseBlock',
  'workflowDecodeBlock',
  'workflowAfterDecodeBlock',
  'distilledSteps4',
  'distilledGuidance1',
  'oneFrame',
  'oneVideo',
  'sampleRate44100',
]);
const MAX_JSON_COLLECTION = 256;
const MAX_JSON_DEPTH = 8;

function invalid(): never {
  throw new Error('Invalid Hugging Face node-library contract.');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function boundedText(value: unknown, pattern?: RegExp, maximum = 1024): string {
  if (typeof value !== 'string' || !value || value.length > maximum || (pattern && !pattern.test(value))) invalid();
  return value;
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum) invalid();
  return value;
}

function jsonValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) invalid();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_COLLECTION) invalid();
    return value.map((item) => jsonValue(item, depth + 1));
  }
  if (!record(value) || Object.keys(value).length > MAX_JSON_COLLECTION) invalid();
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (key.length > 256) invalid();
      return [key, jsonValue(item, depth + 1)];
    }),
  );
}

function uniqueStrings(value: unknown, pattern = IDENTIFIER, maximum = MAX_FIELDS): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  const result = value.map((item) => boundedText(item, pattern, 256));
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function fields(value: unknown): HuggingFaceNodeLibraryField[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  const names = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, ['name', 'type', 'required', 'default', 'description']) ||
      typeof item.required !== 'boolean'
    )
      invalid();
    const name = boundedText(item.name, IDENTIFIER, 256);
    if (names.has(name)) invalid();
    names.add(name);
    return {
      name,
      type: boundedText(item.type, undefined, 256),
      required: item.required,
      default: item.default,
      description:
        typeof item.description === 'string' && item.description.length <= 1024 ? item.description : invalid(),
    };
  });
}

function blockFields(value: unknown): HuggingFaceNodeLibraryBlockField[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, ['name', 'type', 'required', 'default', 'description', 'kwargsType']) ||
      typeof item.required !== 'boolean' ||
      (item.kwargsType !== null && (typeof item.kwargsType !== 'string' || !IDENTIFIER.test(item.kwargsType)))
    )
      invalid();
    return {
      name: boundedText(item.name, IDENTIFIER, 256),
      type: boundedText(item.type, undefined, 256),
      required: item.required,
      default: jsonValue(item.default),
      description: boundedString(item.description, 1024),
      kwargsType: item.kwargsType as string | null,
    };
  });
}

function variadicInputs(value: unknown): HuggingFaceNodeLibraryVariadicInput[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  const kwargsTypes = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, ['kwargsType', 'type', 'required', 'default', 'description']) ||
      typeof item.required !== 'boolean'
    )
      invalid();
    const kwargsType = boundedText(item.kwargsType, IDENTIFIER, 256);
    if (kwargsTypes.has(kwargsType)) invalid();
    kwargsTypes.add(kwargsType);
    return {
      kwargsType,
      type: boundedText(item.type, undefined, 256),
      required: item.required,
      default: jsonValue(item.default),
      description: boundedString(item.description, 1024),
    };
  });
}

function blockComponents(value: unknown): HuggingFaceNodeLibraryBlockComponent[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  const names = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !exactKeys(item, ['name', 'type', 'description', 'creationMethod', 'defaultConfig']))
      invalid();
    const name = boundedText(item.name, IDENTIFIER, 256);
    if (names.has(name)) invalid();
    names.add(name);
    return {
      name,
      type: boundedText(item.type, undefined, 256),
      description: boundedString(item.description, 1024),
      creationMethod: boundedString(item.creationMethod, 64),
      defaultConfig: jsonValue(item.defaultConfig),
    };
  });
}

function blockConfigs(value: unknown): HuggingFaceNodeLibraryBlockConfig[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  const names = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !exactKeys(item, ['name', 'default', 'description'])) invalid();
    const name = boundedText(item.name, IDENTIFIER, 256);
    if (names.has(name)) invalid();
    names.add(name);
    return {
      name,
      default: jsonValue(item.default),
      description: boundedString(item.description, 1024),
    };
  });
}

export function parseHuggingFaceNodeLibraryBlockDefinition(value: unknown): HuggingFaceNodeLibraryBlockDefinition {
  const provider = record(value) && value.provider === 'transformers' ? 'transformers' : 'diffusers';
  const standardComposite =
    record(value) && typeof value.id === 'string' && value.id.startsWith('diffusers.composite-block:');
  const expectedKeys = [
    'schemaVersion',
    ...(provider === 'transformers' || standardComposite ? ['provider'] : []),
    'id',
    'className',
    'kind',
    'description',
    'inputs',
    'variadicInputs',
    'requiredInputs',
    'outputs',
    'components',
    'configs',
    'contentHash',
  ];
  if (
    !record(value) ||
    !exactKeys(value, expectedKeys) ||
    value.schemaVersion !== 1 ||
    (standardComposite && value.provider !== 'diffusers') ||
    typeof value.kind !== 'string' ||
    !BLOCK_KINDS.has(value.kind)
  )
    invalid();
  const className = boundedText(value.className, IDENTIFIER, 256);
  const contentHash = boundedText(value.contentHash, CONTENT_HASH, 71);
  const id = boundedText(value.id, BLOCK_DEFINITION_ID, 384);
  const expectedId =
    provider === 'transformers'
      ? `transformers.composite-block:${className}:${contentHash}`
      : standardComposite
        ? `diffusers.composite-block:${className}:${contentHash}`
        : `diffusers.modular-block:${className}:${contentHash}`;
  if (id !== expectedId) invalid();
  return {
    schemaVersion: 1,
    provider,
    id,
    className,
    kind: value.kind as HuggingFaceNodeLibraryBlockDefinition['kind'],
    description: boundedString(value.description, 1024),
    inputs: blockFields(value.inputs),
    variadicInputs: variadicInputs(value.variadicInputs),
    requiredInputs: uniqueStrings(value.requiredInputs),
    outputs: blockFields(value.outputs),
    components: blockComponents(value.components),
    configs: blockConfigs(value.configs),
    contentHash,
  };
}

function blockRoleAdapters(
  value: unknown,
  blockDefinitionsById: Map<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceNodeLibraryBlockRoleAdapter[] {
  if (!Array.isArray(value) || value.length > MAX_BLOCK_ROLE_ADAPTERS) invalid();
  const ids = new Set<string>();
  const blockIds = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, ['schemaVersion', 'id', 'blockDefinitionId', 'role', 'adapterKind', 'executionClaim']) ||
      item.schemaVersion !== 1 ||
      typeof item.role !== 'string' ||
      !BLOCK_ROLES.has(item.role as HuggingFaceNodeLibraryBlockRole) ||
      item.executionClaim !== 'structural_adapter_only'
    )
      invalid();
    const role = item.role as HuggingFaceNodeLibraryBlockRole;
    const id = boundedText(item.id, BLOCK_ROLE_ADAPTER_ID, 384);
    const blockDefinitionId = boundedText(item.blockDefinitionId, BLOCK_DEFINITION_ID, 384);
    const block = blockDefinitionsById.get(blockDefinitionId);
    const expectedKind = role === 'workflow' ? 'workflow_root' : 'pipeline_state_block';
    const contentHash = blockDefinitionId.slice(blockDefinitionId.lastIndexOf('sha256:'));
    if (
      !block ||
      block.provider !== 'diffusers' ||
      item.adapterKind !== expectedKind ||
      id !== `diffusers.modular-block-role:${role}:${contentHash}` ||
      ids.has(id) ||
      blockIds.has(blockDefinitionId)
    )
      invalid();
    ids.add(id);
    blockIds.add(blockDefinitionId);
    return {
      schemaVersion: 1,
      id,
      blockDefinitionId,
      role,
      adapterKind: expectedKind,
      executionClaim: 'structural_adapter_only',
    };
  });
}

function containerStateAdapters(
  value: unknown,
  blockDefinitionsById: Map<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceNodeLibraryContainerStateAdapter[] {
  if (!Array.isArray(value) || value.length > MAX_CONTAINER_STATE_ADAPTERS) invalid();
  const ids = new Set<string>();
  const blockIds = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, [
        'schemaVersion',
        'id',
        'blockDefinitionId',
        'className',
        'containerKind',
        'iteration',
        'stateInitializers',
        'publishedState',
        'progressSemantics',
        'executionClaim',
      ]) ||
      item.schemaVersion !== 1 ||
      item.containerKind !== 'loop' ||
      item.executionClaim !== 'container_state_adapter_only' ||
      !record(item.iteration) ||
      !exactKeys(item.iteration, ['input', 'cardinality', 'index']) ||
      (item.iteration.cardinality !== 'value' && item.iteration.cardinality !== 'length') ||
      item.iteration.index !== 'k' ||
      (item.progressSemantics !== 'container_default' && item.progressSemantics !== 'steps_per_iteration') ||
      !Array.isArray(item.stateInitializers) ||
      item.stateInitializers.length > MAX_FIELDS
    )
      invalid();
    const className = boundedText(item.className, IDENTIFIER, 256);
    const id = boundedText(item.id, CONTAINER_STATE_ADAPTER_ID, 384);
    const blockDefinitionId = boundedText(item.blockDefinitionId, BLOCK_DEFINITION_ID, 384);
    const block = blockDefinitionsById.get(blockDefinitionId);
    const iterationInput = boundedText(item.iteration.input, IDENTIFIER, 256);
    const initializerNames = new Set<string>();
    const stateInitializers = item.stateInitializers.map((initializer) => {
      if (
        !record(initializer) ||
        !exactKeys(initializer, ['name', 'operation']) ||
        (initializer.operation !== 'empty_list' &&
          initializer.operation !== 'none' &&
          initializer.operation !== 'none_if_missing')
      )
        invalid();
      const name = boundedText(initializer.name, IDENTIFIER, 256);
      const operation =
        initializer.operation as HuggingFaceNodeLibraryContainerStateAdapter['stateInitializers'][number]['operation'];
      if (initializerNames.has(name)) invalid();
      initializerNames.add(name);
      return { name, operation };
    });
    const publishedState = uniqueStrings(item.publishedState);
    const contentHash = blockDefinitionId.slice(blockDefinitionId.lastIndexOf('sha256:'));
    if (
      !block ||
      block.provider !== 'diffusers' ||
      block.kind !== 'loop' ||
      block.className !== className ||
      !block.inputs.some((field) => field.name === iterationInput) ||
      publishedState.some((name) => !initializerNames.has(name)) ||
      id !== `diffusers.modular-container-state:${className}:${contentHash}` ||
      ids.has(id) ||
      blockIds.has(blockDefinitionId)
    )
      invalid();
    ids.add(id);
    blockIds.add(blockDefinitionId);
    return {
      schemaVersion: 1,
      id,
      blockDefinitionId,
      className,
      containerKind: 'loop',
      iteration: {
        input: iterationInput,
        cardinality: item.iteration.cardinality,
        index: 'k',
      },
      stateInitializers,
      publishedState,
      progressSemantics: item.progressSemantics,
      executionClaim: 'container_state_adapter_only',
    };
  });
}

function components(value: unknown): HuggingFaceNodeLibraryComponent[] {
  if (!Array.isArray(value) || value.length > MAX_FIELDS) invalid();
  const names = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !exactKeys(item, ['name', 'type', 'creationMethod', 'reuseKey'])) invalid();
    const name = boundedText(item.name, IDENTIFIER, 256);
    if (names.has(name)) invalid();
    names.add(name);
    return {
      name,
      type: boundedText(item.type, undefined, 256),
      creationMethod:
        typeof item.creationMethod === 'string' && item.creationMethod.length <= 64 ? item.creationMethod : invalid(),
      reuseKey: uniqueStrings(item.reuseKey, IDENTIFIER, 16),
    };
  });
}

function steps(value: unknown): HuggingFaceNodeLibraryStep[] {
  if (!Array.isArray(value) || value.length > MAX_STEPS) invalid();
  const paths = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !exactKeys(item, ['path', 'className', 'kind', 'description'])) invalid();
    const path = boundedText(item.path, IDENTIFIER, 256);
    if (paths.has(path) || typeof item.kind !== 'string' || !BLOCK_KINDS.has(item.kind)) invalid();
    paths.add(path);
    return {
      path,
      className: boundedText(item.className, IDENTIFIER, 256),
      kind: item.kind as HuggingFaceNodeLibraryStep['kind'],
      description:
        typeof item.description === 'string' && item.description.length <= 1024 ? item.description : invalid(),
    };
  });
}

function blockPlacements(
  value: unknown,
  parsedSteps: HuggingFaceNodeLibraryStep[],
  definitionsById: Map<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceNodeLibraryBlockPlacement[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PLACEMENTS) invalid();
  const paths = new Set<string>();
  const legacyPaths = new Set<string>();
  const ordersByParent = new Map<string, number[]>();
  const placements = value.map((item) => {
    if (!record(item) || !exactKeys(item, ['path', 'legacyPath', 'order', 'blockDefinitionId'])) invalid();
    if (!Array.isArray(item.path) || !item.path.length || item.path.length > MAX_PATH_DEPTH) invalid();
    const path = item.path.map((segment) => boundedText(segment, IDENTIFIER, 256));
    const pathKey = JSON.stringify(path);
    const legacyPath = boundedText(item.legacyPath, IDENTIFIER, 256);
    if (paths.has(pathKey) || legacyPaths.has(legacyPath) || legacyPath !== path.join('.')) invalid();
    paths.add(pathKey);
    legacyPaths.add(legacyPath);
    if (!Number.isInteger(item.order) || (item.order as number) < 0) invalid();
    const parentKey = JSON.stringify(path.slice(0, -1));
    ordersByParent.set(parentKey, [...(ordersByParent.get(parentKey) ?? []), item.order as number]);
    const blockDefinitionId = boundedText(item.blockDefinitionId, BLOCK_DEFINITION_ID, 384);
    if (!definitionsById.has(blockDefinitionId)) invalid();
    return { path, legacyPath, order: item.order as number, blockDefinitionId };
  });

  placements.forEach((placement) => {
    if (placement.path.length > 1 && !paths.has(JSON.stringify(placement.path.slice(0, -1)))) invalid();
  });
  ordersByParent.forEach((orders) => {
    if ([...orders].sort((left, right) => left - right).some((order, index) => order !== index)) invalid();
  });

  const stepsByPath = new Map(parsedSteps.map((step) => [step.path, step]));
  if (stepsByPath.size !== placements.length) invalid();
  placements.forEach((placement) => {
    const step = stepsByPath.get(placement.legacyPath);
    const block = definitionsById.get(placement.blockDefinitionId);
    if (
      !step ||
      !block ||
      step.className !== block.className ||
      step.kind !== block.kind ||
      step.description !== block.description
    )
      invalid();
    const hasChild = placements.some(
      (candidate) =>
        candidate.path.length === placement.path.length + 1 &&
        placement.path.every((segment, index) => candidate.path[index] === segment),
    );
    if (!hasChild) {
      const inputNames = new Set(block.inputs.map((field) => field.name));
      if (block.requiredInputs.some((name) => !inputNames.has(name))) invalid();
    }
  });
  return placements;
}

function alternatives(value: unknown): string[][] {
  if (!Array.isArray(value) || value.length > 32) invalid();
  return value.map((item) => uniqueStrings(item));
}

function graphAdapterContracts(
  value: unknown,
  provider: HuggingFaceNodeLibraryProvider,
  standardDiffusersComposite: boolean,
  pipelineClass: string,
  workflowId: string,
  inputNames: Set<string>,
): HuggingFaceNodeLibraryGraphAdapterContract[] {
  if (!Array.isArray(value) || value.length > MAX_ADAPTERS) invalid();
  const ids = new Set<string>();
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, [
        'schemaVersion',
        'id',
        'source',
        'adapterId',
        'upstreamWorkflowId',
        'requiredInputs',
        'actionSequence',
        'stateEdges',
        'upstreamBlockSequence',
      ]) ||
      item.schemaVersion !== 1 ||
      (item.source !== 'mode' && item.source !== 'state_flow' && item.source !== 'workflow') ||
      item.upstreamWorkflowId !== workflowId
    )
      invalid();
    const adapterId = boundedText(item.adapterId, IDENTIFIER, 256);
    const id = boundedText(item.id, GRAPH_ADAPTER_ID, 1024);
    const expectedId =
      provider === 'transformers'
        ? `transformers.composite-adapter:${pipelineClass}:${workflowId}`
        : standardDiffusersComposite
          ? `diffusers.composite-adapter:${pipelineClass}:${workflowId}`
          : `diffusers.modular-adapter:${pipelineClass}:${workflowId}:${item.source}:${adapterId}`;
    if (
      id !== expectedId ||
      ((provider === 'transformers' || standardDiffusersComposite) && adapterId !== workflowId) ||
      ids.has(id)
    )
      invalid();
    ids.add(id);
    const requiredInputs = uniqueStrings(item.requiredInputs);
    const actionSequence = uniqueStrings(item.actionSequence);
    const actions = new Set(actionSequence);
    if (!actionSequence.length || requiredInputs.some((name) => !inputNames.has(name))) invalid();
    if (!Array.isArray(item.stateEdges) || item.stateEdges.length > MAX_FIELDS) invalid();
    const stateEdges = item.stateEdges.map((edge) => {
      if (!record(edge) || !exactKeys(edge, ['producerAction', 'producerOutput', 'consumerAction', 'consumerInput']))
        invalid();
      const parsed = {
        producerAction: boundedText(edge.producerAction, IDENTIFIER, 256),
        producerOutput: boundedText(edge.producerOutput, IDENTIFIER, 256),
        consumerAction: boundedText(edge.consumerAction, IDENTIFIER, 256),
        consumerInput: boundedText(edge.consumerInput, IDENTIFIER, 256),
      };
      if (!actions.has(parsed.producerAction) || !actions.has(parsed.consumerAction)) invalid();
      return parsed;
    });
    return {
      schemaVersion: 1,
      id,
      source: item.source,
      adapterId,
      upstreamWorkflowId: workflowId,
      requiredInputs,
      actionSequence,
      stateEdges,
      upstreamBlockSequence: uniqueStrings(item.upstreamBlockSequence, IDENTIFIER, MAX_STEPS),
    };
  });
}

function executionAdmissions(
  value: unknown,
  provider: HuggingFaceNodeLibraryProvider,
  definitionId: string,
  pipelineClass: string,
  workflowId: string,
  inputNames: Set<string>,
  adapters: HuggingFaceNodeLibraryGraphAdapterContract[],
): HuggingFaceNodeLibraryExecutionAdmission[] {
  if (!Array.isArray(value) || value.length > MAX_ADAPTERS) invalid();
  const ids = new Set<string>();
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  return value.map((item) => {
    if (
      !record(item) ||
      !exactKeys(item, [
        'schemaVersion',
        'id',
        'definitionId',
        'studioMode',
        'bindingSources',
        'instanceInputBindings',
        'executionParameterSources',
        'sealedBindingValues',
        'modelDependencies',
        'dynamicFieldActions',
        'adapterContractId',
        'studioExecutionSpec',
        'artifact',
        'status',
        'claim',
        'executable',
        'publication',
        'reasons',
      ]) ||
      item.schemaVersion !== 4 ||
      item.definitionId !== definitionId ||
      item.executable !== false ||
      (item.status !== 'admitted' && item.status !== 'rejected') ||
      (item.claim !== 'static_graph_contract_compatible' && item.claim !== 'rejected') ||
      (item.status === 'admitted' && item.claim !== 'static_graph_contract_compatible') ||
      (item.status === 'rejected' && item.claim !== 'rejected')
    )
      invalid();
    const id = boundedText(item.id, CLUSTER_ADMISSION_ID, 1024);
    if (ids.has(id)) invalid();
    ids.add(id);
    const adapterContractId =
      item.adapterContractId === null ? null : boundedText(item.adapterContractId, GRAPH_ADAPTER_ID, 1024);
    if (adapterContractId !== null && !adapterIds.has(adapterContractId)) invalid();
    const studioMode = boundedText(item.studioMode, IDENTIFIER, 256);
    const bindingSources = uniqueStrings(item.bindingSources);
    const bindingSourceSet = new Set(bindingSources);
    if (!Array.isArray(item.instanceInputBindings) || item.instanceInputBindings.length > MAX_FIELDS) invalid();
    const mappedSources = new Set<string>();
    const instanceInputBindings = item.instanceInputBindings.map((binding) => {
      if (!record(binding) || !exactKeys(binding, ['bindingSource', 'input'])) invalid();
      const bindingSource = boundedText(binding.bindingSource, IDENTIFIER, 256);
      const input = boundedText(binding.input, IDENTIFIER, 256);
      if (!bindingSourceSet.has(bindingSource) || !inputNames.has(input) || mappedSources.has(bindingSource)) invalid();
      mappedSources.add(bindingSource);
      // One public instance input may intentionally fan out to multiple exact
      // internal binding sources (for example height + optionalHeight). The
      // source identity remains unique and every target still has to name a
      // declared definition input.
      return { bindingSource, input };
    });
    const executionParameterSources = uniqueStrings(item.executionParameterSources);
    if (
      executionParameterSources.some(
        (source) =>
          !bindingSourceSet.has(source) || mappedSources.has(source) || SEALED_EXECUTION_BINDING_SOURCES.has(source),
      )
    )
      invalid();
    if (!record(item.sealedBindingValues) || Object.keys(item.sealedBindingValues).length > MAX_FIELDS) invalid();
    const sealedBindingValues = Object.fromEntries(
      Object.entries(item.sealedBindingValues).map(([source, value]) => {
        if (
          !bindingSourceSet.has(source) ||
          !SEALED_EXECUTION_BINDING_SOURCES.has(source) ||
          (typeof value !== 'boolean' &&
            (typeof value === 'number'
              ? !Number.isSafeInteger(value)
              : typeof value !== 'string' || value.length > 512))
        )
          invalid();
        return [source, value];
      }),
    ) as Record<string, string | boolean | number>;
    const requiredSealedSources = bindingSources.filter((source) => SEALED_EXECUTION_BINDING_SOURCES.has(source));
    if (
      item.status === 'admitted' &&
      requiredSealedSources.some((source) => !Object.prototype.hasOwnProperty.call(sealedBindingValues, source))
    )
      invalid();
    if (!Array.isArray(item.modelDependencies) || item.modelDependencies.length > MAX_FIELDS) invalid();
    const dependencyIds = new Set<string>();
    const modelDependencies = item.modelDependencies.map((dependency) => {
      if (!record(dependency) || !exactKeys(dependency, ['id', 'kind', 'repo', 'revision'])) invalid();
      const parsed = {
        id: boundedText(dependency.id, IDENTIFIER, 256),
        kind: boundedText(dependency.kind, IDENTIFIER, 256),
        repo: boundedText(dependency.repo, undefined, 512),
        revision: boundedText(dependency.revision, IMMUTABLE_REVISION, 40),
      };
      if (dependencyIds.has(parsed.id)) invalid();
      dependencyIds.add(parsed.id);
      return parsed;
    });
    if (!Array.isArray(item.dynamicFieldActions) || item.dynamicFieldActions.length > MAX_FIELDS) invalid();
    const dynamicActionFields = new Set<string>();
    const dynamicFieldActions = item.dynamicFieldActions.map((action) => {
      if (
        !record(action) ||
        !exactKeys(action, ['role', 'field', 'event', 'valueSource']) ||
        (action.event !== 'onChange' && action.event !== 'onSignal')
      )
        invalid();
      const parsed = {
        role: boundedText(action.role, IDENTIFIER, 256),
        field: boundedText(action.field, IDENTIFIER, 256),
        event: action.event as 'onChange' | 'onSignal',
        valueSource: boundedText(action.valueSource, IDENTIFIER, 256),
      };
      const identity = `${parsed.role}\0${parsed.field}\0${parsed.event}`;
      if (dynamicActionFields.has(identity) || !bindingSourceSet.has(parsed.valueSource)) invalid();
      dynamicActionFields.add(identity);
      return parsed;
    });
    const expectedPrefix =
      provider === 'transformers'
        ? `transformers.cluster-admission:${pipelineClass}:${workflowId}`
        : `diffusers.cluster-admission:${pipelineClass}:${workflowId}:`;
    if (provider === 'transformers' ? id !== expectedPrefix : !id.startsWith(expectedPrefix)) invalid();
    if (adapterContractId !== null && provider === 'diffusers') {
      const adapter = adapters.find((candidate) => candidate.id === adapterContractId);
      if (!adapter || id !== `${expectedPrefix}${adapter.source}:${adapter.adapterId}`) invalid();
    } else if (adapterContractId !== null && !adapterIds.has(adapterContractId)) {
      invalid();
    }

    let studioExecutionSpec: HuggingFaceNodeLibraryExecutionAdmission['studioExecutionSpec'] = null;
    if (item.studioExecutionSpec !== null) {
      if (
        !record(item.studioExecutionSpec) ||
        !exactKeys(item.studioExecutionSpec, ['id', 'contentHash', 'executionProfileId'])
      )
        invalid();
      studioExecutionSpec = {
        id: boundedText(item.studioExecutionSpec.id, undefined, 512),
        contentHash: boundedText(item.studioExecutionSpec.contentHash, STUDIO_SPEC_HASH, 64),
        executionProfileId: boundedText(item.studioExecutionSpec.executionProfileId, undefined, 256),
      };
    }

    let artifact: HuggingFaceNodeLibraryExecutionAdmission['artifact'] = null;
    if (item.artifact !== null) {
      if (!record(item.artifact) || !exactKeys(item.artifact, ['repo', 'revision'])) invalid();
      artifact = {
        repo: boundedText(item.artifact.repo, undefined, 512),
        revision: boundedText(item.artifact.revision, IMMUTABLE_REVISION, 40),
      };
    }

    if (!Array.isArray(item.reasons) || item.reasons.length > MAX_FIELDS) invalid();
    const reasons = item.reasons.map((reason) => {
      if (!record(reason) || !exactKeys(reason, ['code', 'message'])) invalid();
      return {
        code: boundedText(reason.code, IDENTIFIER, 256),
        message: boundedText(reason.message, undefined, 1024),
      };
    });
    if (
      (item.status === 'admitted' && (!adapterContractId || !studioExecutionSpec || !artifact || reasons.length)) ||
      (item.status === 'rejected' && !reasons.length)
    )
      invalid();
    if (
      !record(item.publication) ||
      !exactKeys(item.publication, [
        'schemaVersion',
        'readiness',
        'insertable',
        'executable',
        'autoEligible',
        'liveProof',
        'reasons',
      ]) ||
      item.publication.schemaVersion !== 1 ||
      (item.publication.readiness !== 'catalog_only' && item.publication.readiness !== 'graph_qualified') ||
      typeof item.publication.insertable !== 'boolean' ||
      item.publication.executable !== false ||
      item.publication.autoEligible !== false ||
      typeof item.publication.liveProof !== 'boolean' ||
      !Array.isArray(item.publication.reasons) ||
      item.publication.reasons.length < 1 ||
      item.publication.reasons.length > MAX_FIELDS ||
      (item.status === 'admitted' &&
        (item.publication.readiness !== 'graph_qualified' || item.publication.insertable !== true)) ||
      (item.status === 'rejected' &&
        (item.publication.readiness !== 'catalog_only' || item.publication.insertable !== false))
    )
      invalid();
    const publicationReasons = item.publication.reasons.map((reason) => {
      if (!record(reason) || !exactKeys(reason, ['code', 'message'])) invalid();
      return {
        code: boundedText(reason.code, IDENTIFIER, 256),
        message: boundedText(reason.message, undefined, 1024),
      };
    });
    return {
      schemaVersion: 4,
      id,
      definitionId,
      studioMode,
      bindingSources,
      instanceInputBindings,
      executionParameterSources,
      sealedBindingValues,
      modelDependencies,
      dynamicFieldActions,
      adapterContractId,
      studioExecutionSpec,
      artifact,
      status: item.status,
      claim: item.claim,
      executable: false,
      publication: {
        schemaVersion: 1,
        readiness: item.publication.readiness,
        insertable: item.publication.insertable,
        executable: false,
        autoEligible: false,
        liveProof: item.publication.liveProof,
        reasons: publicationReasons,
      },
      reasons,
    };
  });
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  children.forEach((child) => deepFreeze(child));
  return Object.freeze(value) as T;
}

function definition(
  value: unknown,
  revision: string,
  blockDefinitionsById: Map<string, HuggingFaceNodeLibraryBlockDefinition>,
): HuggingFaceNodeLibraryDefinition {
  if (!record(value) || (value.schemaVersion !== 5 && value.schemaVersion !== 6)) invalid();
  const definitionSchemaVersion = value.schemaVersion;
  if (
    !exactKeys(value, [
      'schemaVersion',
      'id',
      'provider',
      'publisher',
      'surface',
      'definitionKind',
      'ownership',
      'mutable',
      'libraryRevision',
      'pipelineClass',
      'blocksClass',
      'pipelineKind',
      'workflowId',
      'workflowKind',
      'taskId',
      'taskContractId',
      'label',
      'description',
      'integrationStatus',
      'executionClaim',
      'executionAdmissions',
      'graphAdapterContracts',
      'inputs',
      'outputs',
      'requiredInputs',
      'requiredInputAlternatives',
      'stateKeys',
      'components',
      'steps',
      'blockContractHash',
      'rootBlockDefinitionId',
      'blockPlacements',
      ...(definitionSchemaVersion === 6 ? ['suggestedInputs'] : []),
      'contentHash',
    ])
  )
    invalid();
  const provider = value.provider;
  if (provider !== 'diffusers' && provider !== 'transformers') invalid();
  const expectedSurface = provider === 'diffusers' ? 'diffusers_cluster_nodes' : 'transformers_cluster_nodes';
  const standardDiffusersComposite = provider === 'diffusers' && value.definitionKind === 'studio_execution_composite';
  const expectedKind =
    provider === 'diffusers' && !standardDiffusersComposite
      ? 'modular_pipeline_workflow'
      : 'studio_execution_composite';
  if (
    value.publisher !== 'huggingface' ||
    value.surface !== expectedSurface ||
    value.definitionKind !== expectedKind ||
    value.ownership !== 'library' ||
    value.mutable !== false ||
    (provider === 'diffusers'
      ? value.libraryRevision !== revision
      : typeof value.libraryRevision !== 'string' || !IMMUTABLE_REVISION.test(value.libraryRevision)) ||
    value.executionClaim !== 'discovery_only' ||
    typeof value.pipelineKind !== 'string' ||
    !BLOCK_KINDS.has(value.pipelineKind) ||
    typeof value.workflowKind !== 'string' ||
    !BLOCK_KINDS.has(value.workflowKind) ||
    typeof value.integrationStatus !== 'string' ||
    !INTEGRATION_STATUSES.has(value.integrationStatus)
  )
    invalid();
  const id = boundedText(value.id, DEFINITION_ID, 512);
  const pipelineClass = boundedText(value.pipelineClass, IDENTIFIER, 256);
  const workflowId = boundedText(value.workflowId, IDENTIFIER, 256);
  const taskId = boundedText(value.taskId, IDENTIFIER, 256);
  const taskContractId = boundedText(value.taskContractId, TASK_CONTRACT_ID, 512);
  const definitionPrefix =
    provider === 'transformers'
      ? 'transformers.composite'
      : standardDiffusersComposite
        ? 'diffusers.composite'
        : 'diffusers.modular';
  if (id !== `${definitionPrefix}:${pipelineClass}:${workflowId}` || taskContractId !== `${provider}.task.${taskId}.v1`)
    invalid();
  const parsedInputs = fields(value.inputs);
  const inputNames = new Set(parsedInputs.map((item) => item.name));
  let suggestedInputs: HuggingFaceNodeLibraryDefinition['suggestedInputs'];
  if (definitionSchemaVersion === 6) {
    if (
      !record(value.suggestedInputs) ||
      !exactKeys(value.suggestedInputs, ['schemaVersion', 'values', 'source']) ||
      value.suggestedInputs.schemaVersion !== 1 ||
      !record(value.suggestedInputs.values) ||
      !record(value.suggestedInputs.source) ||
      !exactKeys(value.suggestedInputs.source, ['kind', 'label', 'url']) ||
      (value.suggestedInputs.source.kind !== 'publisher_example' &&
        value.suggestedInputs.source.kind !== 'modiff_task_starter')
    )
      invalid();
    const values = jsonValue(value.suggestedInputs.values);
    if (!record(values) || Object.keys(values).some((name) => !inputNames.has(name))) invalid();
    suggestedInputs = {
      schemaVersion: 1,
      values,
      source: {
        kind: value.suggestedInputs.source.kind,
        label: boundedText(value.suggestedInputs.source.label, undefined, 512),
        url: boundedString(value.suggestedInputs.source.url, 2048),
      },
    };
  }
  const requiredInputs = uniqueStrings(value.requiredInputs);
  const requiredInputAlternatives = alternatives(value.requiredInputAlternatives);
  const parsedSteps = steps(value.steps);
  const rootBlockDefinitionId = boundedText(value.rootBlockDefinitionId, BLOCK_DEFINITION_ID, 384);
  const rootBlock = blockDefinitionsById.get(rootBlockDefinitionId);
  if (!rootBlock || rootBlock.kind !== value.workflowKind || rootBlock.provider !== provider) invalid();
  const parsedBlockPlacements = blockPlacements(value.blockPlacements, parsedSteps, blockDefinitionsById);
  if (
    parsedBlockPlacements.some(
      (placement) => blockDefinitionsById.get(placement.blockDefinitionId)?.provider !== provider,
    )
  )
    invalid();
  const parsedGraphAdapterContracts = graphAdapterContracts(
    value.graphAdapterContracts,
    provider,
    standardDiffusersComposite,
    pipelineClass,
    workflowId,
    inputNames,
  );
  if (
    requiredInputs.some((name) => !inputNames.has(name)) ||
    requiredInputAlternatives.some((names) => names.some((name) => !inputNames.has(name)))
  )
    invalid();
  return {
    schemaVersion: definitionSchemaVersion,
    id,
    provider,
    publisher: 'huggingface',
    surface: expectedSurface,
    definitionKind: expectedKind,
    ownership: 'library',
    mutable: false,
    libraryRevision: boundedText(value.libraryRevision, IMMUTABLE_REVISION, 40),
    pipelineClass,
    blocksClass: boundedText(value.blocksClass, IDENTIFIER, 256),
    pipelineKind: value.pipelineKind as HuggingFaceNodeLibraryDefinition['pipelineKind'],
    workflowId,
    workflowKind: value.workflowKind as HuggingFaceNodeLibraryDefinition['workflowKind'],
    taskId,
    taskContractId,
    label: boundedText(value.label, undefined, 512),
    description:
      typeof value.description === 'string' && value.description.length <= 1024 ? value.description : invalid(),
    integrationStatus: value.integrationStatus as HuggingFaceNodeLibraryIntegrationStatus,
    executionClaim: 'discovery_only',
    executionAdmissions: executionAdmissions(
      value.executionAdmissions,
      provider,
      id,
      pipelineClass,
      workflowId,
      inputNames,
      parsedGraphAdapterContracts,
    ),
    graphAdapterContracts: parsedGraphAdapterContracts,
    inputs: parsedInputs,
    outputs: fields(value.outputs),
    requiredInputs,
    requiredInputAlternatives,
    stateKeys: uniqueStrings(value.stateKeys),
    components: components(value.components),
    steps: parsedSteps,
    blockContractHash: boundedText(value.blockContractHash, CONTENT_HASH, 71),
    rootBlockDefinitionId,
    blockPlacements: parsedBlockPlacements,
    ...(suggestedInputs ? { suggestedInputs } : {}),
    contentHash: boundedText(value.contentHash, CONTENT_HASH, 71),
  };
}

function taskContract(value: unknown, schemaVersion: 5 | 6): HuggingFaceNodeLibraryTaskContract {
  if (!record(value) || !exactKeys(value, ['schemaVersion', 'id', 'provider', 'taskId', 'label', 'definitionIds']))
    invalid();
  const taskId = boundedText(value.taskId, IDENTIFIER, 256);
  const id = boundedText(value.id, TASK_CONTRACT_ID, 512);
  const provider = value.provider;
  if (
    value.schemaVersion !== schemaVersion ||
    (provider !== 'diffusers' && provider !== 'transformers') ||
    id !== `${provider}.task.${taskId}.v1`
  )
    invalid();
  return {
    schemaVersion,
    id,
    provider,
    taskId,
    label: boundedText(value.label, undefined, 256),
    definitionIds: uniqueStrings(value.definitionIds, DEFINITION_ID, MAX_DEFINITIONS),
  };
}

export function parseHuggingFaceNodeLibrary(value: unknown): HuggingFaceNodeLibrary {
  if (
    !record(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'diffusersRevision',
      'providers',
      'taskContracts',
      'definitions',
      'blockDefinitions',
      'blockRoleAdapters',
      'containerStateAdapters',
    ])
  )
    invalid();
  const schemaVersion = value.schemaVersion;
  if (
    (schemaVersion !== 5 && schemaVersion !== 6) ||
    !Array.isArray(value.providers) ||
    !(
      (value.providers.length === 1 && value.providers[0] === 'diffusers') ||
      (value.providers.length === 2 && value.providers[0] === 'diffusers' && value.providers[1] === 'transformers')
    ) ||
    !Array.isArray(value.taskContracts) ||
    !value.taskContracts.length ||
    value.taskContracts.length > MAX_TASK_CONTRACTS ||
    !Array.isArray(value.definitions) ||
    !value.definitions.length ||
    value.definitions.length > MAX_DEFINITIONS ||
    !Array.isArray(value.blockDefinitions) ||
    !value.blockDefinitions.length ||
    value.blockDefinitions.length > MAX_BLOCK_DEFINITIONS ||
    !Array.isArray(value.blockRoleAdapters) ||
    value.blockRoleAdapters.length > MAX_BLOCK_ROLE_ADAPTERS ||
    !Array.isArray(value.containerStateAdapters) ||
    value.containerStateAdapters.length > MAX_CONTAINER_STATE_ADAPTERS
  )
    invalid();
  const diffusersRevision = boundedText(value.diffusersRevision, IMMUTABLE_REVISION, 40);
  const blockDefinitions = value.blockDefinitions.map(parseHuggingFaceNodeLibraryBlockDefinition);
  const blockDefinitionsById = new Map(blockDefinitions.map((item) => [item.id, item]));
  if (blockDefinitionsById.size !== blockDefinitions.length) invalid();
  const parsedBlockRoleAdapters = blockRoleAdapters(value.blockRoleAdapters, blockDefinitionsById);
  const parsedContainerStateAdapters = containerStateAdapters(value.containerStateAdapters, blockDefinitionsById);
  const definitions = value.definitions.map((item) => definition(item, diffusersRevision, blockDefinitionsById));
  const definitionIds = new Set(definitions.map((item) => item.id));
  if (definitionIds.size !== definitions.length) invalid();
  const taskContracts = value.taskContracts.map((item) => taskContract(item, schemaVersion));
  const taskContractIds = new Set(taskContracts.map((item) => item.id));
  if (taskContractIds.size !== taskContracts.length) invalid();

  const covered = new Set<string>();
  taskContracts.forEach((contract) => {
    contract.definitionIds.forEach((definitionId) => {
      const member = definitions.find((candidate) => candidate.id === definitionId);
      if (
        !member ||
        member.provider !== contract.provider ||
        member.taskContractId !== contract.id ||
        member.taskId !== contract.taskId ||
        covered.has(definitionId)
      )
        invalid();
      covered.add(definitionId);
    });
  });
  if (covered.size !== definitions.length || definitions.some((item) => !taskContractIds.has(item.taskContractId)))
    invalid();
  const referencedBlockIds = new Set(
    definitions.flatMap((item) => [
      item.rootBlockDefinitionId,
      ...item.blockPlacements.map((placement) => placement.blockDefinitionId),
    ]),
  );
  if (
    referencedBlockIds.size !== blockDefinitions.length ||
    blockDefinitions.some((item) => !referencedBlockIds.has(item.id))
  )
    invalid();
  return deepFreeze({
    schemaVersion,
    diffusersRevision,
    providers: [...value.providers] as HuggingFaceNodeLibraryProvider[],
    taskContracts,
    definitions,
    blockDefinitions,
    blockRoleAdapters: parsedBlockRoleAdapters,
    containerStateAdapters: parsedContainerStateAdapters,
  });
}
