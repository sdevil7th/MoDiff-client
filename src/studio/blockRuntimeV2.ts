import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { remapOperationAuthoring } from '../workflow/operationSharedInputs';
import { blockCrossingParamV2, parseBlockCrossingHandleV2 } from './blockCrossingConnectionsV2';
import {
  blockGraphHashV2,
  blockGraphParentIdsV2,
  blockGraphSubtreeNodeIdsV2,
  blockModularContainerNodeIdsV2,
  blockInterfaceHashV2,
  blockInstanceValueV2,
  blockInstancePreviewBindingsV2,
  canonicalBlockStringifyV2,
  normalizeBlockInstanceV2,
  type BlockGraphEdgeV2,
  type BlockGraphNodeV2,
  type BlockBoundaryV2,
  type BlockControlV2,
  type BlockGraphV2,
  type BlockInstanceV2,
  type BlockJsonValue,
  type BlockPortV2,
  type BlockPreviewStateV2,
  type BlockSourceV2,
  type SuggestedInputSetV2,
} from './blockSchemaV2';
import {
  blockMediaFileBoundaryIsCompatibleV2,
  blockValueTypeMatchesMediaV2,
  blockValueTypesAreCompatibleV2,
} from './blockValueTypeCompatibilityV2';
import {
  blockContainerControlTargetsV1,
  blockContainerFieldValueV1,
  blockContainerInterfaceV1,
  blockContainerPortTargetsV1,
  remapBlockContainerInterfaceV1,
} from './blockContainerInterfaceV1';

/**
 * Pure runtime projection/reducer for the common composite-node contract.
 *
 * This module does not own React rendering or catalog registration.
 * `BlockInstanceV2` is the only authority;
 * every root field, child node, connector, control, and edge returned here is
 * a replaceable projection of that instance.
 */

export type BlockFlowGraphV2 = {
  nodes: CustomNodeType[];
  edges: Edge[];
};

export type BlockConnectorParamsV2 = {
  inputs: Record<string, NodeParams>;
  outputs: Record<string, NodeParams>;
};

export type BlockViewModelV2 = {
  instanceId: string;
  definitionId: string;
  definitionContentHash: string;
  displayName: string;
  description?: string;
  category: string;
  source: BlockSourceV2;
  ownership: BlockInstanceV2['definitionSnapshot']['ownership'];
  customization: BlockInstanceV2['customization'];
  expanded: boolean;
  position: BlockInstanceV2['presentation']['position'];
  size: BlockInstanceV2['presentation']['size'];
  controlParams: Record<string, NodeParams>;
  connectorParams: BlockConnectorParamsV2;
  suggestedInputs: SuggestedInputSetV2[];
  previewStates: BlockPreviewStateV2[];
  previewViews: BlockPreviewViewV2[];
};

export type BlockPreviewViewV2 = {
  previewId: string;
  binding: BlockPreviewStateV2['binding'];
  params: Record<string, NodeParams>;
  status: NonNullable<BlockPreviewStateV2['status']>;
  taskId?: string;
};

export type BlockPresentationPatchV2 = Partial<
  Pick<
    BlockInstanceV2['presentation'],
    'expanded' | 'position' | 'size' | 'internalLayoutMode' | 'collapsedContainerNodeIds'
  >
> & {
  /** Entries are merged by semantic node id; null removes an entry. */
  internalLayout?: Record<string, BlockInstanceV2['presentation']['internalLayout'][string] | null>;
};

export type BlockPreviewPatchV2 = {
  /** Omit to preserve the current value; null clears the persisted reference. */
  mediaReference?: string | null;
  /** Omit to preserve the current value; null clears the task association. */
  taskId?: string | null;
  status?: NonNullable<BlockPreviewStateV2['status']>;
};

function controlBindingTargetsV2(control: BlockControlV2) {
  return [control.binding, ...(control.mirrorBindings ?? [])];
}

export function blockInputPortBindingsV2(port: BlockPortV2) {
  return [port.binding, ...(port.mirrorBindings ?? [])];
}

function sealedControlOwnsNode(control: BlockControlV2, nodeId: string) {
  return Boolean(control.sealed) && controlBindingTargetsV2(control).some((binding) => binding.nodeId === nodeId);
}

const ROOT_MODULE = 'MoDiff';
const ROOT_ACTION = 'BlockV2';
const DEFAULT_ROOT_WIDTH = 360;
const DEFAULT_ROOT_HEIGHT = 320;
const CHILD_LEFT = 28;
const CHILD_TOP = 76;
const CHILD_COLUMN_GAP = 380;
const CHILD_ROW_GAP = 300;
const CHILD_COLUMNS = 3;
const EXPANDED_CHILD_FALLBACK_WIDTH = 320;
const EXPANDED_CHILD_FALLBACK_HEIGHT = 560;
const EXPANDED_RIGHT_PADDING = 28;
// Minimum gutter; larger interfaces must also reserve every connector row.
const EXPANDED_BOTTOM_PADDING = 96;
const INTERNAL_CONTAINER_WIDTH = 340;
const INTERNAL_CONTAINER_MIN_HEIGHT = 176;
const INTERNAL_CHILD_LEFT = 28;
const INTERNAL_CHILD_TOP = 76;
const INTERNAL_CHILD_GAP = 36;

function expandedConnectorInsetV2(inputCount: number, outputCount: number) {
  // Shared NodeContent tray: 20px line height, 4px row gap, 12px vertical
  // padding, 1px border. Keep 28px of clear canvas above it. Count hidden
  // optional ports conservatively so connecting one cannot cover a child.
  const rows = Math.max(inputCount, outputCount);
  return Math.max(EXPANDED_BOTTOM_PADDING, rows * 24 + 9 + 28);
}

function expandedNodeConnectorInsetV2(params: Record<string, NodeParams>) {
  const ports = Object.values(params);
  return expandedConnectorInsetV2(
    ports.filter((param) => param.isInput || param.display === 'input').length,
    ports.filter((param) => !param.isInput && param.display === 'output').length,
  );
}
// Preflight only; strict BlockSchemaV2 normalization remains authoritative.
const BLOCK_SEMANTIC_NODE_ID_V2 = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,383}$/u;

const LEGACY_AUTHORITY_FIELDS = [
  'huggingFaceClusterInstance',
  'huggingFaceClusterRole',
  'huggingFaceClusterInstanceId',
  'huggingFaceClusterPath',
  'huggingFaceClusterSemanticId',
  'huggingFaceClusterParameterPath',
  'huggingFaceClusterKind',
  'huggingFaceClusterImplicit',
  'huggingFaceClusterHasParameters',
  'huggingFaceClusterPathExpanded',
  'huggingFaceClusterConditionalRole',
  'huggingFaceClusterConditionalStatus',
  'huggingFaceClusterSelectedBlockName',
  'huggingFaceClusterTriggerInputs',
  'huggingFaceClusterExecutionAdmissionId',
  'huggingFaceClusterExecutionSpecId',
  'huggingFaceClusterExecutionRole',
  'huggingFaceClusterExecutionPosition',
  'userBlockId',
  'userBlockSnapshot',
  'userBlockInstanceId',
  'userBlockSourceNodeId',
] as const;

const PROJECTION_NODE_FIELDS = [
  'blockProjectionOwnerId',
  'blockProjectionNodeId',
  'blockProjectionKind',
  'blockProjectionContainer',
  'blockProjectionModular',
  'blockProjectionChildCount',
  'blockProjectionContainerExpanded',
  'blockProjectionDepth',
  'blockProjectionPortBindings',
] as const;

const PROJECTION_EDGE_FIELDS = [
  'blockProjectionOwnerId',
  'blockProjectionEdgeId',
  'blockProjectionEdgeIds',
  'blockProjectionKind',
] as const;

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function categoryForSource(source: BlockSourceV2) {
  if (source.kind === 'diffusers_catalog') return 'Diffusers';
  if (source.kind === 'transformers_catalog') return 'Transformers';
  if (source.kind === 'hub_import') return 'Hub imports';
  return 'User Nodes';
}

function isV2Candidate(node: CustomNodeType) {
  return hasOwn(node.data, 'blockInstanceV2');
}

function assertNoLegacyAuthority(data: NodeData) {
  const stale = LEGACY_AUTHORITY_FIELDS.filter((field) => data[field] !== undefined);
  if (stale.length) throw new Error(`Invalid Block V2 root: legacy authority is also present (${stale.join(', ')}).`);
  if (Object.keys(data.params ?? {}).length)
    throw new Error('Invalid Block V2 root: NodeData.params cannot be a second persisted value store.');
  if (PROJECTION_NODE_FIELDS.some((field) => data[field] !== undefined))
    throw new Error('Invalid Block V2 root: a durable root cannot also be a derived projection node.');
}

function normalizedRootInstance(node: CustomNodeType) {
  if (node.type !== 'block' || node.data.type !== 'block' || !node.data.blockInstanceV2)
    throw new Error('Invalid Block V2 root: expected a block node with blockInstanceV2.');
  assertNoLegacyAuthority(node.data);
  const instance = normalizeBlockInstanceV2(node.data.blockInstanceV2);
  if (node.id !== instance.instanceId)
    throw new Error('Invalid Block V2 root: the canvas id must equal BlockInstanceV2.instanceId.');
  if (node.parentId) throw new Error('Invalid Block V2 root: composite nodes cannot be nested.');
  return instance;
}

/** Strict identification; malformed or dual-authority candidates fail closed. */
export function isBlockRootV2(value: unknown): value is CustomNodeType {
  if (!isRecord(value) || !isRecord(value.data)) return false;
  try {
    normalizedRootInstance(value as unknown as CustomNodeType);
    return true;
  } catch {
    return false;
  }
}

export function blockProjectionNodeIdV2(instanceId: string, semanticNodeId: string) {
  return `block-v2-node:${instanceId.length}:${instanceId}:${semanticNodeId.length}:${semanticNodeId}`;
}

function blockProjectionEdgeIdV2(instanceId: string, semanticEdgeId: string) {
  return `block-v2-edge:${instanceId.length}:${instanceId}:${semanticEdgeId.length}:${semanticEdgeId}`;
}

function blockInputMirrorEdgeIdV2(
  externalEdgeId: string,
  instanceId: string,
  nodeId: string,
  fieldId: string,
  index: number,
) {
  return `block-v2-input-mirror:${externalEdgeId.length}:${externalEdgeId}:${instanceId.length}:${instanceId}:${nodeId.length}:${nodeId}:${fieldId.length}:${fieldId}:${index}`;
}

/** Create the only durable canvas representation of a V2 composite. */
export function createBlockRootNodeV2(
  instanceValue: BlockInstanceV2,
  options: { selected?: boolean } = {},
): CustomNodeType {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return rootNodeForNormalizedInstanceV2(instance, options);
}

/** Private helpers below only accept a fresh clone validated by a public entry point. */
function rootNodeForNormalizedInstanceV2(
  instance: BlockInstanceV2,
  options: { selected?: boolean } = {},
): CustomNodeType {
  const definition = instance.definitionSnapshot;
  const size = instance.presentation.expanded
    ? expandedSizeForNormalizedInstanceV2(instance)
    : instance.presentation.size;
  return {
    id: instance.instanceId,
    type: 'block',
    // React Flow owns the outer node wrapper. Mark that wrapper explicitly
    // while expanded so it cannot swallow projected-node edge gestures; the
    // shared frame re-enables its interactive header and connector tray.
    ...(instance.presentation.expanded ? { className: 'modiff-block-v2-expanded-root pointer-events-none' } : {}),
    position: cloneJson(instance.presentation.position),
    width: size.width || DEFAULT_ROOT_WIDTH,
    height: size.height || DEFAULT_ROOT_HEIGHT,
    // React Flow retains measurements for a node id across controlled-node
    // replacements. Keep the wrapper's CSS dimensions authoritative as well
    // as its graph dimensions so a previously measured collapsed root cannot
    // visually shrink an expanded projection after an internal layout edit.
    style: {
      width: size.width || DEFAULT_ROOT_WIDTH,
      height: size.height || DEFAULT_ROOT_HEIGHT,
    },
    ...(options.selected === undefined ? {} : { selected: options.selected }),
    data: {
      type: 'block',
      module: ROOT_MODULE,
      action: ROOT_ACTION,
      label: definition.displayName,
      category: categoryForSource(definition.source),
      params: {},
      ...(definition.description ? { description: definition.description } : {}),
      resizable: true,
      blockInstanceV2: instance,
    },
  };
}

function sourceParams(node: BlockGraphNodeV2 | undefined) {
  const params = node && isRecord(node.data.params) ? node.data.params : {};
  return cloneJson(params) as Record<string, NodeParams>;
}

function sourceParam(instance: BlockInstanceV2, nodeId: string, fieldId: string) {
  return sourceParams(instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId))[fieldId];
}

function definitionParam(instance: BlockInstanceV2, nodeId: string, fieldId: string) {
  return sourceParams(instance.definitionSnapshot.graph.nodes.find((node) => node.nodeId === nodeId))[fieldId];
}

function projectedBindingFieldOptions(
  base: NodeParams | undefined,
  instance: BlockInstanceV2,
  logicalId: string,
  direction: 'control' | 'input' | 'output',
  binding: { nodeId: string; fieldId?: string; fieldOrPortId?: string },
) {
  return {
    ...(isRecord(base?.fieldOptions) ? cloneJson(base.fieldOptions) : {}),
    blockBindingV2: {
      schemaVersion: 2,
      ownerId: instance.instanceId,
      logicalId,
      direction,
      nodeId: binding.nodeId,
      fieldOrPortId: binding.fieldId ?? binding.fieldOrPortId,
    },
  };
}

function optionalValue(value: BlockJsonValue | undefined) {
  return value === undefined ? {} : { value: cloneJson(value) };
}

/** Body controls. They intentionally do not use input/output display modes. */
export function blockControlParamsV2(instanceValue: BlockInstanceV2): Record<string, NodeParams> {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return controlParamsForNormalizedInstanceV2(instance);
}

function controlParamsForNormalizedInstanceV2(instance: BlockInstanceV2): Record<string, NodeParams> {
  return Object.fromEntries(
    instance.effectiveInterface.controls.map((control) => {
      const base = sourceParam(instance, control.binding.nodeId, control.binding.fieldId);
      const display = base?.display === 'input' || base?.display === 'output' ? undefined : base?.display;
      return [
        control.controlId,
        {
          ...(base ? cloneJson(base) : {}),
          label: control.label,
          type: control.valueType,
          // Effective-interface controls are explicitly public body controls.
          // A source node may keep the backing field hidden until its dynamic
          // options are resolved, but that implementation detail must not hide
          // the declared Block control on the collapsed or expanded root.
          hidden: false,
          ...(display ? { display } : { display: undefined }),
          ...optionalValue(blockInstanceValueV2(instance, control.controlId)),
          ...(control.defaultValue === undefined ? {} : { default: cloneJson(control.defaultValue) }),
          ...(control.required === undefined ? {} : { required: control.required }),
          disabled: Boolean(control.sealed) || Boolean(base?.disabled),
          isInput: false,
          fieldOptions: projectedBindingFieldOptions(base, instance, control.controlId, 'control', control.binding),
        } satisfies NodeParams,
      ];
    }),
  );
}

function connectorParam(instance: BlockInstanceV2, port: BlockPortV2, direction: 'input' | 'output'): NodeParams {
  const base = sourceParam(instance, port.binding.nodeId, port.binding.fieldOrPortId);
  const value = direction === 'input' ? blockInstanceValueV2(instance, port.portId) : undefined;
  return {
    ...(base ? cloneJson(base) : {}),
    label: port.label,
    type: port.valueType,
    display: direction,
    required: port.required,
    isInput: direction === 'input',
    isConnected: false,
    ...optionalValue(value),
    fieldOptions: projectedBindingFieldOptions(base, instance, port.portId, direction, port.binding),
  };
}

/**
 * Public sockets are a distinct projection from body controls. The same
 * logical id may consequently exist once in `inputs` and once in controls.
 */
export function blockConnectorParamsV2(instanceValue: BlockInstanceV2): BlockConnectorParamsV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return connectorParamsForNormalizedInstanceV2(instance);
}

function connectorParamsForNormalizedInstanceV2(instance: BlockInstanceV2): BlockConnectorParamsV2 {
  return {
    inputs: Object.fromEntries(
      instance.effectiveInterface.boundary.inputs.map((port) => [port.portId, connectorParam(instance, port, 'input')]),
    ),
    outputs: Object.fromEntries(
      instance.effectiveInterface.boundary.outputs.map((port) => [
        port.portId,
        connectorParam(instance, port, 'output'),
      ]),
    ),
  };
}

