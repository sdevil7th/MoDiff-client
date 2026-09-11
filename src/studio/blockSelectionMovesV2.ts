import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { expandedBlockV2AtPosition } from './blockDropTargetsV2';
import { blockProjectionNodeIdV2 } from './blockRuntimeV2';
import { isLegacyMembershipBlock, prepareLegacyBlockMovementV2 } from './legacyBlockMovementV2';

export function absoluteBlockNodePositionV2(node: CustomNodeType, nodes: CustomNodeType[]) {
  const position = { ...node.position };
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId) {
    if (visited.has(parentId)) throw new Error('A containment cycle prevents this move.');
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) throw new Error('The containing Block is missing.');
    position.x += parent.position.x;
    position.y += parent.position.y;
    parentId = parent.parentId;
  }
  return position;
}

/** A selected descendant travels with its selected ancestor exactly once. */
export function topLevelBlockSelectionV2(nodes: CustomNodeType[], ids: readonly string[]) {
  const selected = new Set(ids);
  return nodes.filter((node) => {
    if (!selected.has(node.id)) return false;
    let parentId = node.parentId;
    const visited = new Set([node.id]);
    while (parentId) {
      if (selected.has(parentId)) return false;
      if (visited.has(parentId)) throw new Error('A containment cycle prevents this move.');
      visited.add(parentId);
      parentId = nodes.find((candidate) => candidate.id === parentId)?.parentId;
    }
    return true;
  });
}

export function blockSelectionDropTargetV2(nodes: CustomNodeType[], ids: readonly string[], anchorId: string) {
  const anchor = nodes.find((node) => node.id === anchorId);
  if (!anchor) return null;
  const excluded = new Set(ids);
  for (let changed = true; changed;) {
    changed = false;
    for (const node of nodes)
      if (node.parentId && excluded.has(node.parentId) && !excluded.has(node.id)) {
        excluded.add(node.id);
        changed = true;
      }
  }
  const origin = absoluteBlockNodePositionV2(anchor, nodes);
  const center = {
    x: origin.x + (anchor.measured?.width ?? anchor.width ?? 220) / 2,
    y: origin.y + (anchor.measured?.height ?? anchor.height ?? 120) / 2,
  };
  const available = nodes.filter((node) => !excluded.has(node.id));
  const modern = expandedBlockV2AtPosition(available, center);
  const legacy = available.filter((node) => {
    if (
      !isLegacyMembershipBlock(node) ||
      node.hidden ||
      !(node.data.uiState?.blockExpanded === true || node.data.huggingFaceClusterInstance?.presentation.expanded)
    )
      return false;
    const origin = absoluteBlockNodePositionV2(node, nodes);
    return (
      center.x >= origin.x &&
      center.y >= origin.y &&
      center.x <= origin.x + (node.width ?? node.measured?.width ?? 420) &&
      center.y <= origin.y + (node.height ?? node.measured?.height ?? 480)
    );
  });
  return (
    modern ??
    legacy.sort((a, b) => (a.width ?? 420) * (a.height ?? 480) - (b.width ?? 420) * (b.height ?? 480))[0] ??
    null
  );
}

function assertSupported(node: CustomNodeType) {
  if (node.data.blockInstanceV2 || node.data.blockProjectionKind === 'internal') return;
  if (
    node.parentId ||
    node.data.type === 'group' ||
    node.data.type === 'loop' ||
    node.data.userBlockSnapshot ||
    node.data.huggingFaceClusterInstance
  )
    throw new Error(
      'This selection contains a legacy container. Convert it to a Block before moving the selection between Blocks.',
    );
}

