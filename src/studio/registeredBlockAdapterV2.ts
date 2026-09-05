import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  canonicalBlockStringifyV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  normalizeBlockInstanceV2,
  type BlockControlV2,
  type BlockDefinitionV2,
  type BlockGraphEdgeV2,
  type BlockGraphNodeV2,
  type BlockGraphNodeModularDiffusersV2,
  type BlockInstanceV2,
  type BlockJsonObject,
  type BlockJsonValue,
  type BlockPortV2,
  type BlockPreviewBindingV2,
} from './blockSchemaV2';
import {
  blockValueTypeMatchesMediaV2,
  blockValueTypesAreCompatibleV2,
  normalizeBlockValueTypeV2,
} from './blockValueTypeCompatibilityV2';
import type { HuggingFaceClusterExecutionSkeleton } from './huggingFaceClusterMaterializer';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryBlockDefinition,
  HuggingFaceNodeLibraryBlockRoleAdapter,
  HuggingFaceNodeLibraryExecutionAdmission,
  HuggingFaceNodeLibraryField,
} from './huggingFaceNodeLibrary';
import type {
  RegisteredBlockV2BoundaryInputBinding,
  RegisteredBlockV2BoundaryOutputBinding,
  RegisteredBlockV2ControlFanOut,
  RegisteredBlockV2ControlFanOutBinding,
  RegisteredBlockV2Route,
} from './registeredBlockV2Routes';
import { reviewedModularGraphV2 } from './reviewedModularGraphV2';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';

type PersistedClusterBinding = {
  schemaVersion: 1;
  admissionId: string;
  source: string;
  persistence: 'instance_input' | 'execution_parameter' | 'sealed';
  input?: string;
};

type BoundField = {
  node: CustomNodeType;
  semanticNodeId: string;
  fieldId: string;
  param: NodeParams;
  binding: PersistedClusterBinding;
};

export type CompileRegisteredBlockV2Options = {
  /** New workflow-owned identity. It does not participate in definition hashes. */
  instanceId: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  expanded?: boolean;
  /** Exact hash-pinned catalog projection; never inferred from a pipeline class. */
  route?: RegisteredBlockV2Route;
  /** Exact reviewed upstream contracts used only by an opted-in Modular route. */
  blockDefinitions?: readonly HuggingFaceNodeLibraryBlockDefinition[];
  /** Backend-published generic executor schema; the client never invents its action contract. */
  reviewedModularStepNodeData?: NodeData;
  /** Exact unpruned upstream hierarchy and reviewed workflow-selection traces. */
  modularConditionalSnapshot?: HuggingFaceModularConditionalSnapshot;
  /** Reviewed semantic roles for exact upstream block contracts. */
  blockRoleAdapters?: readonly HuggingFaceNodeLibraryBlockRoleAdapter[];
};

export type CompiledRegisteredBlockV2 = {
  definition: BlockDefinitionV2;
  instance: BlockInstanceV2;
  /** Useful while migrating external edges from legacy runtime-child ids. */
  semanticNodeIdsByMaterializedNodeId: Record<string, string>;
};

const PREVIEW_MEDIA_BY_DISPLAY: Record<string, BlockPreviewBindingV2['mediaType']> = {
  ui_image: 'image',
  ui_imagecompare: 'image',
  ui_video: 'video',
  ui_audio: 'audio',
  ui_text: 'text',
  ui_file: 'file',
};

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,383}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;