const PREVIEW_DISPLAY_V2: Record<BlockPreviewStateV2['binding']['mediaType'], string> = {
  image: 'ui_image',
  video: 'ui_video',
  audio: 'ui_audio',
  text: 'ui_text',
  file: 'ui_text',
};

/** Collapsed preview fields derived from the declared definition binding and instance run state. */
export function blockPreviewViewsV2(instanceValue: BlockInstanceV2): BlockPreviewViewV2[] {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return previewViewsForNormalizedInstanceV2(instance);
}

/** A local view reads the same owner inventory; it never caches independent run state. */
export function blockContainerPreviewViewsV2(instanceValue: BlockInstanceV2, nodeId: string): BlockPreviewViewV2[] {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const local = instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId)?.containerInterface;
  return previewViewsForNormalizedInstanceV2(instance, local?.previews ?? []);
}

function previewViewsForNormalizedInstanceV2(
  instance: BlockInstanceV2,
  bindings = instance.definitionSnapshot.previews.filter((binding) =>
    instance.effectiveGraph.nodes.some((node) => node.nodeId === binding.nodeId),
  ),
): BlockPreviewViewV2[] {
  return bindings.map((binding, index) => {
    const preview = instance.previewStates.find(
      (state) => state.binding.nodeId === binding.nodeId && state.binding.outputPortId === binding.outputPortId,
    )!;
    const base =
      sourceParam(instance, binding.nodeId, binding.outputPortId) ??
      definitionParam(instance, binding.nodeId, binding.outputPortId);
    const fieldId = `preview-${index}-${binding.nodeId}-${binding.outputPortId}`;
    return {
      previewId: fieldId,
      binding: cloneJson(binding),
      params: {
        [fieldId]: {
          ...(base ? cloneJson(base) : {}),
          label: base?.label ?? 'Preview',
          type: base?.type ?? binding.mediaType,
          display: PREVIEW_DISPLAY_V2[binding.mediaType],
          ...(preview.mediaReference === undefined
            ? {}
            : {
                value: preview.mediaReference,
                // A saved source field can retain artifacts from an earlier run.
                // Its URL must not override the current instance's media reference.
                artifacts: Array.isArray(base?.artifacts)
                  ? base.artifacts.filter(
                      (artifact: unknown) =>
                        isRecord(artifact) &&
                        artifact.url === preview.mediaReference &&
                        (!preview.taskId || (artifact.taskId ?? artifact.task_id) === preview.taskId),
                    )
                  : [],
              }),
          fieldOptions: {
            ...(isRecord(base?.fieldOptions) ? cloneJson(base.fieldOptions) : {}),
            blockPreviewBindingV2: {
              schemaVersion: 2,
              ownerId: instance.instanceId,
              nodeId: binding.nodeId,
              outputPortId: binding.outputPortId,
              mediaType: binding.mediaType,
            },
          },
        },
      },
      status: preview.status ?? 'idle',
      ...(preview.taskId ? { taskId: preview.taskId } : {}),
    };
  });
}

export function blockViewModelV2(instanceValue: BlockInstanceV2): BlockViewModelV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const definition = instance.definitionSnapshot;
  const effectiveValueIds = new Set([
    ...instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId),
    ...instance.effectiveInterface.controls.map(({ controlId }) => controlId),
  ]);
  const suggestedInputs = (definition.suggestedInputs ?? [])
    .map((suggestion) => ({
      ...suggestion,
      values: Object.fromEntries(
        Object.entries(suggestion.values).filter(([valueId]) => effectiveValueIds.has(valueId)),
      ),
    }))
    .filter((suggestion) => Object.keys(suggestion.values).length > 0);
  return {
    instanceId: instance.instanceId,
    definitionId: definition.definitionId,
    definitionContentHash: definition.contentHash,
    displayName: definition.displayName,
    ...(definition.description ? { description: definition.description } : {}),
    category: categoryForSource(definition.source),
    source: cloneJson(definition.source),
    ownership: cloneJson(definition.ownership),
    customization: cloneJson(instance.customization),
    expanded: instance.presentation.expanded,
    position: cloneJson(instance.presentation.position),
    size: cloneJson(instance.presentation.size),
    controlParams: controlParamsForNormalizedInstanceV2(instance),
    connectorParams: connectorParamsForNormalizedInstanceV2(instance),
    suggestedInputs: cloneJson(suggestedInputs),
    previewStates: cloneJson(instance.previewStates),
    previewViews: previewViewsForNormalizedInstanceV2(instance),
  };
}

export function parameterCustomizationState(instance: BlockInstanceV2) {
  if (
    instance.effectiveGraph.graphHash !== instance.definitionSnapshot.graph.graphHash ||
    instance.effectiveInterface.effectiveInterfaceHash !== instance.effectiveInterface.baseInterfaceHash
  )
    return 'structure_changed';
  const publicInputs = new Set(instance.effectiveInterface.boundary.inputs.map(({ portId }) => portId));
  const controls = new Map(instance.effectiveInterface.controls.map((control) => [control.controlId, control]));
  const changed = Object.entries(instance.values).some(([logicalId, value]) => {
    const control = controls.get(logicalId);
    // Registered Blocks commonly expose one logical value as both a public
    // connector and an inline control. Presence alone is not an edit in that
    // case: compare it to the reviewed control default. A boundary-only input
    // has no definition-owned value, so supplying it is workflow-local.
    if (publicInputs.has(logicalId) && !control) return true;
    return !control || canonicalBlockStringifyV2(value) !== canonicalBlockStringifyV2(control.defaultValue);
  });
  return changed ? 'parameters_changed' : 'unchanged';
}

/** Copy-on-write value edit. Definition snapshots and sibling instances stay untouched. */
export function setBlockInstanceValueV2(
  instanceValue: BlockInstanceV2,
  logicalId: string,
  value: BlockJsonValue,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const control = instance.effectiveInterface.controls.find(({ controlId }) => controlId === logicalId);
  const input = instance.effectiveInterface.boundary.inputs.find(({ portId }) => portId === logicalId);
  if (!control && !input) throw new Error(`Cannot set unknown Block V2 input/control ${logicalId}.`);
  if (control?.sealed) throw new Error(`Cannot edit sealed Block V2 control ${logicalId}.`);
  if (
    hasOwn(instance.values, logicalId) &&
    canonicalBlockStringifyV2(instance.values[logicalId]) === canonicalBlockStringifyV2(value)
  )
    return instance;
  const next = {
    ...instance,
    values: { ...instance.values, [logicalId]: cloneJson(value) },
    authorities: [],
  };
  return normalizeBlockInstanceV2({
    ...next,
    customization: { ...next.customization, state: parameterCustomizationState(next) },
  });
}

/** Presentation edits never alter semantic hashes, values, or authority receipts. */
export function setBlockPresentationV2(
  instanceValue: BlockInstanceV2,
  patch: BlockPresentationPatchV2,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const internalLayout = cloneJson(instance.presentation.internalLayout);
  Object.entries(patch.internalLayout ?? {}).forEach(([nodeId, layout]) => {
    if (layout === null) delete internalLayout[nodeId];
    else internalLayout[nodeId] = cloneJson(layout);
  });
  return normalizeBlockInstanceV2({
    ...instance,
    presentation: {
      ...instance.presentation,
      ...(patch.expanded === undefined ? {} : { expanded: patch.expanded }),
      ...(patch.position ? { position: cloneJson(patch.position) } : {}),
      ...(patch.size ? { size: cloneJson(patch.size) } : {}),
      ...(patch.internalLayoutMode ? { internalLayoutMode: patch.internalLayoutMode } : {}),
      ...(patch.collapsedContainerNodeIds === undefined
        ? {}
        : { collapsedContainerNodeIds: cloneJson(patch.collapsedContainerNodeIds) }),
      internalLayout,
    },
  });
}

/** Restore geometry only after a rejected structural drag, including new entries. */
export function rejectedBlockDragPresentationPatchV2(
  before: BlockInstanceV2['presentation'],
  current: BlockInstanceV2['presentation'],
): BlockPresentationPatchV2 {
  return {
    ...cloneJson(before),
    internalLayout: {
      ...Object.fromEntries(Object.keys(current.internalLayout).map((key) => [key, null])),
      ...cloneJson(before.internalLayout),
    },
  };
}

/**
 * Update one declared preview without changing definition/effective-graph
 * identity or execution authority. Preview data is workflow-instance run
 * state; it is never mirrored into root params or reusable definitions.
 */
export function setBlockPreviewStateV2(
  instanceValue: BlockInstanceV2,
  preview: { nodeId: string; outputPortId: string },
  patch: BlockPreviewPatchV2,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const matches = instance.previewStates
    .map((state, index) => ({ state, index }))
    .filter(
      ({ state }) => state.binding.nodeId === preview.nodeId && state.binding.outputPortId === preview.outputPortId,
    );
  if (matches.length !== 1)
    throw new Error(
      `Cannot update Block V2 preview ${preview.nodeId}.${preview.outputPortId}: expected one declared binding, found ${matches.length}.`,
    );
  const match = matches[0];
  if (!match) throw new Error('Cannot update Block V2 preview: the declared binding disappeared.');
  const index = match.index;
  const current = instance.previewStates[index];
  if (!current) throw new Error('Cannot update Block V2 preview: the declared state disappeared.');
  const next: BlockPreviewStateV2 = {
    ...current,
    ...(patch.status === undefined ? {} : { status: patch.status }),
  };
  if (patch.mediaReference === null) delete next.mediaReference;
  else if (patch.mediaReference !== undefined) next.mediaReference = patch.mediaReference;
  if (patch.taskId === null) delete next.taskId;
  else if (patch.taskId !== undefined) next.taskId = patch.taskId;
  return normalizeBlockInstanceV2({
    ...instance,
    previewStates: instance.previewStates.map((state, candidateIndex) => (candidateIndex === index ? next : state)),
  });
}

/** Copy-on-write structural edit. The immutable definition remains unchanged. */
export function replaceBlockEffectiveGraphV2(
  instanceValue: BlockInstanceV2,
  graphValue: Omit<BlockGraphV2, 'graphHash'> | BlockGraphV2,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const semantic = {
    nodes: cloneJson(graphValue.nodes),
    edges: cloneJson(graphValue.edges),
    ...(graphValue.executionOrder ? { executionOrder: cloneJson(graphValue.executionOrder) } : {}),
  };
  const effectiveGraph: BlockGraphV2 = { ...semantic, graphHash: blockGraphHashV2(semantic) };
  const nodeIds = new Set(effectiveGraph.nodes.map(({ nodeId }) => nodeId));
  const sameGraph = effectiveGraph.graphHash === instance.effectiveGraph.graphHash;
  const next = {
    ...instance,
    effectiveGraph,
    previewStates: blockInstancePreviewBindingsV2(instance.definitionSnapshot, effectiveGraph).map((binding) => {
      const previous = instance.previewStates.find(
        (state) =>
          state.binding.nodeId === binding.nodeId &&
          state.binding.outputPortId === binding.outputPortId &&
          state.binding.mediaType === binding.mediaType,
      );
      return previous ? { ...previous, binding } : { binding, status: 'idle' as const };
    }),
    presentation: {
      ...instance.presentation,
      internalLayout: Object.fromEntries(
        Object.entries(instance.presentation.internalLayout).filter(([nodeId]) => nodeIds.has(nodeId)),
      ),
      ...(instance.presentation.collapsedContainerNodeIds
        ? {
            collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds.filter((nodeId) =>
              nodeIds.has(nodeId),
            ),
          }
        : {}),
    },
    authorities: sameGraph ? instance.authorities : [],
    customization: {
      ...instance.customization,
      effectiveGraphHash: effectiveGraph.graphHash,
      state: 'unchanged' as BlockInstanceV2['customization']['state'],
    },
  };
  next.customization.state = parameterCustomizationState(next);
  return normalizeBlockInstanceV2(next);
}

/**
 * Replace the public interface of one workflow insertion. Port/control IDs
 * remain the durable external/value identity; definition data is never
 * mutated. Removed, unreferenced values are pruned deterministically. Omitted
 * mirror bindings are preserved by default for partial callers; a complete
 * interface editor passes preserveOmittedMirrors=false so omission explicitly
 * removes the canonical optional field.
 */
export function replaceBlockEffectiveInterfaceV2(
  instanceValue: BlockInstanceV2,
  value: { boundary: BlockBoundaryV2; controls: BlockControlV2[] },
  options: { preserveOmittedMirrors?: boolean } = {},
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const boundary: BlockBoundaryV2 = {
    ...value.boundary,
    inputs: value.boundary.inputs.map((port) => {
      const previous = instance.effectiveInterface.boundary.inputs.find(({ portId }) => portId === port.portId);
      const primaryUnchanged =
        previous?.binding.nodeId === port.binding.nodeId &&
        previous.binding.fieldOrPortId === port.binding.fieldOrPortId;
      return options.preserveOmittedMirrors !== false &&
        primaryUnchanged &&
        port.mirrorBindings === undefined &&
        previous?.mirrorBindings
        ? { ...port, mirrorBindings: cloneJson(previous.mirrorBindings) }
        : port;
    }),
    outputs: value.boundary.outputs,
  };
  const controls = value.controls.map((control) => {
    const previous = instance.effectiveInterface.controls.find(({ controlId }) => controlId === control.controlId);
    const primaryUnchanged =
      previous?.binding.nodeId === control.binding.nodeId && previous.binding.fieldId === control.binding.fieldId;
    return options.preserveOmittedMirrors !== false &&
      primaryUnchanged &&
      control.mirrorBindings === undefined &&
      previous?.mirrorBindings
      ? { ...control, mirrorBindings: cloneJson(previous.mirrorBindings) }
      : control;
  });
  const interfaceValue = { boundary, controls };
  const assertBinding = (
    logicalId: string,
    valueType: string,
    binding: { nodeId: string; fieldId?: string; fieldOrPortId?: string },
    direction: 'input' | 'output' | 'control',
  ) => {
    const fieldId = binding.fieldId ?? binding.fieldOrPortId;
    if (!fieldId) throw new Error(`Cannot configure Block V2 ${direction} ${logicalId}: its binding is missing.`);
    const param = effectiveParam(instance, binding.nodeId, fieldId, `${direction} ${logicalId}`);
    if (
      !blockValueTypesAreCompatibleV2(valueType, param.type) &&
      !(direction === 'input' && blockMediaFileBoundaryIsCompatibleV2(valueType, param))
    )
      throw new Error(`Cannot configure Block V2 ${direction} ${logicalId}: its field type is incompatible.`);
    if (direction === 'output' && param.display !== 'output')
      throw new Error(`Cannot configure Block V2 output ${logicalId}: ${binding.nodeId}.${fieldId} is not an output.`);
    if (direction === 'input' && param.display === 'output')
      throw new Error(`Cannot configure Block V2 input ${logicalId}: ${binding.nodeId}.${fieldId} is an output.`);
    if (direction === 'control' && param.display === 'output')
      throw new Error(`Cannot configure Block V2 control ${logicalId}: output fields cannot be body controls.`);
  };
  boundary.inputs.forEach((port) =>
    blockInputPortBindingsV2(port).forEach((binding) => assertBinding(port.portId, port.valueType, binding, 'input')),
  );
  boundary.outputs.forEach((port) => assertBinding(port.portId, port.valueType, port.binding, 'output'));
  controls.forEach((control) =>
    controlBindingTargetsV2(control).forEach((binding) =>
      assertBinding(control.controlId, control.valueType, binding, 'control'),
    ),
  );
  const sealedById = new Map(
    instance.effectiveInterface.controls.filter(({ sealed }) => sealed).map((control) => [control.controlId, control]),
  );
  sealedById.forEach((sealed, controlId) => {
    const candidate = controls.find((control) => control.controlId === controlId);
    if (
      !candidate ||
      candidate.binding.nodeId !== sealed.binding.nodeId ||
      candidate.binding.fieldId !== sealed.binding.fieldId ||
      canonicalBlockStringifyV2(candidate.mirrorBindings ?? []) !==
        canonicalBlockStringifyV2(sealed.mirrorBindings ?? []) ||
      candidate.valueType !== sealed.valueType ||
      candidate.sealed !== true
    )
      throw new Error(`Cannot remove or rebind sealed Block V2 control ${controlId}.`);
  });
  const effectiveInterfaceHash = blockInterfaceHashV2(interfaceValue);
  const allowedValues = new Set([
    ...boundary.inputs.map(({ portId }) => portId),
    ...controls.map(({ controlId }) => controlId),
  ]);
  const next = {
    ...instance,
    effectiveInterface: {
      boundary: cloneJson(boundary),
      controls: cloneJson(controls),
      baseInterfaceHash: instance.effectiveInterface.baseInterfaceHash,
      effectiveInterfaceHash,
    },
    values: Object.fromEntries(Object.entries(instance.values).filter(([valueId]) => allowedValues.has(valueId))),
    authorities:
      effectiveInterfaceHash === instance.effectiveInterface.effectiveInterfaceHash ? instance.authorities : [],
  };
  return normalizeBlockInstanceV2({
    ...next,
    customization: { ...next.customization, state: parameterCustomizationState(next) },
  });
}

