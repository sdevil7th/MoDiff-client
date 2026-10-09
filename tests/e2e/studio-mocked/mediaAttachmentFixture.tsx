import { createRoot } from 'react-dom/client';
import MediaAttachmentControls from '../../../src/components/MediaAttachmentControls';
import { useFlowStore } from '../../../src/stores/useFlowStore';
import { ModiffButton } from '../../../src/ui';

// eslint-disable-next-line react-refresh/only-export-components -- Isolated mounted-control test entry point.
function MediaAttachmentProbe({
  ownerId,
  otherOwnerId,
  sourceId,
}: {
  ownerId: string;
  otherOwnerId: string;
  sourceId: string;
}) {
  const owner = useFlowStore((state) => state.nodes.find((node) => node.id === ownerId)!);
  return (
    <section data-testid="mounted-media-attachment">
      <MediaAttachmentControls node={owner} inline />
      <ModiffButton
        onClick={() =>
          useFlowStore
            .getState()
            .setParamWithHistory(otherOwnerId, 'repo_id', { source: 'hub', value: 'Qwen/Qwen-Image' })
        }
      >
        Use the same source model
      </ModiffButton>
      <ModiffButton onClick={() => useFlowStore.getState().removeNodes(sourceId)}>Remove selected source</ModiffButton>
      <ModiffButton onClick={() => useFlowStore.getState().undo()}>Undo source edit</ModiffButton>
      <ModiffButton onClick={() => useFlowStore.getState().redo()}>Redo source edit</ModiffButton>
    </section>
  );
}

export function mountMediaAttachmentProbe(ownerId: string, otherOwnerId: string, sourceId: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(<MediaAttachmentProbe ownerId={ownerId} otherOwnerId={otherOwnerId} sourceId={sourceId} />);
}
