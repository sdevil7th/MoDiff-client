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
import {
  unpackVisualOperationGroups,
  visualOperationGroup,
  VISUAL_STAGE_LABELS,
  VISUAL_STAGE_NAMES,
} from '../workflow/visualOperationGroupProjection';
import NodeInspectionDetails from './NodeInspectionDetails';

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
  const kind = visualOperationGroup(node)!;
  const label = VISUAL_STAGE_LABELS[kind];
  const separateLabel = `Separate ${VISUAL_STAGE_NAMES[kind]} stages`;
  const description = {
    guidance:
      'Guidance combines the related Guider and Layers configuration. Schedulers and adapters remain separate nodes.',
    inputs:
      'Text and image stages both run when present. Collapsing a section only hides its fields. Load media separately and connect its output to the relevant input.',
    setup:
      'Model Setup contains this loader and its connected configuration or adapter nodes. Model and task changes review the complete connected workflow. Grouping does not load or cache models.',
    mask: 'Prepare Mask contains the existing image source and Outpaint Canvas utility. Canvas geometry, mask feathering and the white-generate mask keep their original bindings. It does not add preprocessing to other masked tasks.',
    output:
      'Image Output runs the existing decoder and Preview Image nodes. Its image display uses the normal backend preview state; all declared output sockets remain available.',
  }[kind];
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
            <p>{description}</p>
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
