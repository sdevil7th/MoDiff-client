import { lazy, Suspense, useState } from 'react';
import { ModiffDialog } from '../ui';
import { captureWorkflowOperationContext } from '../stores/useStudioStore';

const BlockSaveDialogContentV2 = lazy(() => import('./BlockSaveDialogContentV2'));

/** Save choices are shared at every depth, but are not needed to open a graph. */
export default function BlockSaveDialogV2(props: { nodeId: string; onClose: () => void }) {
  const [context] = useState(captureWorkflowOperationContext);
  return (
    <Suspense
      fallback={
        <ModiffDialog open title="Save block changes" onClose={props.onClose} panelClassName="max-w-lg">
          <p role="status">Loading save options…</p>
        </ModiffDialog>
      }
    >
      <BlockSaveDialogContentV2 {...props} context={context} />
    </Suspense>
  );
}
