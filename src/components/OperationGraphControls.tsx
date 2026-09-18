import { useEffect, useRef, useState } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { ModiffButton, ModiffDialog, ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import { formatRequestError } from '../utils/requestJson';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import {
  createOperationStarter,
  operationAuthoring,
  planOperationChange,
  type OperationChangePlan,
  type OperationStarter,
} from '../workflow/operationAuthoring';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { commitOperationGraph } from '../workflow/operationGraphTransaction';
import OperationStageInspector from './OperationStageInspector';

type Preview = {
  starter: OperationStarter;
  plan: OperationChangePlan | null;
  context: WorkflowOperationContext;
  signature: string;
};

/** Lazy authoring UI. The preview never creates a managed template or Block. */
export default function OperationGraphControls({ pipeline, task }: { pipeline: string; task: string }) {
  const nodes = useFlowStore((s) => s.nodes);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const operations = useNodesStore((s) => s.operationContracts);
  const [loader, setLoader] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [inspect, setInspect] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const loaders = nodes.filter(
    (n) =>
      !n.parentId && !n.data.blockProjectionOwnerId && n.data.operationAuthoring?.operation.decomposition === 'loader',
  );
  const selected = nodes.find((n) => n.selected && n.data.operationAuthoring);
  const selectedHint = selected ? operationAuthoring(selected) : null;

  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setPreview(null);
    setError(null);
    setInspect(false);
    return () => {
      pending.current?.abort();
    };
  }, [pipeline, task, workflow, loader]);

  async function prepare(change: boolean) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const snapshot = useFlowStore.getState().toObject();
    const signature = JSON.stringify(snapshot);
    setBusy(true);
    setError(null);
    try {
      const starter = await requestOperationStarter(pipeline, task, operations, controller.signal);
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (JSON.stringify(useFlowStore.getState().toObject()) !== signature)
        throw new Error('The graph changed. Request a fresh preview.');
      setPreview({ starter, plan: change ? planOperationChange(snapshot, loader, starter) : null, context, signature });
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not prepare the graph.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  function apply() {
    if (!preview) return;
    try {
      assertWorkflowOperationContext(preview.context, { includeForm: false });
      const flow = useFlowStore.getState();
      if (JSON.stringify(flow.toObject()) !== preview.signature)
        throw new Error('The graph changed after this preview. Close it and request a fresh preview.');
      if (preview.plan)
        commitOperationGraph(preview.plan.graph, preview.context, preview.signature, 'Change operation model or task');
      else {
        const x = flow.nodes.length
          ? Math.max(...flow.nodes.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 360))) + 100
          : 80;
        const draft = createOperationStarter(preview.starter, { x, y: 120 });
        prepareWorkflowForManualInsertion();
        commitOperationGraph(
          { nodes: [...flow.nodes, ...draft.nodes], edges: [...flow.edges, ...draft.edges] },
          captureWorkflowOperationContext(),
          preview.signature,
          'Add operation starter',
        );
      }
      setPreview(null);
    } catch (e) {
      setError(formatRequestError(e, 'Could not apply the graph change.'));
    }
  }

  return (
    <div className="space-y-2 px-2 pb-2">
      <ModiffButton disabled={busy} onClick={() => void prepare(false)}>
        Preview connected starter
      </ModiffButton>
      {loaders.length ? (
        <>
          <ModiffFieldShell label="Graph to change">
            <ModiffSelect
              aria-label="Operation graph to change"
              value={loader}
              onValueChange={setLoader}
              options={[
                { value: '', label: 'Select a loader on this canvas' },
                ...loaders.map((n) => ({
                  value: n.id,
                  label: `${n.data.operationAuthoring!.operation.pipelineClass} · ${n.id.slice(-6)}`,
                })),
              ]}
            />
          </ModiffFieldShell>
          <ModiffButton disabled={busy || !loaders.some((n) => n.id === loader)} onClick={() => void prepare(true)}>
            Preview model / task change
          </ModiffButton>
        </>
      ) : null}
      {selectedHint ? <ModiffButton onClick={() => setInspect(true)}>Inspect selected stage</ModiffButton> : null}
      {busy ? (
        <p role="status" className="text-xs text-modiff-subtle-text">
          Preparing ordinary nodes and connections…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-modiff-text">
          {error}
        </p>
      ) : null}
      {preview ? (
        <ModiffDialog
          open
          title={preview.plan ? 'Review model / task change' : 'Connected starter'}
          onClose={() => {
            setPreview(null);
            setError(null);
          }}
        >
          <div className="space-y-3 text-sm">
            <p>
              {preview.starter.pipelineClass} · {preview.starter.task.replace(/_/gu, ' ')}
            </p>
            <p>{preview.starter.nodes.map((n) => n.node.label).join(' → ')}</p>
            <p>
              The result is an editable canvas graph. Run checks model files, runtime support, required inputs and
              resources.
            </p>
            <p>
              Connect the final result to a Preview, Save or Export node before running. Drag from its output to see
              compatible nodes.
            </p>
            {preview.starter.sharedInputs.map((group, index) => (
              <p key={index}>
                Shared {group.name}:{' '}
                {group.members.map((m) => m.operationId.split('.')[1]?.replace(/_/gu, ' ')).join(', ')}. Editing either
                control updates the group; random mode draws one value per run.
              </p>
            ))}
            {preview.starter.requiredInputs.length ? (
              <div>
                <p>Provide or connect the required inputs:</p>
                <ul className="list-inside list-disc">
                  {preview.starter.requiredInputs.map((p) => (
                    <li key={`${p.operationId}:${p.field}`}>
                      {p.operationId.split('.')[1]?.replace(/_/gu, ' ')} · {p.field}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.plan ? (
              <>
                <ul className="list-inside list-disc">
                  {preview.plan.changes.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                {preview.plan.diagnostics.length ? (
                  <div role="status">
                    <p>Review before applying:</p>
                    <ul className="list-inside list-disc">
                      {preview.plan.diagnostics.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p>
                  Custom nodes are retained. Unsupported settings remain available in “Inspect selected stage”. Undo
                  restores the entire change.
                </p>
              </>
            ) : null}
            <ModiffDisclosure label="Inspect implementation">
              <p>
                {preview.starter.workflowId
                  ? `Upstream workflow: ${preview.starter.workflowId}`
                  : 'Whole pipeline adapter'}
              </p>
              <ul className="list-inside list-disc">
                {preview.starter.nodes.map((n) => (
                  <li key={n.operation.operationId}>
                    {n.node.label}: {n.operation.nodeKey}
                    {n.operation.blockName ? ` / ${n.operation.blockName}` : ''}
                  </li>
                ))}
              </ul>
              {preview.starter.upstreamBlocks.length ? (
                <p className="break-words">{preview.starter.upstreamBlocks.join(' → ')}</p>
              ) : null}
              <p>
                Inspection does not expand or convert saved Blocks. Use the existing Block composition inspector for
                structural editing.
              </p>
            </ModiffDisclosure>
            {error ? <p role="alert">{error}</p> : null}
            <div className="flex gap-2">
              <ModiffButton onClick={apply}>
                {preview.plan ? 'Apply graph change' : 'Add starter to canvas'}
              </ModiffButton>
              <ModiffButton
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                Cancel
              </ModiffButton>
            </div>
          </div>
        </ModiffDialog>
      ) : null}
      {inspect && selected && selectedHint ? (
        <OperationStageInspector key={selected.id} nodeId={selected.id} onClose={() => setInspect(false)} />
      ) : null}
    </div>
  );
}
