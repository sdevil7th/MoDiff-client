import { nanoid } from 'nanoid';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import { normalizeGenericModelLoaderParams } from '../studio/modelSelection';

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
  data.params = normalizeGenericModelLoaderParams(data.module, data.action, data.params);

  return {
    id: nanoid(),
    type: data.type,
    position,
    data,
  } satisfies CustomNodeType;
}
