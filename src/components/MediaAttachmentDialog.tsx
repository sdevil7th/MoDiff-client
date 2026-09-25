import { useState } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { ModiffDialog, ModiffFieldShell, ModiffSelect } from '../ui';
import MediaAttachmentControls from './MediaAttachmentControls';

export default function MediaAttachmentDialog({
  owners,
  source,
  onClose,
}: {
  owners: CustomNodeType[];
  source: { nodeId: string; handleId: string };
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(owners[0]?.id ?? '');
  const owner = owners.find((node) => node.id === selected);
  return (
    <ModiffDialog open title="Attach media input" onClose={onClose}>
      <div className="grid gap-3">
        <p className="text-sm text-modiff-subtle-text">
          Choose how this workflow should use the input. Required stages are added to the existing graph.
        </p>
        {owners.length > 1 ? (
          <ModiffFieldShell label="Operation">
            <ModiffSelect
              aria-label="Media attachment operation"
              value={selected}
              onValueChange={setSelected}
              options={owners.map((node) => ({ value: node.id, label: node.data.label || node.id }))}
            />
          </ModiffFieldShell>
        ) : null}
        {owner ? (
          <MediaAttachmentControls key={owner.id} node={owner} initialSource={source} onAttached={onClose} />
        ) : null}
      </div>
    </ModiffDialog>
  );
}