export type AddBlockEffectiveGraphNodeOptionsV2 = {
  /** Position in the complete semantic execution order; defaults to the end. */
  executionIndex?: number;
  /** Parent-relative expanded-canvas layout; a deterministic grid slot is used when omitted. */
  layout?: BlockInstanceV2['presentation']['internalLayout'][string];
};

function assertAdoptableBlockGraphNodeV2(instance: BlockInstanceV2, node: BlockGraphNodeV2) {
  if (
    !node ||
    typeof node !== 'object' ||
    typeof node.nodeId !== 'string' ||
    !BLOCK_SEMANTIC_NODE_ID_V2.test(node.nodeId)
  )
    throw new Error('Cannot add Block V2 internal node: a valid stable semantic nodeId is required.');
  if (typeof node.nodeType !== 'string' || !node.nodeType || !isRecord(node.data))
    throw new Error(`Cannot add Block V2 internal node "${node.nodeId}": nodeType and plain data are required.`);
  if (instance.effectiveGraph.nodes.some(({ nodeId }) => nodeId === node.nodeId))
    throw new Error(`Cannot add duplicate Block V2 internal node "${node.nodeId}".`);
  const data = isRecord(node.data) ? node.data : {};
  const nestedType =
    node.nodeType.toLowerCase() === 'block' ||
    node.nodeType.toLowerCase() === 'cluster' ||
    (typeof data.type === 'string' && ['block', 'cluster'].includes(data.type.toLowerCase()));
  const ownershipMarkers = [...LEGACY_AUTHORITY_FIELDS, ...PROJECTION_NODE_FIELDS].filter((field) =>
    hasOwn(data, field),
  );
  if (nestedType || ownershipMarkers.length)
    throw new Error(
      `Cannot add Block V2 internal node "${node.nodeId}": nested composites and owned projection nodes are not supported${ownershipMarkers.length ? ` (${ownershipMarkers.join(', ')})` : ''}.`,
    );

  const occupiedCanvasIds = new Set([
    instance.instanceId,
    ...instance.effectiveGraph.nodes.map(({ nodeId }) => blockProjectionNodeIdV2(instance.instanceId, nodeId)),
    ...instance.effectiveGraph.edges.map(({ edgeId }) => blockProjectionEdgeIdV2(instance.instanceId, edgeId)),
  ]);
  const projectedId = blockProjectionNodeIdV2(instance.instanceId, node.nodeId);
  if (
    node.nodeId.startsWith('block-v2-node:') ||
    node.nodeId.startsWith('block-v2-edge:') ||
    occupiedCanvasIds.has(node.nodeId) ||
    occupiedCanvasIds.has(projectedId)
  )
    throw new Error(
      `Cannot add Block V2 internal node "${node.nodeId}": its semantic or projected id collides with the reserved canvas projection namespace.`,
    );
  runtimeNodeType(node);
}

/**
 * Adopt one ordinary semantic graph node into this workflow instance. This is
 * intentionally store/gesture agnostic: callers must separately choose and
 * persistence-filter the source canvas node before invoking it.
 */
export function addBlockEffectiveGraphNodeV2(
  instanceValue: BlockInstanceV2,
  nodeValue: BlockGraphNodeV2,
  options: AddBlockEffectiveGraphNodeOptionsV2 = {},
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const node = cloneJson(nodeValue);
  assertAdoptableBlockGraphNodeV2(instance, node);
  const currentOrder = semanticNodeOrder(instance).map(({ nodeId }) => nodeId);
  const executionIndex = options.executionIndex ?? currentOrder.length;
  if (!Number.isSafeInteger(executionIndex) || executionIndex < 0 || executionIndex > currentOrder.length)
    throw new Error(
      `Cannot add Block V2 internal node "${node.nodeId}": executionIndex must be between 0 and ${currentOrder.length}.`,
    );
  const executionOrder = [...currentOrder];
  executionOrder.splice(executionIndex, 0, node.nodeId);
  const next = replaceBlockEffectiveGraphV2(instance, {
    nodes: [...instance.effectiveGraph.nodes, node],
    edges: instance.effectiveGraph.edges,
    executionOrder,
  });
  return setBlockPresentationV2(next, {
    internalLayout: {
      [node.nodeId]: options.layout
        ? cloneJson(options.layout)
        : defaultChildLayout(instance.effectiveGraph.nodes.length),
    },
  });
}

/** Copy an ordinary leaf's current values, not its replaceable canvas receipt. */
export function duplicateOrdinaryBlockNodeV2(
  instanceValue: BlockInstanceV2,
  sourceId: string,
  cloneId: string,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const source = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === sourceId);
  if (!source || source.modularDiffusers || !['custom', 'any'].includes(source.nodeType))
    throw new Error('Duplicate node requires an ordinary leaf. Save/reinsert a Modular subtree instead.');
  const copied = cloneJson(source);
  copied.nodeId = cloneId;
  delete copied.semanticRole;
  for (const [fieldId, param] of Object.entries(copied.data.params ?? {})) {
    if (param.display === 'output') continue;
    const value = blockContainerFieldValueV1(instance, sourceId, fieldId);
    if (value !== undefined) param.value = cloneJson(value);
  }
  const layout = instance.presentation.internalLayout[sourceId] ?? defaultChildLayout(0);
  return addBlockEffectiveGraphNodeV2(instance, copied, {
    layout: { ...layout, x: layout.x + 36, y: layout.y + 36 },
  });
}

export function addBlockEffectiveGraphSubtreeV2(
  instanceValue: BlockInstanceV2,
  nodesValue: readonly BlockGraphNodeV2[],
  edgesValue: readonly BlockGraphEdgeV2[],
  layouts: BlockInstanceV2['presentation']['internalLayout'] = {},
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  if (!nodesValue.length) throw new Error('Cannot add an empty Block V2 internal subtree.');
  const addedIds = new Set<string>();
  nodesValue.forEach((node) => {
    if (addedIds.has(node.nodeId)) throw new Error(`Cannot add duplicate subtree node "${node.nodeId}".`);
    assertAdoptableBlockGraphNodeV2(instance, node);
    addedIds.add(node.nodeId);
  });
  const existingEdgeIds = new Set(instance.effectiveGraph.edges.map(({ edgeId }) => edgeId));
  edgesValue.forEach((edge) => {
    if (existingEdgeIds.has(edge.edgeId)) throw new Error(`Cannot add duplicate subtree edge "${edge.edgeId}".`);
    if (!addedIds.has(edge.sourceNodeId) || !addedIds.has(edge.targetNodeId))
      throw new Error(`Cannot add subtree edge "${edge.edgeId}": both endpoints must belong to the subtree.`);
    existingEdgeIds.add(edge.edgeId);
  });
  // Validate one complete graph: a container's declared ports may reference
  // children later in the incoming subtree, never a partially inserted graph.
  const next = replaceBlockEffectiveGraphV2(instance, {
    nodes: [...instance.effectiveGraph.nodes, ...cloneJson(nodesValue)],
    edges: [...instance.effectiveGraph.edges, ...cloneJson(edgesValue)],
    executionOrder: [
      ...semanticNodeOrder(instance).map(({ nodeId }) => nodeId),
      ...nodesValue.map(({ nodeId }) => nodeId),
    ],
  });
  return setBlockPresentationV2(next, {
    internalLayout: Object.fromEntries(
      nodesValue.map((node, index) => [
        node.nodeId,
        layouts[node.nodeId]
          ? cloneJson(layouts[node.nodeId]!)
          : defaultChildLayout(instance.effectiveGraph.nodes.length + index),
      ]),
    ),
  });
}

/**
 * Atomically replace one internal semantic node while preserving compatible
 * edge IDs and public port/control IDs. Interface bindings follow the
 * replacement only when the same field exists with a compatible role/type.
 */
export function replaceBlockEffectiveGraphNodeV2(
  instanceValue: BlockInstanceV2,
  replacedNodeId: string,
  replacementValue: BlockGraphNodeV2,
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const replaced = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === replacedNodeId);
  if (!replaced) throw new Error(`Cannot replace unknown Block V2 internal node "${replacedNodeId}".`);
  const previewBindings = instance.previewStates
    .map(({ binding }) => binding)
    .filter(({ nodeId }) => nodeId === replacedNodeId);
  const ownsSealedControl = [
    ...instance.effectiveInterface.controls,
    ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
  ].some((control) => sealedControlOwnsNode(control, replacedNodeId));

  const candidate = cloneJson(replacementValue);
  const validationInstance = {
    ...instance,
    effectiveGraph: {
      ...instance.effectiveGraph,
      nodes: instance.effectiveGraph.nodes.filter(({ nodeId }) => nodeId !== replacedNodeId),
    },
  };
  assertAdoptableBlockGraphNodeV2(validationInstance, candidate);

  // A preview or sealed-control binding is an immutable public contract. The
  // safe replacement path therefore swaps the implementation behind that
  // stable semantic role instead of rebinding the contract to a new identity.
  // Ordinary unprotected nodes retain the dropped node's semantic identity as
  // before. This makes protected replacement possible without weakening
  // sealed values or adding mutable preview authority to the instance schema.
  const preservesProtectedIdentity = previewBindings.length > 0 || ownsSealedControl;
  const replacement = {
    ...(preservesProtectedIdentity ? { ...candidate, nodeId: replacedNodeId } : candidate),
    ...(replaced.containerInterface ? { containerInterface: cloneJson(replaced.containerInterface) } : {}),
  };
  const replacementParams = sourceParams(replacement);
  const requireReplacementField = (fieldId: string, valueType: unknown, direction: 'input' | 'output' | 'control') => {
    const param = replacementParams[fieldId];
    if (!param || !blockValueTypesAreCompatibleV2(valueType, param.type))
      throw new Error(
        `Cannot replace Block V2 node "${replacedNodeId}": replacement field ${fieldId} is missing or incompatible.`,
      );
    if (direction === 'output' && param.display !== 'output')
      throw new Error(`Cannot replace Block V2 node "${replacedNodeId}": ${fieldId} is not an output.`);
    if (direction !== 'output' && param.display === 'output')
      throw new Error(`Cannot replace Block V2 node "${replacedNodeId}": ${fieldId} cannot be used as ${direction}.`);
  };
  previewBindings.forEach((preview) => {
    const previous = sourceParam(instance, replacedNodeId, preview.outputPortId);
    const param = replacementParams[preview.outputPortId];
    if (
      !previous ||
      !param ||
      !blockValueTypesAreCompatibleV2(previous.type, param.type) ||
      !blockValueTypeMatchesMediaV2([param.type, param.display, preview.outputPortId], preview.mediaType)
    )
      throw new Error(
        `Cannot replace Block V2 node "${replacedNodeId}": preview field ${preview.outputPortId} is missing or incompatible with ${preview.mediaType} preview output.`,
      );
    if (param.display !== previous.display)
      throw new Error(
        `Cannot replace Block V2 node "${replacedNodeId}": preview field ${preview.outputPortId} must preserve display role ${String(previous.display ?? 'none')}.`,
      );
  });

  instance.effectiveGraph.edges.forEach((edge) => {
    if (edge.sourceNodeId === replacedNodeId) {
      const target = sourceParam(instance, edge.targetNodeId, edge.targetPortId);
      requireReplacementField(edge.sourcePortId, target?.type, 'output');
    }
    if (edge.targetNodeId === replacedNodeId) {
      const source = sourceParam(instance, edge.sourceNodeId, edge.sourcePortId);
      requireReplacementField(edge.targetPortId, source?.type, 'input');
    }
  });
  instance.effectiveInterface.boundary.inputs.forEach((port) =>
    blockInputPortBindingsV2(port)
      .filter(({ nodeId }) => nodeId === replacedNodeId)
      .forEach(({ fieldOrPortId }) => requireReplacementField(fieldOrPortId, port.valueType, 'input')),
  );
  instance.effectiveInterface.boundary.outputs
    .filter(({ binding }) => binding.nodeId === replacedNodeId)
    .forEach((port) => requireReplacementField(port.binding.fieldOrPortId, port.valueType, 'output'));
  instance.effectiveInterface.controls.forEach((control) =>
    controlBindingTargetsV2(control)
      .filter(({ nodeId }) => nodeId === replacedNodeId)
      .forEach(({ fieldId }) => requireReplacementField(fieldId, control.valueType, 'control')),
  );

  instance.effectiveGraph.nodes.forEach((node) => {
    const local = node.containerInterface;
    if (!local) return;
    [...local.boundary.inputs, ...local.boundary.outputs].forEach((port) => {
      const direction = local.boundary.inputs.includes(port) ? 'input' : 'output';
      blockContainerPortTargetsV1(port)
        .filter(({ nodeId }) => nodeId === replacedNodeId)
        .forEach(({ fieldOrPortId }) => requireReplacementField(fieldOrPortId, port.valueType, direction));
    });
    local.controls.forEach((control) =>
      blockContainerControlTargetsV1(control)
        .filter(({ nodeId }) => nodeId === replacedNodeId)
        .forEach(({ fieldId }) => requireReplacementField(fieldId, control.valueType, 'control')),
    );
  });
  const nodeIds = new Map([[replacedNodeId, replacement.nodeId]]);
  const previousParent = instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === replacedNodeId)?.parentNodeId;
  const nodes = instance.effectiveGraph.nodes.map((node) => {
    const next =
      node.nodeId === replacedNodeId
        ? { ...replacement, ...(previousParent ? { parentNodeId: previousParent } : {}) }
        : { ...node, ...(node.parentNodeId === replacedNodeId ? { parentNodeId: replacement.nodeId } : {}) };
    return next.containerInterface
      ? { ...next, containerInterface: remapBlockContainerInterfaceV1(next.containerInterface, nodeIds) }
      : next;
  });
  const edges = instance.effectiveGraph.edges.map((edge) => ({
    ...edge,
    ...(edge.sourceNodeId === replacedNodeId ? { sourceNodeId: replacement.nodeId } : {}),
    ...(edge.targetNodeId === replacedNodeId ? { targetNodeId: replacement.nodeId } : {}),
  }));
  const executionOrder = instance.effectiveGraph.executionOrder?.map((nodeId) =>
    nodeId === replacedNodeId ? replacement.nodeId : nodeId,
  );
  const graphSemantic = { nodes, edges, ...(executionOrder ? { executionOrder } : {}) };
  const effectiveGraph = { ...graphSemantic, graphHash: blockGraphHashV2(graphSemantic) };
  const boundary: BlockBoundaryV2 = {
    ...cloneJson(instance.effectiveInterface.boundary),
    inputs: instance.effectiveInterface.boundary.inputs.map((port) => ({
      ...port,
      binding: port.binding.nodeId === replacedNodeId ? { ...port.binding, nodeId: replacement.nodeId } : port.binding,
      ...(port.mirrorBindings
        ? {
            mirrorBindings: port.mirrorBindings.map((binding) =>
              binding.nodeId === replacedNodeId ? { ...binding, nodeId: replacement.nodeId } : binding,
            ),
          }
        : {}),
    })),
    outputs: instance.effectiveInterface.boundary.outputs.map((port) => ({
      ...port,
      binding: port.binding.nodeId === replacedNodeId ? { ...port.binding, nodeId: replacement.nodeId } : port.binding,
    })),
  };
  const controls = instance.effectiveInterface.controls.map((control) => ({
    ...control,
    binding:
      control.binding.nodeId === replacedNodeId ? { ...control.binding, nodeId: replacement.nodeId } : control.binding,
    ...(control.mirrorBindings
      ? {
          mirrorBindings: control.mirrorBindings.map((binding) =>
            binding.nodeId === replacedNodeId ? { ...binding, nodeId: replacement.nodeId } : binding,
          ),
        }
      : {}),
  }));
  const effectiveInterfaceHash = blockInterfaceHashV2({ boundary, controls });
  const previousLayout = instance.presentation.internalLayout[replacedNodeId];
  const internalLayout = Object.fromEntries(
    Object.entries(instance.presentation.internalLayout).filter(([nodeId]) => nodeId !== replacedNodeId),
  );
  if (previousLayout) internalLayout[replacement.nodeId] = previousLayout;
  const replacedPreviewKeys = new Set(previewBindings.map(({ nodeId, outputPortId }) => `${nodeId}\0${outputPortId}`));
  const previewStates = instance.previewStates.map((state) =>
    replacedPreviewKeys.has(`${state.binding.nodeId}\0${state.binding.outputPortId}`)
      ? { binding: cloneJson(state.binding), status: 'idle' as const }
      : state,
  );

  return normalizeBlockInstanceV2({
    ...instance,
    effectiveGraph,
    effectiveInterface: {
      boundary,
      controls,
      baseInterfaceHash: instance.effectiveInterface.baseInterfaceHash,
      effectiveInterfaceHash,
    },
    presentation: {
      ...instance.presentation,
      internalLayout,
      ...(instance.presentation.collapsedContainerNodeIds
        ? {
            collapsedContainerNodeIds: instance.presentation.collapsedContainerNodeIds
              .map((nodeId) =>
                nodeId === replacedNodeId && replacement.nodeType === 'group' ? replacement.nodeId : nodeId,
              )
              .filter((nodeId) => nodeId !== replacedNodeId || replacement.nodeType === 'group'),
          }
        : {}),
    },
    previewStates,
    authorities: [],
    customization: {
      ...instance.customization,
      effectiveGraphHash: effectiveGraph.graphHash,
      state: 'structure_changed',
    },
  });
}

