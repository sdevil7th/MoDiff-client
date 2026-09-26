import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, useStudioStore } from '../stores/useStudioStore';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import {
  ModiffDialog,
  ModiffIconButton,
  ModiffMenuAction,
  ModiffMenuRoot,
  ModiffMenuSurface,
  ModiffMenuTrigger,
} from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { commitOperationGraph, operationGraphSignature } from '../workflow/operationGraphTransaction';
import { unpackVisualOperationGroups } from '../workflow/visualOperationGroups';
import NodeInspectionDetails from './NodeInspectionDetails';
import { isFocusedGuidance } from '../workflow/encodingNodePresentation';

export default function EncodingNodeMenu({
  node,
  inspect,
  save,
  canSave,
}: {
  node: CustomNodeType;
  inspect: () => void;
  save: () => void;
  canSave: boolean;
}) {
  const [docsOpen, setDocsOpen] = useState(false);
  const guidance = isFocusedGuidance(node.data.blockInstanceV2);
  const label = guidance ? 'Guidance' : 'Encode Inputs';
  const separateLabel = `Separate ${guidance ? 'guidance' : 'encoding'} stages`;
  function separate() {
    try {
      const graph = useFlowStore.getState().toObject();
      const context = captureWorkflowOperationContext();
      const next = unpackVisualOperationGroups(graph, new Set([node.id])).graph;
      commitOperationGraph(next, context, operationGraphSignature(graph), separateLabel);
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Could not separate stages.', {
        variant: 'error',
      });
    }
  }
  return (
    <>
      <ModiffMenuRoot className="nodrag nowheel">
        <ModiffMenuTrigger>
          <ModiffIconButton label={`${label} options`} size="compact">
            <Ellipsis size={16} />
          </ModiffIconButton>
        </ModiffMenuTrigger>
        <ModiffMenuSurface layer="graph">
          <ModiffMenuAction onClick={inspect}>Inspect implementation</ModiffMenuAction>
          <ModiffMenuAction onClick={separate}>{separateLabel}</ModiffMenuAction>
          {canSave ? <ModiffMenuAction onClick={save}>Save as reusable node…</ModiffMenuAction> : null}
          <ModiffMenuAction onClick={() => requestAnimationFrame(() => setDocsOpen(true))}>
            Documentation
          </ModiffMenuAction>
        </ModiffMenuSurface>
      </ModiffMenuRoot>
      {docsOpen ? (
        <ModiffDialog open title={`${label} documentation`} onClose={() => setDocsOpen(false)}>
          <div className="grid gap-4">
            <p>
              {guidance
                ? 'Guidance combines the related Guider and Layers configuration. Schedulers and adapters remain separate nodes.'
                : 'Text and image stages both run when present. Collapsing a section only hides its fields. Load media separately and connect its output to the relevant input.'}
            </p>
            {blockOperationGraphV2(node.data.blockInstanceV2!).nodes.map((stage) => (
              <section key={stage.id}>
                <h3 className="mb-2 font-semibold">{stage.data.label}</h3>
                <NodeInspectionDetails node={stage} section="docs" />
              </section>
            ))}
          </div>
        </ModiffDialog>
      ) : null}
    </>
  );
}
