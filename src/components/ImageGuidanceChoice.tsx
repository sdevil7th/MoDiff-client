import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { imageStageGuidance } from '../studio/imageStageGuidance';
import { ModiffButton } from '../ui';

export default function ImageGuidanceChoice({ nodeId }: { nodeId: string }) {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const registry = useNodesStore((s) => s.nodesRegistry);
  const catalog = useNodesStore((s) => s.visualNodeCatalog);
  const node = nodes.find((item) => item.id === nodeId);
  const choice = node && imageStageGuidance(node, nodes, edges, registry, catalog);
  if (!choice) return null;
  if (choice.reason) return <p className="text-xs text-modiff-subtle-text">{choice.reason}</p>;
  return (
    <ModiffButton
      className="nodrag"
      onClick={() => {
        const flow = useFlowStore.getState();
        const current = flow.nodes.find((item) => item.id === nodeId);
        if (!current) return;
        const currentRegistry = useNodesStore.getState();
        const updated = imageStageGuidance(
          current,
          flow.nodes,
          flow.edges,
          currentRegistry.nodesRegistry,
          currentRegistry.visualNodeCatalog,
        )?.next;
        if (updated)
          flow.replaceGraph(
            {
              nodes: flow.nodes.map((peer) => (peer === current ? { ...current, data: updated } : peer)),
              edges: flow.edges,
            },
            { historyLabel: choice.label },
          );
      }}
    >
      {choice.label}
    </ModiffButton>
  );
}
