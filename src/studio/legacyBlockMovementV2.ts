import { remapOperationAuthoring } from '../workflow/operationSharedInputs';
import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import {
  createBlockInstanceV2,
  migrateUserBlockDefinitionV1,
  normalizeBlockDefinitionV2,
  blockGraphHashV2,
  blockDefinitionContentHashV2,
  type BlockDefinitionV2,
  type BlockJsonValue,
} from './blockSchemaV2';
import {
  blockProjectionNodeIdV2,
  createBlockRootNodeV2,
  materializeBlockProjectionV2,
  setBlockPresentationV2,
  setBlockPreviewStateV2 as reduceBlockPreviewStateV2,
} from './blockRuntimeV2';
import {
  collapseUserBlockInstance,
  createUserBlockNode,
  expandUserBlockInstance,
  snapshotUserBlockInstance,
} from './userBlocks';
import { ordinaryForkNode } from './huggingFaceClusterFork';
import type { UserBlockDefinition, UserBlockPort } from './types';
import { remapBlockContainerInterfaceV1 } from './blockContainerInterfaceV1';

export function isLegacyUserBlock(node: CustomNodeType) {
  return (
    !node.data.blockInstanceV2 &&
    node.data.type === 'block' &&
    Boolean(node.data.userBlockSnapshot || node.data.userBlockId)
  );
}

export function isLegacyMembershipBlock(node: CustomNodeType) {
  return isLegacyUserBlock(node) || (!node.data.blockInstanceV2 && node.data.huggingFaceClusterRole === 'root');
}

