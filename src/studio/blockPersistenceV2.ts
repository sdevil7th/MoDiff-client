import { nanoid } from 'nanoid';

import { useFlowStore } from '../stores/useFlowStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  type WorkflowOperationContext,
  useStudioStore,
} from '../stores/useStudioStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { canonicalBlockStringifyV2, type BlockDefinitionV2 } from './blockSchemaV2';
import {
  blockDefinitionIsUserOwnedV2,
  blockDefinitionPersistenceSignatureV2,
  reusableBlockDefinitionFromInstanceV2,
  reusableBlockDefinitionFromSubtreeV2,
} from './blockDefinitionPersistenceV2';
import { blockProjectionNodeIdV2, isBlockRootV2 } from './blockRuntimeV2';

export type BlockPersistenceChoiceV2 = 'workflow' | 'new' | 'update';

function currentWorkflowTitle() {
  const studio = useStudioStore.getState();
  return studio.workflowTabs.find((tab) => tab.id === studio.activeWorkflowTabId)?.title.trim() || 'Workflow';
}

export function contextualDefinitionName(label: string, workflowTitle: string) {
  const normalizedLabel = label.trim() || 'User Node';
  const normalizedWorkflow = workflowTitle.trim() || 'Workflow';
  const suffix = ` — ${normalizedWorkflow}`;
  const name = normalizedLabel.endsWith(suffix) ? normalizedLabel : `${normalizedLabel}${suffix}`;
  return name.slice(0, 512);
}

function nextDefinitionId() {
  const store = useUserBlockStore.getState();
  const occupied = new Set([
    ...store.blocks.map(({ id }) => id),
    ...store.blockDefinitionsV2.map(({ definitionId }) => definitionId),
  ]);
  let definitionId = '';
  do definitionId = `user-block-v2-${nanoid(16)}`;
  while (occupied.has(definitionId));
  return definitionId;
}

function currentInstance(instanceId: string) {
  const root = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
  if (!root || !isBlockRootV2(root)) throw new Error('The Block V2 instance is no longer available in this workflow.');
  const instance = root.data.blockInstanceV2;
  if (!instance) throw new Error('The Block V2 instance has no persisted instance authority.');
  return instance;
}

/**
 * Save the current effective route as a reusable User Node without rebasing or
 * otherwise mutating the workflow insertion. This is used when a registered
 * multi-model Block needs to preserve the active route in the User Nodes
 * library and then continue switching its workflow-local exact route.
 */
export async function saveBlockInstanceV2AsNewUserDefinition(
  {
    instanceId,
    displayName,
    workflowTitle = currentWorkflowTitle(),
    context = captureWorkflowOperationContext(),
  }: {
    instanceId: string;
    displayName?: string;
    workflowTitle?: string;
    context?: WorkflowOperationContext;
  },
  saveDefinition: (definition: BlockDefinitionV2) => Promise<BlockDefinitionV2> = (definition) =>
    useUserBlockStore.getState().saveBlockDefinitionV2(definition),
) {
  assertWorkflowOperationContext(context, { includeForm: false });
  const instance = currentInstance(instanceId);
  const sourceSignature = blockDefinitionPersistenceSignatureV2(instance);
  const candidate = reusableBlockDefinitionFromInstanceV2(instance, {
    choice: 'new',
    definitionId: nextDefinitionId(),
    displayName:
      displayName?.trim() || contextualDefinitionName(instance.definitionSnapshot.displayName, workflowTitle),
  });
  const saved = await saveDefinition(candidate);
  if (canonicalBlockStringifyV2(saved) !== canonicalBlockStringifyV2(candidate)) {
    throw new Error('The saved Block V2 response changed the requested reusable definition.');
  }
  assertWorkflowOperationContext(context, { includeForm: false });
  const latest = currentInstance(instanceId);
  if (blockDefinitionPersistenceSignatureV2(latest) !== sourceSignature) {
    throw new Error('The Block V2 instance changed while its reusable definition was saving. Retry the operation.');
  }
  return saved;
}

/** Save one exact Modular placement subtree without mutating its workflow instance. */
export async function saveBlockSubtreeV2AsNewUserDefinition(
  {
    instanceId,
    rootNodeId,
    label,
    displayName,
    workflowTitle = currentWorkflowTitle(),
    context = captureWorkflowOperationContext(),
  }: {
    instanceId: string;
    rootNodeId: string;
    label: string;
    displayName?: string;
    workflowTitle?: string;
    context?: WorkflowOperationContext;
  },
  saveDefinition: (definition: BlockDefinitionV2) => Promise<BlockDefinitionV2> = (definition) =>
    useUserBlockStore.getState().saveBlockDefinitionV2(definition),
) {
  assertWorkflowOperationContext(context, { includeForm: false });
  const instance = currentInstance(instanceId);
  const sourceSignature = blockDefinitionPersistenceSignatureV2(instance);
  const candidate = reusableBlockDefinitionFromSubtreeV2(instance, {
    rootNodeId,
    definitionId: nextDefinitionId(),
    displayName: displayName?.trim() || contextualDefinitionName(label, workflowTitle),
  });
  const saved = await saveDefinition(candidate);
  if (canonicalBlockStringifyV2(saved) !== canonicalBlockStringifyV2(candidate)) {
    throw new Error('The saved subtree response changed the requested reusable User Node.');
  }
  assertWorkflowOperationContext(context, { includeForm: false });
  const latest = currentInstance(instanceId);
  if (blockDefinitionPersistenceSignatureV2(latest) !== sourceSignature) {
    throw new Error('The Block changed while its subtree User Node was saving. Retry the operation.');
  }
  return saved;
}

