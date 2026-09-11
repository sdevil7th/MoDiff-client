import { useEffect } from 'react';
import { useBlockEditorStore } from '../stores/useBlockEditorStore';

/** Keep existing node entry points; the editor is owned by the workspace panel. */
export default function BlockSaveDialogV2({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  useEffect(() => {
    useBlockEditorStore.getState().open(nodeId, 'save');
    onClose();
  }, [nodeId, onClose]);
  return null;
}
