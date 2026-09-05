import { useRef, useState } from 'react';

import { useFlowStore } from '../stores/useFlowStore';
import type { WorkflowOperationContext } from '../stores/useStudioStore';
import { persistBlockSelectionV2Choice, type BlockPersistenceChoiceV2 } from '../studio/blockPersistenceV2';
import { resolveCompositeBlockCapabilitiesV2 } from '../studio/compositeBlockCapabilitiesV2';
import { ModiffButton, ModiffDialog } from '../ui';
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
      const result = await persistBlockSelectionV2Choice({ nodeId, choice, context });
      enqueueSnackbar(
        choice === 'workflow'
          ? 'Changes kept only in this workflow.'
          : `${choice === 'new' ? 'Saved new' : 'Updated'} User Node: ${result.definition?.displayName ?? 'User Node'}`,
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
    <ModiffDialog
      open
      onClose={() => {
        if (!submitting.current) onClose();
      }}
      title="Save block changes"
      testId={`save-user-block-choices-${nodeId}`}
      panelClassName="max-w-lg"
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
            <ModiffButton disabled={Boolean(busy)} loading={busy === 'new'} onClick={() => void save('new')}>
              Save as new User Node
            </ModiffButton>
          ) : null}
          {!nested && capabilities?.updateReusableDefinition ? (
            <ModiffButton
              tone="primary"
              disabled={Boolean(busy)}
              loading={busy === 'update'}
              onClick={() => void save('update')}
            >
              Update existing User Node
            </ModiffButton>
          ) : null}
        </>
      }
    >
      <div className="grid gap-2 text-sm text-modiff-subtle-text">
        <p className="font-semibold text-modiff-text">{selected?.data.label || 'Block'}</p>
        <p>The current instance values and presentation are already embedded in this workflow.</p>
        <p>
          {nested
            ? 'Save as new copies only this Block and its descendants, with the current prompts and settings. Connections crossing this subtree become public inputs and outputs. The owning Block and other workflow instances are unchanged.'
            : 'Saving a reusable User Node preserves the exact effective graph, explicit interface, current declared defaults, preview bindings, and source ancestry. Other workflow instances keep their embedded snapshots.'}
        </p>
        {nested ? (
          <p>
            This nested Block is part of its owning workflow instance, not a separate library definition. Insert its
            saved User Node to update that reusable definition independently.
          </p>
        ) : null}
      </div>
    </ModiffDialog>
  );
}