/**
 * Commit one explicit V2 save choice. Only the targeted embedded instance is
 * rebased after an acknowledged reusable-definition write; sibling/open
 * workflow instances keep their snapshots until explicitly refreshed.
 */
export async function persistBlockInstanceV2Choice(
  {
    instanceId,
    choice,
    displayName,
    workflowTitle = currentWorkflowTitle(),
    context = captureWorkflowOperationContext(),
  }: {
    instanceId: string;
    choice: BlockPersistenceChoiceV2;
    displayName?: string;
    workflowTitle?: string;
    context?: WorkflowOperationContext;
  },
  saveDefinition: (definition: BlockDefinitionV2) => Promise<BlockDefinitionV2> = (definition) =>
    useUserBlockStore.getState().saveBlockDefinitionV2(definition),
) {
  assertWorkflowOperationContext(context, { includeForm: false });
  const instance = currentInstance(instanceId);
  if (choice === 'workflow') {
    // No reusable-definition API/store mutation belongs to this choice.
    assertWorkflowOperationContext(context, { includeForm: false });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { choice, definition: null } as const;
  }
  if (choice === 'update' && !blockDefinitionIsUserOwnedV2(instance.definitionSnapshot)) {
    throw new Error('Registered catalog definitions cannot be overwritten. Save this block as a new User Node.');
  }

  if (choice === 'new') {
    const saved = await saveBlockInstanceV2AsNewUserDefinition(
      { instanceId, workflowTitle, displayName, context },
      saveDefinition,
    );
    useFlowStore.getState().applyBlockDefinitionV2(instanceId, saved);
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return { choice, definition: saved } as const;
  }

  const sourceSignature = blockDefinitionPersistenceSignatureV2(instance);
  const candidate = reusableBlockDefinitionFromInstanceV2(instance, {
    choice,
    definitionId: instance.definitionRef.definitionId,
    displayName: displayName?.trim() || instance.definitionSnapshot.displayName,
  });
  const saved = await saveDefinition(candidate);
  if (canonicalBlockStringifyV2(saved) !== canonicalBlockStringifyV2(candidate)) {
    throw new Error('The saved Block V2 response changed the requested reusable definition.');
  }

  assertWorkflowOperationContext(context, { includeForm: false });
  const latest = currentInstance(instanceId);
  if (blockDefinitionPersistenceSignatureV2(latest) !== sourceSignature) {
    throw new Error('The Block V2 instance changed while its reusable definition was saving. Retry the operation.');
  }
  useFlowStore.getState().applyBlockDefinitionV2(instanceId, saved);
  useStudioStore.getState().saveActiveWorkflowTab(true);
  return { choice, definition: saved } as const;
}

export const USER_BLOCK_V2_DRAG_PREFIX = 'modiff-user-block-v2:';

/** The selected canvas node is a view, not a separate nested save authority. */
export async function persistBlockSelectionV2Choice(
  {
    nodeId,
    choice,
    displayName,
    context = captureWorkflowOperationContext(),
  }: {
    nodeId: string;
    choice: BlockPersistenceChoiceV2;
    displayName?: string;
    context?: WorkflowOperationContext;
  },
  saveDefinition: (definition: BlockDefinitionV2) => Promise<BlockDefinitionV2> = (definition) =>
    useUserBlockStore.getState().saveBlockDefinitionV2(definition),
) {
  // Check BEFORE contacting the library. A dialog left open across a tab or
  // canvas replacement must not write a definition from the new workflow.
  assertWorkflowOperationContext(context, { includeForm: false });
  const selected = useFlowStore.getState().nodes.find((node) => node.id === nodeId);
  if (!selected) throw new Error('The selected Block is no longer available in this workflow.');
  if (selected.data.blockInstanceV2) {
    return persistBlockInstanceV2Choice({ instanceId: nodeId, choice, displayName, context }, saveDefinition);
  }
  const ownerId = selected.data.blockProjectionOwnerId;
  const semanticNodeId = selected.data.blockProjectionNodeId;
  if (selected.data.blockProjectionKind !== 'internal' || !ownerId || !semanticNodeId) {
    throw new Error('The selection is not a Block V2 root or Modular subtree.');
  }
  const instance = currentInstance(ownerId);
  if (selected.id !== blockProjectionNodeIdV2(ownerId, semanticNodeId)) {
    throw new Error('The selected Modular subtree has an invalid projection identity.');
  }
  if (!instance.effectiveGraph.nodes.some((node) => node.nodeId === semanticNodeId)) {
    throw new Error('The selected Modular subtree is no longer present in the owning Block.');
  }
  if (choice === 'update') {
    throw new Error('This nested Block has no independent reusable definition to update. Save it as a new User Node.');
  }
  if (choice === 'workflow') {
    return persistBlockInstanceV2Choice({ instanceId: ownerId, choice, context }, saveDefinition);
  }
  const saved = await saveBlockSubtreeV2AsNewUserDefinition(
    {
      instanceId: ownerId,
      rootNodeId: semanticNodeId,
      displayName,
      label: selected.data.label || selected.data.action || 'Modular Diffusers Block',
      context,
    },
    saveDefinition,
  );
  useStudioStore.getState().saveActiveWorkflowTab(true);
  return { choice, definition: saved } as const;
}
