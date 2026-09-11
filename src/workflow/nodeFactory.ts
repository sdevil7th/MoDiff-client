import { nanoid } from 'nanoid';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';

export function cloneNodeData(data: NodeData): NodeData {
  return JSON.parse(JSON.stringify(data)) as NodeData;
}

export function createNodeFromRegistry(
  key: string,
  nodesRegistry: Record<string, NodeData>,
  position: CustomNodeType['position'],
) {
  const registryNode = nodesRegistry[key];
  if (!registryNode) return null;
  const data = cloneNodeData(registryNode);

  return {
    // Ordinary nodes must also have valid semantic IDs when moved into a Block.
    id: `node-${nanoid()}`,
    type: data.type,
    position,
    data,
  } satisfies CustomNodeType;
}
