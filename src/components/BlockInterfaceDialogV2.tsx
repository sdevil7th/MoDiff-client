import { useEffect } from 'react';
import { useBlockEditorStore } from '../stores/useBlockEditorStore';

/** Keep existing node entry points; the editor is owned by the workspace panel. */
export default function BlockInterfaceDialogV2({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  useEffect(() => {
    useBlockEditorStore.getState().open(nodeId, 'interface');
    onClose();
  }, [nodeId, onClose]);
  return null;
}
