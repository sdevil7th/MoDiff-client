import type { NodeData, NodeParams } from '../stores/useNodeStore';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';

export type HandleDirection = 'source' | 'target' | null | undefined;

/** Use the same endpoint and type rules for suggestions and the inserted wire. */
export function matchingNodeHandleForDrop(
  node: NodeData,
  dataType: NodeParams['type'] | null,
  handleType: HandleDirection,
) {
  if (handleType !== 'source' && handleType !== 'target') return undefined;
  return Object.entries(node.params).find(([, param]) => {
    if (handleType === 'source') {
      return (
        (param.display === 'input' || param.isInput) &&
        param.display !== 'output' &&
        connectionTypesAreCompatible(dataType, param.type)
      );
    }
    return param.display === 'output' && connectionTypesAreCompatible(param.type, dataType);
  });
}
