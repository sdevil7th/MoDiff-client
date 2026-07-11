import { type Connection, type FinalConnectionState } from '@xyflow/react';
import { useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { nanoid } from 'nanoid';

import type { NodeData, NodeParams } from '../stores/useNodeStore';
import type { CustomConnection, CustomNodeType } from '../stores/useFlowStore';

type ScreenToFlowPosition = (position: { x: number; y: number }) => { x: number; y: number };
type GetParam = <K extends keyof NodeParams>(id: string, param: string, key: K) => NodeParams[K] | null;
type SetParam = <K extends keyof NodeParams = 'value'>(
  id: string,
  param: string,
  value: NodeParams[K],
  key?: K,
) => void;

type DropHandle = {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target' | null;
  dataType: string | string[] | null;
};

type UseWorkflowConnectionsOptions = {
  addNode: (node: CustomNodeType) => void;
  edgeType: string;
  getParam: GetParam;
  onConnect: (connection: CustomConnection) => void;
  screenToFlowPosition: ScreenToFlowPosition;
  setParam: SetParam;
  updateNodeInternals: (id: string) => void;
};

function toTypeArray(value: unknown) {
  return Array.isArray(value) ? value : [value];
}

function typesAreCompatible(sourceType: unknown, targetType: unknown) {
  const sourceTypes = toTypeArray(sourceType);
  const targetTypes = toTypeArray(targetType);
  return (
    targetTypes.includes('any') || sourceTypes.includes('any') || sourceTypes.some((type) => targetTypes.includes(type))
  );
}

function matchingHandleForDrop(node: NodeData, dropHandle: DropHandle) {
  return Object.entries(node.params || {}).find(([, param]) => {
    const paramTypes = toTypeArray(param.type);
    const dataTypes = toTypeArray(dropHandle.dataType ?? 'any');

    if (paramTypes.includes('any') || dataTypes.includes('any')) {
      return true;
    }

    if (dropHandle.handleType === 'source') {
      return param.display === 'input' && paramTypes.some((type) => dataTypes.includes(type ?? 'any'));
    }

    return param.display === 'output' && dataTypes.some((type) => paramTypes.includes(type ?? 'any'));
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
}: UseWorkflowConnectionsOptions) {
  const [anchorPosition, setAnchorPosition] = useState<{ top: number; left: number } | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnectionValid, setIsConnectionValid] = useState<boolean | null>(null);
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
        id: nanoid(),
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

      const sourceType = getParam(conn.source, conn.sourceHandle, 'type') || 'default';
      const targetType = getParam(conn.target, conn.targetHandle, 'type') || 'default';
      return typesAreCompatible(sourceType, targetType);
    },
    [getParam],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!connectionTypeRef.current) {
        setIsConnectionValid(null);
        return;
      }

      const target = (event.target as HTMLElement).closest('.modiff-field');
      const fieldKey = target?.getAttribute('data-key');
      const nodeId = target?.closest('.react-flow__node-custom')?.getAttribute('data-id');
      if (!target || !fieldKey || !nodeId) {
        setIsConnectionValid(null);
        return;
      }

      const targetType = getParam(nodeId, fieldKey, 'type');
      setIsConnectionValid(typesAreCompatible(connectionTypeRef.current, targetType));
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

      if (!params.nodeId || !params.handleId) {
        return;
      }

      const sourceType = getParam(params.nodeId, params.handleId, 'type') || 'default';
      connectionTypeRef.current = sourceType;
      dropHandleRef.current = null;
      document.addEventListener('mousemove', handleMouseMove);
    },
    [getParam, handleMouseMove],
  );

  const handleDropOnPane = useCallback((event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('react-flow__pane')) {
      return false;
    }

    const handleId = conn.fromHandle?.id;
    if (handleId) {
      const fromNodeData = conn.fromNode?.data as NodeData;
      const param = fromNodeData.params?.[handleId as keyof typeof fromNodeData.params];
      if (param) {
        dropHandleRef.current = {
          nodeId: conn.fromNode?.id ?? '',
          handleId,
          handleType: conn.fromHandle?.type === 'source' ? 'source' : 'target',
          dataType: param.type ?? null,
        };
      }
    }

    setAnchorPosition(pointerPosition(event));
    return true;
  }, []);

  const handleDropOnField = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      if (!conn.fromNode?.id || !conn.fromHandle?.id) {
        return false;
      }

      const target = (event.target as HTMLElement).closest('.modiff-field');
      const fieldKey = target?.getAttribute('data-key');
      const nodeId = target?.closest('.react-flow__node-custom')?.getAttribute('data-id');
      if (!target || !fieldKey || !nodeId) {
        return false;
      }

      const targetIsInput = getParam(nodeId, fieldKey, 'isInput');
      if (targetIsInput) {
        return false;
      }

      const sourceType = getParam(conn.fromNode.id, conn.fromHandle.id, 'type');
      const targetType = getParam(nodeId, fieldKey, 'type');
      if (!typesAreCompatible(sourceType, targetType)) {
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
    [onConnect, edgeType, getParam, setParam, updateNodeInternals],
  );

  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, conn: FinalConnectionState) => {
      event.preventDefault();
      setIsConnecting(false);
      connectionTypeRef.current = null;
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
      onConnect({
        ...conn,
        edgeType,
      });
    },
    [onConnect, edgeType],
  );

  const closeNodeSearchDialog = useCallback(() => {
    setAnchorPosition(null);
    dropHandleRef.current = null;
  }, []);

  return {
    anchorPosition,
    closeNodeSearchDialog,
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
