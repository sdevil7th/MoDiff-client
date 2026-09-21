import { useMemo } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { prepareOperationBlockGraph } from '../workflow/operationLegacyBlockChange';
import { BlockOwnerChoices } from './OperationOwnerControls';

/** Conversion is an uncommitted candidate until the user applies the preview. */
export default function LegacyOperationOwnerControls({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const candidate = useMemo(() => {
    try {
      return { root: prepareOperationBlockGraph({ nodes, edges }, nodeId).root };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [nodes, edges, nodeId]);
  return candidate.root ? (
    <BlockOwnerChoices node={candidate.root} ownerBlockId={nodeId} inline />
  ) : (
    <p role="alert">{candidate.error}</p>
  );
}