function invalid(message: string): never {
  throw new Error(`Cannot compile registered BlockDefinitionV2: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonValue(value: unknown, label: string, seen = new Set<object>()): BlockJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(`${label} contains a non-finite number.`);
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) invalid(`${label} is not finite JSON.`);
  if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null &&
    !Array.isArray(value)
  )
    invalid(`${label} must contain only plain JSON values.`);
  seen.add(value);
  const result: BlockJsonValue = Array.isArray(value)
    ? value.map((item, index) => jsonValue(item, `${label}[${index}]`, seen))
    : Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          item === undefined ? [] : [[key, jsonValue(item, `${label}.${key}`, seen)]],
        ),
      );
  seen.delete(value);
  return result;
}

function jsonObject(value: Record<string, unknown>, label: string): BlockJsonObject {
  return jsonValue(value, label) as BlockJsonObject;
}

function words(value: string) {
  return value
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function lexicalCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validSemanticId(value: string, label: string) {
  if (!ID.test(value)) invalid(`${label} ${JSON.stringify(value)} cannot be represented as a stable V2 id.`);
  return value;
}

function typeIsMultiple(valueType: string) {
  return /(?:^|[.[])\s*(?:list|tuple|array|sequence)\b/iu.test(valueType);
}

function projectedValueType(value: unknown) {
  const normalized = normalizeBlockValueTypeV2(value);
  if (Array.isArray(normalized)) return normalized.map(String).join('|') || 'any';
  return typeof normalized === 'string' && normalized ? normalized : 'any';
}

function persistedBinding(value: unknown): PersistedClusterBinding | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    typeof value.admissionId !== 'string' ||
    typeof value.source !== 'string' ||
    (value.persistence !== 'instance_input' &&
      value.persistence !== 'execution_parameter' &&
      value.persistence !== 'sealed') ||
    (value.input !== undefined && typeof value.input !== 'string')
  )
    return null;
  return value as PersistedClusterBinding;
}

function semanticFieldOptions(value: unknown) {
  if (!isRecord(value)) return undefined;
  const result = Object.fromEntries(
    Object.entries(value).filter(
      ([key, item]) =>
        item !== undefined &&
        key !== 'suppressInitialFieldAction' &&
        // The legacy materializer receipts are compiler input, not part of the
        // source-neutral V2 graph. Controls, explicit boundary ports, sealed
        // values, and immutable provenance have already been compiled into
        // their canonical V2 fields. Retaining any Cluster-prefixed option
        // would create a stale second binding/admission authority when the
        // graph is later projected as an ordinary block.
        !key.startsWith('huggingFaceCluster'),
    ),
  );
  return Object.keys(result).length ? result : undefined;
}

function semanticParam(param: NodeParams, label: string) {
  const binding = persistedBinding(param.fieldOptions?.huggingFaceClusterBinding);
  const mutableBinding = binding?.persistence === 'instance_input' || binding?.persistence === 'execution_parameter';
  const volatileOutput = param.display === 'output' || Boolean(PREVIEW_MEDIA_BY_DISPLAY[param.display ?? '']);
  const fieldOptions = semanticFieldOptions(param.fieldOptions);
  const semantic: Record<string, unknown> = {};
  const copy = (key: keyof NodeParams) => {
    if (param[key] !== undefined) semantic[key] = param[key];
  };
  copy('type');
  copy('display');
  copy('label');
  copy('default');
  copy('description');
  // A false `disabled` flag is the browser field-action busy-state after an
  // action completes. Some backends omit it while others publish the explicit
  // false, so retaining it would make an identical registered execution
  // contract hash differently depending on timing and cache state. An
  // explicit true remains semantic: it declares that the reviewed field is
  // intentionally unavailable/read-only in the executable graph.
  if (param.disabled === true) semantic.disabled = true;
  copy('hidden');
  copy('required');
  copy('isInput');
  copy('spawn');
  copy('options');
  copy('optionsSource');
  copy('min');
  copy('max');
  copy('step');
  copy('onChange');
  copy('onSignal');
  copy('dataSource');
  if (fieldOptions) semantic.fieldOptions = fieldOptions;
  // Mutable caller values belong exclusively to BlockInstanceV2.values. A
  // generated output/preview is equally instance-local. Sealed and ordinary
  // static values remain part of the reviewed definition graph.
  if (!mutableBinding && !volatileOutput && Object.prototype.hasOwnProperty.call(param, 'value')) {
    semantic.value = param.value;
  }
  return jsonObject(semantic, label);
}

function semanticNodeData(node: CustomNodeType) {
  const params = Object.fromEntries(
    Object.entries(node.data.params)
      .sort(([left], [right]) => lexicalCompare(left, right))
      .map(([fieldId, param]) => [fieldId, semanticParam(param, `node ${node.id}.${fieldId}`)]),
  );
  return jsonObject(
    {
      type: node.data.type,
      module: node.data.module,
      action: node.data.action,
      params,
      ...(node.data.skipParamsCheck === undefined ? {} : { skipParamsCheck: node.data.skipParamsCheck }),
    },
    `node ${node.id} data`,
  );
}

function selectedAdmission(
  definition: HuggingFaceNodeLibraryDefinition,
  skeleton: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceNodeLibraryExecutionAdmission {
  const admission = definition.executionAdmissions.find(({ id }) => id === skeleton.admissionId);
  if (
    !admission ||
    admission.definitionId !== definition.id ||
    admission.status !== 'admitted' ||
    admission.claim !== 'static_graph_contract_compatible' ||
    admission.publication.readiness !== 'graph_qualified' ||
    !admission.publication.insertable ||
    !admission.adapterContractId ||
    !admission.studioExecutionSpec ||
    !admission.artifact ||
    admission.reasons.length
  )
    invalid('the execution skeleton does not belong to an insertable graph-qualified admission.');
  if (
    skeleton.adapterContractId !== admission.adapterContractId ||
    skeleton.studioExecutionSpec.id !== admission.studioExecutionSpec.id ||
    skeleton.studioExecutionSpec.contentHash !== admission.studioExecutionSpec.contentHash ||
    skeleton.studioExecutionSpec.executionProfileId !== admission.studioExecutionSpec.executionProfileId
  )
    invalid('the execution skeleton and admission execution specification disagree.');
  return admission;
}

function validateSkeleton(definition: HuggingFaceNodeLibraryDefinition, skeleton: HuggingFaceClusterExecutionSkeleton) {
  if (
    skeleton.schemaVersion !== 1 ||
    skeleton.definitionId !== definition.id ||
    skeleton.claim !== 'materialized_graph_skeleton' ||
    skeleton.executable !== false ||
    !skeleton.bindingsComplete ||
    skeleton.missingBindingSources.length ||
    skeleton.pendingFields.length
  )
    invalid('the supplied execution skeleton is incomplete or stale.');
  const roles = new Set<string>();
  const nodeIds = new Set<string>();
  skeleton.nodes.forEach((node) => {
    const role = node.data.huggingFaceClusterExecutionRole;
    if (
      !role ||
      node.parentId !== skeleton.instanceId ||
      node.data.huggingFaceClusterRole !== 'execution' ||
      node.data.huggingFaceClusterInstanceId !== skeleton.instanceId ||
      node.data.huggingFaceClusterExecutionAdmissionId !== skeleton.admissionId ||
      node.data.huggingFaceClusterExecutionSpecId !== skeleton.studioExecutionSpec.id ||
      roles.has(role) ||
      nodeIds.has(node.id)
    )
      invalid(`execution node ${node.id} has stale or duplicate semantic ownership.`);
    validSemanticId(role, 'execution role');
    roles.add(role);
    nodeIds.add(node.id);
  });
  const declaredRoleEntries = Object.entries(skeleton.nodeIdsByRole);
  if (
    declaredRoleEntries.length !== roles.size ||
    declaredRoleEntries.some(([role, nodeId]) => {
      const node = skeleton.nodes.find((candidate) => candidate.id === nodeId);
      return !node || node.data.huggingFaceClusterExecutionRole !== role;
    })
  )
    invalid('the execution role receipt does not match the materialized graph.');
  skeleton.edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || !edge.sourceHandle || !edge.targetHandle)
      invalid(`execution edge ${edge.id} has an invalid endpoint or handle.`);
  });
}

function boundFields(skeleton: HuggingFaceClusterExecutionSkeleton, semanticIds: ReadonlyMap<string, string>) {
  return skeleton.nodes.flatMap((node): BoundField[] =>
    Object.entries(node.data.params).flatMap(([fieldId, param]) => {
      const binding = persistedBinding(param.fieldOptions?.huggingFaceClusterBinding);
      if (!binding) return [];
      if (binding.admissionId !== skeleton.admissionId)
        invalid(`binding ${node.id}.${fieldId} belongs to another admission.`);
      return [
        {
          node,
          semanticNodeId: semanticIds.get(node.id)!,
          fieldId,
          param,
          binding,
        },
      ];
    }),
  );
}

type EditableBindingGroup = {
  primary: BoundField;
  mirrors: BoundField[];
};

function bindingTargetKey(field: Pick<BoundField, 'semanticNodeId' | 'fieldId'>) {
  return `${field.semanticNodeId}\0${field.fieldId}`;
}

function reviewedTargetKey(target: { role: string; fieldId: string }) {
  return `${target.role}\0${target.fieldId}`;
}

function editableBindingGroup(
  fields: readonly BoundField[],
  source: string,
  persistence: PersistedClusterBinding['persistence'],
  reviewedFanOuts: readonly RegisteredBlockV2ControlFanOut[],
): EditableBindingGroup {
  // Mutable receipts on output fields are observations of a run, not writable
  // value destinations. They remain in the graph but never become a control or
  // mirror target.
  const matches = fields.filter(
    ({ binding, param }) =>
      binding.source === source && binding.persistence === persistence && param.display !== 'output',
  );
  if (matches.length === 1) {
    if (reviewedFanOuts.some((fanOut) => fanOut.source === source && fanOut.persistence === persistence))
      invalid(`editable binding source ${source} declares fan-out but resolves to one graph field.`);
    return { primary: matches[0]!, mirrors: [] };
  }
  const fanOuts = reviewedFanOuts.filter((fanOut) => fanOut.source === source && fanOut.persistence === persistence);
  if (fanOuts.length !== 1)
    invalid(
      `editable binding source ${source} must resolve through one exact reviewed fan-out; found ${matches.length} graph fields and ${fanOuts.length} declarations.`,
    );
  const fanOut = fanOuts[0]!;
  if (!fanOut.mirrors.length) invalid(`reviewed fan-out ${source} must declare at least one mirror.`);
  const reviewedKeys = [reviewedTargetKey(fanOut.primary), ...fanOut.mirrors.map(reviewedTargetKey)];
  if (new Set(reviewedKeys).size !== reviewedKeys.length)
    invalid(`reviewed fan-out ${source} duplicates its primary or mirror targets.`);
  const mirrorKeys = fanOut.mirrors.map(reviewedTargetKey);
  if (mirrorKeys.some((key, index) => index > 0 && key <= mirrorKeys[index - 1]!))
    invalid(`reviewed fan-out ${source} mirrors are not canonically ordered.`);
  const actualKeys = matches.map(bindingTargetKey);
  if (
    reviewedKeys.length !== actualKeys.length ||
    [...reviewedKeys].sort(lexicalCompare).some((key, index) => key !== [...actualKeys].sort(lexicalCompare)[index])
  )
    invalid(
      `reviewed fan-out ${source} does not exactly match its materialized graph fields ` +
        `(reviewed: ${reviewedKeys.join(', ') || 'none'}; materialized: ${actualKeys.join(', ') || 'none'}).`,
    );
  const byKey = new Map(matches.map((field) => [bindingTargetKey(field), field]));
  const primary = byKey.get(reviewedTargetKey(fanOut.primary));
  if (!primary) invalid(`reviewed fan-out ${source} primary is absent from the materialized graph.`);
  const mirrors = fanOut.mirrors.map((target) => byKey.get(reviewedTargetKey(target))!);
  const primaryType = primary.param.type;
  for (const field of mirrors) {
    if (field.param.display === 'output' || !blockValueTypesAreCompatibleV2(primaryType, field.param.type))
      invalid(`reviewed fan-out ${source} targets an output or incompatible field.`);
  }
  const values = matches.map(actualValue);
  if (
    values.some(
      (value) =>
        (value === undefined) !== (values[0] === undefined) ||
        (value !== undefined &&
          values[0] !== undefined &&
          canonicalBlockStringifyV2(value) !== canonicalBlockStringifyV2(values[0])),
    )
  )
    invalid(`reviewed fan-out ${source} has disagreeing defaults or initial values.`);
  return { primary, mirrors };
}

function actualValue(field: BoundField) {
  if (Object.prototype.hasOwnProperty.call(field.param, 'value') && field.param.value !== undefined)
    return jsonValue(field.param.value, `value for ${field.binding.source}`);
  if (Object.prototype.hasOwnProperty.call(field.param, 'default') && field.param.default !== undefined)
    return jsonValue(field.param.default, `default for ${field.binding.source}`);
  return undefined;
}

function materializedBindingValue(param: NodeParams, value: unknown) {
  if (
    typeof value === 'string' &&
    (param.display === 'modelselect' || (param.value !== null && typeof param.value === 'object'))
  )
    return { source: 'hub', value };
  return value;
}

function validateSealedBindingValues(
  fields: readonly BoundField[],
  admission: HuggingFaceNodeLibraryExecutionAdmission,
) {
  fields
    .filter(({ binding }) => binding.persistence === 'sealed')
    .forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(admission.sealedBindingValues, field.binding.source))
        invalid(`sealed binding ${field.binding.source} is absent from the reviewed admission.`);
      const expected = jsonValue(
        materializedBindingValue(field.param, admission.sealedBindingValues[field.binding.source]),
        `reviewed sealed value for ${field.binding.source}`,
      );
      const actual = actualValue(field);
      if (actual === undefined || canonicalBlockStringifyV2(actual) !== canonicalBlockStringifyV2(expected))
        invalid(`sealed binding ${field.binding.source} disagrees with the reviewed admission.`);
    });
}

function fieldControl(
  group: EditableBindingGroup,
  sourceField: HuggingFaceNodeLibraryField | null,
  order: number,
): BlockControlV2 {
  const field = group.primary;
  const defaultValue = sourceField?.default ?? field.param.default;
  return {
    controlId: sourceField?.name ?? field.binding.source,
    label: words(sourceField?.name ?? field.param.label ?? field.binding.source),
    binding: { nodeId: field.semanticNodeId, fieldId: field.fieldId },
    ...(group.mirrors.length
      ? {
          mirrorBindings: group.mirrors.map(({ semanticNodeId, fieldId }) => ({
            nodeId: semanticNodeId,
            fieldId,
          })),
        }
      : {}),
    valueType: projectedValueType(field.param.type ?? sourceField?.type),
    ...(defaultValue === undefined
      ? {}
      : { defaultValue: jsonValue(defaultValue, `default for ${field.binding.source}`) }),
    ...((sourceField?.required ?? field.param.required) === undefined
      ? {}
      : { required: Boolean(sourceField?.required ?? field.param.required) }),
    order,
    group: sourceField ? 'Inputs' : 'Generation',
    ...(sourceField?.description || field.param.description
      ? { help: sourceField?.description || field.param.description }
      : {}),
  };
}

function inputPort(
  group: EditableBindingGroup,
  sourceField: HuggingFaceNodeLibraryField,
  reviewedBinding?: RegisteredBlockV2BoundaryInputBinding,
): BlockPortV2 {
  const field = group.primary;
  const reviewedInputName = reviewedBinding?.inputName ?? reviewedBinding?.portId;
  if (
    reviewedBinding &&
    (reviewedInputName !== sourceField.name ||
      reviewedBinding.role !== field.semanticNodeId ||
      reviewedBinding.fieldId !== field.fieldId)
  )
    invalid(`registered input projection ${sourceField.name} disagrees with the materialized graph.`);
  const compatible = blockValueTypesAreCompatibleV2(sourceField.type, field.param.type);
  const reviewedMediaType = reviewedBinding?.mediaType;
  const sourceDeclaresReviewedMedia = reviewedMediaType
    ? blockValueTypeMatchesMediaV2(sourceField.type, reviewedMediaType)
    : false;
  const reviewedMediaFilePath =
    reviewedBinding?.adaptation === 'media_file_path' &&
    (reviewedMediaType === 'image' || reviewedMediaType === 'video' || reviewedMediaType === 'audio') &&
    (sourceDeclaresReviewedMedia || typeIsMultiple(String(sourceField.type))) &&
    field.param.display === 'filebrowser' &&
    blockValueTypesAreCompatibleV2(field.param.type, 'string');
  if (!compatible && !reviewedMediaFilePath)
    invalid(`registered input ${sourceField.name} is incompatible with its bound graph field.`);
  return {
    portId: reviewedBinding?.portId ?? sourceField.name,
    label: words(sourceField.name),
    valueType: projectedValueType(
      reviewedMediaFilePath && !sourceDeclaresReviewedMedia
        ? field.param.type
        : reviewedMediaFilePath
          ? sourceField.type
          : (field.param.type ?? sourceField.type),
    ),
    required: sourceField.required,
    ...(typeIsMultiple(sourceField.type) ? { multiple: true } : {}),
    binding: { nodeId: field.semanticNodeId, fieldOrPortId: field.fieldId },
    ...(group.mirrors.length
      ? {
          mirrorBindings: group.mirrors.map(({ semanticNodeId, fieldId }) => ({
            nodeId: semanticNodeId,
            fieldOrPortId: fieldId,
          })),
        }
      : {}),
  };
}

function terminalOutputFields(skeleton: HuggingFaceClusterExecutionSkeleton, semanticIds: ReadonlyMap<string, string>) {
  const nodesById = new Map(skeleton.nodes.map((node) => [node.id, node]));
  const previewNodeIds = new Set(
    skeleton.nodes
      .filter((node) =>
        Object.values(node.data.params).some((param) => Boolean(PREVIEW_MEDIA_BY_DISPLAY[param.display ?? ''])),
      )
      .map(({ id }) => id),
  );
  const consumed = new Set(skeleton.edges.map((edge) => `${edge.source}\0${edge.sourceHandle}`));
  const candidates = skeleton.edges.flatMap((edge) => {
    if (!previewNodeIds.has(edge.target) || !edge.sourceHandle) return [];
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    const param = source?.data.params[edge.sourceHandle];
    const previewMediaType = target
      ? Object.values(target.data.params)
          .map((targetParam) => PREVIEW_MEDIA_BY_DISPLAY[targetParam.display ?? ''])
          .find(Boolean)
      : undefined;
    return source && param
      ? [
          {
            node: source,
            semanticNodeId: semanticIds.get(source.id)!,
            fieldId: edge.sourceHandle,
            param,
            previewMediaType,
          },
        ]
      : [];
  });
  skeleton.nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([fieldId, param]) => {
      if (param.display !== 'output' || consumed.has(`${node.id}\0${fieldId}`)) return;
      candidates.push({ node, semanticNodeId: semanticIds.get(node.id)!, fieldId, param, previewMediaType: undefined });
    });
  });
  return [
    ...new Map(
      candidates.map((candidate) => [`${candidate.semanticNodeId}\0${candidate.fieldId}`, candidate]),
    ).values(),
  ];
}

function outputPorts(
  definition: HuggingFaceNodeLibraryDefinition,
  skeleton: HuggingFaceClusterExecutionSkeleton,
  semanticIds: ReadonlyMap<string, string>,
  reviewedBindings?: readonly RegisteredBlockV2BoundaryOutputBinding[],
) {
  const candidates = terminalOutputFields(skeleton, semanticIds);
  if (reviewedBindings) {
    const definitionOutputs = new Map(definition.outputs.map((output) => [output.name, output]));
    if (
      !reviewedBindings.length ||
      new Set(reviewedBindings.map(({ portId }) => portId)).size !== reviewedBindings.length
    )
      invalid('the reviewed registered output projection is empty or ambiguous.');
    return reviewedBindings.map((binding): BlockPortV2 => {
      const output = definitionOutputs.get(binding.outputName ?? binding.portId);
      const candidate = candidates.find(
        (item) => item.semanticNodeId === binding.role && item.fieldId === binding.fieldId,
      );
      if (!output || !candidate)
        invalid(`reviewed registered output projection ${binding.portId} is absent from the materialized graph.`);
      if (binding.mediaType !== undefined && binding.adaptation === undefined)
        invalid(`registered output ${output.name} must declare an explicit reviewed media adaptation.`);
      if (binding.adaptation !== undefined && binding.mediaType === undefined)
        invalid(`registered output ${output.name} declares a media adaptation without a media type.`);
      const compatibleDeclarations = blockValueTypesAreCompatibleV2(candidate.param.type, output.type);
      const reviewedMediaProjection =
        binding.adaptation === 'direct_media' &&
        binding.mediaType !== undefined &&
        candidate.param.display === 'output' &&
        blockValueTypeMatchesMediaV2([output.name, output.type], binding.mediaType) &&
        blockValueTypeMatchesMediaV2(candidate.param.type, binding.mediaType);
      const reviewedMediaFileExport =
        binding.adaptation === 'media_file_export' &&
        binding.mediaType !== undefined &&
        blockValueTypeMatchesMediaV2([output.name, output.type], binding.mediaType) &&
        candidate.param.display === 'output' &&
        blockValueTypeMatchesMediaV2(candidate.param.type, binding.mediaType) &&
        skeleton.edges.some((edge) => {
          if (edge.target !== candidate.node.id || !edge.targetHandle) return false;
          const input = candidate.node.data.params[edge.targetHandle];
          return input?.display === 'input' && blockValueTypeMatchesMediaV2(input.type, binding.mediaType!);
        });
      if (!compatibleDeclarations && !reviewedMediaProjection && !reviewedMediaFileExport)
        invalid(`registered output ${output.name} is incompatible with its bound graph field.`);
      const valueType = projectedValueType(candidate.param.type ?? output.type);
      return {
        portId: binding.portId,
        label: words(output.name),
        valueType,
        required: output.required,
        ...(typeIsMultiple(valueType) ? { multiple: true } : {}),
        binding: { nodeId: candidate.semanticNodeId, fieldOrPortId: candidate.fieldId },
      };
    });
  }
  const remaining = new Set(candidates);
  return definition.outputs.flatMap((output): BlockPortV2[] => {
    const exact = candidates.find((candidate) => remaining.has(candidate) && candidate.fieldId === output.name);
    const positional = definition.outputs.length === 1 && remaining.size === 1 ? [...remaining][0] : undefined;
    const candidate = exact ?? positional;
    if (!candidate) return [];
    const compatibleDeclarations = blockValueTypesAreCompatibleV2(candidate.param.type, output.type);
    const compatiblePreview =
      exact &&
      candidate.previewMediaType !== undefined &&
      blockValueTypeMatchesMediaV2(candidate.param.type, candidate.previewMediaType) &&
      blockValueTypeMatchesMediaV2(output.type, candidate.previewMediaType);
    if (!compatibleDeclarations && !compatiblePreview)
      invalid(`registered output ${output.name} is incompatible with its bound graph field.`);
    remaining.delete(candidate);
    // The finalized backend field is the executable connector contract. The
    // upstream output type can be a Python union such as PIL/numpy/tensor;
    // after an exact stable-name match, expose the concrete MoDiff socket type
    // instead of leaking that implementation union into the canvas.
    const valueType = projectedValueType(candidate.param.type ?? output.type);
    return [
      {
        portId: output.name,
        label: words(output.name),
        valueType,
        required: output.required,
        ...(typeIsMultiple(valueType) ? { multiple: true } : {}),
        binding: { nodeId: candidate.semanticNodeId, fieldOrPortId: candidate.fieldId },
      },
    ];
  });
}

function previewBindings(skeleton: HuggingFaceClusterExecutionSkeleton, semanticIds: ReadonlyMap<string, string>) {
  const previews: BlockPreviewBindingV2[] = [];
  skeleton.nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([fieldId, param]) => {
      const mediaType = PREVIEW_MEDIA_BY_DISPLAY[param.display ?? ''];
      if (!mediaType) return;
      previews.push({
        nodeId: semanticIds.get(node.id)!,
        outputPortId: fieldId,
        mediaType,
      });
    });
  });
  return previews
    .sort((left, right) =>
      lexicalCompare(`${left.nodeId}\0${left.outputPortId}`, `${right.nodeId}\0${right.outputPortId}`),
    )
    .map((preview, index) => ({ ...preview, ...(index === 0 ? { primary: true } : {}) }));
}

function deterministicExecutionOrder(nodes: readonly BlockGraphNodeV2[], edges: readonly BlockGraphEdgeV2[]) {
  const outgoing = new Map(nodes.map(({ nodeId }) => [nodeId, [] as string[]]));
  const incoming = new Map(nodes.map(({ nodeId }) => [nodeId, 0]));
  edges.forEach(({ sourceNodeId, targetNodeId }) => {
    outgoing.get(sourceNodeId)!.push(targetNodeId);
    incoming.set(targetNodeId, incoming.get(targetNodeId)! + 1);
  });
  outgoing.forEach((targets) => targets.sort(lexicalCompare));
  const ready = nodes
    .map(({ nodeId }) => nodeId)
    .filter((nodeId) => incoming.get(nodeId) === 0)
    .sort(lexicalCompare);
  const ordered: string[] = [];
  while (ready.length) {
    const nodeId = ready.shift()!;
    ordered.push(nodeId);
    outgoing.get(nodeId)!.forEach((targetNodeId) => {
      const remaining = incoming.get(targetNodeId)! - 1;
      incoming.set(targetNodeId, remaining);
      if (remaining === 0) {
        ready.push(targetNodeId);
        ready.sort(lexicalCompare);
      }
    });
  }
  if (ordered.length !== nodes.length) invalid('the registered execution graph contains a cycle.');
  return ordered;
}

function blockGraph(
  skeleton: HuggingFaceClusterExecutionSkeleton,
  semanticIds: ReadonlyMap<string, string>,
  modularMetadata: ReadonlyMap<string, BlockGraphNodeModularDiffusersV2> = new Map(),
) {
  const nodes: BlockGraphNodeV2[] = skeleton.nodes
    .map((node) => {
      const semanticRole = node.data.huggingFaceClusterExecutionRole!;
      const metadata = modularMetadata.get(semanticRole);
      const semanticData = semanticNodeData(node);
      return {
        nodeId: semanticIds.get(node.id)!,
        nodeType: node.type || node.data.type || 'custom',
        semanticRole,
        ...(metadata?.kind === 'upstream_block' ? { upstreamBlockPath: metadata.placementPath!.join('/') } : {}),
        ...(metadata ? { modularDiffusers: metadata } : {}),
        data: metadata
          ? jsonObject(
              {
                ...semanticData,
                label: node.data.label,
                category: node.data.category,
                ...(node.data.description ? { description: node.data.description } : {}),
                resizable: true,
              },
              `node ${node.id} exact data`,
            )
          : semanticData,
      };
    })
    .sort((left, right) => lexicalCompare(left.nodeId, right.nodeId));
  const edges: BlockGraphEdgeV2[] = skeleton.edges
    .map((edge) => {
      const sourceNodeId = semanticIds.get(edge.source)!;
      const targetNodeId = semanticIds.get(edge.target)!;
      const sourcePortId = validSemanticId(edge.sourceHandle!, 'source port');
      const targetPortId = validSemanticId(edge.targetHandle!, 'target port');
      return {
        edgeId: validSemanticId(
          `edge:${sourceNodeId}:${sourcePortId}:${targetNodeId}:${targetPortId}`,
          'execution edge',
        ),
        sourceNodeId,
        sourcePortId,
        targetNodeId,
        targetPortId,
      };
    })
    .sort((left, right) => lexicalCompare(left.edgeId, right.edgeId));
  const unhashed = {
    nodes,
    edges,
    executionOrder: deterministicExecutionOrder(nodes, edges),
  };
  return { ...unhashed, graphHash: blockGraphHashV2(unhashed) };
}

/**
 * Compile one exact registered admission into the common composite contract.
 *
 * The materialized skeleton is used as an execution-schema witness only. Its
 * instance ids, positions, current caller values, previews, progress, and UI
 * state never enter the reusable definition or its canonical hashes.
 */
export function compileRegisteredBlockV2(
  sourceDefinition: HuggingFaceNodeLibraryDefinition,
  sourceSkeleton: HuggingFaceClusterExecutionSkeleton,
  options: CompileRegisteredBlockV2Options,
): CompiledRegisteredBlockV2 {
  const exact =
    options.route?.exactModularGraph &&
    sourceDefinition.provider === 'diffusers' &&
    sourceDefinition.definitionKind === 'modular_pipeline_workflow' &&
    sourceDefinition.blocksClass !== null
      ? reviewedModularGraphV2(
          sourceDefinition,
          sourceSkeleton,
          options.route,
          options.blockDefinitions ?? invalid('the reviewed Modular block registry is unavailable.'),
          options.reviewedModularStepNodeData ?? invalid('the reviewed Modular step executor is unavailable.'),
          options.modularConditionalSnapshot,
          options.blockRoleAdapters,
        )
      : { skeleton: sourceSkeleton, metadataBySemanticRole: new Map<string, BlockGraphNodeModularDiffusersV2>() };
  const skeleton = exact.skeleton;
  validateSkeleton(sourceDefinition, skeleton);
  const admission = selectedAdmission(sourceDefinition, skeleton);
  if (!COMMIT.test(sourceDefinition.libraryRevision) || !COMMIT.test(admission.artifact!.revision))
    invalid('registered library and repository revisions must be immutable 40-character commits.');

  const semanticIds = new Map(
    skeleton.nodes.map((node) => [
      node.id,
      validSemanticId(node.data.huggingFaceClusterExecutionRole!, 'execution role'),
    ]),
  );
  const fields = boundFields(skeleton, semanticIds);
  validateSealedBindingValues(fields, admission);
  const admittedSources = new Set(admission.bindingSources);
  const materializedSources = new Set(fields.map(({ binding }) => binding.source));
  if (
    fields.some(({ binding }) => !admittedSources.has(binding.source)) ||
    admission.bindingSources.some((source) => !materializedSources.has(source))
  )
    invalid('the materialized binding sources do not exactly match the reviewed admission.');
  const inputFieldByName = new Map(sourceDefinition.inputs.map((field) => [field.name, field]));
  // Route data owns the already-reviewed Studio fields while the exact
  // hierarchy projection can discover additional selected upstream leaves.
  // Merge both descriptions into one declaration per logical source. A plain
  // replacement would lose legitimate Studio consumers (for example an
  // exporter FPS field); concatenation would create competing authorities.
  const reviewedFanOutGroups = new Map<string, RegisteredBlockV2ControlFanOut[]>();
  for (const fanOut of [...(options.route?.controlFanOuts ?? []), ...(exact.controlFanOuts ?? [])]) {
    const key = `${fanOut.persistence}\0${fanOut.source}`;
    reviewedFanOutGroups.set(key, [...(reviewedFanOutGroups.get(key) ?? []), fanOut]);
  }
  const reviewedFanOuts = [...reviewedFanOutGroups.values()].map((fanOuts) => {
    // Preserve the route's reviewed primary because public boundary inputs may
    // explicitly bind to it. Exact hierarchy discovery only extends mirrors.
    const primary = fanOuts[0]!.primary;
    const primaryKey = reviewedTargetKey(primary);
    const targets = new Map<string, RegisteredBlockV2ControlFanOutBinding>();
    fanOuts.forEach((fanOut) => {
      [fanOut.primary, ...fanOut.mirrors].forEach((target) => targets.set(reviewedTargetKey(target), target));
    });
    targets.delete(primaryKey);
    return {
      source: fanOuts[0]!.source,
      persistence: fanOuts[0]!.persistence,
      primary,
      mirrors: [...targets.values()].sort((left, right) =>
        lexicalCompare(reviewedTargetKey(left), reviewedTargetKey(right)),
      ),
    };
  });
  const inputBindings = sourceDefinition.inputs.flatMap((field) => {
    const admitted = admission.instanceInputBindings.find(({ input }) => input === field.name);
    return admitted
      ? [[field, editableBindingGroup(fields, admitted.bindingSource, 'instance_input', reviewedFanOuts)] as const]
      : [];
  });
  const executionBindings = admission.executionParameterSources.map((source) =>
    editableBindingGroup(fields, source, 'execution_parameter', reviewedFanOuts),
  );
  const expectedFanOutKeys = [
    ...inputBindings.flatMap(([, group]) =>
      group.mirrors.length ? [`instance_input\0${group.primary.binding.source}`] : [],
    ),
    ...executionBindings.flatMap((group) =>
      group.mirrors.length ? [`execution_parameter\0${group.primary.binding.source}`] : [],
    ),
  ];
  const reviewedFanOutKeys = reviewedFanOuts.map(({ persistence, source }) => `${persistence}\0${source}`);
  if (
    new Set(reviewedFanOutKeys).size !== reviewedFanOutKeys.length ||
    reviewedFanOutKeys.length !== expectedFanOutKeys.length ||
    [...reviewedFanOutKeys]
      .sort(lexicalCompare)
      .some((key, index) => key !== [...expectedFanOutKeys].sort(lexicalCompare)[index])
  )
    invalid(
      'the reviewed control fan-out declarations do not exactly match mutable duplicate sources ' +
        `(reviewed: ${reviewedFanOutKeys.join(', ') || 'none'}; ` +
        `materialized: ${expectedFanOutKeys.join(', ') || 'none'}).`,
    );
  const controls = [
    ...inputBindings.map(([field, binding], order) => fieldControl(binding, field, order)),
    ...executionBindings.map((binding, index) => fieldControl(binding, null, inputBindings.length + index)),
  ];
  const controlIds = new Set<string>();
  controls.forEach(({ controlId }) => {
    if (controlIds.has(controlId)) invalid(`control id ${controlId} is ambiguous.`);
    validSemanticId(controlId, 'control id');
    controlIds.add(controlId);
  });

  const graph = blockGraph(skeleton, semanticIds, exact.metadataBySemanticRole);
  const reviewedInputBindings = new Map(
    (options.route?.boundary.inputs ?? []).map((binding) => [binding.inputName ?? binding.portId, binding]),
  );
  if (
    options.route &&
    (reviewedInputBindings.size !== (options.route.boundary.inputs ?? []).length ||
      new Set((options.route.boundary.inputs ?? []).map(({ portId }) => portId)).size !==
        (options.route.boundary.inputs ?? []).length ||
      [...reviewedInputBindings].some(([inputName]) => !inputBindings.some(([field]) => field.name === inputName)))
  )
    invalid('the reviewed registered input projection is ambiguous or targets an unexposed input.');
  const boundaryInputs = inputBindings.map(([field, binding]) =>
    inputPort(binding, field, reviewedInputBindings.get(field.name)),
  );
  const boundaryOutputs = outputPorts(
    sourceDefinition,
    skeleton,
    semanticIds,
    exact.boundaryOutputs ?? options.route?.boundary.outputs,
  );
  if (!options.route && sourceDefinition.outputs.length && boundaryOutputs.length !== sourceDefinition.outputs.length)
    invalid('the declared registered outputs cannot be mapped exactly to the materialized graph.');
  const previews = previewBindings(skeleton, semanticIds);
  const suggestedInputs = sourceDefinition.suggestedInputs
    ? [
        {
          suggestionId: 'creator-example',
          label: sourceDefinition.suggestedInputs.source.label,
          ...(sourceDefinition.suggestedInputs.source.url
            ? { source: sourceDefinition.suggestedInputs.source.url }
            : {}),
          values: Object.fromEntries(
            Object.entries(sourceDefinition.suggestedInputs.values).map(([fieldName, value]) => {
              if (!controlIds.has(fieldName) || !inputFieldByName.has(fieldName))
                invalid(`suggested creator input ${fieldName} does not target an exposed registered control.`);
              return [fieldName, jsonValue(value, `suggested creator input ${fieldName}`)];
            }),
          ),
        },
      ]
    : undefined;

  const source = {
    kind:
      sourceDefinition.provider === 'diffusers' ? ('diffusers_catalog' as const) : ('transformers_catalog' as const),
    catalogCategory: sourceDefinition.provider,
    provider: sourceDefinition.publisher,
    library: sourceDefinition.provider,
    libraryRevision: sourceDefinition.libraryRevision,
    pipelineClass: sourceDefinition.pipelineClass,
    blocksClass: sourceDefinition.blocksClass,
    workflow: sourceDefinition.workflowId,
    manifestDefinitionId: sourceDefinition.id,
    manifestContentHash: sourceDefinition.contentHash,
    executionAdmissionId: admission.id,
    repository: admission.artifact!.repo,
    repositoryRevision: admission.artifact!.revision,
  };
  const unhashedDefinition: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId: validSemanticId(admission.id, 'registered definition id'),
    displayName: sourceDefinition.label,
    ...(sourceDefinition.description ? { description: sourceDefinition.description } : {}),
    source,
    graph,
    boundary: { mode: 'explicit', inputs: boundaryInputs, outputs: boundaryOutputs },
    controls,
    ...(suggestedInputs ? { suggestedInputs } : {}),
    previews,
    ownership: { kind: 'registered', definitionMutable: false },
  };
  const definition = normalizeBlockDefinitionV2({
    ...unhashedDefinition,
    contentHash: blockDefinitionContentHashV2(unhashedDefinition),
  });

  const values = Object.fromEntries(
    [...inputBindings.map(([, group]) => group.primary), ...executionBindings.map(({ primary }) => primary)].flatMap(
      (field) => {
        const value = actualValue(field);
        const controlId = field.binding.input ?? field.binding.source;
        return value === undefined ? [] : [[controlId, value]];
      },
    ),
  );
  const internalLayout = Object.fromEntries(
    skeleton.nodes.map((node) => {
      const width = node.measured?.width ?? node.width;
      const height = node.measured?.height ?? node.height;
      return [
        semanticIds.get(node.id)!,
        {
          x: node.position.x,
          y: node.position.y,
          ...(typeof width === 'number' && Number.isFinite(width) && width > 0 ? { width } : {}),
          ...(typeof height === 'number' && Number.isFinite(height) && height > 0 ? { height } : {}),
        },
      ];
    }),
  );
  const created = createBlockInstanceV2(definition, {
    instanceId: options.instanceId,
    position: options.position ?? { x: 0, y: 0 },
    size: options.size ?? { width: 360, height: 320 },
    values,
    internalLayout,
    ...(exact.metadataBySemanticRole.size ? { internalLayoutMode: 'hierarchical' as const } : {}),
    // These are the reviewed admission's compiler-materialized starter
    // values, not workflow edits made after insertion.
    baselineValues: true,
  });
  const instance = normalizeBlockInstanceV2({
    ...created,
    presentation: { ...created.presentation, expanded: options.expanded ?? false },
  });
  return {
    definition,
    instance,
    semanticNodeIdsByMaterializedNodeId: Object.fromEntries(semanticIds),
  };
}
