import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import type { Edge } from '@xyflow/react';
import { arrangeGraphNodes, waitForGraphNodeMeasurements } from '../workflow/graphLayout';
import { groupNewOperationGraph } from '../workflow/visualOperationGroups';
import { workflowSnapshotFromGraph } from './workflowInference';
import { setBlockPresentationV2 } from './blockRuntimeV2';
import type { StudioFormState } from './types';
import {
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
} from '../stores/useStudioStore';

/** Fresh bundled examples use the same stage presentation as fresh templates.
 * Saved documents and ordinary file imports retain their authored presentation. */
export function exampleWorkflowSnapshotFromGraph(
  graph: Parameters<typeof workflowSnapshotFromGraph>[0],
  edgeType: string,
  fallback: StudioFormState,
) {
  const snapshot = workflowSnapshotFromGraph(graph, edgeType, fallback);
  const nodes = snapshot.nodes as CustomNodeType[];
  const grouped = groupNewOperationGraph({ nodes, edges: snapshot.edges as Edge[] });
  const changed = grouped.nodes.some((node) => !nodes.some((original) => original.id === node.id));
  // Role labels in canonical files are summary hints, not an accepted managed
  // template receipt. Leave the ordinary graph authoritative even without folds.
  if (!changed) return { ...snapshot, studioGraphBinding: null };
  return {
    ...snapshot,
    nodes: arrangeGraphNodes(grouped.nodes, grouped.edges).map((node) =>
      node.data.blockInstanceV2
        ? {
            ...node,
            data: {
              ...node.data,
              blockInstanceV2: setBlockPresentationV2(node.data.blockInstanceV2, { position: node.position }),
            },
          }
        : node,
    ),
    edges: grouped.edges,
    // Fresh Examples retain their actual graph, without inferred template authority.
    studioGraphBinding: null,
  };
}

/** Finish a fresh example only while its document is still selected. Ordinary
 * controls need their real measured heights before the final layout and fit. */
export async function settleExampleWorkflowCanvas() {
  const context = captureWorkflowOperationContext();
  try {
    const measured = await waitForGraphNodeMeasurements(() => useFlowStore.getState().nodes, 5_000);
    assertWorkflowOperationContext(context, { includeForm: false });
    if (!measured)
      throw new Error('The example controls did not finish measuring. Reopen the example to retry its layout.');
    await useFlowStore
      .getState()
      .arrangeGraph({ history: false, fitNewNodeContents: true, reserveFirstImagePreviewSpace: true });
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
    );
    assertWorkflowOperationContext(context, { includeForm: false });
    useStudioStore.getState().saveActiveWorkflowTab(true);
    return true;
  } catch (error) {
    if (isWorkflowOperationCancelled(error)) return false;
    throw error;
  }
}