function blockNodeDeletionReferencesV2(instance: BlockInstanceV2, nodeId: string, removed: ReadonlySet<string>) {
  const references = [
    ...instance.effectiveInterface.boundary.inputs
      .filter((port) => blockInputPortBindingsV2(port).some((binding) => binding.nodeId === nodeId))
      .map(({ label, portId }) => `public input "${label}" (${portId})`),
    ...instance.effectiveInterface.boundary.outputs
      .filter(({ binding }) => binding.nodeId === nodeId)
      .map(({ label, portId }) => `public output "${label}" (${portId})`),
    ...instance.effectiveInterface.controls
      .filter((control) => controlBindingTargetsV2(control).some((binding) => binding.nodeId === nodeId))
      .map(({ label, controlId }) => `exposed control "${label}" (${controlId})`),
    ...instance.definitionSnapshot.previews
      .filter((preview) => preview.nodeId === nodeId)
      .map((preview) => `${preview.mediaType} preview (${preview.nodeId}.${preview.outputPortId})`),
    ...instance.effectiveGraph.nodes.flatMap((owner) => {
      const local = owner.containerInterface;
      if (!local || removed.has(owner.nodeId)) return [];
      return [
        ...[...local.boundary.inputs, ...local.boundary.outputs]
          .filter((port) => blockContainerPortTargetsV1(port).some((binding) => binding.nodeId === nodeId))
          .map((port) => `internal Block "${owner.nodeId}" port "${port.label}" (${port.portId})`),
        ...local.controls
          .filter((control) => blockContainerControlTargetsV1(control).some((binding) => binding.nodeId === nodeId))
          .map((control) => `internal Block "${owner.nodeId}" control "${control.label}" (${control.controlId})`),
        ...(local.previews ?? [])
          .filter((preview) => preview.nodeId === nodeId)
          .map(
            (preview) =>
              `internal Block "${owner.nodeId}" ${preview.mediaType} preview (${preview.nodeId}.${preview.outputPortId})`,
          ),
      ];
    }),
  ];
  return [...new Set(references)];
}

/**
 * Delete ordinary internal nodes from one instance graph. Public interface and
 * preview bindings are immutable instance contracts, so their source nodes
 * must be rebound explicitly before they can be removed.
 */
export function removeBlockEffectiveGraphNodesV2(
  instanceValue: BlockInstanceV2,
  semanticNodeIdsValue: readonly string[],
): BlockInstanceV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const semanticNodeIds = [...new Set(semanticNodeIdsValue)];
  semanticNodeIds.forEach((nodeId) => {
    if (!nodeId || !instance.effectiveGraph.nodes.some((node) => node.nodeId === nodeId))
      throw new Error(`Cannot delete unknown Block V2 internal node "${nodeId}".`);
  });
  const blockers = semanticNodeIds.flatMap((nodeId) => {
    const references = blockNodeDeletionReferencesV2(instance, nodeId, new Set(semanticNodeIds));
    return references.length ? [`"${nodeId}" is referenced by ${references.join(', ')}`] : [];
  });
  if (blockers.length)
    throw new Error(
      `Cannot delete Block V2 internal node: ${blockers.join('; ')}. Rebind those public declarations first.`,
    );
  if (semanticNodeIds.length === 0) return instance;

  const removed = new Set(semanticNodeIds);
  const retainedChild = instance.effectiveGraph.nodes.find(
    ({ nodeId, parentNodeId }) => !removed.has(nodeId) && parentNodeId && removed.has(parentNodeId),
  );
  if (retainedChild)
    throw new Error(
      `Cannot delete a Block container while child ${retainedChild.nodeId} still belongs to it. Move or delete its children first.`,
    );
  return replaceBlockEffectiveGraphV2(instance, {
    nodes: instance.effectiveGraph.nodes.filter(({ nodeId }) => !removed.has(nodeId)),
    edges: instance.effectiveGraph.edges.filter(
      ({ sourceNodeId, targetNodeId }) => !removed.has(sourceNodeId) && !removed.has(targetNodeId),
    ),
    ...(instance.effectiveGraph.executionOrder
      ? { executionOrder: instance.effectiveGraph.executionOrder.filter((nodeId) => !removed.has(nodeId)) }
      : {}),
  });
}

type ResolvedBindingValue = {
  logicalId: string;
  value: BlockJsonValue;
};

function projectedBindingValues(instance: BlockInstanceV2) {
  const values = new Map<string, ResolvedBindingValue>();
  const add = (nodeId: string, fieldId: string, logicalId: string, value: BlockJsonValue | undefined) => {
    if (value === undefined) return;
    const key = `${nodeId}\0${fieldId}`;
    const previous = values.get(key);
    if (previous && canonicalBlockStringifyV2(previous.value) !== canonicalBlockStringifyV2(value))
      throw new Error(
        `Cannot project Block V2 instance ${instance.instanceId}: ${previous.logicalId} and ${logicalId} bind conflicting values to ${nodeId}.${fieldId}.`,
      );
    values.set(key, { logicalId, value });
  };
  instance.effectiveInterface.controls.forEach((control) => {
    const value = blockInstanceValueV2(instance, control.controlId);
    controlBindingTargetsV2(control).forEach((binding) =>
      add(binding.nodeId, binding.fieldId, control.controlId, value),
    );
  });
  instance.effectiveInterface.boundary.inputs.forEach((port) => {
    const value = hasOwn(instance.values, port.portId) ? instance.values[port.portId] : undefined;
    blockInputPortBindingsV2(port).forEach((binding) => add(binding.nodeId, binding.fieldOrPortId, port.portId, value));
  });
  return values;
}

export function runtimeNodeType(node: BlockGraphNodeV2): Exclude<NodeData['type'], 'block' | 'cluster'> {
  const supported = new Set(['custom', 'any', 'group', 'loop']);
  if (!supported.has(node.nodeType))
    throw new Error(`Cannot project Block V2 node ${node.nodeId}: unsupported node type ${node.nodeType}.`);
  if (typeof node.data.type === 'string' && node.data.type !== node.nodeType)
    throw new Error(
      `Cannot project Block V2 node ${node.nodeId}: nodeType ${node.nodeType} disagrees with data.type ${node.data.type}.`,
    );
  return node.nodeType as Exclude<NodeData['type'], 'block' | 'cluster'>;
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

function projectedNodeData(
  instance: BlockInstanceV2,
  graphNode: BlockGraphNodeV2,
  bindings: ReadonlyMap<string, ResolvedBindingValue>,
): NodeData {
  const raw = cloneJson(graphNode.data) as Record<string, unknown>;
  const params = sourceParams(graphNode);
  Object.entries(params).forEach(([fieldId, param]) => {
    const binding = bindings.get(`${graphNode.nodeId}\0${fieldId}`);
    params[fieldId] = {
      ...param,
      fieldOptions: {
        ...(isRecord(param.fieldOptions) ? cloneJson(param.fieldOptions) : {}),
        // A projected child is a view of the instance's already-normalized,
        // sealed effective graph. Mounting or remounting that view (including
        // after Save + refresh) must not replay backend schema/materialization
        // actions that were used to compile the registered definition. Manual
        // edits still call fieldAction from the field's commit handler.
        suppressInitialFieldAction: true,
        ...(binding
          ? {
              blockBindingV2: {
                schemaVersion: 2,
                ownerId: instance.instanceId,
                logicalId: binding.logicalId,
                direction: 'internal',
                nodeId: graphNode.nodeId,
                fieldOrPortId: fieldId,
              },
            }
          : {}),
      },
      ...(binding ? { value: cloneJson(binding.value) } : {}),
    };
  });
  const type = runtimeNodeType(graphNode);
  const module = typeof raw.module === 'string' ? raw.module : '';
  const action = typeof raw.action === 'string' ? raw.action : (graphNode.semanticRole ?? graphNode.nodeId);
  const label =
    (typeof raw.label === 'string' && raw.label) ||
    words(graphNode.semanticRole ?? action ?? graphNode.nodeId) ||
    graphNode.nodeId;
  return {
    type,
    module,
    action,
    label,
    category: typeof raw.category === 'string' ? raw.category : 'Block internals',
    params,
    // Expanded Block internals are ordinary canvas nodes. Keep the same
    // resize affordance as standalone/User Node internals; the durable size
    // is absorbed into presentation.internalLayout by setFlowNodeSize.
    resizable: true,
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw.skipParamsCheck === 'boolean' ? { skipParamsCheck: raw.skipParamsCheck } : {}),
    ...(raw.operationAuthoring
      ? {
          operationAuthoring: remapOperationAuthoring(raw.operationAuthoring, (id) =>
            blockProjectionNodeIdV2(instance.instanceId, id),
          ),
        }
      : {}),
    blockProjectionOwnerId: instance.instanceId,
    blockProjectionNodeId: graphNode.nodeId,
    blockProjectionKind: 'internal',
  };
}

/** Complete authoring view, including hidden members; not an execution or readiness check. */
export function blockOperationGraphV2(instance: BlockInstanceV2): BlockFlowGraphV2 {
  const values = projectedBindingValues(instance);
  return {
    nodes: instance.effectiveGraph.nodes.map((node) => ({
      id: blockProjectionNodeIdV2(instance.instanceId, node.nodeId),
      type: runtimeNodeType(node),
      position: { x: 0, y: 0 },
      data: projectedNodeData(instance, node, values),
    })),
    edges: instance.effectiveGraph.edges.map((edge) => ({
      id: edge.edgeId,
      source: blockProjectionNodeIdV2(instance.instanceId, edge.sourceNodeId),
      sourceHandle: edge.sourcePortId,
      target: blockProjectionNodeIdV2(instance.instanceId, edge.targetNodeId),
      targetHandle: edge.targetPortId,
    })),
  };
}

function defaultChildLayout(index: number): BlockInstanceV2['presentation']['internalLayout'][string] {
  return {
    x: CHILD_LEFT + (index % CHILD_COLUMNS) * CHILD_COLUMN_GAP,
    y: CHILD_TOP + Math.floor(index / CHILD_COLUMNS) * CHILD_ROW_GAP,
  };
}

/** Source-relative coordinates for lossless nesting between flat and hierarchical layouts. */
export function blockRelativeInternalLayoutsV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const parents = blockGraphParentIdsV2(instance.effectiveGraph);
  const layouts = Object.fromEntries(
    instance.effectiveGraph.nodes.map((node, index) => [
      node.nodeId,
      cloneJson(instance.presentation.internalLayout[node.nodeId] ?? defaultChildLayout(index)),
    ]),
  );
  if (instance.presentation.internalLayoutMode === 'hierarchical') return layouts;
  return Object.fromEntries(
    Object.entries(layouts).map(([id, layout]) => {
      const parent = layouts[parents.get(id) ?? ''];
      return [id, parent ? { ...layout, x: layout.x - parent.x, y: layout.y - parent.y } : layout];
    }),
  );
}

type ProjectedLayoutV2 = { x: number; y: number; width: number; height: number };

function projectedOwnSizeV2(
  graphNode: BlockGraphNodeV2,
  layout: BlockInstanceV2['presentation']['internalLayout'][string],
  directChildren: readonly BlockGraphNodeV2[],
  layoutByNodeId: ReadonlyMap<string, BlockInstanceV2['presentation']['internalLayout'][string]>,
) {
  const params = Object.values(sourceParams(graphNode)).filter(
    (param) => param.display !== 'input' && param.display !== 'output' && !param.hidden,
  );
  const multiline = params.some((param) => {
    const display = String(param.display ?? '').toLowerCase();
    const type = Array.isArray(param.type)
      ? param.type.join(' ').toLowerCase()
      : String(param.type ?? '').toLowerCase();
    return display.startsWith('text') || type === 'text';
  });
  const defaultHeight =
    graphNode.nodeType === 'group' || params.length === 0
      ? INTERNAL_CONTAINER_MIN_HEIGHT
      : multiline || params.length > 6
        ? 400
        : params.length > 3
          ? 320
          : 240;
  let width = Math.max(260, layout.width ?? INTERNAL_CONTAINER_WIDTH);
  let height = Math.max(112, layout.height ?? defaultHeight);

  // Catalogs produced before progressive disclosure stored a container's
  // complete recursive footprint in its one width/height pair. Detect that
  // legacy geometry from its immediate child bounds and restore the compact
  // card size. Expanded dimensions are derived separately below.
  const containsStoredChild = directChildren.some((child) => {
    const childLayout = layoutByNodeId.get(child.nodeId);
    if (!childLayout) return false;
    const childWidth = childLayout.width ?? INTERNAL_CONTAINER_WIDTH;
    const childHeight = childLayout.height ?? INTERNAL_CONTAINER_MIN_HEIGHT;
    return width >= childLayout.x + childWidth + 20 || height >= childLayout.y + childHeight + 20;
  });
  if (containsStoredChild) {
    width = INTERNAL_CONTAINER_WIDTH;
    height = defaultHeight;
  }
  return { width, height };
}

function layoutsOverlapV2(left: ProjectedLayoutV2, right: ProjectedLayoutV2) {
  return (
    left.x < right.x + right.width + INTERNAL_CHILD_GAP &&
    left.x + left.width + INTERNAL_CHILD_GAP > right.x &&
    left.y < right.y + right.height + INTERNAL_CHILD_GAP &&
    left.y + left.height + INTERNAL_CHILD_GAP > right.y
  );
}

/**
 * Resolve the visible hierarchy bottom-up. Persisted coordinates remain the
 * preferred positions, while expanded container dimensions and collision
 * displacement are projection-only. This keeps manual edits durable without
 * allowing a newly opened subtree to overlap its siblings or escape its
 * immediate parent frame.
 */