/** Uses the established reducers within one rollback/Undo boundary. */
export function moveBlockSelectionV2(
  ids: readonly string[],
  destinationId: string | null,
  mode: 'drop' | 'out' = 'drop',
) {
  const before = useFlowStore.getState();
  const prepared = prepareLegacyBlockMovementV2(before.nodes, before.edges, ids, destinationId);
  if (prepared.destinationId && !prepared.nodes.some((node) => node.id === prepared.destinationId))
    throw new Error('The destination Block is missing.');
  const selection = topLevelBlockSelectionV2(prepared.nodes, prepared.ids);
  if (!selection.length) throw new Error('Select a node or Block to move.');
  selection.forEach(assertSupported);
  const selectedIds = new Set(selection.map((node) => node.id));
  const placements = selection.map((node, index) => {
    let destination = prepared.destinationId
      ? prepared.nodes.find((candidate) => candidate.id === prepared.destinationId)
      : undefined;
    let position = absoluteBlockNodePositionV2(node, prepared.nodes);
    if (mode === 'out') {
      if (node.data.blockProjectionKind !== 'internal' || !node.parentId)
        throw new Error('Every selected item must be inside a Block.');
      const parent = prepared.nodes.find((candidate) => candidate.id === node.parentId)!;
      destination = parent.parentId ? prepared.nodes.find((candidate) => candidate.id === parent.parentId) : undefined;
      const origin = absoluteBlockNodePositionV2(parent, prepared.nodes);
      position = {
        x: origin.x + (parent.measured?.width ?? parent.width ?? 420) + 32,
        y: origin.y + 80 + index * ((node.measured?.height ?? node.height ?? 160) + 32),
      };
    }
    if (destination) {
      let ancestor: CustomNodeType | undefined = destination;
      while (ancestor) {
        if (selectedIds.has(ancestor.id))
          throw new Error('A Block cannot be moved inside itself or its selected descendants.');
        ancestor = prepared.nodes.find((candidate) => candidate.id === ancestor?.parentId);
      }
      if (!destination.data.blockInstanceV2 && !destination.data.blockProjectionContainer)
        throw new Error('Choose an expanded Block as the destination.');
      if (
        destination.hidden ||
        destination.data.blockInstanceV2?.presentation.expanded === false ||
        destination.data.blockProjectionContainerExpanded === false
      )
        throw new Error('Expand the destination Block first.');
    }
    return { id: node.id, destinationId: destination?.id, position };
  });
  before.beginHistoryTransaction('Move selection between Blocks');
  const moved: string[] = [];
  try {
    if (prepared.nodes !== before.nodes) useFlowStore.setState({ nodes: prepared.nodes, edges: prepared.edges });
    for (const placement of placements) {
      let state = useFlowStore.getState();
      let node = state.nodes.find((candidate) => candidate.id === placement.id);
      if (!node) throw new Error('A selected node changed during the move.');
      const destination = placement.destinationId
        ? state.nodes.find((candidate) => candidate.id === placement.destinationId)
        : undefined;
      if (placement.destinationId && !destination) throw new Error('The destination Block changed during the move.');
      const ownerId = destination?.data.blockProjectionOwnerId ?? destination?.id;
      if (node.data.blockProjectionOwnerId && node.data.blockProjectionOwnerId === ownerId) {
        state.reparentNodeInBlockV2(node.id, destination?.data.blockProjectionNodeId, placement.position);
        moved.push(node.id);
        continue;
      }
      if (node.data.blockProjectionOwnerId) {
        const id = state.moveNodeOutOfBlockV2(node.id, placement.position);
        state = useFlowStore.getState();
        node = state.nodes.find((candidate) => candidate.id === id)!;
      }
      if (destination && ownerId) {
        const beforeIds = new Set(
          state.nodes
            .filter((candidate) => candidate.data.blockProjectionOwnerId === ownerId)
            .map((candidate) => candidate.id),
        );
        if (node.data.blockInstanceV2)
          state.adoptBlockFragmentIntoBlockV2(node.id, ownerId, destination.data.blockProjectionNodeId);
        else state.adoptNodeIntoBlockV2(node.id, ownerId, destination.data.blockProjectionNodeId);
        const after = useFlowStore.getState();
        const ordinaryId = blockProjectionNodeIdV2(ownerId, /^[_-]/u.test(node.id) ? `node-${node.id}` : node.id);
        const inserted =
          after.nodes.find((candidate) => candidate.id === ordinaryId) ??
          after.nodes.find(
            (candidate) =>
              candidate.data.blockProjectionOwnerId === ownerId &&
              !beforeIds.has(candidate.id) &&
              candidate.parentId === destination.id,
          );
        if (inserted) moved.push(inserted.id);
      } else {
        if (node.data.blockInstanceV2) state.persistBlockCanvasPresentationV2(node.id);
        moved.push(node.id);
      }
    }
    const retained = new Set(moved);
    useFlowStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: retained.has(node.id) })),
    }));
    useFlowStore.getState().commitHistoryTransaction();
    useFlowStore.getState().updateHandleConnectionStatus();
    return moved;
  } catch (error) {
    useFlowStore.getState().cancelHistoryTransaction();
    for (const root of before.nodes.filter((node) => node.data.blockInstanceV2))
      if (useFlowStore.getState().nodes.some((node) => node.id === root.id))
        useFlowStore.getState().ensureBlockProjectionV2(root.id);
    const selected = new Set(before.nodes.filter((node) => node.selected).map((node) => node.id));
    useFlowStore.setState((state) => ({
      nodes: state.nodes.map((node) => ({ ...node, selected: selected.has(node.id) })),
    }));
    throw error;
  }
}

/** Metadata hydration is needed only for old clusters without their executable
 * children. Conversion and movement still commit under one Undo boundary. */
export async function moveBlockSelectionPreparedV2(
  ids: readonly string[],
  destinationId: string | null,
  mode: 'drop' | 'out' = 'drop',
) {
  const before = useFlowStore.getState();
  const involved = new Set([...ids, ...(destinationId ? [destinationId] : [])]);
  for (const id of [...involved]) {
    let node = before.nodes.find((item) => item.id === id);
    const visited = new Set<string>();
    while (node?.parentId && !visited.has(node.id)) {
      visited.add(node.id);
      involved.add(node.parentId);
      node = before.nodes.find((item) => item.id === node!.parentId);
    }
  }
  const missing = before.nodes.filter(
    (node) =>
      involved.has(node.id) &&
      node.data.huggingFaceClusterRole === 'root' &&
      !before.nodes.some(
        (child) =>
          child.data.huggingFaceClusterInstanceId === node.id && child.data.huggingFaceClusterRole === 'execution',
      ),
  );
  if (!missing.length) return moveBlockSelectionV2(ids, destinationId, mode);
  const { captureWorkflowOperationContext, assertWorkflowOperationContext, workflowOperationContextIsCurrent } =
    await import('../stores/useStudioStore');
  const context = captureWorkflowOperationContext();
  before.beginHistoryTransaction('Prepare and move older Blocks');
  try {
    const { prepareHuggingFaceClusterForAuthoring } = await import('./huggingFaceClusterPreparation');
    for (const node of missing) {
      assertWorkflowOperationContext(context);
      await prepareHuggingFaceClusterForAuthoring(node.id);
      assertWorkflowOperationContext(context);
    }
    const result = moveBlockSelectionV2(ids, destinationId, mode);
    useFlowStore.getState().commitHistoryTransaction();
    return result;
  } catch (error) {
    if (workflowOperationContextIsCurrent(context)) useFlowStore.getState().cancelHistoryTransaction();
    throw error;
  }
}
