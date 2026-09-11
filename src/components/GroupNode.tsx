import { memo, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Boxes, ChevronDown, ChevronRight } from 'lucide-react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { ModiffIconButton, NodeResizeHandle } from '../ui';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';

/**
 * Shared non-executable container renderer.
 *
 * A projected Modular Diffusers sequential/auto/conditional container is a
 * real selectable React Flow parent, not an invented backend action. Its
 * children remain ordinary nodes and its geometry is persisted by the owning
 * BlockInstanceV2 presentation. Ordinary user-created groups use this same
 * renderer so registered and user-owned compositions do not fork visually.
 */
const GroupNode = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  useNodeLayoutSync(node.id, nodeRef);
  const modular = node.data.blockProjectionContainer === true;
  const childCount = node.data.blockProjectionChildCount ?? 0;
  const containerExpanded = node.data.blockProjectionContainerExpanded !== false;
  const toggleContainer = useFlowStore((state) => state.toggleBlockContainerExpandedV2);

  return (
    <div
      ref={nodeRef}
      className={
        modular
          ? 'relative h-full w-full rounded-modiff-panel border-2 border-dashed border-hf-yellow/45 bg-hf-yellow/[0.025] shadow-inner'
          : 'relative h-full w-full rounded-modiff-panel border-2 border-dashed border-modiff-border bg-modiff-surface/20 shadow-inner'
      }
      data-testid={`group-node-${node.id}`}
    >
      <div className="drag-handle flex h-11 items-center gap-2 border-b border-modiff-border/80 bg-modiff-panel/90 px-3 text-sm font-bold text-modiff-text">
        <Boxes size={16} className={modular ? 'text-hf-yellow' : 'text-modiff-subtle-text'} />
        <span className="truncate">{node.data.label || 'Group'}</span>
        {modular ? (
          <div className="nodrag ml-auto flex shrink-0 items-center gap-1.5">
            <span className="rounded-modiff-compact border border-hf-yellow/30 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-hf-yellow">
              {childCount} {childCount === 1 ? 'block' : 'blocks'}
            </span>
            <ModiffIconButton
              label={`${containerExpanded ? 'Collapse' : 'Expand'} ${node.data.label || 'Modular Diffusers container'}`}
              size="compact"
              data-testid={`toggle-modular-container-${node.id}`}
              onClick={() => {
                const ownerId = node.data.blockProjectionOwnerId;
                const semanticNodeId = node.data.blockProjectionNodeId;
                if (ownerId && semanticNodeId) toggleContainer(ownerId, semanticNodeId);
              }}
            >
              {containerExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </ModiffIconButton>
          </div>
        ) : null}
      </div>
      {node.data.description ? (
        <span className="pointer-events-none absolute left-3 top-12 max-w-[calc(100%-1.5rem)] truncate text-xs text-modiff-subtle-text/80">
          {node.data.description}
        </span>
      ) : null}
      {!modular || containerExpanded ? <NodeResizeHandle /> : null}
    </div>
  );
});

GroupNode.displayName = 'GroupNode';

export default GroupNode;
