import type { Edge, XYPosition } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { deepEqual } from '../utils/deepEqual';
import { compositeInstanceChildren } from './compositeNodes';
import {
  createHuggingFaceClusterInstance,
  huggingFaceClusterParameterProjection,
  setHuggingFaceClusterExecution,
  setHuggingFaceClusterExecutionParameter,
  setHuggingFaceClusterParameter,
  setHuggingFaceClusterPresentation,
  validateHuggingFaceClusterInstance,
  type HuggingFaceClusterInstance,
} from './huggingFaceClusterInstance';
import type { HuggingFaceNodeLibraryDefinition, HuggingFaceNodeLibraryField } from './huggingFaceNodeLibrary';
import type {
  HuggingFaceClusterExecutableGraph,
  HuggingFaceClusterExecutionSkeleton,
  HuggingFaceClusterPersistedBinding,
} from './huggingFaceClusterMaterializer';
import { huggingFaceClusterDisplayLabel } from './huggingFaceNodeCatalog';

export type HuggingFaceClusterGraph = {
  nodes: CustomNodeType[];
  edges: Edge[];
};

export const HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH = 360;
export const HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT = 320;
export const HUGGING_FACE_CLUSTER_INPUT_PORT_PREFIX = '__hf_cluster_input__';
export const HUGGING_FACE_CLUSTER_OUTPUT_PORT_PREFIX = '__hf_cluster_output__';

const CLUSTER_CHILD_TOP = 64;
const CLUSTER_CHILD_PADDING = 32;
const MATERIALIZED_NODE_PADDING = 24;
const CLUSTER_PREVIEW_DISPLAYS = new Set(['ui_image', 'ui_video', 'ui_audio', 'ui_text', 'ui_imagecompare']);

