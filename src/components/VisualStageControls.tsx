import { useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, useStudioStore } from '../stores/useStudioStore';
import {
  ModiffDialog,
  ModiffIconButton,
  ModiffMenuAction,
  ModiffMenuRoot,
  ModiffMenuSurface,
  ModiffMenuTrigger,
} from '../ui';
import { operationGraphSignature, commitOperationGraph } from '../workflow/operationGraphTransaction';
import {
  groupOperationStages,
  unpackVisualOperationGroups,
  visualOperationGroup,
  type VisualOperationGroup,
} from '../workflow/visualOperationGroups';
import MediaAttachmentControls from './MediaAttachmentControls';
import { useNodesStore } from '../stores/useNodeStore';
import { executableMediaOperations, mediaAttachmentChoices } from '../workflow/mediaAttachment';

/** Workflow-local presentation actions; saving a reusable definition is separate. */
export default function VisualStageControls({ node }: { node: CustomNodeType }) {
  const [error, setError] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const kind = visualOperationGroup(node);
  const operations = useNodesStore((state) => state.operationContracts);
  const support = useNodesStore((state) => state.pipelineSupport);
  const canAttach =
    !kind &&
    mediaAttachmentChoices(
      executableMediaOperations(operations, support),
      node.data.operationAuthoring?.operation.pipelineClass ?? '',
    ).length > 0;
  function apply(group?: VisualOperationGroup) {
    try {
      const graph = useFlowStore.getState().toObject();
      const context = captureWorkflowOperationContext();
      const next = group
        ? groupOperationStages(graph, node.id, [group])
        : unpackVisualOperationGroups(graph, new Set([node.id])).graph;
      if (next === graph && !kind)
        throw new Error('No eligible ungrouped stages on this model branch. Existing groups are unchanged.');
      commitOperationGraph(
        next,
        context,
        operationGraphSignature(graph),
        group ? 'Group workflow stages' : 'Ungroup workflow stages',
      );
      useStudioStore.getState().saveActiveWorkflowTab(true);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not group these stages.');
    }
  }
  return (
    <div className="nodrag nowheel grid gap-2 py-2">
      <ModiffMenuRoot>
        <ModiffMenuTrigger>
          <ModiffIconButton label="Workflow stage actions" size="compact">
            <Ellipsis size={16} />
          </ModiffIconButton>
        </ModiffMenuTrigger>
        <ModiffMenuSurface layer="graph">
          {kind ? (
            <ModiffMenuAction onClick={() => apply()}>Ungroup stages</ModiffMenuAction>
          ) : (
            <>
              {!node.data.blockProjectionOwnerId ? (
                <>
                  <ModiffMenuAction onClick={() => apply('inputs')}>Group input encoders</ModiffMenuAction>
                  <ModiffMenuAction onClick={() => apply('guidance')}>Group guidance</ModiffMenuAction>
                </>
              ) : null}
              {canAttach ? (
                <ModiffMenuAction onClick={() => requestAnimationFrame(() => setAttachOpen(true))}>
                  Add image / audio input…
                </ModiffMenuAction>
              ) : null}
            </>
          )}
        </ModiffMenuSurface>
      </ModiffMenuRoot>
      {attachOpen ? (
        <ModiffDialog open title="Add image / audio input" onClose={() => setAttachOpen(false)}>
          <MediaAttachmentControls node={node} onAttached={() => setAttachOpen(false)} inline />
        </ModiffDialog>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-modiff-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
