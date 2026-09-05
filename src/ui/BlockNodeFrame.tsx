import type { MouseEvent, ReactNode, RefObject } from 'react';
import { PackageOpen } from 'lucide-react';

import { cx } from '../utils/classNames';
import { NodeResizeGrip } from './NodeResizeHandle';

export type BlockNodeFrameProps = {
  nodeId: string;
  label: string;
  expanded: boolean;
  nodeRef: RefObject<HTMLDivElement | null>;
  headerRef?: RefObject<HTMLElement | null>;
  connectorRef?: RefObject<HTMLDivElement | null>;
  actions: ReactNode;
  controls: ReactNode;
  connectors: ReactNode;
  connectorsWhenExpanded?: boolean;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  schemaVersion?: 1 | 2;
  sourceKind?: string;
  expandedFrameSize?: { width: number; height: number };
  projectionKind?: 'modular-diffusers';
  semanticNodeId?: string;
  parentNodeId?: string;
};

/** Shared visual/action frame for persisted composite graph nodes. */
export function BlockNodeFrame({
  nodeId,
  label,
  expanded,
  nodeRef,
  headerRef,
  connectorRef,
  actions,
  controls,
  connectors,
  connectorsWhenExpanded = false,
  onResizeStart,
  schemaVersion = 1,
  sourceKind,
  expandedFrameSize,
  projectionKind,
  semanticNodeId,
  parentNodeId,
}: BlockNodeFrameProps) {
  const transparentExpandedFrame = schemaVersion === 2 && expanded;
  return (
    <div
      ref={nodeRef}
      className={cx(
        'relative flex h-full w-full min-w-[260px] flex-col overflow-visible rounded-modiff-panel border-2 border-hf-yellow/60 shadow-modiff-node',
        expanded ? cx(transparentExpandedFrame && 'pointer-events-none', 'bg-hf-yellow/[0.055]') : 'bg-modiff-surface',
      )}
      data-testid={`user-block-${nodeId}`}
      data-block-schema-version={schemaVersion}
      data-block-source={sourceKind}
      data-block-expanded={expanded ? 'true' : 'false'}
      data-block-projection={projectionKind}
      data-block-semantic-node-id={semanticNodeId}
      data-block-parent-node-id={parentNodeId}
      style={expanded && expandedFrameSize ? expandedFrameSize : undefined}
    >
      <header
        ref={headerRef}
        className={cx(
          'flex h-11 shrink-0 items-center gap-2 rounded-t-modiff-panel border-b border-hf-yellow/25 px-3 text-sm font-bold text-modiff-text',
          expanded ? cx(transparentExpandedFrame && 'pointer-events-auto', 'bg-hf-yellow/10') : 'bg-modiff-bg',
        )}
      >
        <PackageOpen size={16} className="shrink-0 text-hf-yellow" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {actions}
      </header>

      {expanded ? (
        <>
          <div className="pointer-events-none min-h-0 flex-1" aria-hidden="true" />
          {connectorsWhenExpanded ? (
            <div ref={connectorRef} className={cx(transparentExpandedFrame && 'pointer-events-auto', 'shrink-0')}>
              {connectors}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div
            className="nowheel min-h-24 flex-1 overflow-x-hidden overflow-y-auto bg-modiff-surface p-3"
            data-testid={`user-block-controls-${nodeId}`}
          >
            {controls}
          </div>
          <div ref={connectorRef} className="shrink-0">
            {connectors}
          </div>
        </>
      )}

      {!expanded ? <NodeResizeGrip label="Drag to resize block" onMouseDown={onResizeStart} /> : null}
    </div>
  );
}