function words(value: string) {
  return value
    .replace(/ModularPipeline$/u, '')
    .replace(/Pipeline$/u, '')
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function clusterLabel(definition: HuggingFaceNodeLibraryDefinition) {
  return huggingFaceClusterDisplayLabel(definition);
}

const IMAGE_MEDIA_BINDING_SOURCES = new Set([
  'referenceImages',
  'conditionImages',
  'maskImage',
  'lastImage',
  'controlImage',
  'ipAdapterImage',
]);
const VIDEO_MEDIA_BINDING_SOURCES = new Set([
  'sourceVideo',
  'referenceVideos',
  'controlVideo',
  'maskVideo',
  'poseVideo',
  'faceVideo',
  'backgroundVideo',
]);
const AUDIO_MEDIA_BINDING_SOURCES = new Set(['sourceAudio', 'referenceAudio']);

function mediaBindingKind(
  definition: HuggingFaceNodeLibraryDefinition,
  input: string,
): 'image' | 'video' | 'audio' | null {
  const sources = definition.executionAdmissions.flatMap((admission) =>
    admission.instanceInputBindings.flatMap((binding) => (binding.input === input ? [binding.bindingSource] : [])),
  );
  const kinds = new Set(
    sources.flatMap((source) =>
      IMAGE_MEDIA_BINDING_SOURCES.has(source)
        ? ['image' as const]
        : VIDEO_MEDIA_BINDING_SOURCES.has(source)
          ? ['video' as const]
          : AUDIO_MEDIA_BINDING_SOURCES.has(source)
            ? ['audio' as const]
            : [],
    ),
  );
  return kinds.size === 1 ? ([...kinds][0] ?? null) : null;
}

function fieldParam(
  field: HuggingFaceNodeLibraryField,
  value: unknown,
  definition: HuggingFaceNodeLibraryDefinition,
): NodeParams {
  const sourceTypeTokens = field.type.toLowerCase().split(/[^a-z]+/u);
  const mediaKind = mediaBindingKind(definition, field.name);
  const type = sourceTypeTokens.includes('bool')
    ? 'bool'
    : sourceTypeTokens.includes('int') || sourceTypeTokens.includes('integer')
      ? 'int'
      : sourceTypeTokens.includes('float')
        ? 'float'
        : sourceTypeTokens.includes('str') || sourceTypeTokens.includes('string')
          ? 'string'
          : field.type;
  const suggested = definition.suggestedInputs?.values[field.name];
  const suggestionSource = suggested === undefined ? undefined : definition.suggestedInputs?.source;
  return {
    type,
    display: mediaKind ? 'filebrowser' : /prompt|description|caption|lyrics/u.test(field.name) ? 'textarea' : undefined,
    label: words(field.name),
    value,
    default: field.default,
    description: [
      field.description,
      suggestionSource
        ? `Initial value: ${suggestionSource.label}${suggestionSource.url ? ` (${suggestionSource.url})` : ''}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    required: field.required,
    fieldOptions: {
      huggingFaceType: field.type,
      huggingFaceSource: 'hugging_face_cluster',
      ...(suggestionSource
        ? {
            huggingFaceSuggestedInputSourceKind: suggestionSource.kind,
            huggingFaceSuggestedInputSourceLabel: suggestionSource.label,
            huggingFaceSuggestedInputSourceUrl: suggestionSource.url,
          }
        : {}),
      ...(mediaKind ? { fileTypes: [mediaKind], multiple: sourceTypeTokens.includes('list') } : {}),
    },
  };
}

function projectedParams(
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  current: Record<string, NodeParams> = {},
) {
  const derived = Object.fromEntries(
    Object.entries(current).filter(
      ([, param]) =>
        param.fieldOptions &&
        ((typeof param.fieldOptions.huggingFaceClusterPreviewSourceNodeId === 'string' &&
          typeof param.fieldOptions.huggingFaceClusterPreviewSourceField === 'string') ||
          (typeof param.fieldOptions.huggingFaceClusterPortNodeId === 'string' &&
            typeof param.fieldOptions.huggingFaceClusterPortField === 'string' &&
            param.fieldOptions.huggingFaceClusterPortAdmissionId === instance.execution?.admissionId)),
    ),
  );
  return {
    ...Object.fromEntries(
      huggingFaceClusterParameterProjection(instance, definition).map((field) => [
        field.name,
        fieldParam(field, field.value, definition),
      ]),
    ),
    ...derived,
  };
}

function previewParamId(node: CustomNodeType, field: string) {
  // Root fields are the public composite surface and therefore must be stable
  // across independent insertions of the same registered definition. Runtime
  // child ids include the workflow instance id; the reviewed execution role
  // is the semantic identity shared by every instance.
  const semanticNodeId = node.data.huggingFaceClusterExecutionRole ?? node.id;
  return `__hf_cluster_preview__${encodeURIComponent(semanticNodeId)}__${encodeURIComponent(field)}`;
}

function executionPreviewParams(nodes: readonly CustomNodeType[]) {
  return Object.fromEntries(
    nodes.flatMap((node) =>
      Object.entries(node.data.params).flatMap(([field, param]) =>
        CLUSTER_PREVIEW_DISPLAYS.has(param.display ?? '')
          ? [
              [
                previewParamId(node, field),
                {
                  ...param,
                  fieldOptions: {
                    ...param.fieldOptions,
                    huggingFaceClusterPreviewSourceNodeId: node.id,
                    huggingFaceClusterPreviewSourceField: field,
                  },
                },
              ] as const,
            ]
          : [],
      ),
    ),
  );
}

function clusterPortParam(
  admissionId: string,
  direction: 'input' | 'output',
  node: CustomNodeType,
  field: string,
  label: string,
): NodeParams {
  const source = node.data.params[field];
  return {
    label,
    display: direction,
    type: source?.type ?? 'any',
    isConnected: false,
    fieldOptions: {
      huggingFaceClusterPortAdmissionId: admissionId,
      huggingFaceClusterPortDirection: direction,
      huggingFaceClusterPortNodeId: node.id,
      huggingFaceClusterPortField: field,
    },
  };
}

/**
 * Build the same typed boundary tray used by User Nodes from the concrete,
 * reviewed execution graph. Inputs map to backend-declared instance bindings;
 * outputs map to the values consumed by terminal preview/output nodes.
 */
function executionBoundaryParams(
  skeleton: Pick<HuggingFaceClusterExecutionSkeleton, 'admissionId' | 'nodes' | 'edges'>,
) {
  const inputs = skeleton.nodes.flatMap((node) =>
    Object.entries(node.data.params).flatMap(([field, param]) => {
      const binding = persistedBinding(param.fieldOptions?.huggingFaceClusterBinding);
      if (binding?.persistence !== 'instance_input' || !binding.input) return [];
      return [
        [
          `${HUGGING_FACE_CLUSTER_INPUT_PORT_PREFIX}${binding.input}`,
          clusterPortParam(skeleton.admissionId, 'input', node, field, param.label || binding.input),
        ] as const,
      ];
    }),
  );
  const nodesById = new Map(skeleton.nodes.map((node) => [node.id, node]));
  const previewNodeIds = new Set(
    skeleton.nodes.filter((node) => node.data.huggingFaceClusterExecutionRole === 'preview').map((node) => node.id),
  );
  const outputs = skeleton.edges.flatMap((edge) => {
    if (!previewNodeIds.has(edge.target) || !edge.sourceHandle) return [];
    const source = nodesById.get(edge.source);
    if (!source) return [];
    const param = source.data.params[edge.sourceHandle];
    return [
      [
        `${HUGGING_FACE_CLUSTER_OUTPUT_PORT_PREFIX}${edge.sourceHandle}`,
        clusterPortParam(skeleton.admissionId, 'output', source, edge.sourceHandle, param?.label || edge.sourceHandle),
      ] as const,
    ];
  });
  return Object.fromEntries([...new Map([...inputs, ...outputs]).entries()]);
}

function clusterPortTarget(param: NodeParams | undefined, direction: 'input' | 'output') {
  const options = param?.fieldOptions;
  if (
    options?.huggingFaceClusterPortDirection !== direction ||
    typeof options.huggingFaceClusterPortNodeId !== 'string' ||
    typeof options.huggingFaceClusterPortField !== 'string'
  )
    return null;
  return {
    nodeId: options.huggingFaceClusterPortNodeId,
    field: options.huggingFaceClusterPortField,
  };
}

/** Translate durable root connections to the deterministic execution children
 * before readiness inspection or API export. The visible graph keeps its root
 * edges so collapse/expand never changes the user's workflow topology. */
export function expandHuggingFaceClusterBoundaryEdges(graph: HuggingFaceClusterGraph): HuggingFaceClusterGraph {
  const roots = new Map(
    graph.nodes.filter((node) => node.data.huggingFaceClusterRole === 'root').map((node) => [node.id, node]),
  );
  if (!roots.size) return graph;
  return {
    nodes: graph.nodes,
    edges: graph.edges.map((edge) => {
      const sourceRoot = roots.get(edge.source);
      const targetRoot = roots.get(edge.target);
      const sourceTarget = sourceRoot
        ? clusterPortTarget(sourceRoot.data.params[edge.sourceHandle ?? ''], 'output')
        : null;
      const targetTarget = targetRoot
        ? clusterPortTarget(targetRoot.data.params[edge.targetHandle ?? ''], 'input')
        : null;
      return {
        ...edge,
        ...(sourceTarget ? { source: sourceTarget.nodeId, sourceHandle: sourceTarget.field } : {}),
        ...(targetTarget ? { target: targetTarget.nodeId, targetHandle: targetTarget.field } : {}),
      };
    }),
  };
}

function withoutExecutionPreviews(node: CustomNodeType): CustomNodeType {
  return {
    ...node,
    data: {
      ...node.data,
      params: Object.fromEntries(
        Object.entries(node.data.params).filter(
          ([, param]) => typeof param.fieldOptions?.huggingFaceClusterPreviewSourceNodeId !== 'string',
        ),
      ),
    },
  };
}

function rootWithInstance(
  node: CustomNodeType,
  instance: HuggingFaceClusterInstance,
  definition: HuggingFaceNodeLibraryDefinition,
  size?: { width: number; height: number },
): CustomNodeType {
  return {
    ...node,
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
    data: {
      ...node.data,
      params: projectedParams(instance, definition, node.data.params),
      huggingFaceClusterInstance: instance,
    },
  };
}

function rootInstance(node: CustomNodeType, definition: HuggingFaceNodeLibraryDefinition) {
  if (
    node.data.type !== 'cluster' ||
    node.data.huggingFaceClusterRole !== 'root' ||
    !node.data.huggingFaceClusterInstance
  ) {
    throw new Error(`Node ${node.id} is not a Diffusers Cluster Node root.`);
  }
  const instance = validateHuggingFaceClusterInstance(node.data.huggingFaceClusterInstance, definition);
  if (instance.instanceId !== node.id) throw new Error(`Diffusers Cluster Node identity mismatch for ${node.id}.`);
  return instance;
}

function ownedChildren(nodes: readonly CustomNodeType[], instanceId: string) {
  return compositeInstanceChildren(nodes, instanceId, (node) => node.data.huggingFaceClusterInstanceId);
}

function persistedBinding(value: unknown): HuggingFaceClusterPersistedBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const binding = value as Partial<HuggingFaceClusterPersistedBinding>;
  if (
    binding.schemaVersion !== 1 ||
    typeof binding.admissionId !== 'string' ||
    typeof binding.source !== 'string' ||
    (binding.persistence !== 'instance_input' &&
      binding.persistence !== 'execution_parameter' &&
      binding.persistence !== 'sealed') ||
    (binding.input !== undefined && typeof binding.input !== 'string')
  )
    return null;
  return binding as HuggingFaceClusterPersistedBinding;
}

function withoutOwnedChildren(graph: HuggingFaceClusterGraph, instanceId: string, role?: 'block' | 'execution') {
  const childIds = new Set(
    ownedChildren(graph.nodes, instanceId)
      .filter((node) => role === undefined || node.data.huggingFaceClusterRole === role)
      .map((node) => node.id),
  );
  return {
    nodes: graph.nodes.filter((node) => !childIds.has(node.id)),
    edges: graph.edges.filter((edge) => !childIds.has(edge.source) && !childIds.has(edge.target)),
  };
}

function executionVisibility(graph: HuggingFaceClusterGraph, instanceId: string, expanded: boolean) {
  const executionNodeIds = new Set(
    ownedChildren(graph.nodes, instanceId)
      .filter((node) => node.data.huggingFaceClusterRole === 'execution')
      .map((node) => node.id),
  );
  return {
    nodes: graph.nodes.map((node) => {
      if (!executionNodeIds.has(node.id)) return node;
      const base = node.data.huggingFaceClusterExecutionPosition;
      return {
        ...node,
        // React Flow does not mount `hidden` nodes, then repeatedly warns that
        // the retained internal edges cannot find their handles. Keep the
        // ordinary child cards mounted but visually/inertly hidden while the
        // Cluster is collapsed. This is the same graph; expanding only changes
        // presentation and never rebuilds connector identity.
        hidden: false,
        style: {
          ...node.style,
          visibility: expanded ? ('visible' as const) : ('hidden' as const),
          pointerEvents: expanded ? undefined : ('none' as const),
        },
        position: base
          ? {
              x: base.x + (expanded ? CLUSTER_CHILD_PADDING - MATERIALIZED_NODE_PADDING : 0),
              y: base.y + (expanded ? CLUSTER_CHILD_TOP - MATERIALIZED_NODE_PADDING : 0),
            }
          : node.position,
      };
    }),
    edges: graph.edges.map((edge) =>
      executionNodeIds.has(edge.source) || executionNodeIds.has(edge.target) ? { ...edge, hidden: !expanded } : edge,
    ),
  };
}

export function createHuggingFaceClusterNode(
  definition: HuggingFaceNodeLibraryDefinition,
  instanceId: string,
  position: XYPosition,
  parameterOverrides: Record<string, unknown> = {},
  executionAdmissionId: string | null = null,
  executionParameterOverrides: Record<string, unknown> = {},
): CustomNodeType {
  const created = createHuggingFaceClusterInstance(definition, instanceId, parameterOverrides);
  const selected = executionAdmissionId
    ? setHuggingFaceClusterExecution(created, definition, executionAdmissionId)
    : created;
  const seeded = Object.entries(executionParameterOverrides).reduce(
    (current, [source, value]) => setHuggingFaceClusterExecutionParameter(current, definition, source, value),
    selected,
  );
  // Values projected from the global Studio form are execution seeds, not
  // evidence that the user supplied an optional Modular Diffusers input to
  // this Cluster instance. Later Cluster edits use the setter above and become
  // explicit; clearing them restores omission semantics.
  const instance = seeded.execution
    ? validateHuggingFaceClusterInstance(
        {
          ...seeded,
          execution: { ...seeded.execution, explicitParameterSources: [] },
        },
        definition,
      )
    : seeded;
  return {
    id: instanceId,
    type: 'cluster',
    position,
    width: HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
    height: HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
    selected: false,
    dragging: false,
    data: {
      type: 'cluster',
      module: '',
      action: '',
      label: clusterLabel(definition),
      category: definition.provider === 'diffusers' ? 'Diffusers Cluster Nodes' : 'Transformers Cluster Nodes',
      description: definition.description || `Reviewed ${definition.pipelineClass} ${definition.workflowId} workflow.`,
      params: projectedParams(instance, definition),
      resizable: true,
      uiState: {
        clusterCollapsedWidth: HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
        clusterCollapsedHeight: HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
      },
      huggingFaceClusterRole: 'root',
      huggingFaceClusterInstance: instance,
    },
  };
}

export function isHuggingFaceClusterExpanded(graph: HuggingFaceClusterGraph, instanceId: string) {
  const root = graph.nodes.find((node) => node.id === instanceId);
  return Boolean(root?.data.huggingFaceClusterInstance?.presentation.expanded);
}

export function expandedHuggingFaceClusterAtPosition(nodes: CustomNodeType[], position: XYPosition) {
  const candidates = nodes
    .filter(
      (node) =>
        node.data.huggingFaceClusterRole === 'root' &&
        node.data.huggingFaceClusterInstance?.presentation.expanded &&
        !node.parentId,
    )
    .filter((node) => {
      const width = node.measured?.width ?? node.width ?? HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH;
      const height = node.measured?.height ?? node.height ?? HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT;
      return (
        position.x >= node.position.x &&
        position.x <= node.position.x + width &&
        position.y >= node.position.y &&
        position.y <= node.position.y + height
      );
    })
    .sort((left, right) => {
      const leftArea =
        (left.measured?.width ?? left.width ?? HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH) *
        (left.measured?.height ?? left.height ?? HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT);
      const rightArea =
        (right.measured?.width ?? right.width ?? HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH) *
        (right.measured?.height ?? right.height ?? HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT);
      return leftArea - rightArea;
    });
  return candidates[0] ?? null;
}

/** Keep the expanded Cluster frame fitted to the same ordinary child cards
 * React Flow renders for User Nodes. Child measurements arrive after the
 * structural skeleton, so this is intentionally safe to call repeatedly. */
export function fitHuggingFaceClusterInstance(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId && node.data.huggingFaceClusterRole === 'root');
  if (!root?.data.huggingFaceClusterInstance?.presentation.expanded) return graph;
  const children = ownedChildren(graph.nodes, instanceId).filter(
    (node) => node.data.huggingFaceClusterRole === 'execution' && !node.hidden,
  );
  if (!children.length) return graph;
  const width = Math.ceil(
    Math.max(
      HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
      ...children.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 320) + CLUSTER_CHILD_PADDING),
    ),
  );
  const height = Math.ceil(
    Math.max(
      HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
      ...children.map(
        (node) => node.position.y + (node.measured?.height ?? node.height ?? 260) + CLUSTER_CHILD_PADDING,
      ),
    ),
  );
  if (Math.abs((root.width ?? 0) - width) < 0.5 && Math.abs((root.height ?? 0) - height) < 0.5) return graph;
  return {
    nodes: graph.nodes.map((node) => (node.id === instanceId ? { ...node, width, height } : node)),
    edges: graph.edges,
  };
}

export function collapsedHuggingFaceClusterPreviewTarget(
  nodes: readonly CustomNodeType[],
  runtimeNodeId: string,
  field: string,
): { nodeId: string; fieldKey: string } | null {
  const child = nodes.find((node) => node.id === runtimeNodeId && node.data.huggingFaceClusterRole === 'execution');
  const instanceId = child?.data.huggingFaceClusterInstanceId;
  if (!instanceId) return null;
  const root = nodes.find(
    (node) =>
      node.id === instanceId &&
      node.data.huggingFaceClusterRole === 'root' &&
      !node.data.huggingFaceClusterInstance?.presentation.expanded,
  );
  if (!root) return null;
  const preview = Object.entries(root.data.params).find(
    ([, param]) =>
      param.fieldOptions?.huggingFaceClusterPreviewSourceNodeId === runtimeNodeId &&
      param.fieldOptions?.huggingFaceClusterPreviewSourceField === field,
  );
  return preview ? { nodeId: root.id, fieldKey: preview[0] } : null;
}

export function expandHuggingFaceClusterInstance(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  // Older workflow snapshots may briefly contain the former presentation-only
  // `sub_blocks` hierarchy. It is deliberately discarded: an expanded Cluster
  // is a graph canvas, not a nested hierarchy inspector.
  const base = withoutOwnedChildren(graph, instanceId, 'block');
  const expanded = setHuggingFaceClusterPresentation(instance, definition, {
    ...instance.presentation,
    expanded: true,
  });
  const visibleExecution = executionVisibility(base, instanceId, true);
  const executionNodes = ownedChildren(visibleExecution.nodes, instanceId).filter(
    (node) => node.data.huggingFaceClusterRole === 'execution',
  );
  const executionWidth = executionNodes.reduce(
    (maximum, node) => Math.max(maximum, node.position.x + (node.width ?? 320) + CLUSTER_CHILD_PADDING),
    0,
  );
  const executionHeight = executionNodes.reduce(
    (maximum, node) => Math.max(maximum, node.position.y + (node.height ?? 260) + CLUSTER_CHILD_PADDING),
    0,
  );
  const collapsedWidth = Math.max(
    HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
    instance.presentation.expanded
      ? (root.data.uiState?.clusterCollapsedWidth ?? HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH)
      : (root.width ?? 0),
  );
  const collapsedHeight = Math.max(
    HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
    instance.presentation.expanded
      ? (root.data.uiState?.clusterCollapsedHeight ?? HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT)
      : (root.height ?? 0),
  );
  const rootWithCollapsedSize = {
    ...root,
    data: {
      ...root.data,
      uiState: {
        ...root.data.uiState,
        clusterCollapsedWidth: collapsedWidth,
        clusterCollapsedHeight: collapsedHeight,
        clusterExecutionEdgesReady: false,
      },
    },
  };
  const expandedRoot = rootWithInstance(rootWithCollapsedSize, expanded, definition, {
    width: Math.max(HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH, executionWidth),
    height: Math.max(HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT, executionHeight),
  });
  return {
    nodes: visibleExecution.nodes.map((node) => (node.id === instanceId ? expandedRoot : node)),
    edges: visibleExecution.edges,
  };
}

export function collapseHuggingFaceClusterInstance(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  const base = withoutOwnedChildren(graph, instanceId, 'block');
  const collapsed = setHuggingFaceClusterPresentation(instance, definition, {
    ...instance.presentation,
    expanded: false,
  });
  const collapsedWidth = Math.max(
    HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
    root.data.uiState?.clusterCollapsedWidth ?? HUGGING_FACE_CLUSTER_COLLAPSED_WIDTH,
  );
  const collapsedHeight = Math.max(
    HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
    root.data.uiState?.clusterCollapsedHeight ?? HUGGING_FACE_CLUSTER_COLLAPSED_HEIGHT,
  );
  return executionVisibility(
    {
      nodes: base.nodes.map((node) =>
        node.id === instanceId
          ? rootWithInstance(node, collapsed, definition, {
              width: collapsedWidth,
              height: collapsedHeight,
            })
          : node,
      ),
      edges: base.edges,
    },
    instanceId,
    false,
  );
}

export function toggleHuggingFaceClusterBlockExpanded(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  path: string,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  const expandedPaths = new Set(instance.presentation.expandedPaths);
  if (expandedPaths.has(path)) expandedPaths.delete(path);
  else expandedPaths.add(path);
  const next = setHuggingFaceClusterPresentation(instance, definition, {
    ...instance.presentation,
    expanded: true,
    expandedPaths: [...expandedPaths],
  });
  const graphWithInstance = {
    nodes: graph.nodes.map((node) => (node.id === instanceId ? rootWithInstance(node, next, definition) : node)),
    edges: graph.edges,
  };
  return expandHuggingFaceClusterInstance(graphWithInstance, instanceId, definition);
}

export function attachHuggingFaceClusterExecutionSkeleton(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  skeleton: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  if (
    skeleton.instanceId !== instanceId ||
    skeleton.definitionId !== definition.id ||
    skeleton.executable !== false ||
    !instance.execution ||
    instance.execution.admissionId !== skeleton.admissionId ||
    instance.execution.studioExecutionSpec.id !== skeleton.studioExecutionSpec.id ||
    instance.execution.studioExecutionSpec.contentHash !== skeleton.studioExecutionSpec.contentHash ||
    instance.execution.studioExecutionSpec.executionProfileId !== skeleton.studioExecutionSpec.executionProfileId
  )
    throw new Error('Diffusers Cluster Node execution skeleton identity is invalid.');
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  const nodeIds = new Set(skeleton.nodes.map((node) => node.id));
  if (
    nodeIds.size !== skeleton.nodes.length ||
    skeleton.nodes.some(
      (node) =>
        node.parentId !== instanceId ||
        node.data.huggingFaceClusterRole !== 'execution' ||
        node.data.huggingFaceClusterInstanceId !== instanceId ||
        node.data.huggingFaceClusterExecutionAdmissionId !== skeleton.admissionId ||
        node.data.huggingFaceClusterExecutionSpecId !== skeleton.studioExecutionSpec.id ||
        node.data.uiState?.disabled !== true,
    ) ||
    skeleton.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
  )
    throw new Error('Diffusers Cluster Node execution skeleton ownership is invalid.');
  const previewParams = executionPreviewParams(skeleton.nodes);
  const boundaryParams = executionBoundaryParams(skeleton);
  const attached = {
    nodes: [
      ...base.nodes.map((node) =>
        node.id === instanceId
          ? {
              ...node,
              data: { ...node.data, params: { ...node.data.params, ...previewParams, ...boundaryParams } },
            }
          : node,
      ),
      ...skeleton.nodes,
    ],
    edges: [...base.edges, ...skeleton.edges],
  };
  return instance.presentation.expanded
    ? expandHuggingFaceClusterInstance(attached, instanceId, definition)
    : collapseHuggingFaceClusterInstance(attached, instanceId, definition);
}

export function attachHuggingFaceClusterExecutableGraph(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  executable: HuggingFaceClusterExecutableGraph,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  if (
    executable.instanceId !== instanceId ||
    executable.definitionId !== definition.id ||
    (executable.claim !== 'qualification_execution_graph' && executable.claim !== 'manual_execution_graph') ||
    executable.executable !== true ||
    !instance.execution ||
    instance.execution.admissionId !== executable.admissionId ||
    instance.execution.studioExecutionSpec.id !== executable.studioExecutionSpec.id ||
    instance.execution.studioExecutionSpec.contentHash !== executable.studioExecutionSpec.contentHash ||
    instance.execution.studioExecutionSpec.executionProfileId !== executable.studioExecutionSpec.executionProfileId
  )
    throw new Error('Diffusers Cluster Node executable graph identity is invalid.');
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  const nodeIds = new Set(executable.nodes.map((node) => node.id));
  if (
    nodeIds.size !== executable.nodes.length ||
    executable.nodes.some(
      (node) =>
        node.parentId !== instanceId ||
        node.data.huggingFaceClusterRole !== 'execution' ||
        node.data.huggingFaceClusterInstanceId !== instanceId ||
        node.data.huggingFaceClusterExecutionAdmissionId !== executable.admissionId ||
        node.data.huggingFaceClusterExecutionSpecId !== executable.studioExecutionSpec.id ||
        node.data.uiState?.disabled === true,
    ) ||
    executable.edges.some((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target))
  )
    throw new Error('Diffusers Cluster Node executable graph ownership is invalid.');
  const previewParams = executionPreviewParams(executable.nodes);
  const boundaryParams = executionBoundaryParams(executable);
  const attached = {
    nodes: [
      ...base.nodes.map((node) =>
        node.id === instanceId
          ? {
              ...node,
              data: { ...node.data, params: { ...node.data.params, ...previewParams, ...boundaryParams } },
            }
          : node,
      ),
      ...executable.nodes,
    ],
    edges: [...base.edges, ...executable.edges],
  };
  return instance.presentation.expanded
    ? expandHuggingFaceClusterInstance(attached, instanceId, definition)
    : collapseHuggingFaceClusterInstance(attached, instanceId, definition);
}

export function setHuggingFaceClusterGraphParameter(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  name: string,
  value: unknown,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = setHuggingFaceClusterParameter(rootInstance(root, definition), definition, name, value);
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  const updated = {
    nodes: base.nodes.map((node) =>
      node.id === instanceId ? rootWithInstance(withoutExecutionPreviews(node), instance, definition) : node,
    ),
    edges: base.edges,
  };
  return instance.presentation.expanded ? expandHuggingFaceClusterInstance(updated, instanceId, definition) : updated;
}

export function setHuggingFaceClusterGraphExecution(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  admissionId: string | null,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = setHuggingFaceClusterExecution(rootInstance(root, definition), definition, admissionId);
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  return {
    nodes: base.nodes.map((node) =>
      node.id === instanceId ? rootWithInstance(withoutExecutionPreviews(node), instance, definition) : node,
    ),
    edges: base.edges,
  };
}

export function setHuggingFaceClusterGraphExecutionParameter(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  source: string,
  value: unknown,
): HuggingFaceClusterGraph {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = setHuggingFaceClusterExecutionParameter(rootInstance(root, definition), definition, source, value);
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  const updated = {
    nodes: base.nodes.map((node) =>
      node.id === instanceId ? rootWithInstance(withoutExecutionPreviews(node), instance, definition) : node,
    ),
    edges: base.edges,
  };
  return instance.presentation.expanded ? expandHuggingFaceClusterInstance(updated, instanceId, definition) : updated;
}

export function setHuggingFaceClusterGraphChildParameter(
  graph: HuggingFaceClusterGraph,
  nodeId: string,
  definition: HuggingFaceNodeLibraryDefinition,
  field: string,
  value: unknown,
): HuggingFaceClusterGraph {
  const child = graph.nodes.find((node) => node.id === nodeId);
  const instanceId = child?.data.huggingFaceClusterInstanceId;
  const param = child?.data.params[field];
  const binding = persistedBinding(param?.fieldOptions?.huggingFaceClusterBinding);
  if (!child || child.data.huggingFaceClusterRole !== 'execution' || !instanceId || !param || !binding)
    throw new Error(`Node ${nodeId}.${field} is not a persisted Diffusers Cluster Node execution parameter.`);
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const current = rootInstance(root, definition);
  if (!current.execution || current.execution.admissionId !== binding.admissionId)
    throw new Error('Diffusers Cluster Node child binding does not match the selected execution admission.');
  // Dynamic node-definition refreshes can echo the already sealed value after
  // the reviewed model type is selected. Treat that exact echo as a no-op,
  // while continuing to reject every attempted mutation of sealed authority.
  if (binding.persistence === 'sealed' && deepEqual(param.value, value)) return graph;
  if (binding.persistence === 'sealed')
    throw new Error(`Diffusers Cluster Node binding ${binding.source} is sealed by the reviewed contract.`);
  let instance: HuggingFaceClusterInstance;
  if (binding.persistence === 'instance_input') {
    if (!binding.input) throw new Error('Diffusers Cluster Node input binding is incomplete.');
    instance = setHuggingFaceClusterParameter(current, definition, binding.input, value);
  } else {
    instance = setHuggingFaceClusterExecutionParameter(current, definition, binding.source, value);
  }
  const base = withoutOwnedChildren(graph, instanceId, 'execution');
  return {
    nodes: base.nodes.map((node) =>
      node.id === instanceId ? rootWithInstance(withoutExecutionPreviews(node), instance, definition) : node,
    ),
    edges: base.edges,
  };
}

/** Persist a layout-only execution-card move on the owning Cluster instance.
 *
 * Execution children themselves are deliberately omitted from workflow
 * snapshots. Store their canonical parent-relative position by reviewed role
 * on the durable root, and update the live child's canonical position so a
 * collapse/expand cycle does not snap it back before Save.
 */
export function setHuggingFaceClusterGraphExecutionPosition(
  graph: HuggingFaceClusterGraph,
  nodeId: string,
  definition: HuggingFaceNodeLibraryDefinition,
): HuggingFaceClusterGraph {
  const child = graph.nodes.find((node) => node.id === nodeId);
  const instanceId = child?.data.huggingFaceClusterInstanceId;
  const role = child?.data.huggingFaceClusterExecutionRole;
  if (!child || child.data.huggingFaceClusterRole !== 'execution' || !instanceId || !role)
    throw new Error(`Node ${nodeId} is not a movable Diffusers Cluster Node execution card.`);
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  const canonicalPosition = instance.presentation.expanded
    ? {
        x: child.position.x - (CLUSTER_CHILD_PADDING - MATERIALIZED_NODE_PADDING),
        y: child.position.y - (CLUSTER_CHILD_TOP - MATERIALIZED_NODE_PADDING),
      }
    : { ...child.position };
  const current = instance.presentation.executionLayout[role];
  if (
    deepEqual(current, canonicalPosition) &&
    deepEqual(child.data.huggingFaceClusterExecutionPosition, canonicalPosition)
  )
    return graph;
  const presentation = {
    ...instance.presentation,
    executionLayout: {
      ...instance.presentation.executionLayout,
      [role]: canonicalPosition,
    },
  };
  const updated = setHuggingFaceClusterPresentation(instance, definition, presentation);
  return {
    nodes: graph.nodes.map((node) =>
      node.id === instanceId
        ? rootWithInstance(node, updated, definition)
        : node.id === nodeId
          ? {
              ...node,
              data: { ...node.data, huggingFaceClusterExecutionPosition: canonicalPosition },
            }
          : node,
    ),
    edges: graph.edges,
  };
}

/**
 * Rebuilds all derived child containers from the exact reviewed definition.
 * Persisted children are never treated as the structural source of truth.
 */
export function reconcileHuggingFaceClusterGraph(
  graph: HuggingFaceClusterGraph,
  instanceId: string,
  definition: HuggingFaceNodeLibraryDefinition,
) {
  const root = graph.nodes.find((node) => node.id === instanceId);
  if (!root) throw new Error(`Diffusers Cluster Node ${instanceId} was not found.`);
  const instance = rootInstance(root, definition);
  // Execution children are derived from a current admission, Studio spec,
  // live registry, dynamic field actions, and runtime/resource proof. A saved
  // node snapshot is never enough to restore that authority after refresh.
  const base = withoutOwnedChildren(graph, instanceId);
  const withoutPreviews = {
    ...base,
    nodes: base.nodes.map((node) => (node.id === instanceId ? withoutExecutionPreviews(node) : node)),
  };
  return instance.presentation.expanded
    ? expandHuggingFaceClusterInstance(withoutPreviews, instanceId, definition)
    : collapseHuggingFaceClusterInstance(withoutPreviews, instanceId, definition);
}
