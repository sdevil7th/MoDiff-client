import { type Connection, type FinalConnectionState } from '@xyflow/react';
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import type { NodeParams } from '../stores/useNodeStore';
import type { CustomConnection, CustomNodeType } from '../stores/useFlowStore';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { blockCrossingParamV2, parseBlockCrossingHandleV2 } from '../studio/blockCrossingConnectionsV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypes';
import { matchingNodeHandleForInsertion, nodeConnectionSemanticsAreCompatible } from './nodeConnectionMatching';
import { useFlowStore } from '../stores/useFlowStore';
import {
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import { isOptionalEncodingHandle } from './encodingOptionalInput';

export type NodeSearchFactory = (position: CustomNodeType['position']) => CustomNodeType | Promise<CustomNodeType>;

type ScreenToFlowPosition = (position: { x: number; y: number }) => { x: number; y: number };
type GetParam = <K extends keyof NodeParams>(id: string, param: string, key: K) => NodeParams[K] | null;
type SetParam = <K extends keyof NodeParams = 'value'>(
  id: string,
  param: string,
  value: NodeParams[K],
  key?: K,
) => void;

/**
 * Resolve the actual canvas connection surface before falling back to the
 * legacy parameter store. Block V2 roots deliberately keep `data.params`
 * empty, so connection validation must read their embedded public interface
 * through `nodeConnectorParam` just like the commit path does.
 */
export function workflowConnectionParam<K extends keyof NodeParams>(
  nodes: CustomNodeType[],
  fallback: GetParam,
  nodeId: string,
  handleId: string,
  key: K,
): NodeParams[K] | null {
  const crossing = parseBlockCrossingHandleV2(handleId);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (crossing) {
    const instance =
      node?.data.blockInstanceV2 ??
      nodes.find((candidate) => candidate.id === node?.data.blockProjectionOwnerId)?.data.blockInstanceV2;
    if (instance) return (blockCrossingParamV2(instance, crossing)[key] ?? null) as NodeParams[K] | null;
  }
  const param = nodeConnectorParam(
    nodes.find((node) => node.id === nodeId),
    handleId,
  );
  if (!param) return fallback(nodeId, handleId, key);
  const value = param[key];
  return value === undefined ? null : value;
}

export type DropHandle = {
  nodeId: string;
  node: CustomNodeType['data'];
  handleId: string;
  handleType: 'source' | 'target' | null;
  dataType: string | string[] | null;
};

export function captureWorkflowDropHandle(
  node: CustomNodeType | undefined,
  handleId: string | null | undefined,
  handleType: 'source' | 'target' | null,
  dataType?: NodeParams['type'] | null,
): DropHandle | null {
  const param = nodeConnectorParam(node, handleId);
  if (!node || !handleId || (!param && !dataType)) return null;
  return {
    nodeId: node.id,
    node: node.data,
    handleId,
    handleType,
    dataType: dataType ?? param?.type ?? null,
  };
}

type UseWorkflowConnectionsOptions = {
  edgeType: string;
  getParam: GetParam;
  onConnect: (connection: CustomConnection) => void;
  screenToFlowPosition: ScreenToFlowPosition;
  setParam: SetParam;
  updateNodeInternals: (id: string) => void;
  connectionScopeIsValid?: (connection: Connection) => boolean;
  onMediaDrop?: (source: { nodeId: string; handleId: string }, targetId: string) => Promise<boolean>;
  onEncodingConnect: (connection: Connection, pendingNode?: CustomNodeType, signal?: AbortSignal) => Promise<void>;
  onConnectionError: (error: unknown) => void;
};

function pointerPosition(event: MouseEvent | TouchEvent) {
  return {
    top: 'touches' in event ? (event.touches[0]?.clientY ?? 0) : event.clientY,
    left: 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX,
  };
}

function graphConnectionSemanticsAreCompatible(
  sourceId: string,
  sourceHandle: string,
  targetId: string,
  targetHandle: string,
) {
  const nodes = useFlowStore.getState().nodes;
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  return (
    !source || !target || nodeConnectionSemanticsAreCompatible(source.data, sourceHandle, target.data, targetHandle)
  );
}

export function useWorkflowConnections({
  edgeType,
  getParam,
  onConnect,
  screenToFlowPosition,
  setParam,
  updateNodeInternals,
  connectionScopeIsValid,
  onMediaDrop,
  onEncodingConnect,
  onConnectionError,
}: UseWorkflowConnectionsOptions) {
  const [anchorPosition, setAnchorPosition] = useState<{ top: number; left: number } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnectionValid, setIsConnectionValid] = useState<boolean | null>(null);
  const [connectionDataType, setConnectionDataType] = useState<string | string[] | null>(null);
  const connectionTypeRef = useRef<string | string[] | null>(null);
  const dropHandleRef = useRef<DropHandle | null>(null);
  const searchContextRef = useRef<ReturnType<typeof captureWorkflowOperationContext> | null>(null);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) {
      return;
    }

    event.preventDefault();
    dropHandleRef.current = null;
    searchContextRef.current = captureWorkflowOperationContext();
    setAnchorPosition({
      top: event.clientY,
      left: event.clientX,
    });
  }, []);

  const handleNodeSearchSelect = useCallback(
    async (createNode: NodeSearchFactory, signal: AbortSignal, allowUnverified: boolean) => {
      if (!anchorPosition || !searchContextRef.current) return;
      const context = searchContextRef.current;
      const dropHandle = dropHandleRef.current;
      let committed = false;
      try {
        assertWorkflowOperationContext(context, { includeForm: false });
        const position = screenToFlowPosition({ x: anchorPosition.left, y: anchorPosition.top });
        const newNode = await createNode(position);
        if (signal.aborted) return;
        assertWorkflowOperationContext(context, { includeForm: false });
        const currentOrigin = dropHandle && useFlowStore.getState().nodes.find((node) => node.id === dropHandle.nodeId);
        const matchingHandle = dropHandle
          ? matchingNodeHandleForInsertion(
              newNode.data,
              {
                dataType: dropHandle.dataType,
                handleType: dropHandle.handleType,
                origin: { node: dropHandle.node, handleId: dropHandle.handleId },
                allowUnverified,
              },
              currentOrigin ? { node: currentOrigin.data, handleId: dropHandle.handleId } : null,
            )
          : undefined;
        if (dropHandle && !matchingHandle) throw new Error('This node no longer has a compatible port.');
        let connection: CustomConnection | undefined;
        if (dropHandle && matchingHandle) {
          const [newHandleId] = matchingHandle;
          connection =
            dropHandle.handleType === 'source'
              ? {
                  source: dropHandle.nodeId,
                  sourceHandle: dropHandle.handleId,
                  target: newNode.id,
                  targetHandle: newHandleId,
                  edgeType,
                }
              : {
                  source: newNode.id,
                  sourceHandle: newHandleId,
                  target: dropHandle.nodeId,
                  targetHandle: dropHandle.handleId,
                  edgeType,
                };
        }
        const wasEmpty = useFlowStore.getState().nodes.length === 0;
        if (
          connection &&
          (isOptionalEncodingHandle(connection.targetHandle) || isOptionalEncodingHandle(connection.sourceHandle))
        ) {
          await onEncodingConnect(connection, newNode, signal);
          if (signal.aborted) return;
          committed = true;
          return;
        }
        useFlowStore.getState().addNodeWithConnection(newNode, connection);
        if (wasEmpty && useStudioStore.getState().graphBinding) useStudioStore.getState().detachManagedGraph();
        prepareWorkflowForManualInsertion();
        committed = true;
      } finally {
        if (committed && searchContextRef.current === context) dropHandleRef.current = null;
      }
    },
    [anchorPosition, screenToFlowPosition, edgeType, onEncodingConnect],
  );

  const connectionError = useCallback(
    (conn: Connection) => {
      if (!conn.sourceHandle || !conn.targetHandle) {
        return 'Cannot connect: an input or output socket is missing.';
      }

      if (conn.source === conn.target) {
        return 'Cannot connect a node to itself: this would create a dependency loop.';
      }
      const seen = new Set<string>();
      const pending = [conn.target];
      const edges = useFlowStore.getState().edges;
      while (pending.length) {
        const id = pending.pop()!;
        if (id === conn.source) {
          const nodes = useFlowStore.getState().nodes;
          const label = (nodeId: string) => {
            const node = nodes.find((node) => node.id === nodeId);
            return node?.data.label || node?.data.action || nodeId;
          };
          return `Cannot connect: this would create a dependency loop. "${label(conn.source)}" already depends on "${label(conn.target)}".`;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        for (const edge of edges) if (edge.source === id) pending.push(edge.target);
      }

      if (connectionScopeIsValid && !connectionScopeIsValid(conn)) {
        return 'Cannot connect these sockets across this node boundary.';
      }

      const sourceType = getParam(conn.source, conn.sourceHandle, 'type') || 'default';
      const targetType = getParam(conn.target, conn.targetHandle, 'type') || 'default';
      if (!connectionTypesAreCompatible(sourceType, targetType))
        return `Cannot connect: output type ${[sourceType].flat().join(' / ')} is incompatible with input type ${[targetType].flat().join(' / ')}.`;
      if (!graphConnectionSemanticsAreCompatible(conn.source, conn.sourceHandle, conn.target, conn.targetHandle))
        return 'Cannot connect: these sockets have incompatible model or operation requirements.';
      return null;
    },
    [connectionScopeIsValid, getParam],
  );

  // Hover validation stays silent. Explain rejection only when the user drops.
  const handleIsValidConnection = useCallback((conn: Connection) => connectionError(conn) === null, [connectionError]);

  const handleMouseMove = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!connectionTypeRef.current) {
        setIsConnectionValid(null);
        return;
      }

      const target = (event.target as HTMLElement).closest('.modiff-field');
      const fieldKey = target?.getAttribute('data-key');
      const nodeId = target?.closest('.react-flow__node')?.getAttribute('data-id');
      if (!target || !fieldKey || !nodeId) {
        setIsConnectionValid(null);
        return;
      }

      const targetType = getParam(nodeId, fieldKey, 'type');
      setIsConnectionValid(connectionTypesAreCompatible(connectionTypeRef.current, targetType));
    },
    [getParam],
  );

  const handleConnectStart = useCallback(
    (
      event: MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null },
    ) => {
      event.preventDefault();
      setIsConnecting(true);
      setConnectionDataType(null);

      if (!params.nodeId || !params.handleId) {
        return;
      }

      const sourceType = getParam(params.nodeId, params.handleId, 'type') || 'default';
      connectionTypeRef.current = sourceType;
      setConnectionDataType(sourceType);
      dropHandleRef.current = null;
      document.addEventListener('mousemove', handleMouseMove);
    },
    [getParam, handleMouseMove],
  );

  const handleDropOnPane = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains('react-flow__pane')) {
        return false;
      }

      const handleId = conn.fromHandle?.id;
      if (handleId) {
        const fromNode = conn.fromNode as unknown as CustomNodeType | undefined;
        dropHandleRef.current = captureWorkflowDropHandle(
          fromNode,
          handleId,
          conn.fromHandle?.type === 'source' ? 'source' : 'target',
          fromNode ? getParam(fromNode.id, handleId, 'type') : null,
        );
      }

      setAnchorPosition(pointerPosition(event));
      searchContextRef.current = captureWorkflowOperationContext();
      return true;
    },
    [getParam],
  );

  const handleDropOnField = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      if (!conn.fromNode?.id || !conn.fromHandle?.id || conn.fromHandle.type !== 'source') {
        return false;
      }

      const target = (event.target as HTMLElement).closest('.modiff-field');
      const fieldKey = target?.getAttribute('data-key');
      const nodeId = target?.closest('.react-flow__node')?.getAttribute('data-id');
      if (!target || !fieldKey || !nodeId) {
        return false;
      }
      if (
        getParam(nodeId, fieldKey, 'display') === 'output' ||
        getParam(nodeId, fieldKey, 'hidden') ||
        getParam(nodeId, fieldKey, 'disabled')
      )
        return false;
      if (
        !handleIsValidConnection({
          source: conn.fromNode.id,
          sourceHandle: conn.fromHandle.id,
          target: nodeId,
          targetHandle: fieldKey,
        })
      )
        return false;

      const targetIsInput = getParam(nodeId, fieldKey, 'isInput');
      if (targetIsInput) {
        return false;
      }

      const sourceType = getParam(conn.fromNode.id, conn.fromHandle.id, 'type');
      const targetType = getParam(nodeId, fieldKey, 'type');
      if (!connectionTypesAreCompatible(sourceType, targetType)) {
        return false;
      }

      if (!graphConnectionSemanticsAreCompatible(conn.fromNode.id, conn.fromHandle.id, nodeId, fieldKey)) {
        return false;
      }

      if (
        connectionScopeIsValid &&
        !connectionScopeIsValid({
          source: conn.fromNode.id,
          sourceHandle: conn.fromHandle.id,
          target: nodeId,
          targetHandle: fieldKey,
        })
      ) {
        return false;
      }

      setParam(nodeId, fieldKey, true, 'isInput');
      updateNodeInternals(nodeId);
      onConnect({
        source: conn.fromNode.id,
        sourceHandle: conn.fromHandle.id,
        target: nodeId,
        targetHandle: fieldKey,
        edgeType,
      });
      return true;
    },
    [connectionScopeIsValid, handleIsValidConnection, onConnect, edgeType, getParam, setParam, updateNodeInternals],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      event.preventDefault();
      setIsConnecting(false);
      connectionTypeRef.current = null;
      setConnectionDataType(null);
      document.removeEventListener('mousemove', handleMouseMove);

      if (conn.isValid) {
        return;
      }

      if (conn.fromHandle && conn.toHandle && conn.fromNode && conn.toNode) {
        if (conn.fromHandle.type === conn.toHandle.type) {
          onConnectionError(new Error('Cannot connect: connect an output socket to an input socket.'));
          return;
        }
        const forward = conn.fromHandle.type === 'source';
        const reason = connectionError({
          source: forward ? conn.fromNode.id : conn.toNode.id,
          sourceHandle: (forward ? conn.fromHandle.id : conn.toHandle.id) ?? null,
          target: forward ? conn.toNode.id : conn.fromNode.id,
          targetHandle: (forward ? conn.toHandle.id : conn.fromHandle.id) ?? null,
        });
        onConnectionError(new Error(reason ?? 'Cannot connect: this socket is unavailable.'));
        return;
      }

      if (conn.toHandle === null && handleDropOnPane(event, conn)) {
        return;
      }

      if (handleDropOnField(event, conn)) return;
      if (conn.fromHandle?.type === 'source' && conn.fromHandle.id && conn.fromNode?.id) {
        const targetId = (event.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');
        if (targetId) onMediaDrop?.({ nodeId: conn.fromNode.id, handleId: conn.fromHandle.id }, targetId);
      }
    },
    [handleDropOnPane, handleDropOnField, handleMouseMove, onMediaDrop, connectionError, onConnectionError],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!handleIsValidConnection(conn)) {
        return;
      }
      if (isOptionalEncodingHandle(conn.targetHandle) || isOptionalEncodingHandle(conn.sourceHandle)) {
        void onEncodingConnect(conn).catch(onConnectionError);
        return;
      }
      onConnect({
        ...conn,
        edgeType,
      });
    },
    [handleIsValidConnection, onConnect, edgeType, onEncodingConnect, onConnectionError],
  );

  const closeNodeSearchDialog = useCallback(() => {
    setAnchorPosition(null);
    dropHandleRef.current = null;
    searchContextRef.current = null;
  }, []);

  return {
    anchorPosition,
    closeNodeSearchDialog,
    connectionDataType,
    handleConnect,
    handleConnectEnd,
    handleConnectStart,
    handleDoubleClick,
    handleIsValidConnection,
    handleNodeSearchSelect,
    isConnecting,
    isConnectionValid,
    nodeSearchDataType: dropHandleRef.current?.dataType ?? undefined,
    nodeSearchHandleType: dropHandleRef.current?.handleType,
    nodeSearchOrigin: dropHandleRef.current ?? undefined,
  };
}
