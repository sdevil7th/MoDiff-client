import { type Connection, type FinalConnectionState } from '@xyflow/react';
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { nanoid } from 'nanoid';

import type { NodeData, NodeParams } from '../stores/useNodeStore';
import type { CustomConnection, CustomNodeType } from '../stores/useFlowStore';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { blockCrossingParamV2, parseBlockCrossingHandleV2 } from '../studio/blockCrossingConnectionsV2';
import { connectionTypesAreCompatible } from '../theme/connectionTypes';

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
    handleId,
    handleType,
    dataType: dataType ?? param?.type ?? null,
  };
}

type UseWorkflowConnectionsOptions = {
  addNode: (node: CustomNodeType) => void;
  edgeType: string;
  getParam: GetParam;
  onConnect: (connection: CustomConnection) => void;
  screenToFlowPosition: ScreenToFlowPosition;
  setParam: SetParam;
  updateNodeInternals: (id: string) => void;
  connectionScopeIsValid?: (connection: Connection) => boolean;
};

function matchingHandleForDrop(node: NodeData, dropHandle: DropHandle) {
  return Object.entries(node.params || {}).find(([, param]) => {
    if (dropHandle.handleType === 'source') {
      return (
        (param.display === 'input' || param.isInput) &&
        param.display !== 'output' &&
        connectionTypesAreCompatible(dropHandle.dataType ?? 'any', param.type)
      );
    }
    return param.display === 'output' && connectionTypesAreCompatible(param.type, dropHandle.dataType ?? 'any');
  });
}

function pointerPosition(event: MouseEvent | TouchEvent) {
  return {
    top: 'touches' in event ? (event.touches[0]?.clientY ?? 0) : event.clientY,
    left: 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX,
  };
}

export function useWorkflowConnections({
  addNode,
  edgeType,
  getParam,
  onConnect,
  screenToFlowPosition,
  setParam,
  updateNodeInternals,
  connectionScopeIsValid,
}: UseWorkflowConnectionsOptions) {
  const [anchorPosition, setAnchorPosition] = useState<{ top: number; left: number } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnectionValid, setIsConnectionValid] = useState<boolean | null>(null);
  const [connectionDataType, setConnectionDataType] = useState<string | string[] | null>(null);
  const connectionTypeRef = useRef<string | string[] | null>(null);
  const dropHandleRef = useRef<DropHandle | null>(null);

  const handleDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) {
      return;
    }

    event.preventDefault();
    setAnchorPosition({
      top: event.clientY,
      left: event.clientX,
    });
  }, []);

  const handleNodeSearchSelect = useCallback(
    (_: string, node: NodeData) => {
      if (!anchorPosition) {
        return;
      }

      const position = screenToFlowPosition({
        x: anchorPosition.left,
        y: anchorPosition.top,
      });
      const newNode: CustomNodeType = {
        id: `node-${nanoid()}`,
        type: node.type,
        position,
        data: node,
      };

      addNode(newNode);

      const dropHandle = dropHandleRef.current;
      if (!dropHandle) {
        return;
      }

      const matchingHandle = matchingHandleForDrop(node, dropHandle);
      if (matchingHandle) {
        const [newHandleId] = matchingHandle;
        const connection =
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

        onConnect(connection);
      }

      dropHandleRef.current = null;
    },
    [anchorPosition, screenToFlowPosition, addNode, onConnect, edgeType],
  );

  const handleIsValidConnection = useCallback(
    (conn: Connection) => {
      if (!conn.sourceHandle || !conn.targetHandle) {
        return false;
      }

      if (conn.source === conn.target) {
        return false;
      }

      if (connectionScopeIsValid && !connectionScopeIsValid(conn)) {
        return false;
      }

      const sourceType = getParam(conn.source, conn.sourceHandle, 'type') || 'default';
      const targetType = getParam(conn.target, conn.targetHandle, 'type') || 'default';
      return connectionTypesAreCompatible(sourceType, targetType);
    },
    [connectionScopeIsValid, getParam],
  );

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
      return true;
    },
    [getParam],
  );

  const handleDropOnField = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      if (!conn.fromNode?.id || !conn.fromHandle?.id) {
        return false;
      }

      const target = (event.target as HTMLElement).closest('.modiff-field');
      const fieldKey = target?.getAttribute('data-key');
      const nodeId = target?.closest('.react-flow__node')?.getAttribute('data-id');
      if (!target || !fieldKey || !nodeId) {
        return false;
      }

      const targetIsInput = getParam(nodeId, fieldKey, 'isInput');
      if (targetIsInput) {
        return false;
      }

      const sourceType = getParam(conn.fromNode.id, conn.fromHandle.id, 'type');
      const targetType = getParam(nodeId, fieldKey, 'type');
      if (!connectionTypesAreCompatible(sourceType, targetType)) {
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
    [connectionScopeIsValid, onConnect, edgeType, getParam, setParam, updateNodeInternals],
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

      if (conn.toHandle === null && handleDropOnPane(event, conn)) {
        return;
      }

      handleDropOnField(event, conn);
    },
    [handleDropOnPane, handleDropOnField, handleMouseMove],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (connectionScopeIsValid && !connectionScopeIsValid(conn)) {
        return;
      }
      onConnect({
        ...conn,
        edgeType,
      });
    },
    [connectionScopeIsValid, onConnect, edgeType],
  );

  const closeNodeSearchDialog = useCallback(() => {
    setAnchorPosition(null);
    dropHandleRef.current = null;
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
  };
}
