import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodesStore, type NodeData } from '../stores/useNodeStore';
import {
  useStudioStore,
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
} from '../stores/useStudioStore';
import { useNodeDiscovery, useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import OperationDiscoveryFields from './OperationDiscoveryFields';
import { operationLabel } from '../workflow/operationCatalog';
import type { OperationContract } from '../workflow/operationContracts';
import { TreeButtonRow } from '../ui';
import { operationSearchEntries } from '../workflow/nodeConnectionSearch';
import { formatRequestError } from '../utils/requestJson';
import OperationGraphControls from './OperationGraphControls';
import { withOperationAuthoring } from '../workflow/operationAuthoring';

/** A bound operation inserts one ordinary node. It does not create a template. */
export default function OperationCatalogPanel({
  search,
  onInsert,
}: {
  search: string;
  onInsert: (key: string, node: NodeData) => void;
}) {
  const operations = useNodesStore((state) => state.operationContracts);
  const registry = useNodesStore((state) => state.nodesRegistry);
  const resolve = useNodesStore((state) => state.resolveOperation);
  const workflow = useStudioStore((state) => state.activeWorkflowTabId);
  const { pipeline, task, selected, support } = useNodeDiscovery();
  const canvasEpoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const entries = useMemo(
    () =>
      selected
        ? operationSearchEntries(operations, pipeline, selected.task, undefined, undefined, search, registry)
        : [],
    [operations, pipeline, selected, search, registry],
  );
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError(null);
    return () => {
      pending.current?.abort();
    };
  }, [pipeline, task, workflow, canvasEpoch]);

  async function insert(operation: OperationContract) {
    if (pending.current) return;
    const context = captureWorkflowOperationContext();
    const selection = useNodeDiscoveryStore.getState().selection;
    const request = new AbortController();
    pending.current = request;
    setBusy(true);
    setError(null);
    try {
      const node = await resolve(operation, request.signal);
      if (request.signal.aborted || useNodeDiscoveryStore.getState().selection !== selection) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      onInsert(`${node.module}.${node.action}`, withOperationAuthoring(node, operation));
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
        <OperationDiscoveryFields />
        {selected ? (
          <p role="status" className="text-xs text-modiff-subtle-text">
            {selected.execution === 'adapter'
              ? 'Execution adapter available.'
              : selected.execution === 'declared'
                ? 'Declared nodes; no execution adapter.'
                : 'No operation binding for this task.'}{' '}
            {selected.decomposition === 'pipeline'
              ? 'Whole pipeline call.'
              : selected.decomposition === 'stages'
                ? 'Editable nodes.'
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
      {selected?.operationIds.length ? <OperationGraphControls pipeline={pipeline} task={selected.task} /> : null}
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
                : 'Node'}
          </span>
        </TreeButtonRow>
      ))}
      {selected && !entries.length && selected.operationIds.length > 0 ? (
        <p className="px-2 text-xs text-modiff-subtle-text">No operations match this search.</p>
      ) : null}
    </section>
  );
}