function snapshotMaterializedCluster(graph: { nodes: CustomNodeType[]; edges: Edge[] }, root: CustomNodeType) {
  const instance = root.data.huggingFaceClusterInstance;
  const children = graph.nodes.filter(
    (node) => node.data.huggingFaceClusterInstanceId === root.id && node.data.huggingFaceClusterRole === 'execution',
  );
  if (!instance?.execution || !children.length) throw new Error('Reopen this Cluster before moving it.');
  if (
    children.some(
      (node) =>
        node.data.huggingFaceClusterExecutionAdmissionId !== instance.execution!.admissionId ||
        node.data.huggingFaceClusterExecutionSpecId !== instance.execution!.studioExecutionSpec.id,
    )
  )
    throw new Error('Reopen this Cluster before moving it.');
  const ordinary = children.map((node) => {
    const fork = ordinaryForkNode(node, root.id);
    return { ...fork, data: { ...fork.data, uiState: { ...node.data.uiState } } };
  });
  const ids = new Map(children.map((node, index) => [node.id, ordinary[index]!.id]));
  const inputs: UserBlockPort[] = [],
    outputs: UserBlockPort[] = [];
  const handles = new Map<string, string>();
  const externalCrossings: Edge[] = [];
  for (const [field, param] of Object.entries(root.data.params)) {
    const options = param.fieldOptions;
    const direction = options?.huggingFaceClusterPortDirection;
    const nodeId =
      typeof options?.huggingFaceClusterPortNodeId === 'string'
        ? ids.get(options.huggingFaceClusterPortNodeId)
        : undefined;
    if (
      !nodeId ||
      typeof options?.huggingFaceClusterPortField !== 'string' ||
      (direction !== 'input' && direction !== 'output')
    )
      continue;
    const id = `port-${field}`;
    handles.set(field, id);
    (direction === 'input' ? inputs : outputs).push({
      id,
      label: param.label ?? field,
      type: param.type ?? 'any',
      nodeId,
      paramKey: options.huggingFaceClusterPortField,
    });
  }
  const owned = new Set(
    graph.nodes
      .filter((node) => node.id === root.id || node.data.huggingFaceClusterInstanceId === root.id)
      .map((node) => node.id),
  );
  const source = useHuggingFaceNodeLibraryStore
    .getState()
    .library?.definitions.find(
      (definition) =>
        definition.id === instance.definition.id && definition.contentHash === instance.definition.contentHash,
    );
  const admission = source?.executionAdmissions.find((item) => item.id === instance.execution!.admissionId);
  const definition: UserBlockDefinition = {
    ...(source
      ? {
          origin: {
            schemaVersion: 1 as const,
            kind: 'hugging_face_cluster_fork' as const,
            provider: source.provider,
            definitionId: source.id,
            contentHash: source.contentHash,
            libraryRevision: source.libraryRevision,
            pipelineClass: source.pipelineClass,
            workflowId: source.workflowId,
            admissionId: instance.execution.admissionId,
            repo: admission?.artifact?.repo,
            revision: admission?.artifact?.revision,
            importedAt: Date.now(),
          },
        }
      : {}),
    id: `legacy-${root.id}`,
    name: root.data.label ?? 'Block',
    version: 1,
    nodes: ordinary,
    edges: graph.edges
      .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
      .map((edge, index) => ({
        ...edge,
        id: `edge-${index}`,
        source: ids.get(edge.source)!,
        target: ids.get(edge.target)!,
      })),
    inputs,
    outputs,
    exposedParams: children.flatMap((child) =>
      Object.entries(child.data.params).flatMap(([field, param]) => {
        const binding = param.fieldOptions?.huggingFaceClusterBinding;
        if (!binding || typeof binding !== 'object' || !('persistence' in binding) || binding.persistence === 'sealed')
          return [];
        return [
          {
            id: `control-${ids.get(child.id)}-${field}`,
            kind: 'graph-param' as const,
            label: param.label ?? field,
            nodeId: ids.get(child.id)!,
            paramKey: field,
          },
        ];
      }),
    ),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const parent = createUserBlockNode(definition, root.position, root.id);
  parent.selected = root.selected;
  // Let the established expansion reader restore the ordinary child graph.
  let next = {
    nodes: [...graph.nodes.filter((node) => !owned.has(node.id)), parent],
    edges: graph.edges.flatMap((edge) => {
      if ((owned.has(edge.source) && edge.source !== root.id) || (owned.has(edge.target) && edge.target !== root.id)) {
        if ((ids.has(edge.source) && !owned.has(edge.target)) || (ids.has(edge.target) && !owned.has(edge.source)))
          externalCrossings.push({ ...edge });
        return [];
      }
      if (
        (edge.source === root.id && !handles.has(edge.sourceHandle ?? '')) ||
        (edge.target === root.id && !handles.has(edge.targetHandle ?? ''))
      )
        throw new Error('Repair the missing public socket.');
      return [
        {
          ...edge,
          ...(edge.source === root.id ? { sourceHandle: handles.get(edge.sourceHandle!) } : {}),
          ...(edge.target === root.id ? { targetHandle: handles.get(edge.targetHandle!) } : {}),
        },
      ];
    }),
  };
  if (instance.presentation.expanded) next = expandUserBlockInstance(next, root.id, []);
  return { ...next, ids, externalCrossings };
}

/** Flatten legacy embedded definitions into the existing V2 graph, retaining
 * each nested interface on a group. There is still only one graph/value store. */
export function migrateLegacyHierarchyV2(
  snapshot: UserBlockDefinition,
  blocks: UserBlockDefinition[],
  depth = 0,
): BlockDefinitionV2 {
  if (depth > 24) throw new Error('The legacy hierarchy exceeds 24 nested Blocks.');
  const copy = JSON.parse(JSON.stringify(snapshot)) as UserBlockDefinition;
  const nested: { id: string; definition: BlockDefinitionV2 }[] = [];
  copy.nodes = (copy.nodes as CustomNodeType[]).map((node) => {
    if (!isLegacyUserBlock(node)) return node;
    const source = node.data.userBlockSnapshot ?? blocks.find((block) => block.id === node.data.userBlockId);
    if (!source) throw new Error(`Missing nested definition: ${node.data.label ?? node.id}`);
    const effective = structuredClone(source);
    for (const control of effective.exposedParams) {
      const target = (effective.nodes as CustomNodeType[]).find((child) => child.id === control.nodeId);
      const value = node.data.params[control.id]?.value;
      if (target && control.paramKey && value !== undefined && target.data.params[control.paramKey])
        target.data.params[control.paramKey]!.value = value;
    }
    nested.push({
      id: node.id,
      definition: migrateLegacyHierarchyV2(safeLegacyIds(effective).snapshot, blocks, depth + 1),
    });
    return {
      ...node,
      type: 'group',
      data: { type: 'group', label: node.data.label, params: JSON.parse(JSON.stringify(node.data.params)) },
    };
  });
  const base = migrateUserBlockDefinitionV1(copy);
  for (const { id, definition } of nested) {
    const map = new Map(definition.graph.nodes.map((node) => [node.nodeId, `${id}::${node.nodeId}`]));
    if ([...map.values()].some((key) => base.graph.nodes.some((node) => node.nodeId === key)))
      throw new Error('Nested legacy node identity collides with an existing node.');
    const surface = remapBlockContainerInterfaceV1(
      {
        schemaVersion: 1,
        boundary: definition.boundary,
        controls: definition.controls.map((control) => {
          const copy = { ...control };
          delete copy.defaultValue;
          return copy;
        }),
        previews: definition.previews,
      },
      map,
    );
    base.graph.nodes.find((node) => node.nodeId === id)!.containerInterface = surface;
    base.graph.nodes.push(
      ...definition.graph.nodes.map((node) => {
        const hint = remapOperationAuthoring(node.data.operationAuthoring, (key) => map.get(key) ?? key);
        return {
          ...node,
          data: { ...node.data, ...(hint ? { operationAuthoring: JSON.parse(JSON.stringify(hint)) } : {}) },
          nodeId: map.get(node.nodeId)!,
          parentNodeId: node.parentNodeId ? map.get(node.parentNodeId)! : id,
          ...(node.containerInterface
            ? { containerInterface: remapBlockContainerInterfaceV1(node.containerInterface, map) }
            : {}),
        };
      }),
    );
    base.graph.edges.push(
      ...definition.graph.edges.map((edge) => ({
        ...edge,
        edgeId: `${id}::${edge.edgeId}`,
        sourceNodeId: map.get(edge.sourceNodeId)!,
        targetNodeId: map.get(edge.targetNodeId)!,
      })),
    );
    base.previews.push(...definition.previews.map((preview) => ({ ...preview, nodeId: map.get(preview.nodeId)! })));
  }
  // Older ordinary group membership was stored on React Flow nodes.
  for (const node of copy.nodes as CustomNodeType[]) {
    if (node.parentId && base.graph.nodes.some((parent) => parent.nodeId === node.parentId))
      base.graph.nodes.find((child) => child.nodeId === node.id)!.parentNodeId = node.parentId;
  }
  base.graph.graphHash = blockGraphHashV2(base.graph);
  base.contentHash = blockDefinitionContentHashV2(base);
  return normalizeBlockDefinitionV2(base);
}

function safeLegacyIds(snapshot: UserBlockDefinition) {
  const copy = structuredClone(snapshot);
  const nodeMap = new Map<string, string>();
  const used = new Set((copy.nodes as CustomNodeType[]).map((node) => node.id));
  for (const node of copy.nodes as CustomNodeType[]) {
    if (!/^[_-]/u.test(node.id)) continue;
    let next = `legacy-node-${node.id}`;
    while (used.has(next)) next = `legacy-${next}`;
    used.add(next);
    nodeMap.set(node.id, next);
    node.id = next;
  }
  for (const node of copy.nodes as CustomNodeType[]) {
    const hint = remapOperationAuthoring(node.data.operationAuthoring, (id) => nodeMap.get(id) ?? id);
    if (hint) node.data.operationAuthoring = hint;
    if (node.parentId) node.parentId = nodeMap.get(node.parentId) ?? node.parentId;
  }
  for (const edge of copy.edges as Edge[]) {
    edge.source = nodeMap.get(edge.source) ?? edge.source;
    edge.target = nodeMap.get(edge.target) ?? edge.target;
    if (/^[_-]/u.test(edge.id)) edge.id = `legacy-edge-${edge.id}`;
  }
  for (const binding of [...copy.inputs, ...copy.outputs, ...copy.exposedParams])
    if (binding.nodeId) binding.nodeId = nodeMap.get(binding.nodeId) ?? binding.nodeId;
  if (/^[_-]/u.test(copy.id)) copy.id = `legacy-definition-${copy.id}`;
  return { snapshot: copy, nodeMap };
}

/** Upgrade only workflow instances involved in an explicit instance edit.
 * The existing V1 snapshot/adapter owns values and interfaces; no library save.
 * Callers commit the returned graph and requested edit in the same Undo transaction. */
export function prepareLegacyBlockMovementV2(
  nodes: CustomNodeType[],
  edges: Edge[],
  ids: readonly string[],
  destinationId: string | null,
) {
  let graph = { nodes, edges };
  const remapped = new Map<string, string>();
  const externalCrossings: Edge[] = [];
  const involved = new Set([...ids, ...(destinationId ? [destinationId] : [])]);
  for (const id of [...involved]) {
    let node = nodes.find((candidate) => candidate.id === id);
    const visited = new Set<string>();
    while (node?.parentId) {
      if (visited.has(node.id)) throw new Error('A containment cycle prevents this move.');
      visited.add(node.id);
      involved.add(node.parentId);
      node = nodes.find((candidate) => candidate.id === node!.parentId);
    }
  }
  const blocks = useUserBlockStore.getState().blocks;
  for (const root of nodes.filter(
    (node) => involved.has(node.id) && !node.data.blockInstanceV2 && node.data.huggingFaceClusterRole === 'root',
  )) {
    const snapshot = snapshotMaterializedCluster(graph, root);
    graph = snapshot;
    externalCrossings.push(...snapshot.externalCrossings);
    snapshot.ids.forEach((id, previous) => remapped.set(previous, blockProjectionNodeIdV2(root.id, id)));
  }
  const nestingDepth = (node: CustomNodeType) => {
    let depth = 0,
      parent = node.parentId;
    while (parent && depth <= 24) {
      depth++;
      parent = graph.nodes.find((item) => item.id === parent)?.parentId;
    }
    return depth;
  };
  // Refresh deepest embedded snapshots first, preserving edits made while an
  // old nested instance was expanded before flattening its outer owner.
  for (const node of graph.nodes
    .filter((item) => involved.has(item.id) && isLegacyUserBlock(item))
    .sort((a, b) => nestingDepth(b) - nestingDepth(a))) {
    const snapshot = snapshotUserBlockInstance(graph, node.id, blocks);
    const refreshed = collapseUserBlockInstance(graph, node.id, blocks).nodes.find((item) => item.id === node.id);
    if (snapshot)
      graph = {
        ...graph,
        nodes: graph.nodes.map((item) =>
          item.id === node.id
            ? {
                ...item,
                data: { ...item.data, params: refreshed?.data.params ?? item.data.params, userBlockSnapshot: snapshot },
              }
            : item,
        ),
      };
  }
  for (let original of graph.nodes
    .filter((node) => involved.has(node.id) && isLegacyUserBlock(node))
    .sort((a, b) => nestingDepth(a) - nestingDepth(b))) {
    const live = graph.nodes.find((node) => node.id === original.id);
    if (!live || !isLegacyUserBlock(live)) continue;
    original = live;
    const descendantIds = new Set([original.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const node of graph.nodes)
        if (node.parentId && descendantIds.has(node.parentId) && !descendantIds.has(node.id)) {
          descendantIds.add(node.id);
          changed = true;
        }
    }
    const priorGraph = graph;
    const expanded = expandUserBlockInstance(graph, original.id, blocks);
    const snapshot = snapshotUserBlockInstance(expanded, original.id, blocks);
    if (!snapshot) throw new Error(`Missing definition: ${original.data.label ?? original.id}`);
    const collapsed = collapseUserBlockInstance(expanded, original.id, blocks);
    const parent = collapsed.nodes.find((node) => node.id === original.id)!;
    const children = expanded.nodes.filter((node) => node.data.userBlockInstanceId === original.id);
    const safe = safeLegacyIds(snapshot);
    const definition = migrateLegacyHierarchyV2(safe.snapshot, blocks);
    const instanceId = /^[_-]/u.test(original.id) ? `legacy-instance-${original.id}` : original.id;
    if (instanceId !== original.id && graph.nodes.some((node) => node.id === instanceId))
      throw new Error('Converted Block ID already exists.');
    remapped.set(original.id, instanceId);
    const values = Object.fromEntries(
      [
        ...definition.controls.map((control) => control.controlId),
        ...definition.boundary.inputs.map((port) => port.portId),
      ].flatMap((id) =>
        parent.data.params[id]?.value === undefined ? [] : [[id, parent.data.params[id]!.value as BlockJsonValue]],
      ),
    );
    let instance = createBlockInstanceV2(definition, {
      instanceId,
      position: original.position,
      size: { width: parent.width ?? 420, height: parent.height ?? 480 },
      values,
      internalLayout: Object.fromEntries(
        children.map((node) => [
          safe.nodeMap.get(node.data.userBlockSourceNodeId ?? node.id) ?? node.data.userBlockSourceNodeId ?? node.id,
          {
            x: node.position.x,
            y: node.position.y,
            width: node.width ?? node.measured?.width ?? 280,
            height: node.height ?? node.measured?.height ?? 320,
          },
        ]),
      ),
    });
    instance = setBlockPresentationV2(instance, { expanded: original.data.uiState?.blockExpanded === true });
    for (const preview of instance.previewStates) {
      const child = children.find(
        (node) =>
          (safe.nodeMap.get(node.data.userBlockSourceNodeId ?? node.id) ?? node.data.userBlockSourceNodeId) ===
          preview.binding.nodeId,
      );
      const param = child?.data.params[preview.binding.outputPortId];
      const artifact = param?.artifacts?.find((item) => typeof item.url === 'string' && item.url);
      const value = artifact?.url ?? param?.value;
      if (typeof value === 'string' && value.length && value.length <= 8192)
        instance = reduceBlockPreviewStateV2(instance, preview.binding, { status: 'complete', mediaReference: value });
    }
    const convertedRoot = createBlockRootNodeV2(instance, { selected: original.selected });
    if (original.parentId) convertedRoot.parentId = original.parentId;
    const projection = materializeBlockProjectionV2(convertedRoot);
    graph = {
      nodes: [...collapsed.nodes.filter((node) => !descendantIds.has(node.id)), ...projection.nodes],
      edges: [
        ...collapsed.edges
          .filter((edge) => !descendantIds.has(edge.source) || edge.source === original.id)
          .filter((edge) => !descendantIds.has(edge.target) || edge.target === original.id)
          .map((edge) => ({
            ...edge,
            source: edge.source === original.id ? instanceId : edge.source,
            target: edge.target === original.id ? instanceId : edge.target,
          })),
        ...projection.edges,
      ],
    };
    for (const node of priorGraph.nodes.filter((item) => item.id !== original.id && descendantIds.has(item.id))) {
      let key = node.data.userBlockSourceNodeId ?? node.id;
      let parent = priorGraph.nodes.find((item) => item.id === node.parentId);
      while (parent && parent.id !== original.id) {
        if (isLegacyUserBlock(parent)) key = `${parent.data.userBlockSourceNodeId ?? parent.id}::${key}`;
        parent = priorGraph.nodes.find((item) => item.id === parent!.parentId);
      }
      remapped.set(node.id, blockProjectionNodeIdV2(instanceId, safe.nodeMap.get(key) ?? key));
    }
    const crossing = priorGraph.edges.filter(
      (edge) =>
        descendantIds.has(edge.source) !== descendantIds.has(edge.target) &&
        edge.source !== original.id &&
        edge.target !== original.id,
    );
    graph.edges.push(
      ...crossing
        .filter((edge) => !graph.edges.some((existing) => existing.id === edge.id))
        .map((edge) => ({
          ...edge,
          source: remapped.get(edge.source) ?? edge.source,
          target: remapped.get(edge.target) ?? edge.target,
        })),
    );
    children.forEach((node) =>
      remapped.set(
        node.id,
        blockProjectionNodeIdV2(
          instanceId,
          safe.nodeMap.get(node.data.userBlockSourceNodeId ?? node.id) ?? node.data.userBlockSourceNodeId ?? node.id,
        ),
      ),
    );
  }
  if (externalCrossings.length)
    graph = {
      ...graph,
      edges: [
        ...graph.edges,
        ...externalCrossings.map((edge) => ({
          ...edge,
          source: remapped.get(edge.source) ?? edge.source,
          target: remapped.get(edge.target) ?? edge.target,
        })),
      ],
    };
  return {
    ...graph,
    ids: ids.map((id) => remapped.get(id) ?? id),
    destinationId: destinationId ? (remapped.get(destinationId) ?? destinationId) : null,
    remapped,
  };
}

export function prepareLegacyGraphForAutoV2(nodes: CustomNodeType[], edges: Edge[], targetNodeId?: string) {
  const ids = targetNodeId ? [targetNodeId] : nodes.filter(isLegacyMembershipBlock).map((node) => node.id);
  return prepareLegacyBlockMovementV2(nodes, edges, ids, null);
}
