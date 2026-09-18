import { EditorPanel } from '../ui/EditorPanel';
import { useRef, useState } from 'react';

import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore, type WorkflowOperationContext } from '../stores/useStudioStore';
import {
  contextualDefinitionName,
  persistBlockSelectionV2Choice,
  type BlockPersistenceChoiceV2,
} from '../studio/blockPersistenceV2';
import { resolveCompositeBlockCapabilitiesV2 } from '../studio/compositeBlockCapabilitiesV2';
import { ModiffButton, ModiffInput, ModiffFieldShell } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';

/** Mounted on open so the target and workflow context cannot drift behind the dialog. */
export default function BlockSaveDialogContentV2({
  nodeId,
  onClose,
  context,
}: {
  nodeId: string;
  onClose: () => void;
  context: WorkflowOperationContext;
}) {
  const [busy, setBusy] = useState<BlockPersistenceChoiceV2 | null>(null);
  const submitting = useRef(false);
  const selected = useFlowStore((state) => state.nodes.find((node) => node.id === nodeId));
  const ownerId = selected?.data.blockInstanceV2 ? nodeId : selected?.data.blockProjectionOwnerId;
  const instance = useFlowStore((state) => state.nodes.find((node) => node.id === ownerId)?.data.blockInstanceV2);
  const nested = Boolean(selected && !selected.data.blockInstanceV2);
  const [name, setName] = useState(() => {
    const title =
      useStudioStore.getState().workflowTabs.find((tab) => tab.id === context.workflowTabId)?.title || 'Workflow';
    return contextualDefinitionName(selected?.data.label || instance?.definitionSnapshot.displayName || 'Block', title);
  });
  const invalidName = !name.trim() || name.trim().length > 512;
  const capabilities = instance
    ? resolveCompositeBlockCapabilitiesV2(instance.definitionSnapshot, instance, {
        editWorkflow: true,
        configureInterfaces: true,
        createUserDefinitions: true,
        updateUserDefinitions: true,
      })
    : null;

  async function save(choice: BlockPersistenceChoiceV2) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(choice);
    try {
      if (choice !== 'workflow' && invalidName) throw new Error('Enter a Block name (up to 512 characters).');
      const result = await persistBlockSelectionV2Choice({ nodeId, choice, context, displayName: name.trim() });
      enqueueSnackbar(
        choice === 'workflow'
          ? 'Changes kept only in this workflow.'
          : `${choice === 'new' ? 'Saved new' : 'Updated'} Block: ${result.definition?.displayName ?? 'Block'}`,
        { variant: 'success', autoHideDuration: 3200 },
      );
      onClose();
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Could not save the Block changes.', {
        variant: 'error',
        autoHideDuration: 6000,
      });
    } finally {
      submitting.current = false;
      setBusy(null);
    }
  }

  return (
    <EditorPanel
      onClose={() => {
        if (!submitting.current) onClose();
      }}
      title="Save block changes"
      testId={`save-user-block-choices-${nodeId}`}
      footer={
        <>
          <ModiffButton disabled={Boolean(busy)} onClick={onClose}>
            Cancel
          </ModiffButton>
          <ModiffButton
            disabled={Boolean(busy) || !capabilities?.keepWorkflowOnly}
            loading={busy === 'workflow'}
            onClick={() => void save('workflow')}
          >
            Keep only in this workflow
          </ModiffButton>
          {capabilities?.saveAsNewUserNode ? (
            <ModiffButton
              tone="primary"
              disabled={Boolean(busy) || invalidName}
              loading={busy === 'new'}
              onClick={() => void save('new')}
            >
              Save as new Block
            </ModiffButton>
          ) : null}
          {!nested && capabilities?.updateReusableDefinition ? (
            <ModiffButton
              disabled={Boolean(busy) || invalidName}
              loading={busy === 'update'}
              onClick={() => void save('update')}
            >
              Update existing Block
            </ModiffButton>
          ) : null}
        </>
      }
    >
      <div className="grid gap-2 text-sm text-modiff-subtle-text">
        <p className="font-semibold text-modiff-text">{selected?.data.label || 'Block'}</p>
        <ModiffFieldShell label="Block name" required error={invalidName ? 'Enter a name.' : undefined}>
          <ModiffInput
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={512}
            disabled={Boolean(busy)}
            aria-invalid={invalidName}
            autoFocus
          />
        </ModiffFieldShell>
        <p>Save a reusable copy with these settings and the inputs and outputs you configured.</p>
        <p>
          {nested
            ? 'Only this Block and its contents are saved. Outside nodes and their connections stay in this workflow.'
            : 'Outside nodes and their connections stay in this workflow. Temporary connected sockets are not added to the saved Block.'}
        </p>
      </div>
    </EditorPanel>
  );
}
