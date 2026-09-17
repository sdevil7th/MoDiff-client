import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodesStore, type NodeData } from '../stores/useNodeStore';
import { useStudioStore } from '../stores/useStudioStore';
import { operationLabel, operationsForTask } from '../workflow/operationCatalog';
import type { OperationContract } from '../workflow/operationContracts';
import { ModiffFieldShell, ModiffSelect, TreeButtonRow } from '../ui';
import { matchesSearchKeywords } from '../utils/searchKeywords';
import { formatRequestError } from '../utils/requestJson';

/** A bound operation inserts one ordinary node. It does not create a template. */
export default function OperationCatalogPanel({
  search,
  onInsert,
}: {
  search: string;
  onInsert: (key: string, node: NodeData) => void;
}) {
  const operations = useNodesStore((state) => state.operationContracts);
  const support = useNodesStore((state) => state.pipelineSupport);
  const resolve = useNodesStore((state) => state.resolveOperation);
  const workflow = useStudioStore((state) => state.activeWorkflowTabId);
  const [pipeline, setPipeline] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const entry = support.find((p) => p.pipelineClass === pipeline);
  const selected =
    entry?.tasks.find((t) => t.task === task) ?? entry?.tasks.find((t) => t.operationIds.length > 0) ?? entry?.tasks[0];
  const entries = useMemo(
    () =>
      selected
        ? operationsForTask(operations, pipeline, selected.task).filter((op) =>
            matchesSearchKeywords(search, [operationLabel(op), op.pipelineClass, op.nodeKey]),
          )
        : [],
    [operations, pipeline, selected, search],
  );
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError(null);
    return () => {
      pending.current?.abort();
    };
  }, [pipeline, task, workflow]);

  async function insert(operation: OperationContract) {
    if (pending.current) return;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(null);
    try {
      const node = await resolve(operation, request.signal);
      if (!request.signal.aborted && useStudioStore.getState().activeWorkflowTabId === workflow)
        onInsert(`${node.module}.${node.action}`, node);
    } catch (error) {
      if (!request.signal.aborted) setError(formatRequestError(error, 'Could not resolve the selected operation.'));
    } finally {
      if (pending.current === request) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  if (!support.length) return null;
  return (
    <section aria-label="Diffusers operations" className="mb-2 border-b border-modiff-border pb-2">
      <div className="space-y-2 px-2 pb-2">
        <ModiffFieldShell label="Pipeline">
          <ModiffSelect
            aria-label="Operation pipeline"
            value={pipeline}
            onValueChange={(value) => {
              pending.current?.abort();
              setPipeline(value);
              setTask('');
            }}
            options={[
              { value: '', label: 'Select a pipeline' },
              ...support.map((p) => ({ value: p.pipelineClass, label: p.pipelineClass })),
            ]}
          />
        </ModiffFieldShell>
        {entry ? (
          <ModiffFieldShell label="Task">
            <ModiffSelect
              aria-label="Operation task"
              value={selected?.task ?? ''}
              onValueChange={(value) => {
                pending.current?.abort();
                setTask(value);
              }}
              options={entry.tasks.map((t) => ({ value: t.task, label: t.task.replace(/_/gu, ' ') }))}
            />
          </ModiffFieldShell>
        ) : (
          <p className="text-xs text-modiff-subtle-text">
            Choose a pipeline and task to add its operations to the canvas.
          </p>
        )}
        {selected ? (
          <p role="status" className="text-xs text-modiff-subtle-text">
            {selected.execution === 'adapter'
              ? 'Execution adapter available.'
              : selected.execution === 'declared'
                ? 'Declared stages; no execution adapter.'
                : 'No operation binding for this task.'}{' '}
            {selected.decomposition === 'pipeline'
              ? 'Whole pipeline call.'
              : selected.decomposition === 'stages'
                ? 'Editable stages.'
                : ''}{' '}
            {selected.dependencies === 'blocked'
              ? 'Runtime setup required in Setup.'
              : selected.dependencies === 'ready'
                ? 'Runtime available; Run still checks models and resources.'
                : 'Runtime support unverified.'}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-modiff-text">
            {error}
          </p>
        ) : null}
      </div>
      {entries.map((operation) => (
        <TreeButtonRow
          key={operation.operationId}
          level={0}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void insert(operation)}
          title={`Add ${operationLabel(operation)} for ${operation.pipelineClass}. ${operation.decomposition === 'pipeline' ? 'This operation calls the complete pipeline.' : 'Uses the existing node execution path.'}`}
        >
          <span className="min-w-0 flex-1 break-words">{operationLabel(operation)}</span>
          <span className="text-xs text-modiff-subtle-text">
            {operation.decomposition === 'pipeline'
              ? 'Pipeline'
              : operation.decomposition === 'loader'
                ? 'Load'
                : 'Stage'}
          </span>
        </TreeButtonRow>
      ))}
      {selected && !entries.length && selected.operationIds.length > 0 ? (
        <p className="px-2 text-xs text-modiff-subtle-text">No operations match this search.</p>
      ) : null}
    </section>
  );
}
