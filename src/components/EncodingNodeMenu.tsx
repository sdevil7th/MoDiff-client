import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
  visualOperationGroupMedia,
  visualStagePresentation,
} from '../workflow/visualOperationGroupProjection';
import NodeInspectionDetails from './NodeInspectionDetails';
import { operationScope } from '../workflow/operationScope';
import { operationOwnsModel } from '../workflow/operationContracts';

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
  const graph = useFlowStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const kind = visualOperationGroup(node)!;
  const media = visualOperationGroupMedia(node);
  const { label, name } = visualStagePresentation(kind, media);
  const separateLabel = `Separate ${name} stages`;
  let combinationOwner: string | undefined;
  if (
    kind === 'inputs' &&
    !node.data.blockInstanceV2!.effectiveGraph.nodes.some((stage) => {
      const operation = (stage.data.operationAuthoring as { operation?: { nodeType?: string } } | undefined)?.operation;
      return ['guidance', 'guidance_layers'].includes(operation?.nodeType ?? '');
    })
  ) {
    try {
      const flat = unpackVisualOperationGroups(graph);
      const members = flat.members.get(node.id) ?? [];
      const owners = flat.graph.nodes.filter(
        (owner) =>
          operationOwnsModel(owner.data.operationAuthoring?.operation) &&
          operationScope(flat.graph, owner.id).some((stage) => members.includes(stage.id)),
      );
      if (
        owners.length === 1 &&
        operationScope(flat.graph, owners[0]!.id).some((stage) =>
          ['guidance', 'guidance_layers'].includes(stage.data.operationAuthoring?.operation.nodeType ?? ''),
        )
      )
        combinationOwner = owners[0]!.id;
    } catch {
      /* Ambiguous/shared stages retain their existing presentation. */
    }
  }
  const description = {
    guidance:
      'Guidance combines the related Guider and Layers configuration. Schedulers and adapters remain separate nodes.',
    inputs:
      'Text, image and declared Guidance stages run behind this node. Guidance affects conditioning and denoising. Collapsing a section only hides its fields; use its Enabled control to change execution. Load media separately and connect its output to the relevant input.',
    setup:
      'Model Setup contains this loader and its connected configuration or adapter nodes. Model and task changes review the complete connected workflow. Grouping does not load or cache models.',
    mask: 'Prepare Mask contains the existing image source and Outpaint Canvas utility. Canvas geometry, mask feathering and the white-generate mask keep their original bindings. It does not add preprocessing to other masked tasks.',
    output:
      media === 'audio'
        ? 'Audio Output runs the existing audio decoder and Export Audio nodes. Playback uses the normal backend preview state; all declared output sockets remain available.'
        : 'Image Output runs the existing decoder and Preview Image nodes. Its image display uses the normal backend preview state; all declared output sockets remain available.',
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
  async function combine() {
    try {
      const graph = useFlowStore.getState().toObject();
      const context = captureWorkflowOperationContext();
      const signature = operationGraphSignature(graph);
      const { combineOperationInputStages } = await import('../workflow/visualOperationGroups');
      const next = combineOperationInputStages(graph, combinationOwner!);
      commitOperationGraph(next, context, signature, 'Combine encoding and Guidance');
      useStudioStore.getState().saveActiveWorkflowTab(true);
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Could not combine these stages.', { variant: 'error' });
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
          {combinationOwner ? (
            <ModiffMenuAction onClick={combine}>Combine encoding and Guidance</ModiffMenuAction>
          ) : null}
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
