import { useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { stageDefinition, visualStageForNode } from '../studio/visualNodeCatalog';
import { changeStageAction } from '../studio/stageActionChange';
import { ModiffSelect } from '../ui';

/** Ordinary manually authored stages. Managed model switches and saved Block
 * interfaces keep their existing owners. */
export default function StageActionChoice({ nodeId }: { nodeId: string }) {
  const node = useFlowStore((s) => s.nodes.find((n) => n.id === nodeId));
  const catalog = useNodesStore((s) => s.visualNodeCatalog);
  const registry = useNodesStore((s) => s.nodesRegistry);
  const [reason, setReason] = useState('');
  const current = node && visualStageForNode(catalog, node.data);
  if (
    !node ||
    !catalog ||
    !current ||
    node.parentId ||
    node.data.studioRole ||
    node.data.operationAuthoring ||
    node.data.blockProjectionOwnerId ||
    node.data.blockInstanceV2 ||
    current.mode.guidance
  )
    return null;
  const choices = current.stage.modes.filter((m) => !m.guidance && stageDefinition(m, registry));
  if (choices.length < 2) return null;
  return (
    <div className="grid gap-1">
      <ModiffSelect
        aria-label="Stage action"
        value={String(choices.indexOf(current.mode))}
        options={choices.map((m, i) => ({ value: String(i), label: m.label }))}
        onValueChange={(v) => {
          const flow = useFlowStore.getState(),
            selected = choices[Number(v)],
            live = flow.nodes.find((n) => n.id === nodeId);
          if (!selected || !live) return;
          try {
            const next = changeStageAction(live, selected, catalog, registry, flow.nodes, flow.edges);
            flow.replaceGraph(
              { nodes: flow.nodes.map((n) => (n === live ? { ...n, data: next } : n)), edges: flow.edges },
              { historyLabel: 'Change stage action' },
            );
            setReason('');
          } catch (error) {
            setReason(error instanceof Error ? error.message : 'Could not change this stage.');
          }
        }}
      />
      {reason && (
        <p role="alert" className="text-xs text-modiff-subtle-text">
          {reason}
        </p>
      )}
    </div>
  );
}