function projectedHierarchicalLayoutsV2(
  instance: BlockInstanceV2,
  orderedNodes: readonly BlockGraphNodeV2[],
  parentIds: ReadonlyMap<string, string>,
  surfaceParams: ReadonlyMap<string, Record<string, NodeParams>>,
) {
  const orderIndex = new Map(orderedNodes.map((node, index) => [node.nodeId, index]));
  const storedLayoutByNodeId = new Map(
    instance.effectiveGraph.nodes.map((node, index) => [
      node.nodeId,
      instance.presentation.internalLayout[node.nodeId] ?? defaultChildLayout(index),
    ]),
  );
  // Root-relative legacy/standard-pipeline Blocks need the same collision
  // solver as hierarchical Modular Blocks. Convert only the projection's
  // preferred coordinates; never migrate saved layout or execution authority.
  const layoutByNodeId = new Map(
    [...storedLayoutByNodeId].map(([id, layout]) => {
      const parent = storedLayoutByNodeId.get(parentIds.get(id) ?? '');
      return [
        id,
        parent && instance.presentation.internalLayoutMode !== 'hierarchical'
          ? { ...layout, x: layout.x - parent.x, y: layout.y - parent.y }
          : layout,
      ];
    }),
  );
  const visibleIds = new Set(orderedNodes.map(({ nodeId }) => nodeId));
  const collapsed = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
  const childrenByParent = new Map<string, BlockGraphNodeV2[]>();
  orderedNodes.forEach((node) => {
    const parentId = parentIds.get(node.nodeId) ?? instance.instanceId;
    if (!visibleIds.has(parentId) && parentId !== instance.instanceId) return;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), node]);
  });
  childrenByParent.forEach((children) =>
    children.sort((left, right) => (orderIndex.get(left.nodeId) ?? 0) - (orderIndex.get(right.nodeId) ?? 0)),
  );

  const resolved = new Map<string, ProjectedLayoutV2>();
  const resolving = new Set<string>();
  const resolveNode = (node: BlockGraphNodeV2): ProjectedLayoutV2 => {
    const cached = resolved.get(node.nodeId);
    if (cached) return cached;
    if (resolving.has(node.nodeId)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${node.nodeId}.`);
    resolving.add(node.nodeId);
    const preferred = layoutByNodeId.get(node.nodeId)!;
    const directChildren = childrenByParent.get(node.nodeId) ?? [];
    const own = projectedOwnSizeV2(
      node,
      preferred,
      instance.effectiveGraph.nodes.filter((candidate) => parentIds.get(candidate.nodeId) === node.nodeId),
      layoutByNodeId,
    );
    const result: ProjectedLayoutV2 = { x: preferred.x, y: preferred.y, ...own };
    if (!directChildren.length && node.nodeType !== 'group') {
      // A fixed-height ordinary leaf has a non-shrinking header, toolbar and
      // connector tray. Reserve a usable scrolling body as well: old catalog
      // sizes otherwise let the tray consume the entire editable area. This
      // is projection-only and feeds the ancestor/collision solver below.
      const fields = Object.values({ ...sourceParams(node), ...surfaceParams.get(node.nodeId) }).filter(
        (field) => !field.hidden,
      );
      const inputs = fields.filter((field) => field.isInput || field.display === 'input').length;
      const outputs = fields.filter((field) => !field.isInput && field.display === 'output').length;
      const hasControls = fields.some(
        (field) => !field.isInput && field.display !== 'input' && field.display !== 'output',
      );
      const trayHeight = Math.max(inputs, outputs) * 24 + 16;
      result.height = Math.max(result.height, 44 + 32 + trayHeight + (hasControls ? 120 : 24));
    }
    if (directChildren.length && !collapsed.has(node.nodeId)) {
      const placed: ProjectedLayoutV2[] = [];
      for (const child of directChildren) {
        const childSize = resolveNode(child);
        const childPreferred = layoutByNodeId.get(child.nodeId)!;
        const placement: ProjectedLayoutV2 = {
          ...childSize,
          x: Math.max(INTERNAL_CHILD_LEFT, childPreferred.x),
          y: Math.max(INTERNAL_CHILD_TOP, childPreferred.y),
        };
        let guard = 0;
        while (placed.some((candidate) => layoutsOverlapV2(candidate, placement))) {
          const collisions = placed.filter((candidate) => layoutsOverlapV2(candidate, placement));
          placement.x = Math.max(...collisions.map((candidate) => candidate.x + candidate.width + INTERNAL_CHILD_GAP));
          if (++guard > directChildren.length + 1)
            throw new Error(`Could not place Modular Diffusers child ${child.nodeId} without overlap.`);
        }
        resolved.set(child.nodeId, placement);
        placed.push(placement);
      }
      result.width = Math.max(own.width, ...placed.map((child) => child.x + child.width + EXPANDED_RIGHT_PADDING));
      const bottomInset = expandedNodeConnectorInsetV2({ ...sourceParams(node), ...surfaceParams.get(node.nodeId) });
      result.height = Math.max(own.height, ...placed.map((child) => child.y + child.height + bottomInset));
    }
    resolving.delete(node.nodeId);
    resolved.set(node.nodeId, result);
    return result;
  };

  const roots = childrenByParent.get(instance.instanceId) ?? [];
  const hierarchical = instance.presentation.internalLayoutMode === 'hierarchical';
  const rootHeaderOffset = hierarchical
    ? 0
    : Math.max(0, CHILD_TOP - Math.min(...roots.map((node) => layoutByNodeId.get(node.nodeId)!.y)));
  const placedRoots: ProjectedLayoutV2[] = [];
  for (const root of roots) {
    const size = resolveNode(root);
    const preferred = layoutByNodeId.get(root.nodeId)!;
    const placement: ProjectedLayoutV2 = {
      ...size,
      x: Math.max(hierarchical ? INTERNAL_CHILD_LEFT : 0, preferred.x),
      y: Math.max(INTERNAL_CHILD_TOP, preferred.y + rootHeaderOffset),
    };
    let guard = 0;
    while (placedRoots.some((candidate) => layoutsOverlapV2(candidate, placement))) {
      const collisions = placedRoots.filter((candidate) => layoutsOverlapV2(candidate, placement));
      placement.x = Math.max(...collisions.map((candidate) => candidate.x + candidate.width + INTERNAL_CHILD_GAP));
      if (++guard > roots.length + 1) throw new Error(`Could not place Modular Diffusers root ${root.nodeId}.`);
    }
    resolved.set(root.nodeId, placement);
    placedRoots.push(placement);
  }
  return resolved;
}

function semanticNodeOrder(instance: BlockInstanceV2) {
  const byId = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, node]));
  const ordered = (instance.effectiveGraph.executionOrder ?? []).flatMap((nodeId) => {
    const node = byId.get(nodeId);
    if (!node) return [];
    byId.delete(nodeId);
    return [node];
  });
  return [...ordered, ...[...byId.values()].sort((left, right) => lexicalCompare(left.nodeId, right.nodeId))];
}

/** Immediate semantic parents for the shared Block hierarchy. */
export function blockModularParentIdsV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return blockGraphParentIdsV2(instance.effectiveGraph);
}

function hierarchyDepth(nodeId: string, parentIds: ReadonlyMap<string, string>) {
  let depth = 0;
  let current = nodeId;
  const visited = new Set<string>();
  while (parentIds.has(current)) {
    if (visited.has(current)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${current}.`);
    visited.add(current);
    current = parentIds.get(current)!;
    depth += 1;
  }
  return depth;
}

/**
 * Older registered Diffusers snapshots included skipped Auto/Conditional
 * wrappers as empty group leaves. They have no selected descendant, semantic
 * edge, public binding, control, or preview and therefore cannot participate
 * in the active workflow (for example Qwen text-to-image's optional image and
 * ControlNet VAE encoders). Keep the embedded definition immutable, but omit
 * those inert historical presentation artifacts. Never apply this rule to a
 * structurally customized graph or user-owned definition.
 */
function inactiveRegisteredStructuralNodeIdsV2(instance: BlockInstanceV2, parentIds: ReadonlyMap<string, string>) {
  if (
    instance.definitionSnapshot.source.kind !== 'diffusers_catalog' ||
    instance.effectiveGraph.graphHash !== instance.definitionSnapshot.graph.graphHash
  )
    return new Set<string>();
  const referenced = new Set<string>();
  instance.effectiveGraph.edges.forEach(({ sourceNodeId, targetNodeId }) => {
    referenced.add(sourceNodeId);
    referenced.add(targetNodeId);
  });
  instance.effectiveInterface.boundary.inputs.forEach((port) =>
    blockInputPortBindingsV2(port).forEach(({ nodeId }) => referenced.add(nodeId)),
  );
  instance.effectiveInterface.boundary.outputs.forEach(({ binding: { nodeId } }) => referenced.add(nodeId));
  instance.effectiveInterface.controls.forEach((control) => {
    controlBindingTargetsV2(control).forEach(({ nodeId }) => referenced.add(nodeId));
  });
  instance.definitionSnapshot.previews.forEach(({ nodeId }) => referenced.add(nodeId));
  const parents = new Set(parentIds.values());
  return new Set(
    instance.effectiveGraph.nodes.flatMap((node) =>
      node.nodeType === 'group' &&
      node.modularDiffusers?.kind === 'upstream_block' &&
      !parents.has(node.nodeId) &&
      !referenced.has(node.nodeId)
        ? [node.nodeId]
        : [],
    ),
  );
}

