import { getIncomers, type Edge, type NodeChange, type OnNodeDrag } from '@xyflow/react';
import { useCallback, useState } from 'react';

import type { CustomNodeType } from '../stores/useFlowStore';

type UseWorkflowAltDragOptions = {
  nodes: CustomNodeType[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<CustomNodeType>[]) => void;
};

export function useWorkflowAltDrag({ nodes, edges, onNodesChange }: UseWorkflowAltDragOptions) {
  const [isAltDragging, setIsAltDragging] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [connectedNodeIds, setConnectedNodeIds] = useState<Set<string>>(new Set());
  const [initialPositions, setInitialPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [dragStartPosition, setDragStartPosition] = useState<{ x: number; y: number } | null>(null);

  const findConnectedNodes = useCallback(
    (nodeId: string, visited: Set<string> = new Set()): Set<string> => {
      if (visited.has(nodeId)) {
        return visited;
      }

      visited.add(nodeId);

      const node = nodes.find((item) => item.id === nodeId);
      if (!node) {
        return visited;
      }

      const incomers = getIncomers(node, nodes, edges);
      for (const incomer of incomers) {
        if (!visited.has(incomer.id)) {
          findConnectedNodes(incomer.id, visited);
        }
      }

      return visited;
    },
    [nodes, edges],
  );

  const handleNodeDragStart: OnNodeDrag<CustomNodeType> = useCallback(
    (event, node) => {
      const isAltPressed = 'altKey' in event ? event.altKey : false;

      if (!isAltPressed) {
        return;
      }

      setIsAltDragging(true);
      setDraggedNodeId(node.id);
      setDragStartPosition(node.position);

      const connected = findConnectedNodes(node.id);
      setConnectedNodeIds(connected);

      const positions = new Map<string, { x: number; y: number }>();
      connected.forEach((nodeId) => {
        const connectedNode = nodes.find((item) => item.id === nodeId);
        if (connectedNode) {
          positions.set(nodeId, { x: connectedNode.position.x, y: connectedNode.position.y });
        }
      });
      setInitialPositions(positions);
    },
    [findConnectedNodes, nodes],
  );

  const handleNodeDrag: OnNodeDrag<CustomNodeType> = useCallback(
    (_event, node) => {
      if (!isAltDragging || !draggedNodeId || !connectedNodeIds.has(node.id) || !dragStartPosition) {
        return;
      }

      const deltaX = node.position.x - dragStartPosition.x;
      const deltaY = node.position.y - dragStartPosition.y;
      const nodeChanges: NodeChange<CustomNodeType>[] = [];
      Array.from(connectedNodeIds)
        .filter((nodeId) => nodeId !== node.id)
        .forEach((nodeId) => {
          const connectedNode = nodes.find((item) => item.id === nodeId);
          const initialPos = initialPositions.get(nodeId);
          if (!connectedNode || !initialPos) {
            return;
          }

          nodeChanges.push({
            type: 'position',
            id: nodeId,
            position: {
              x: initialPos.x + deltaX,
              y: initialPos.y + deltaY,
            },
            positionAbsolute: {
              x: initialPos.x + deltaX,
              y: initialPos.y + deltaY,
            },
          });
        });

      if (nodeChanges.length > 0) {
        onNodesChange(nodeChanges);
      }
    },
    [isAltDragging, draggedNodeId, connectedNodeIds, dragStartPosition, initialPositions, nodes, onNodesChange],
  );

  const handleNodeDragStop: OnNodeDrag<CustomNodeType> = useCallback(() => {
    if (!isAltDragging) {
      return;
    }

    setIsAltDragging(false);
    setDraggedNodeId(null);
    setConnectedNodeIds(new Set());
    setInitialPositions(new Map());
    setDragStartPosition(null);
  }, [isAltDragging]);

  return {
    handleNodeDragStart,
    handleNodeDrag,
    handleNodeDragStop,
  };
}
