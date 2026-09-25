import { lazy, memo, Suspense } from 'react';
import { LoaderCircle, PackageOpen } from 'lucide-react';
import type { NodeProps } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { BlockNodeV2 } from './BlockNodeV2';
import NodeContent from './NodeContent';
import EncodingNode from './EncodingNodeRenderer';
import { isFocusedStageNode } from '../workflow/encodingNodePresentation';

const LegacyUserBlockNode = lazy(() => import('./LegacyUserBlockNode'));

const PendingBlockInsertionNode = memo((node: NodeProps<CustomNodeType>) => {
  const pending = node.data.blockInsertionPendingV2;
  if (!pending) throw new Error(`Pending Block renderer received an invalid node (${node.id}).`);
  return (
    <div
      className="flex h-full w-full min-w-[260px] flex-col overflow-hidden rounded-modiff-panel border-2 border-hf-yellow/60 bg-modiff-surface shadow-modiff-node"
      aria-busy="true"
      aria-live="polite"
      data-testid={`block-insertion-pending-${node.id}`}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-hf-yellow/25 bg-modiff-bg px-3 text-sm font-bold text-modiff-text">
        <PackageOpen size={16} className="shrink-0 text-hf-yellow" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Adding {pending.label}</span>
        <LoaderCircle size={17} className="shrink-0 animate-spin text-hf-yellow" aria-hidden="true" />
      </header>
      <div className="flex min-h-0 flex-1 items-center gap-3 px-4 text-sm text-modiff-subtle-text">
        <LoaderCircle size={20} className="shrink-0 animate-spin text-hf-yellow" aria-hidden="true" />
        <span>{pending.message}</span>
      </div>
    </div>
  );
});

PendingBlockInsertionNode.displayName = 'PendingBlockInsertionNode';

/** Generic composites use the Block renderer; encoding has a dedicated node surface. */
const BlockNode = memo((node: NodeProps<CustomNodeType>) => {
  if (node.data.blockInsertionPendingV2) return <PendingBlockInsertionNode {...node} />;
  if (isFocusedStageNode(node.data.blockInstanceV2)) return <EncodingNode {...node} />;
  if (node.data.blockInstanceV2) return <BlockNodeV2 {...node} />;
  return (
    <Suspense
      fallback={
        <div
          aria-busy="true"
          className="flex h-full flex-col rounded-modiff-panel border border-modiff-border bg-modiff-surface text-sm text-modiff-subtle-text"
        >
          <div role="status" className="min-h-24 flex-1 p-3">
            Loading saved Block…
          </div>
          {!node.data.uiState?.blockExpanded ? (
            <NodeContent
              nodeId={node.id}
              params={node.data.params}
              module={node.data.module}
              action={node.data.action}
              mode="connectors"
              updateStore={() => undefined}
            />
          ) : null}
        </div>
      }
    >
      <LegacyUserBlockNode {...node} />
    </Suspense>
  );
});
BlockNode.displayName = 'BlockNode';
export default BlockNode;
