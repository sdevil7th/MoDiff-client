import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { Repeat2 } from 'lucide-react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { useFlowStore } from '../stores/useFlowStore';
import { ModiffCheckbox, ModiffFieldShell, ModiffNumberInput, ModiffSelect, NodeResizeHandle } from '../ui';

function numericValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const LoopNode = memo((node: NodeProps<CustomNodeType>) => {
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  const nodes = useFlowStore((state) => state.nodes);
  const children = nodes.filter((candidate) => candidate.parentId === node.id);
  const iterations = numericValue(node.data.params.iterations?.value, 2);
  const iterationMode = node.data.params.iteration_mode?.value === 'collection' ? 'collection' : 'count';
  const maximum = numericValue(node.data.params.max_iterations?.value, 100);
  const carry = node.data.params.carry?.value !== false;
  const collect = node.data.params.collect?.value !== false;
  const durable = node.data.params.durable?.value === true;
  const retries = numericValue(node.data.params.max_retries?.value, 1);
  const hasResult = children.some(
    (child) => child.data.module === 'modules.WorkflowControl' && child.data.action === 'LoopResult',
  );
  const hasIndex = children.some(
    (child) => child.data.module === 'modules.WorkflowControl' && child.data.action === 'LoopIndex',
  );
  const hasItems = children.some(
    (child) => child.data.module === 'modules.WorkflowControl' && child.data.action === 'LoopItems',
  );

  return (
    <div className="relative h-full w-full rounded-modiff-panel border-2 border-dashed border-hf-yellow/55 bg-hf-yellow/[0.035] shadow-inner">
      <div className="drag-handle flex h-11 items-center gap-2 border-b border-hf-yellow/25 bg-modiff-panel/90 px-3 text-sm font-bold text-modiff-text">
        <Repeat2 size={16} className="text-hf-yellow" />
        <span className="truncate">{node.data.label || 'Loop'}</span>
        {node.data.progressMessage ? (
          <span className="ml-auto truncate text-xs font-medium text-modiff-subtle-text">
            {node.data.progressMessage}
          </span>
        ) : null}
      </div>
      <div className="nodrag nowheel absolute right-2 top-1.5 flex items-center gap-2 text-xs text-modiff-subtle-text">
        <div className="flex items-center gap-1">
          <ModiffSelect
            aria-label="Loop repeat mode"
            value={iterationMode}
            onValueChange={(value) => setParam(node.id, 'iteration_mode', value)}
            options={[
              { value: 'count', label: 'Count' },
              { value: 'collection', label: 'Items' },
            ]}
            size="compact"
          />
          <ModiffNumberInput
            aria-label="Loop iterations"
            min={1}
            max={maximum}
            value={iterations}
            disabled={iterationMode === 'collection'}
            onValueChange={(value) => setParam(node.id, 'iterations', value ?? 1)}
            controlSize="compact"
            className="nodrag w-16"
          />
        </div>
      </div>
      <div className="nodrag nowheel absolute bottom-2 left-2 flex items-center gap-3 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 px-2 py-1 text-xs text-modiff-subtle-text">
        <ModiffCheckbox
          checked={carry}
          label="Carry"
          onCheckedChange={(checked) => setParam(node.id, 'carry', checked)}
        />
        <ModiffCheckbox
          checked={collect}
          label="Collect"
          onCheckedChange={(checked) => setParam(node.id, 'collect', checked)}
        />
        <ModiffCheckbox
          checked={durable}
          label="Resume"
          onCheckedChange={(checked) => setParam(node.id, 'durable', checked)}
        />
        <span>Limit {maximum}</span>
        <ModiffFieldShell label="Retries" layout="inline" className="gap-1">
          <ModiffNumberInput
            aria-label="Loop retries"
            min={0}
            max={10}
            value={retries}
            onValueChange={(value) => setParam(node.id, 'max_retries', value ?? 1)}
            controlSize="compact"
            className="nodrag w-12 px-1"
          />
        </ModiffFieldShell>
      </div>
      {!hasResult ? (
        <div className="pointer-events-none absolute bottom-12 left-2 rounded-modiff-compact border border-hf-orange/40 bg-modiff-panel/90 px-2 py-1 text-xs text-hf-orange">
          Add one Loop Result node and connect the value to return.
        </div>
      ) : iterationMode === 'collection' && !hasItems ? (
        <div className="pointer-events-none absolute bottom-12 left-2 rounded-modiff-compact border border-hf-orange/40 bg-modiff-panel/90 px-2 py-1 text-xs text-hf-orange">
          Add one Loop Items node and connect its collection.
        </div>
      ) : !hasIndex && iterationMode === 'count' ? (
        <div className="pointer-events-none absolute bottom-12 left-2 rounded-modiff-compact border border-modiff-border bg-modiff-panel/90 px-2 py-1 text-xs text-modiff-subtle-text">
          Add Loop Index when the body needs a changing seed, item, or parameter.
        </div>
      ) : null}
      <NodeResizeHandle />
    </div>
  );
});

LoopNode.displayName = 'LoopNode';

export default LoopNode;
