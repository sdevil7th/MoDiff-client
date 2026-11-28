import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { blockGraphSubtreeNodeIdsV2, type BlockInstanceV2 } from '../studio/blockSchemaV2';
import { ModiffButton, ModiffDialog } from '../ui';
import NodeInspectionDetails from './NodeInspectionDetails';

export default function StageImplementationDialog({
  label,
  instance,
  semanticNodeId,
  onClose,
  onConfigure,
}: {
  label: string;
  instance: BlockInstanceV2;
  semanticNodeId?: string;
  onClose: () => void;
  onConfigure: () => void;
}) {
  const descendants = semanticNodeId ? blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, semanticNodeId) : null;
  if (semanticNodeId) descendants?.delete(semanticNodeId);
  const members = blockOperationGraphV2(instance).nodes.filter(
    (node) => !descendants || (node.data.blockProjectionNodeId && descendants.has(node.data.blockProjectionNodeId)),
  );

  return (
    <ModiffDialog
      open
      title={label + ' implementation'}
      onClose={onClose}
      footer={<ModiffButton onClick={onConfigure}>Configure inputs, outputs and controls</ModiffButton>}
    >
      <p className="mb-4 text-sm text-modiff-subtle-text">
        These operations execute behind this node.
        {!descendants ? ' Choose Edit stages to change their connections, then Done editing to return.' : ''}
      </p>
      <div className="grid gap-4">
        {members.map((member) => (
          <section key={member.id}>
            <h3 className="mb-2 font-semibold">{member.data.label}</h3>
            <NodeInspectionDetails node={member} section="implementation" />
          </section>
        ))}
      </div>
    </ModiffDialog>
  );
}