function visibleSemanticNodeIdsV2(
  instance: BlockInstanceV2,
  parentIds = blockGraphParentIdsV2(instance.effectiveGraph),
) {
  const collapsed = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
  const inactiveStructural = inactiveRegisteredStructuralNodeIdsV2(instance, parentIds);
  return new Set(
    instance.effectiveGraph.nodes.flatMap((node) => {
      if (inactiveStructural.has(node.nodeId)) return [];
      let parentId = parentIds.get(node.nodeId);
      const visited = new Set<string>([node.nodeId]);
      while (parentId) {
        if (visited.has(parentId)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${parentId}.`);
        visited.add(parentId);
        if (collapsed.has(parentId)) return [];
        parentId = parentIds.get(parentId);
      }
      return [node.nodeId];
    }),
  );
}

type ProjectedSemanticEndpointV2 = {
  direction: 'input' | 'output';
  nodeId: string;
  fieldOrPortId: string;
  mirrorBindings?: { nodeId: string; fieldOrPortId: string }[];
};

type BlockProjectionSurfaceV2 = {
  paramsByNodeId: ReadonlyMap<string, Record<string, NodeParams>>;
  bindingsByNodeId: ReadonlyMap<string, Record<string, ProjectedSemanticEndpointV2>>;
  edges: Edge[];
};

function projectionBoundaryHandleIdV2(endpoint: ProjectedSemanticEndpointV2) {
  const direction = endpoint.direction === 'input' ? 'in' : 'out';
  return `block-boundary-${direction}:${endpoint.nodeId.length}:${endpoint.nodeId}:${endpoint.fieldOrPortId.length}:${endpoint.fieldOrPortId}`;
}

function visibleRepresentativeNodeIdV2(
  nodeId: string,
  parentIds: ReadonlyMap<string, string>,
  collapsedContainerIds: ReadonlySet<string>,
) {
  let parentId = parentIds.get(nodeId);
  let representativeNodeId = nodeId;
  const visited = new Set<string>([nodeId]);
  while (parentId) {
    if (visited.has(parentId)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${parentId}.`);
    visited.add(parentId);
    // When multiple unopened ancestors exist, only the outermost one is
    // visible. Keep walking so a deeply nested socket is lifted all the way
    // to the boundary the user can actually see.
    if (collapsedContainerIds.has(parentId)) representativeNodeId = parentId;
    parentId = parentIds.get(parentId);
  }
  return representativeNodeId;
}

function connectorDirection(param: NodeParams | undefined) {
  if (param?.display === 'output') return 'output';
  if (param?.display === 'input' || param?.isInput) return 'input';
  return null;
}

/**
 * Derive the visible connection surface of a progressively collapsed
 * hierarchy. Semantic edges remain bound to their exact leaf sockets; only
 * their canvas endpoints are lifted to the nearest collapsed ancestor.
 */
function blockProjectionSurfaceV2(instance: BlockInstanceV2): BlockProjectionSurfaceV2 {
  const parentIds = blockGraphParentIdsV2(instance.effectiveGraph);
  const collapsedContainerIds = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
  const visibleNodeIds = visibleSemanticNodeIdsV2(instance, parentIds);
  const nodesById = new Map(instance.effectiveGraph.nodes.map((node) => [node.nodeId, node]));
  const paramsByNodeId = new Map<string, Record<string, NodeParams>>();
  const bindingsByNodeId = new Map<string, Record<string, ProjectedSemanticEndpointV2>>();
  const mirroredSurfaces = new Map<string, BlockPortV2[]>();
  if (
    instance.effectiveInterface.boundary.inputs.some((port) => port.mirrorBindings?.length) ||
    instance.effectiveGraph.nodes.some((node) =>
      node.containerInterface?.boundary.inputs.some((port) => port.mirrorBindings?.length),
    )
  ) {
    for (const nodeId of blockModularContainerNodeIdsV2(instance.effectiveGraph)) {
      if (!visibleNodeIds.has(nodeId) || nodesById.get(nodeId)?.containerInterface) continue;
      mirroredSurfaces.set(
        nodeId,
        blockContainerInterfaceV1(instance, nodeId).boundary.inputs.filter((port) => port.mirrorBindings?.length),
      );
    }
  }

  const addEndpointAtNode = (
    representativeNodeId: string,
    endpoint: ProjectedSemanticEndpointV2,
    preferred?: { label?: string; valueType?: string; required?: boolean },
  ) => {
    if (!visibleNodeIds.has(representativeNodeId))
      throw new Error(`Invalid Block V2 projection: ${endpoint.nodeId} has no visible representative.`);
    const local = nodesById.get(representativeNodeId)?.containerInterface;
    const declaredPorts = local?.boundary[endpoint.direction === 'input' ? 'inputs' : 'outputs'];
    const candidatePorts =
      declaredPorts ?? (endpoint.direction === 'input' ? mirroredSurfaces.get(representativeNodeId) : undefined);
    const localPort = candidatePorts?.find((port) =>
      blockContainerPortTargetsV1(port).some(
        (binding) => binding.nodeId === endpoint.nodeId && binding.fieldOrPortId === endpoint.fieldOrPortId,
      ),
    );
    const boundEndpoint = localPort
      ? {
          direction: endpoint.direction,
          ...localPort.binding,
          ...(localPort.mirrorBindings ? { mirrorBindings: cloneJson(localPort.mirrorBindings) } : {}),
        }
      : endpoint;
    const source = sourceParams(nodesById.get(boundEndpoint.nodeId))[boundEndpoint.fieldOrPortId];
    const reusableOwnHandle =
      !local && representativeNodeId === endpoint.nodeId && connectorDirection(source) === endpoint.direction;
    const handleId = localPort
      ? `block-local-port:${localPort.portId.length}:${localPort.portId}`
      : reusableOwnHandle
        ? endpoint.fieldOrPortId
        : projectionBoundaryHandleIdV2(endpoint);
    if (!reusableOwnHandle) {
      const params = paramsByNodeId.get(representativeNodeId) ?? {};
      const bindings = bindingsByNodeId.get(representativeNodeId) ?? {};
      const previous = bindings[handleId];
      if (
        previous &&
        (previous.direction !== endpoint.direction ||
          previous.nodeId !== boundEndpoint.nodeId ||
          previous.fieldOrPortId !== boundEndpoint.fieldOrPortId)
      )
        throw new Error(`Invalid Block V2 projection: boundary handle collision at ${handleId}.`);
      params[handleId] = {
        ...(source ?? {}),
        // A boundary alias is another view of the owning instance's input,
        // not an empty socket. Resolve its value just like the editable field
        // so Fix/readiness do not invent missing-input repairs after expansion.
        ...(endpoint.direction === 'input'
          ? optionalValue(blockContainerFieldValueV1(instance, boundEndpoint.nodeId, boundEndpoint.fieldOrPortId))
          : {}),
        type: source?.type ?? preferred?.valueType ?? 'any',
        label:
          localPort?.label ??
          preferred?.label ??
          params[handleId]?.label ??
          source?.label ??
          words(endpoint.fieldOrPortId),
        display: endpoint.direction,
        isInput: endpoint.direction === 'input',
        hidden: false,
        disabled: false,
        required: localPort?.required ?? preferred?.required ?? source?.required ?? false,
        fieldOptions: {
          ...(isRecord(source?.fieldOptions) ? cloneJson(source.fieldOptions) : {}),
          suppressInitialFieldAction: true,
          ...(!localPort && !preferred && params[handleId]?.fieldOptions?.blockConnectedCrossingV2 !== false
            ? { blockConnectedCrossingV2: true }
            : { blockConnectedCrossingV2: false }),
        },
      };
      bindings[handleId] = boundEndpoint;
      paramsByNodeId.set(representativeNodeId, params);
      bindingsByNodeId.set(representativeNodeId, bindings);
    }
    return { nodeId: representativeNodeId, handleId };
  };

  // An explicit local surface is independent of current wires and of the
  // root's public interface. Never infer it anew on collapse or refresh.
  for (const node of instance.effectiveGraph.nodes) {
    if (!visibleNodeIds.has(node.nodeId) || !node.containerInterface) continue;
    for (const direction of ['input', 'output'] as const) {
      for (const port of node.containerInterface.boundary[direction === 'input' ? 'inputs' : 'outputs'])
        addEndpointAtNode(node.nodeId, { direction, ...port.binding });
    }
  }
  const addEndpoint = (
    endpoint: ProjectedSemanticEndpointV2,
    preferred?: { label?: string; valueType?: string; required?: boolean },
  ) =>
    addEndpointAtNode(
      visibleRepresentativeNodeIdV2(endpoint.nodeId, parentIds, collapsedContainerIds),
      endpoint,
      preferred,
    );
  const visibleContainerAncestors = (nodeId: string) => {
    const ancestors: string[] = [];
    let parentId = parentIds.get(nodeId);
    const visited = new Set<string>([nodeId]);
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${parentId}.`);
      visited.add(parentId);
      if (visibleNodeIds.has(parentId)) ancestors.push(parentId);
      parentId = parentIds.get(parentId);
    }
    return ancestors;
  };
  const addEndpointToVisibleContainers = (
    endpoint: ProjectedSemanticEndpointV2,
    preferred?: { label?: string; valueType?: string; required?: boolean },
    excluding: ReadonlySet<string> = new Set(),
  ) => {
    visibleContainerAncestors(endpoint.nodeId).forEach((containerId) => {
      if (!excluding.has(containerId)) addEndpointAtNode(containerId, endpoint, preferred);
    });
  };

  // Public root bindings are also meaningful boundaries of whichever
  // immediate subtree owns them, even when no current internal edge crosses
  // that boundary (for example a prompt control exposed as a connectable
  // input on a collapsed text-encoder block).
  instance.effectiveInterface.boundary.inputs.forEach((port) => {
    blockInputPortBindingsV2(port).forEach((binding) => {
      const endpoint = { direction: 'input' as const, nodeId: binding.nodeId, fieldOrPortId: binding.fieldOrPortId };
      const preferred = { label: port.label, valueType: port.valueType, required: port.required };
      addEndpoint(endpoint, preferred);
      addEndpointToVisibleContainers(endpoint, preferred);
    });
  });
  instance.effectiveInterface.boundary.outputs.forEach((port) => {
    const endpoint = {
      direction: 'output' as const,
      nodeId: port.binding.nodeId,
      fieldOrPortId: port.binding.fieldOrPortId,
    };
    const preferred = { label: port.label, valueType: port.valueType, required: port.required };
    addEndpoint(endpoint, preferred);
    addEndpointToVisibleContainers(endpoint, preferred);
  });

  // A nested Block's declared public sockets also remain available on its
  // unopened descendants. Do not leak a local interface into ancestors above
  // its owner or create any new wire while disclosing that interface.
  for (const node of instance.effectiveGraph.nodes) {
    if (!node.containerInterface) continue;
    for (const direction of ['input', 'output'] as const) {
      for (const port of node.containerInterface.boundary[direction === 'input' ? 'inputs' : 'outputs']) {
        for (const binding of blockContainerPortTargetsV1(port)) {
          const endpoint = { direction, ...binding };
          let ancestorId: string | undefined = binding.nodeId;
          while (ancestorId && ancestorId !== node.nodeId) {
            if (visibleNodeIds.has(ancestorId)) addEndpointAtNode(ancestorId, endpoint, port);
            ancestorId = parentIds.get(ancestorId);
          }
        }
      }
    }
  }

  const exposeCrossingEndpoints = (edge: BlockGraphEdgeV2, declared = false) => {
    const sourceEndpoint = {
      direction: 'output' as const,
      nodeId: edge.sourceNodeId,
      fieldOrPortId: edge.sourcePortId,
    };
    const targetEndpoint = {
      direction: 'input' as const,
      nodeId: edge.targetNodeId,
      fieldOrPortId: edge.targetPortId,
    };
    const sourceAncestors = new Set(visibleContainerAncestors(edge.sourceNodeId));
    const targetAncestors = new Set(visibleContainerAncestors(edge.targetNodeId));
    const preferred = declared ? {} : undefined;
    if (sourceParams(nodesById.get(edge.sourceNodeId))[edge.sourcePortId]?.display === 'output')
      addEndpointToVisibleContainers(sourceEndpoint, preferred, targetAncestors);
    const target = sourceParams(nodesById.get(edge.targetNodeId))[edge.targetPortId];
    if (target && target.display !== 'output')
      addEndpointToVisibleContainers(targetEndpoint, preferred, sourceAncestors);
    return { sourceEndpoint, targetEndpoint };
  };
  // Existing registered interfaces stay available; newly authored crossing
  // sockets below are derived only from current connections.
  instance.definitionSnapshot.graph.edges.forEach((edge) => exposeCrossingEndpoints(edge, true));
  const edges = instance.effectiveGraph.edges.flatMap((edge): Edge[] => {
    const { sourceEndpoint, targetEndpoint } = exposeCrossingEndpoints(edge);
    const sourceRepresentativeNodeId = visibleRepresentativeNodeIdV2(
      edge.sourceNodeId,
      parentIds,
      collapsedContainerIds,
    );
    const targetRepresentativeNodeId = visibleRepresentativeNodeIdV2(
      edge.targetNodeId,
      parentIds,
      collapsedContainerIds,
    );
    // An edge wholly contained by one unopened subtree has no visible
    // boundary crossing. Do not manufacture two unused handles on that
    // container; the exact semantic edge remains in effectiveGraph and will
    // reappear unchanged when the subtree is opened (and during execution).
    if (sourceRepresentativeNodeId === targetRepresentativeNodeId) return [];
    const source = addEndpoint(sourceEndpoint);
    const target = addEndpoint(targetEndpoint);
    if (!source || !target)
      throw new Error(`Cannot project Block edge ${edge.edgeId}: its internal interface omits a connected port.`);
    return [
      {
        id: blockProjectionEdgeIdV2(instance.instanceId, edge.edgeId),
        source: blockProjectionNodeIdV2(instance.instanceId, source.nodeId),
        sourceHandle: source.handleId,
        target: blockProjectionNodeIdV2(instance.instanceId, target.nodeId),
        targetHandle: target.handleId,
        type: 'smoothstep',
        // Keep the selectable edge immediately below connected blocks. The
        // root and expanded container frames are pointer-transparent behind
        // their interactive headers/connectors.
        zIndex: -1,
        data: {
          blockProjectionOwnerId: instance.instanceId,
          blockProjectionEdgeId: edge.edgeId,
          blockProjectionKind: 'internal',
        },
      },
    ];
  });
  // Several mirrors of one public input can cross the same container. Keep
  // every exact socket (they are not interchangeable fan-out ports), but name
  // its consumer so the user can tell which one they are connecting to.
  for (const [nodeId, params] of paramsByNodeId) {
    const bindings = bindingsByNodeId.get(nodeId)!;
    const parentPath = nodesById.get(nodeId)?.modularDiffusers?.placementPath ?? [];
    const connectors = Object.entries({
      ...(nodesById.get(nodeId)?.containerInterface ? {} : sourceParams(nodesById.get(nodeId))),
      ...params,
    }).filter(([, param]) => connectorDirection(param));
    const groups = new Map<string, typeof connectors>();
    for (const [handleId, param] of connectors) {
      const key = `${connectorDirection(param)}\0${param.label ?? words(handleId)}`;
      groups.set(key, [...(groups.get(key) ?? []), [handleId, param]]);
    }
    const used = new Set<string>();
    for (const [handleId, param] of connectors) {
      const endpoint = bindings[handleId] ?? {
        direction: connectorDirection(param)!,
        nodeId,
        fieldOrPortId: handleId,
      };
      const sourceNode = nodesById.get(endpoint.nodeId)!;
      const path = sourceNode.modularDiffusers?.placementPath;
      const base = param.label ?? words(handleId);
      const direction = endpoint.direction;
      const peers = groups.get(`${direction}\0${base}`)!;
      const duplicates = peers.length > 1;
      const relativePaths = peers.map(
        ([peerHandle]) =>
          nodesById
            .get(bindings[peerHandle]?.nodeId ?? nodeId)
            ?.modularDiffusers?.placementPath?.slice(parentPath.length) ?? [],
      );
      let commonPrefix = 0;
      while (
        relativePaths.every(
          (parts) => parts.length > commonPrefix + 1 && parts[commonPrefix] === relativePaths[0]![commonPrefix],
        )
      )
        commonPrefix += 1;
      const relativePath = path
        ?.slice(parentPath.length + commonPrefix)
        .map(words)
        .join(' / ');
      const consumer = relativePath || words(sourceNode.nodeId);
      let label = duplicates ? `${base} · ${consumer}` : base;
      if (used.has(`${direction}\0${label}`)) label = `${label} · ${endpoint.fieldOrPortId}`;
      if (used.has(`${direction}\0${label}`)) label = `${base} · ${endpoint.nodeId}.${endpoint.fieldOrPortId}`;
      used.add(`${direction}\0${label}`);
      // Copy even native connector metadata; definition params remain immutable.
      params[handleId] = {
        ...param,
        label,
        fieldOptions: {
          ...param.fieldOptions,
          connectionDescription: `${path?.join(' / ') ?? sourceNode.nodeId} · ${endpoint.fieldOrPortId} (${sourceNode.nodeId})`,
          suppressInitialFieldAction: true,
        },
      };
    }
  }
  const groupedEdges = new Map<string, Edge>();
  for (const edge of edges) {
    const key = canonicalBlockStringifyV2([edge.source, edge.sourceHandle, edge.target, edge.targetHandle]);
    const existing = groupedEdges.get(key);
    if (!existing) groupedEdges.set(key, edge);
    else {
      const previousIds = existing.data?.blockProjectionEdgeIds;
      existing.data = {
        ...existing.data,
        blockProjectionEdgeIds: [
          ...(Array.isArray(previousIds) ? previousIds : [existing.data?.blockProjectionEdgeId]),
          edge.data?.blockProjectionEdgeId,
        ],
      };
    }
  }
  return { paramsByNodeId, bindingsByNodeId, edges: [...groupedEdges.values()] };
}

/** Resolve a visible projected handle back to its exact semantic leaf socket. */
export function blockProjectionConnectionEndpointV2(
  node: Pick<CustomNodeType, 'data'>,
  handleId: string,
  direction: 'input' | 'output',
) {
  const crossing = parseBlockCrossingHandleV2(handleId);
  if (crossing)
    return crossing.direction === direction ? { nodeId: crossing.nodeId, fieldOrPortId: crossing.fieldOrPortId } : null;
  if (connectorDirection(node.data.params?.[handleId]) !== direction) return null;
  const projected = node.data.blockProjectionPortBindings?.[handleId];
  if (projected) {
    if (projected.direction !== direction) return null;
    return { nodeId: projected.nodeId, fieldOrPortId: projected.fieldOrPortId };
  }
  if (!node.data.blockProjectionNodeId) return null;
  return { nodeId: node.data.blockProjectionNodeId, fieldOrPortId: handleId };
}

/** Explicit local fan-out is one socket connected atomically to its complete target set. */
export function blockProjectionConnectionEndpointsV2(
  node: Pick<CustomNodeType, 'data'>,
  handleId: string,
  direction: 'input' | 'output',
) {
  const primary = blockProjectionConnectionEndpointV2(node, handleId, direction);
  if (!primary) return [];
  const mirrors = node.data.blockProjectionPortBindings?.[handleId]?.mirrorBindings ?? [];
  return direction === 'input' ? [primary, ...mirrors] : [primary];
}

/** Number of ordinary internal nodes currently visible in an expanded projection. */
export function blockProjectedChildCountV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return visibleSemanticNodeIdsV2(instance).size;
}

function projectedChildren(instance: BlockInstanceV2, absolute: boolean, included?: ReadonlySet<string>) {
  const values = projectedBindingValues(instance);
  const semanticOrder = semanticNodeOrder(instance);
  const semanticOrderIndex = new Map(semanticOrder.map((node, index) => [node.nodeId, index]));
  const parentIds = blockGraphParentIdsV2(instance.effectiveGraph);
  const childCount = new Map(blockModularContainerNodeIdsV2(instance.effectiveGraph).map((id) => [id, 0]));
  const disabledNodeIds = new Set(
    semanticOrder
      .filter((node) => isRecord(node.data.uiState) && node.data.uiState.disabled === true)
      .map(({ nodeId }) => nodeId),
  );
  const disabledByAncestor = (nodeId: string) => {
    let parent = parentIds.get(nodeId);
    while (parent) {
      if (disabledNodeIds.has(parent)) return true;
      parent = parentIds.get(parent);
    }
    return false;
  };
  parentIds.forEach((parentId) => childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1));
  // React Flow requires every parent to precede its descendants.
  // Canvas disclosure is presentation-only. Execution always materializes the
  // complete effective graph, including descendants hidden by a container.
  const visibleNodeIds = absolute
    ? (included ?? new Set(instance.effectiveGraph.nodes.map(({ nodeId }) => nodeId)))
    : visibleSemanticNodeIdsV2(instance, parentIds);
  const collapsedContainerIds = new Set(instance.presentation.collapsedContainerNodeIds ?? []);
  const projectionSurface = absolute ? null : blockProjectionSurfaceV2(instance);
  // A collapsed container is another view of the same declared controls, not
  // a parameter-less summary card. Build once, then fan each control out to its
  // containing ancestors. These aliases are canvas-only: execution still uses
  // the original semantic fields and the single owning instance's values.
  const containerControls = new Map<string, Record<string, NodeParams>>();
  if (!absolute) {
    const controls = controlParamsForNormalizedInstanceV2(instance);
    for (const control of instance.effectiveInterface.controls) {
      const ancestors = new Set<string>();
      for (const binding of [control.binding, ...(control.mirrorBindings ?? [])]) {
        let parent = parentIds.get(binding.nodeId);
        while (parent) {
          ancestors.add(parent);
          parent = parentIds.get(parent);
        }
      }
      for (const parent of ancestors) {
        const params = containerControls.get(parent) ?? {};
        const controlParam = controls[control.controlId]!;
        params[`block-control:${control.controlId.length}:${control.controlId}`] = {
          ...controlParam,
          fieldOptions: { ...controlParam.fieldOptions, suppressInitialFieldAction: true },
        };
        containerControls.set(parent, params);
      }
    }
    for (const node of instance.effectiveGraph.nodes) {
      let inheritedLocal = false;
      let ancestorId = parentIds.get(node.nodeId);
      while (ancestorId && !inheritedLocal) {
        inheritedLocal = Boolean(
          instance.effectiveGraph.nodes.find(({ nodeId }) => nodeId === ancestorId)?.containerInterface,
        );
        ancestorId = parentIds.get(ancestorId);
      }
      if (!node.containerInterface && !(childCount.has(node.nodeId) && inheritedLocal)) continue;
      const surface = blockContainerInterfaceV1(instance, node.nodeId);
      const params: Record<string, NodeParams> = {};
      for (const control of surface.controls) {
        // An executable loop already renders its own native fields. Only
        // descendant aliases are needed unless this view was configured.
        if (!node.containerInterface && control.binding.nodeId === node.nodeId) continue;
        const base = sourceParam(instance, control.binding.nodeId, control.binding.fieldId);
        const display = base?.display === 'input' || base?.display === 'output' ? undefined : base?.display;
        const targets = blockContainerControlTargetsV1(control);
        params[`block-local-control:${control.controlId.length}:${control.controlId}`] = {
          ...base,
          label: control.label,
          type: control.valueType,
          display,
          value: blockContainerFieldValueV1(instance, control.binding.nodeId, control.binding.fieldId),
          hidden: false,
          isInput: false,
          disabled: Boolean(control.sealed || base?.disabled),
          ...(control.required === undefined ? {} : { required: control.required }),
          fieldOptions: {
            ...base?.fieldOptions,
            suppressInitialFieldAction: true,
            blockContainerControlV1: {
              schemaVersion: 1,
              ownerId: instance.instanceId,
              containerNodeId: node.nodeId,
              controlId: control.controlId,
            },
            connectionDescription: targets.map(({ nodeId, fieldId }) => `${nodeId}.${fieldId}`).join(', '),
          },
        };
      }
      containerControls.set(node.nodeId, params);
    }
  }
  const orderedNodes = semanticOrder
    .filter(({ nodeId }) => visibleNodeIds.has(nodeId))
    .sort((left, right) => {
      // React Flow's parent-first requirement is not execution order. Moving
      // an ordinary child between containers must not reorder run paths.
      if (absolute) return semanticOrderIndex.get(left.nodeId)! - semanticOrderIndex.get(right.nodeId)!;
      const depthDifference = hierarchyDepth(left.nodeId, parentIds) - hierarchyDepth(right.nodeId, parentIds);
      return depthDifference || semanticOrderIndex.get(left.nodeId)! - semanticOrderIndex.get(right.nodeId)!;
    });
  const storedLayouts = orderedNodes.map(
    (graphNode, index) => instance.presentation.internalLayout[graphNode.nodeId] ?? defaultChildLayout(index),
  );
  const resolvedHierarchicalLayouts = !absolute
    ? projectedHierarchicalLayoutsV2(instance, orderedNodes, parentIds, projectionSurface!.paramsByNodeId)
    : null;
  const layouts = orderedNodes.map(
    (graphNode, index) => resolvedHierarchicalLayouts?.get(graphNode.nodeId) ?? storedLayouts[index]!,
  );
  // Imported/reviewed skeletons predate the shared Block frame and may start
  // at y=24. In a V2 Block that places the first ordinary node over the
  // 44px header, where it can intercept Configure/Collapse actions. Preserve
  // all relative node positions while reserving the same header-safe inset
  // used by newly-created V2 layouts. The durable layout remains source data;
  // a later user drag persists the projected, safe coordinate normally.
  const minimumY = Math.min(
    ...orderedNodes.flatMap((node, index) => (parentIds.has(node.nodeId) ? [] : [layouts[index]!.y])),
  );
  const headerSafeOffsetY = Number.isFinite(minimumY) ? Math.max(0, CHILD_TOP - minimumY) : 0;
  const rootRelativePosition = (nodeId: string, layout: { x: number; y: number }) => {
    let x = layout.x;
    let y = layout.y;
    if (instance.presentation.internalLayoutMode === 'hierarchical') {
      let parentId = parentIds.get(nodeId);
      const visited = new Set<string>([nodeId]);
      while (parentId) {
        if (visited.has(parentId)) throw new Error(`Invalid Block V2 Modular hierarchy: cycle at ${parentId}.`);
        visited.add(parentId);
        const parentLayout =
          instance.presentation.internalLayout[parentId] ?? defaultChildLayout(semanticOrderIndex.get(parentId) ?? 0);
        x += parentLayout.x;
        y += parentLayout.y;
        parentId = parentIds.get(parentId);
      }
    }
    return { x, y: y + headerSafeOffsetY };
  };
  return orderedNodes.map((graphNode, index): CustomNodeType => {
    const layout = layouts[index]!;
    const boundaryParams = projectionSurface?.paramsByNodeId.get(graphNode.nodeId);
    const boundaryBindings = projectionSurface?.bindingsByNodeId.get(graphNode.nodeId);
    const semanticParentId = parentIds.get(graphNode.nodeId);
    const parentLayout = semanticParentId
      ? (instance.presentation.internalLayout[semanticParentId] ??
        defaultChildLayout(semanticOrderIndex.get(semanticParentId) ?? 0))
      : null;
    const hierarchical =
      Boolean(resolvedHierarchicalLayouts) || instance.presentation.internalLayoutMode === 'hierarchical';
    const projectedLayout = {
      ...layout,
      x: semanticParentId && !hierarchical && parentLayout ? layout.x - parentLayout.x : layout.x,
      y:
        semanticParentId && !hierarchical && parentLayout
          ? layout.y - parentLayout.y
          : layout.y + (semanticParentId ? 0 : headerSafeOffsetY),
    };
    const depth = hierarchyDepth(graphNode.nodeId, parentIds);
    const parentId = semanticParentId
      ? blockProjectionNodeIdV2(instance.instanceId, semanticParentId)
      : instance.instanceId;
    const projectedData = projectedNodeData(instance, graphNode, values);
    const canvasParams = {
      ...Object.fromEntries(
        Object.entries(projectedData.params).map(([key, param]) => [
          key,
          !absolute && graphNode.containerInterface && !param.display?.startsWith('ui_')
            ? { ...param, hidden: true, isInput: false }
            : param,
        ]),
      ),
      ...boundaryParams,
    };
    for (const [alias, control] of Object.entries(containerControls.get(graphNode.nodeId) ?? {})) {
      if (control.fieldOptions?.blockContainerControlV1) {
        canvasParams[alias] = control;
        continue;
      }
      const logicalId = (control.fieldOptions?.blockBindingV2 as { logicalId: string }).logicalId;
      const existing = Object.entries(projectedData.params).find(
        ([, param]) =>
          !param.hidden &&
          param.display !== 'input' &&
          param.display !== 'output' &&
          (param.fieldOptions?.blockBindingV2 as { logicalId?: string } | undefined)?.logicalId === logicalId,
      );
      // Executable containers can already own a bound field (for example the
      // denoise loop's guidance). Reuse its native field key, not a second row.
      canvasParams[existing?.[0] ?? alias] = control;
    }
    if (!absolute && graphNode.containerInterface?.previews) {
      for (const preview of previewViewsForNormalizedInstanceV2(instance, graphNode.containerInterface.previews))
        Object.assign(canvasParams, preview.params);
    }
    return {
      id: blockProjectionNodeIdV2(instance.instanceId, graphNode.nodeId),
      type: runtimeNodeType(graphNode),
      position: absolute
        ? (() => {
            const rootPosition = rootRelativePosition(graphNode.nodeId, layout);
            return {
              x: instance.presentation.position.x + rootPosition.x,
              y: instance.presentation.position.y + rootPosition.y,
            };
          })()
        : { x: projectedLayout.x, y: projectedLayout.y },
      ...(projectedLayout.width ? { width: projectedLayout.width } : {}),
      ...(projectedLayout.height ? { height: projectedLayout.height } : {}),
      // V2 children may be dragged outside explicitly. The drag-stop reducer
      // decides whether that is a layout edit or one atomic move-out; React
      // Flow must not silently grow the parent and hide the boundary crossing.
      ...(absolute ? {} : { parentId, expandParent: false }),
      zIndex: depth + 1,
      data: {
        ...projectedData,
        // Execution deliberately has no canvas parentId. Carry the effective
        // disabled state so a disabled nested container cannot still run its
        // descendants through the top-level workflow Run button.
        ...(absolute && disabledByAncestor(graphNode.nodeId)
          ? { uiState: { ...projectedData.uiState, disabled: true } }
          : {}),
        ...(absolute ? {} : { params: canvasParams }),
        ...(graphNode.modularDiffusers?.kind === 'upstream_block' ? { blockProjectionModular: true } : {}),
        ...(childCount.has(graphNode.nodeId)
          ? {
              blockProjectionContainer: true,
              blockProjectionChildCount: childCount.get(graphNode.nodeId),
              blockProjectionContainerExpanded: !collapsedContainerIds.has(graphNode.nodeId),
            }
          : {}),
        blockProjectionDepth: depth,
        ...(boundaryBindings ? { blockProjectionPortBindings: boundaryBindings } : {}),
      },
    };
  });
}

function projectionPositionRelativeToRoot(
  child: CustomNodeType,
  byId: ReadonlyMap<string, CustomNodeType>,
  rootId: string,
) {
  let x = child.position.x;
  let y = child.position.y;
  let parentId = child.parentId;
  const visited = new Set<string>([child.id]);
  while (parentId && parentId !== rootId) {
    if (visited.has(parentId)) throw new Error(`Invalid Block V2 projection hierarchy: cycle at ${parentId}.`);
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) throw new Error(`Invalid Block V2 projection hierarchy: missing parent ${parentId}.`);
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}

/**
 * Derive the expanded canvas frame from its ordinary child nodes.
 *
 * `presentation.size` deliberately remains the collapsed/user-resized size.
 * Expanded bounds are a replaceable canvas projection, so expanding,
 * measuring, or moving one child cannot mutate controls, ports, or the size
 * restored on collapse.
 */
export function blockExpandedProjectionSizeV2(
  instanceValue: BlockInstanceV2,
  projectedNodes?: readonly CustomNodeType[],
) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return expandedSizeForNormalizedInstanceV2(instance, projectedNodes);
}

function expandedSizeForNormalizedInstanceV2(instance: BlockInstanceV2, projectedNodes?: readonly CustomNodeType[]) {
  const children = projectedNodes ?? projectedChildren(instance, false);
  // Collapsed/user-resized geometry and expanded/composition geometry are two
  // independent projections. Starting from presentation.size caused a resize
  // performed in collapsed mode to leak into the expanded wrapper and, with
  // React Flow's retained measurement for the same id, could pin that wrapper
  // to the collapsed rectangle while its children used the reviewed layout.
  let width = DEFAULT_ROOT_WIDTH;
  let height = DEFAULT_ROOT_HEIGHT;
  const byId = new Map(children.map((child) => [child.id, child]));
  const bottomInset = expandedConnectorInsetV2(
    instance.effectiveInterface.boundary.inputs.length,
    instance.effectiveInterface.boundary.outputs.length,
  );

  children.forEach((child) => {
    if (child.data.blockProjectionOwnerId !== instance.instanceId) return;
    const position = projectionPositionRelativeToRoot(child, byId, instance.instanceId);
    const childWidth = child.measured?.width ?? child.width ?? EXPANDED_CHILD_FALLBACK_WIDTH;
    const childHeight = child.measured?.height ?? child.height ?? EXPANDED_CHILD_FALLBACK_HEIGHT;
    width = Math.max(width, position.x + childWidth + EXPANDED_RIGHT_PADDING);
    height = Math.max(height, position.y + childHeight + bottomInset);
  });

  return { width: Math.ceil(width), height: Math.ceil(height) };
}

function projectedInternalEdges(instance: BlockInstanceV2, mode: 'canvas' | 'execution' = 'canvas'): Edge[] {
  if (mode === 'canvas') return blockProjectionSurfaceV2(instance).edges;
  return instance.effectiveGraph.edges.map((edge) => ({
    id: blockProjectionEdgeIdV2(instance.instanceId, edge.edgeId),
    source: blockProjectionNodeIdV2(instance.instanceId, edge.sourceNodeId),
    sourceHandle: edge.sourcePortId,
    target: blockProjectionNodeIdV2(instance.instanceId, edge.targetNodeId),
    targetHandle: edge.targetPortId,
    type: 'smoothstep',
    zIndex: -1,
    data: {
      blockProjectionOwnerId: instance.instanceId,
      blockProjectionEdgeId: edge.edgeId,
      blockProjectionKind: 'internal',
    },
  }));
}

/** Project a root and, when expanded, its ordinary internal nodes and links. */
export function materializeBlockProjectionV2(rootValue: CustomNodeType): BlockFlowGraphV2 {
  const instance = normalizedRootInstance(rootValue);
  const root = {
    ...rootNodeForNormalizedInstanceV2(instance),
    ...(rootValue.selected === undefined ? {} : { selected: rootValue.selected }),
  };
  if (!instance.presentation.expanded) return { nodes: [root], edges: [] };
  return {
    nodes: [root, ...projectedChildren(instance, false)],
    edges: projectedInternalEdges(instance),
  };
}

function assertUniqueGraphIds(nodes: CustomNodeType[], edges: Edge[]) {
  const nodeIds = new Set<string>();
  nodes.forEach(({ id }) => {
    if (!id || nodeIds.has(id)) throw new Error(`Invalid Block V2 graph: duplicate or empty node id ${id}.`);
    nodeIds.add(id);
  });
  const edgeIds = new Set<string>();
  edges.forEach(({ id, source, target }) => {
    if (!id || edgeIds.has(id)) throw new Error(`Invalid Block V2 graph: duplicate or empty edge id ${id}.`);
    if (!nodeIds.has(source) || !nodeIds.has(target))
      throw new Error(`Invalid Block V2 graph: edge ${id} references an unknown node.`);
    edgeIds.add(id);
  });
}

function rootsById(nodes: CustomNodeType[]) {
  return new Map(
    nodes.filter(isV2Candidate).map((node) => {
      const instance = normalizedRootInstance(node);
      return [node.id, instance] as const;
    }),
  );
}

function hasProjectionNodeMarker(node: CustomNodeType) {
  return PROJECTION_NODE_FIELDS.some((field) => hasOwn(node.data, field));
}

function projectionNodeReceipt(node: CustomNodeType) {
  if (!hasProjectionNodeMarker(node)) return null;
  if (
    node.data.blockProjectionKind !== 'internal' ||
    typeof node.data.blockProjectionOwnerId !== 'string' ||
    !node.data.blockProjectionOwnerId ||
    typeof node.data.blockProjectionNodeId !== 'string' ||
    !node.data.blockProjectionNodeId ||
    node.data.blockInstanceV2 !== undefined
  )
    throw new Error(`Invalid Block V2 projection node ${node.id}: malformed ownership receipt.`);
  return {
    ownerId: node.data.blockProjectionOwnerId,
    semanticNodeId: node.data.blockProjectionNodeId,
  };
}

function hasProjectionEdgeMarker(edge: Edge) {
  const data = isRecord(edge.data) ? edge.data : {};
  return PROJECTION_EDGE_FIELDS.some((field) => hasOwn(data, field));
}

function projectionEdgeReceipt(edge: Edge) {
  const data = isRecord(edge.data) ? edge.data : {};
  if (!hasProjectionEdgeMarker(edge)) return null;
  if (
    data.blockProjectionKind !== 'internal' ||
    typeof data.blockProjectionOwnerId !== 'string' ||
    !data.blockProjectionOwnerId ||
    typeof data.blockProjectionEdgeId !== 'string' ||
    !data.blockProjectionEdgeId
  )
    throw new Error(`Invalid Block V2 projection edge ${edge.id}: malformed ownership receipt.`);
  return { ownerId: data.blockProjectionOwnerId, semanticEdgeId: data.blockProjectionEdgeId };
}

function containsBlockV2RuntimeData(nodes: CustomNodeType[], edges: Edge[]) {
  return (
    nodes.some((node) => isV2Candidate(node) || hasProjectionNodeMarker(node)) || edges.some(hasProjectionEdgeMarker)
  );
}

function validatedProjectionInventory(
  nodes: CustomNodeType[],
  edges: Edge[],
  rootInstances: ReadonlyMap<string, BlockInstanceV2>,
) {
  const nodeIds = new Set<string>();
  nodes.forEach((node) => {
    const receipt = projectionNodeReceipt(node);
    if (!receipt) return;
    const owner = rootInstances.get(receipt.ownerId);
    if (!owner)
      throw new Error(`Invalid Block V2 projection node ${node.id}: authoritative root ${receipt.ownerId} is absent.`);
    if (!owner.effectiveGraph.nodes.some(({ nodeId }) => nodeId === receipt.semanticNodeId))
      throw new Error(
        `Invalid Block V2 projection node ${node.id}: semantic node ${receipt.semanticNodeId} is not in the effective graph.`,
      );
    const expectedId = blockProjectionNodeIdV2(receipt.ownerId, receipt.semanticNodeId);
    if (node.id !== expectedId)
      throw new Error(`Invalid Block V2 projection node ${node.id}: expected deterministic id ${expectedId}.`);
    nodeIds.add(node.id);
  });

  const edgeIds = new Set<string>();
  // Call-local only: every owner above has just been validated. Rebuilding the
  // entire visible surface per edge made Save/Run quadratic in graph links.
  // Never retain this map across calls or cache caller-owned mutable authority.
  const expectedEdgesByOwner = new Map<string, Map<string, Edge>>();
  edges.forEach((edge) => {
    const receipt = projectionEdgeReceipt(edge);
    if (!receipt) {
      if (nodeIds.has(edge.source) || nodeIds.has(edge.target))
        throw new Error(
          `Invalid Block V2 graph: external edge ${edge.id} targets a derived child; connect it to the root public port instead.`,
        );
      return;
    }
    const owner = rootInstances.get(receipt.ownerId);
    if (!owner)
      throw new Error(`Invalid Block V2 projection edge ${edge.id}: authoritative root ${receipt.ownerId} is absent.`);
    const semantic = owner.effectiveGraph.edges.find(({ edgeId }) => edgeId === receipt.semanticEdgeId);
    if (!semantic)
      throw new Error(
        `Invalid Block V2 projection edge ${edge.id}: semantic edge ${receipt.semanticEdgeId} is not in the effective graph.`,
      );
    let expectedEdges = expectedEdgesByOwner.get(receipt.ownerId);
    if (!expectedEdges) {
      expectedEdges = new Map(
        projectedInternalEdges(owner, 'canvas').map((candidate) => [
          String(candidate.data?.blockProjectionEdgeId),
          candidate,
        ]),
      );
      expectedEdgesByOwner.set(receipt.ownerId, expectedEdges);
    }
    const expected = expectedEdges.get(receipt.semanticEdgeId);
    if (!expected)
      throw new Error(
        `Invalid Block V2 projection edge ${edge.id}: semantic edge ${receipt.semanticEdgeId} is hidden inside one collapsed subtree.`,
      );
    if (
      edge.id !== expected.id ||
      edge.source !== expected.source ||
      edge.target !== expected.target ||
      edge.sourceHandle !== expected.sourceHandle ||
      edge.targetHandle !== expected.targetHandle ||
      canonicalBlockStringifyV2(edge.data?.blockProjectionEdgeIds ?? null) !==
        canonicalBlockStringifyV2(expected.data?.blockProjectionEdgeIds ?? null) ||
      !nodeIds.has(expected.source) ||
      !nodeIds.has(expected.target)
    )
      throw new Error(`Invalid Block V2 projection edge ${edge.id}: receipt and projected endpoints disagree.`);
    edgeIds.add(edge.id);
  });
  return { nodeIds, edgeIds };
}

function effectiveParam(instance: BlockInstanceV2, nodeId: string, fieldId: string, label: string): NodeParams {
  const node = instance.effectiveGraph.nodes.find((candidate) => candidate.nodeId === nodeId);
  const params = sourceParams(node);
  if (!node || !hasOwn(params, fieldId))
    throw new Error(
      `Cannot expand Block V2 instance ${instance.instanceId}: ${label} no longer binds to ${nodeId}.${fieldId}.`,
    );
  return params[fieldId]!;
}

/** Validate a proposed wire against durable fields, never transient canvas metadata. */
export function assertBlockInternalConnectionV2(
  instance: BlockInstanceV2,
  sourceEndpoint: { nodeId: string; fieldOrPortId: string },
  targetEndpoint: { nodeId: string; fieldOrPortId: string },
) {
  const controls = [
    ...instance.effectiveInterface.controls,
    ...instance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
  ];
  const sealed = controls.find(
    (control) =>
      control.sealed &&
      controlBindingTargetsV2(control).some(
        (binding) => binding.nodeId === targetEndpoint.nodeId && binding.fieldId === targetEndpoint.fieldOrPortId,
      ),
  );
  if (sealed)
    throw new Error(
      `Cannot wire sealed Block control "${sealed.label}". Use the reviewed model/route selector or replace its owning node explicitly.`,
    );
  const source = effectiveParam(instance, sourceEndpoint.nodeId, sourceEndpoint.fieldOrPortId, 'connection source');
  const target = effectiveParam(instance, targetEndpoint.nodeId, targetEndpoint.fieldOrPortId, 'connection target');
  if (
    source.display !== 'output' ||
    target.display === 'output' ||
    !blockValueTypesAreCompatibleV2(source.type, target.type)
  )
    throw new Error('Cannot connect these Block fields: their current semantic types or directions are incompatible.');
}

function validateEffectiveGraphForExecution(instance: BlockInstanceV2, included?: ReadonlySet<string>) {
  const inScope = (nodeId: string) => !included || included.has(nodeId);
  const scopedEdges = instance.effectiveGraph.edges.filter(
    (edge) => inScope(edge.sourceNodeId) && inScope(edge.targetNodeId),
  );
  const scoped = included
    ? { ...instance, effectiveGraph: { ...instance.effectiveGraph, edges: scopedEdges } }
    : instance;
  instance.effectiveGraph.nodes.filter((node) => inScope(node.nodeId)).forEach(runtimeNodeType);
  instance.effectiveInterface.controls.forEach((control) => {
    controlBindingTargetsV2(control).forEach((binding) => {
      if (!inScope(binding.nodeId)) return;
      const param = effectiveParam(instance, binding.nodeId, binding.fieldId, `control ${control.controlId}`);
      if (!blockValueTypesAreCompatibleV2(control.valueType, param.type) || param.display === 'output')
        throw new Error(
          `Cannot expand Block V2 instance ${instance.instanceId}: control ${control.controlId} has an incompatible effective field type.`,
        );
    });
  });
  const validatePort = (port: BlockPortV2, direction: 'input' | 'output') => {
    const bindings = direction === 'input' ? blockInputPortBindingsV2(port) : [port.binding];
    bindings.forEach((binding) => {
      if (!inScope(binding.nodeId)) return;
      const param = effectiveParam(
        instance,
        binding.nodeId,
        binding.fieldOrPortId,
        `public ${direction} ${port.portId}`,
      );
      if (
        (!blockValueTypesAreCompatibleV2(port.valueType, param.type) &&
          !(direction === 'input' && blockMediaFileBoundaryIsCompatibleV2(port.valueType, param))) ||
        (direction === 'input' && param.display === 'output')
      )
        throw new Error(
          `Cannot expand Block V2 instance ${instance.instanceId}: public ${direction} ${port.portId} has an incompatible effective field type.`,
        );
    });
  };
  instance.effectiveInterface.boundary.inputs.forEach((port) => validatePort(port, 'input'));
  instance.effectiveInterface.boundary.outputs.forEach((port) => validatePort(port, 'output'));
  instance.previewStates
    .map(({ binding }) => binding)
    .forEach((preview) => {
      if (!inScope(preview.nodeId)) return;
      effectiveParam(
        instance,
        preview.nodeId,
        preview.outputPortId,
        `preview ${preview.nodeId}.${preview.outputPortId}`,
      );
    });
  scopedEdges.forEach((edge) => {
    const source = effectiveParam(
      instance,
      edge.sourceNodeId,
      edge.sourcePortId,
      `internal edge ${edge.edgeId} source`,
    );
    const target = effectiveParam(
      instance,
      edge.targetNodeId,
      edge.targetPortId,
      `internal edge ${edge.edgeId} target`,
    );
    if (
      source.display !== 'output' ||
      target.display === 'output' ||
      !blockValueTypesAreCompatibleV2(source.type, target.type)
    )
      throw new Error(
        `Cannot expand Block V2 instance ${instance.instanceId}: internal edge ${edge.edgeId} connects incompatible types.`,
      );
    assertBlockInternalConnectionV2(
      scoped,
      { nodeId: edge.sourceNodeId, fieldOrPortId: edge.sourcePortId },
      { nodeId: edge.targetNodeId, fieldOrPortId: edge.targetPortId },
    );
  });
}

/**
 * Replace every V2 root with the same effective internal graph used by the
 * canvas projection and translate stable public boundary edges for execution.
 */
export function expandBlockGraphV2ForExecution(
  nodesValue: CustomNodeType[],
  edgesValue: Edge[],
  targetNodeId?: string,
): BlockFlowGraphV2 {
  const selected = nodesValue.find(({ id }) => id === targetNodeId);
  const selectedOwnerId = selected?.data.blockInstanceV2
    ? selected.id
    : selected?.data.blockProjectionContainer
      ? selected.data.blockProjectionOwnerId
      : undefined;
  const selectedInstance = nodesValue.find(({ id }) => id === selectedOwnerId)?.data.blockInstanceV2;
  const selectedSemanticIds = selectedInstance
    ? selected?.data.blockProjectionNodeId
      ? blockGraphSubtreeNodeIdsV2(selectedInstance.effectiveGraph, selected.data.blockProjectionNodeId)
      : new Set(selectedInstance.effectiveGraph.nodes.map(({ nodeId }) => nodeId))
    : undefined;
  if (selectedOwnerId) {
    // A selected Block still consumes its wired inputs. Retain upstream owners
    // before validating/expanding, while unrelated drafts stay out of the run.
    const ownerById = new Map(nodesValue.map((node) => [node.id, node.data.blockProjectionOwnerId ?? node.id]));
    const retainedOwners = new Set([selectedOwnerId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edgesValue) {
        const source = ownerById.get(edge.source);
        const target = ownerById.get(edge.target);
        if (source && target && retainedOwners.has(target) && !retainedOwners.has(source)) {
          retainedOwners.add(source);
          changed = true;
        }
      }
    }
    nodesValue = nodesValue.filter((node) => retainedOwners.has(node.data.blockProjectionOwnerId ?? node.id));
    const retained = new Set(nodesValue.map(({ id }) => id));
    edgesValue = edgesValue.filter((edge) => retained.has(edge.source) && retained.has(edge.target));
  }
  if (selectedInstance && selectedSemanticIds) {
    // Nested selection can depend on siblings elsewhere in the same owner.
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of selectedInstance.effectiveGraph.edges) {
        if (selectedSemanticIds.has(edge.targetNodeId) && !selectedSemanticIds.has(edge.sourceNodeId)) {
          selectedSemanticIds.add(edge.sourceNodeId);
          changed = true;
        }
      }
    }
  }
  if (!containsBlockV2RuntimeData(nodesValue, edgesValue))
    return { nodes: cloneJson(nodesValue), edges: cloneJson(edgesValue) };
  assertUniqueGraphIds(nodesValue, edgesValue);
  const rootInstances = rootsById(nodesValue);
  const projection = validatedProjectionInventory(nodesValue, edgesValue, rootInstances);
  if (!rootInstances.size) return { nodes: cloneJson(nodesValue), edges: cloneJson(edgesValue) };

  rootInstances.forEach((instance, id) =>
    validateEffectiveGraphForExecution(instance, id === selectedOwnerId ? selectedSemanticIds : undefined),
  );
  const externalNodes = nodesValue
    .filter((node) => !rootInstances.has(node.id) && !projection.nodeIds.has(node.id))
    .map(cloneJson);
  const executionNodes = [...rootInstances.entries()].flatMap(([id, instance]) =>
    projectedChildren(instance, true, id === selectedOwnerId ? selectedSemanticIds : undefined),
  );
  const occupied = new Set(externalNodes.map(({ id }) => id));
  executionNodes.forEach(({ id }) => {
    if (occupied.has(id)) throw new Error(`Cannot expand Block V2 graph: projected node id ${id} already exists.`);
    occupied.add(id);
  });

  const translatedEdges = edgesValue
    .filter((edge) => !projection.edgeIds.has(edge.id))
    .flatMap((edge) => {
      const sourceInstance = rootInstances.get(edge.source);
      const targetInstance = rootInstances.get(edge.target);
      let source = edge.source;
      let sourceHandle = edge.sourceHandle;
      const target = edge.target;
      const targetHandle = edge.targetHandle;
      if (sourceInstance) {
        const crossing = parseBlockCrossingHandleV2(sourceHandle);
        if (crossing) blockCrossingParamV2(sourceInstance, crossing);
        const port =
          crossing?.direction === 'output'
            ? { binding: crossing }
            : sourceInstance.effectiveInterface.boundary.outputs.find(({ portId }) => portId === sourceHandle);
        if (!port)
          throw new Error(
            `Cannot expand Block V2 instance ${sourceInstance.instanceId}: edge ${edge.id} references unknown output ${String(sourceHandle)}.`,
          );
        source = blockProjectionNodeIdV2(sourceInstance.instanceId, port.binding.nodeId);
        sourceHandle = port.binding.fieldOrPortId;
      }
      if (targetInstance) {
        const crossing = parseBlockCrossingHandleV2(targetHandle);
        if (crossing) blockCrossingParamV2(targetInstance, crossing);
        const port =
          crossing?.direction === 'input'
            ? { binding: crossing, mirrorBindings: undefined }
            : targetInstance.effectiveInterface.boundary.inputs.find(({ portId }) => portId === targetHandle);
        if (!port)
          throw new Error(
            `Cannot expand Block V2 instance ${targetInstance.instanceId}: edge ${edge.id} references unknown input ${String(targetHandle)}.`,
          );
        const bindings = [port.binding, ...(port.mirrorBindings ?? [])];
        for (const binding of bindings) {
          const sealed = [
            ...targetInstance.effectiveInterface.controls,
            ...targetInstance.effectiveGraph.nodes.flatMap((node) => node.containerInterface?.controls ?? []),
          ].find(
            (control) =>
              control.sealed &&
              controlBindingTargetsV2(control).some(
                (target) => target.nodeId === binding.nodeId && target.fieldId === binding.fieldOrPortId,
              ),
          );
          if (sealed)
            throw new Error(
              `Cannot run connected sealed Block control "${sealed.label}". Disconnect its incoming wire or explicitly replace its owning node.`,
            );
        }
        return bindings.map((binding, index) => ({
          ...cloneJson(edge),
          ...(index
            ? {
                id: blockInputMirrorEdgeIdV2(
                  edge.id,
                  targetInstance.instanceId,
                  binding.nodeId,
                  binding.fieldOrPortId,
                  index,
                ),
              }
            : {}),
          source,
          sourceHandle,
          target: blockProjectionNodeIdV2(targetInstance.instanceId, binding.nodeId),
          targetHandle: binding.fieldOrPortId,
        }));
      }
      return [{ ...cloneJson(edge), source, sourceHandle, target, targetHandle }];
    });

  // Presentation collapse never changes execution. The backend receives all
  // exact semantic edges and leaf endpoints even when the canvas currently
  // lifts those links to collapsed subtree boundaries.
  const internalEdges = [...rootInstances.values()].flatMap((instance) =>
    projectedInternalEdges(instance, 'execution'),
  );
  const edgeIds = new Set<string>();
  [...translatedEdges, ...internalEdges].forEach(({ id }) => {
    if (edgeIds.has(id)) throw new Error(`Cannot expand Block V2 graph: projected edge id ${id} already exists.`);
    edgeIds.add(id);
  });
  const internalNodeIds = new Set(executionNodes.map(({ id }) => id));
  const incomingByField = new Map<string, string>();
  for (const edge of [...translatedEdges, ...internalEdges]) {
    if (!internalNodeIds.has(edge.target) || !edge.targetHandle) continue;
    const key = `${edge.target}\0${edge.targetHandle}`;
    const previous = incomingByField.get(key);
    if (previous)
      throw new Error(
        `Cannot run Block input ${edge.targetHandle}: incoming edges ${previous} and ${edge.id} both drive the same field. Disconnect one source or combine them in an upstream node first.`,
      );
    incomingByField.set(key, edge.id);
  }
  if (selectedSemanticIds) {
    const included = new Set(
      [...selectedSemanticIds].map((nodeId) => blockProjectionNodeIdV2(selectedOwnerId!, nodeId)),
    );
    const allEdges = [...translatedEdges, ...internalEdges];
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of allEdges) {
        if (included.has(edge.target) && !included.has(edge.source)) {
          included.add(edge.source);
          changed = true;
        }
      }
    }
    return {
      nodes: [...externalNodes, ...executionNodes].filter(({ id }) => included.has(id)),
      edges: allEdges.filter((edge) => included.has(edge.source) && included.has(edge.target)),
    };
  }
  return { nodes: [...externalNodes, ...executionNodes], edges: [...translatedEdges, ...internalEdges] };
}

/** Rebuild a durable root solely from its embedded instance authority. */
export function canonicalizePersistedBlockRootV2(rootValue: CustomNodeType): CustomNodeType {
  return rootNodeForNormalizedInstanceV2(normalizedRootInstance(rootValue));
}

/**
 * Remove all replaceable V2 child/edge projections and canonicalize V2 roots.
 * External workflow edges stay attached to stable public root port ids.
 */
export function canonicalizePersistedBlockGraphV2(nodesValue: CustomNodeType[], edgesValue: Edge[]): BlockFlowGraphV2 {
  if (!containsBlockV2RuntimeData(nodesValue, edgesValue))
    return { nodes: cloneJson(nodesValue), edges: cloneJson(edgesValue) };
  assertUniqueGraphIds(nodesValue, edgesValue);
  const rootInstances = rootsById(nodesValue);
  const projection = validatedProjectionInventory(nodesValue, edgesValue, rootInstances);
  const nodes = nodesValue.flatMap((node) => {
    if (projection.nodeIds.has(node.id)) return [];
    const instance = rootInstances.get(node.id);
    if (instance) return [rootNodeForNormalizedInstanceV2(instance)];
    return [cloneJson(node)];
  });
  const retainedNodeIds = new Set(nodes.map(({ id }) => id));
  const edges = edgesValue
    .filter(
      (edge) =>
        !projection.edgeIds.has(edge.id) && retainedNodeIds.has(edge.source) && retainedNodeIds.has(edge.target),
    )
    .map(cloneJson);
  return { nodes, edges };
}
