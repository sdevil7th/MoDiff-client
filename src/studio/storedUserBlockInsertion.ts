import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import { createBlockInstanceV2 } from './blockSchemaV2';
import { createBlockRootNodeV2 } from './blockRuntimeV2';
import { isBlockDefinitionV2, type StoredUserBlockDefinition } from './userBlockLibrary';
import { createUserBlockNode } from './userBlocks';

/** All insertion surfaces preserve the saved definition and create a fresh instance. */
export function createStoredUserBlockNode(block: StoredUserBlockDefinition, position: CustomNodeType['position']) {
  return isBlockDefinitionV2(block)
    ? createBlockRootNodeV2(
        createBlockInstanceV2(block, {
          instanceId: `block-v2-${nanoid(16)}`,
          position,
          size: { width: 420, height: 480 },
        }),
      )
    : createUserBlockNode(block, position);
}
