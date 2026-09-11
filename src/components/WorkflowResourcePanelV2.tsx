import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { useFlowStore } from '../stores/useFlowStore';
import { createDurableNodesSelector } from '../stores/flowDurableReferences';
import { useStudioStore } from '../stores/useStudioStore';
import { ModiffButton, ModiffSelect } from '../ui';
import { assessWorkflowResourcesV2, buildWorkflowResourceRequestV2 } from '../studio/workflowResourceAssessmentV2';
import { selectedAutoCandidate } from '../studio/autoResource';
import { formatResourceBytes } from '../studio/runtimeResources';
import type { WorkflowAutoPlanV2 } from '../studio/workflowAutoExecutionV2';

type Assessment = Awaited<ReturnType<typeof assessWorkflowResourcesV2>>;

export default function WorkflowResourcePanelV2() {
  const stableNodes = useMemo(createDurableNodesSelector, []);
  const nodes = useFlowStore((state) => stableNodes(state.nodes));
  const edges = useFlowStore((state) => state.edges);
  const workflowId = useStudioStore((state) => state.activeWorkflowTabId);
  const [scope, setScope] = useState('');
  const [result, setResult] = useState<Assessment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoPlan, setAutoPlan] = useState<WorkflowAutoPlanV2 | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const prepared = useMemo(() => {
    try {
      return { request: buildWorkflowResourceRequestV2(nodes, edges, scope || undefined), error: '' };
    } catch (cause) {
      return { request: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [nodes, edges, scope]);
  const key = prepared.request?.key;
  useEffect(() => {
    requestRef.current?.abort();
    setBusy(false);
    setResult(null);
    setError('');
    setAutoPlan(null);
    return () => requestRef.current?.abort();
  }, [key, scope, workflowId]);
  const assess = async () => {
    if (!prepared.request) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const assessment = await assessWorkflowResourcesV2(prepared.request, controller.signal);
      if (!controller.signal.aborted && useStudioStore.getState().activeWorkflowTabId === workflowId) {
        const current = useFlowStore.getState();
        if (
          buildWorkflowResourceRequestV2(current.nodes, current.edges, scope || undefined).key !==
          assessment.request.key
        )
          throw new Error('The workflow changed. Assess its current settings again.');
        setResult(assessment);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const request = prepared.request;
  const planAuto = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError('');
    setAutoPlan(null);
    try {
      const plan = await (
        await import('../studio/workflowAutoExecutionV2')
      ).inspectWorkflowAutoPlanV2(scope || undefined, controller.signal);
      if (!controller.signal.aborted && useStudioStore.getState().activeWorkflowTabId === workflowId) setAutoPlan(plan);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const visible = result?.request.key === key ? result : null;
  return (
    <section className="grid gap-3 p-3 text-sm text-modiff-text" data-testid="workflow-resource-assessment">
      <h2 className="flex items-center gap-2 font-semibold">
        <Gauge size={17} />
        Workflow resources
      </h2>
      <p className="text-xs text-modiff-subtle-text">
        Auto chooses supported technical settings for the model and runtime. Expert keeps your configured settings.
        Switching modes preserves your nodes, links and creative controls.
      </p>
      <p className="text-xs text-modiff-subtle-text">
        A loader’s Auto Offload controls where its weights reside. Repeat/Loop controls repeated runs. They are separate
        from Auto resource planning.
      </p>
      <ModiffSelect
        aria-label="Resource assessment scope"
        value={scope}
        onValueChange={setScope}
        options={[
          { value: '', label: 'Whole workflow' },
          ...nodes
            .filter((node) => node.data.blockInstanceV2 || node.data.blockProjectionContainer)
            .map((node) => ({ value: node.id, label: `Only ${node.data.label ?? node.id}` })),
        ]}
      />
      <p className="text-xs text-modiff-subtle-text">
        {scope
          ? 'Only contained nodes are assessed. Outside suppliers are excluded, as with Run Block.'
          : 'Includes connected outside nodes and every enabled Block.'}
      </p>
      {request ? (
        <>
          <p className="text-xs">
            {request.nodeCount} executable nodes · {request.loaderCount} model loaders · {request.adapterCount} adapters
          </p>
          <p
            className="rounded-modiff-compact border border-modiff-border p-2 text-xs"
            data-testid="workflow-auto-reason"
          >
            Auto can plan custom workflows and multiple Blocks. Each model recipe and the combined memory requirement
            must pass the backend check.
          </p>
        </>
      ) : null}
      <ModiffButton
        onClick={() => void assess()}
        disabled={busy || !request || !request.nodeCount}
        data-testid="assess-workflow-resources"
      >
        <RefreshCw size={14} />
        {busy ? 'Assessing resources…' : 'Assess workflow resources'}
      </ModiffButton>
      <ModiffButton
        onClick={() => void planAuto()}
        disabled={busy || !request?.nodeCount}
        data-testid="plan-workflow-auto"
      >
        Check Auto execution plan
      </ModiffButton>
      {autoPlan ? (
        <div
          className="grid gap-2 rounded-modiff-compact border border-modiff-border p-2 text-xs"
          data-testid="workflow-auto-plan"
        >
          <p className="font-semibold">
            {!autoPlan.canAutoRun
              ? 'Auto needs attention'
              : autoPlan.requiresPreparation
                ? 'Check computed inputs when Run starts'
                : 'Ready for Auto execution'}
          </p>
          <p>{autoPlan.message}</p>
          <p>
            {autoPlan.requiresPreparation ? 'Resolved so far: ' : 'Peak planned resources: '}
            {autoPlan.loaders.length} model owners · RAM{' '}
            {formatResourceBytes(autoPlan.requirements.systemRamBytes ?? null)} · GPU{' '}
            {formatResourceBytes(autoPlan.requirements.vramBytes ?? null)}
          </p>
          {autoPlan.loaders.map((loader) => (
            <p key={loader.nodeId}>
              {loader.repository} · {loader.consumers.length} consumers
            </p>
          ))}
          {autoPlan.patches.length ? (
            <p>Run will apply {autoPlan.patches.length} resource-setting changes to the visible workflow.</p>
          ) : null}
          {autoPlan.issues.map((issue, index) => (
            <p className="break-words text-modiff-subtle-text" key={index}>
              {issue}
            </p>
          ))}
          <p>Run checks the current graph and available memory again. Expert preserves your explicit settings.</p>
        </div>
      ) : null}
      {prepared.error || error ? (
        <p role="alert" className="break-words text-xs text-modiff-red">
          {prepared.error || error}
        </p>
      ) : null}
      {visible ? (
        <>
          <div className="rounded-modiff-compact border border-modiff-border p-2 text-xs">
            <p>Available RAM: {formatResourceBytes(visible.resources.system.ramAvailableBytes)}</p>
            {visible.resources.accelerators.map((gpu) => (
              <p key={gpu.device}>
                {gpu.name}: {formatResourceBytes(gpu.memoryFreeBytes)} free · {gpu.memoryKind} memory
              </p>
            ))}
            <p className="mt-1 text-modiff-subtle-text">
              Shared GPU memory and RAM overlap; they are not added together.
            </p>
          </div>
          {visible.request.items.map((item) => {
            const plan = visible.plans[item.id];
            const candidate = plan ? selectedAutoCandidate(plan, item.form ?? undefined) : null;
            return (
              <div
                key={item.id}
                className="grid gap-1 rounded-modiff-compact border border-modiff-border p-2 text-xs"
                data-testid="workflow-resource-item"
              >
                <p className="break-words font-semibold">{item.label}</p>
                <p>
                  {item.loaderIds.length} loader{item.loaderIds.length === 1 ? '' : 's'} · {item.consumers} downstream
                  consumers
                </p>
                {item.currentSettings.map((settings, index) => (
                  <p key={item.loaderIds[index]} className="break-words text-modiff-subtle-text">
                    Current: {settings}
                  </p>
                ))}
                {candidate ? (
                  <p className="break-words">
                    Source recipe recommendation: {candidate.dtype} · {candidate.offloadMode}.{' '}
                    {plan?.statusLabel ?? candidate.reason}
                  </p>
                ) : plan ? (
                  <p>{plan.blockingReason ?? plan.message ?? 'No supported local source recipe was selected.'}</p>
                ) : null}
                {item.details.map((detail) => (
                  <p key={detail} className="text-modiff-subtle-text">
                    {detail}
                  </p>
                ))}
              </div>
            );
          })}
          {visible.request.issues.map((issue) => (
            <p key={issue} className="text-xs text-modiff-subtle-text">
              {issue}
            </p>
          ))}
          <p className="text-xs text-modiff-subtle-text">
            Assessment preserves the graph and current settings. Check Auto execution plan to validate the actual
            combined graph, connected adapters and available memory before running.
          </p>
        </>
      ) : null}
    </section>
  );
}
