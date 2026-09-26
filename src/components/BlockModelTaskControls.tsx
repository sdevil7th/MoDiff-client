import { useEffect, useRef, useState } from 'react';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { ModiffButton, ModiffDialog, ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import { createBlockRootNodeV2 } from '../studio/blockRuntimeV2';
import {
  assertBlockRouteEdgesCompatibleV1,
  restoreBlockDefinitionDraftV2,
  switchBlockDefinitionV2,
} from '../studio/blockRouteSelectionV1';
import { registeredBlockV2Route } from '../studio/registeredBlockV2Routes';
import { getFormDefaultsForRegisteredRoute } from '../studio/modelProfiles';
import type { StudioMode, StudioModelType } from '../studio/types';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { commitOperationGraph } from '../workflow/operationGraphTransaction';
import { formatRequestError } from '../utils/requestJson';

type Preview = { destination: BlockInstanceV2; context: WorkflowOperationContext; signature: string };

/** Existing upstream compositions keep their exact edited draft when replaced.
 * The catalog/compiler and normal canvas transaction remain the only owners. */
export default function BlockModelTaskControls({ node }: { node: CustomNodeType }) {
  const library = useHuggingFaceNodeLibraryStore((s) => s.library);
  const libraryError = useHuggingFaceNodeLibraryStore((s) => s.error);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const pending = useRef<AbortController | null>(null);
  const instance = node.data.blockInstanceV2!;
  const choices = (library?.definitions ?? []).flatMap((definition) =>
    definition.executionAdmissions
      .filter(
        (admission) =>
          admission.status === 'admitted' &&
          admission.publication.insertable &&
          admission.publication.readiness === 'graph_qualified' &&
          registeredBlockV2Route(definition, admission),
      )
      .map((admission) => ({ definition, admission })),
  );
  const drafts = Object.entries(instance.routeSelection?.inactiveDrafts ?? {});
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setError(null);
    setPreview(null);
    return () => {
      pending.current?.abort();
    };
  }, [workflow, node.id, target]);

  async function prepare() {
    if (pending.current || !target) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const graph = useFlowStore.getState().toObject();
    const signature = JSON.stringify(graph);
    setBusy(true);
    setError(null);
    try {
      const current = graph.nodes.find((n) => n.id === node.id)?.data.blockInstanceV2;
      if (!current) throw new Error('The owning Block is unavailable.');
      let destination: BlockInstanceV2;
      if (target.startsWith('draft:')) {
        destination = restoreBlockDefinitionDraftV2(current, target.slice(6));
      } else {
        const choice = choices.find((c) => c.admission.id === target);
        if (!choice) throw new Error('Reload the catalog and select an available workflow.');
        const { createHuggingFaceClusterForGraph } = await import('../studio/huggingFaceClusterInsertion');
        const form = getFormDefaultsForRegisteredRoute(
          choice.admission.studioMode as StudioMode,
          choice.definition.pipelineClass as StudioModelType,
        );
        const compiled = await createHuggingFaceClusterForGraph(
          choice.definition,
          current.presentation.position,
          form,
          { insert: false, signal: controller.signal },
        );
        if (
          !compiled.data.blockInstanceV2 ||
          compiled.data.blockInstanceV2.definitionRef.definitionId !== choice.admission.id
        )
          throw new Error('The compiler returned a different workflow. No changes were applied.');
        destination = switchBlockDefinitionV2(current, compiled.data.blockInstanceV2);
      }
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      if (JSON.stringify(useFlowStore.getState().toObject()) !== signature)
        throw new Error('The graph changed. Request a fresh preview.');
      assertBlockRouteEdgesCompatibleV1(current, destination, graph.edges);
      setPreview({ destination, context, signature });
    } catch (e) {
      if (!controller.signal.aborted) setError(formatRequestError(e, 'Could not prepare the model/task change.'));
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
      const graph = useFlowStore.getState().toObject();
      const replacement = createBlockRootNodeV2(preview.destination);
      commitOperationGraph(
        {
          ...graph,
          nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, ...replacement.data } } : n)),
        },
        preview.context,
        preview.signature,
        'Change Block model or task',
      );
      setPreview(null);
      setTarget('');
    } catch (e) {
      setError(formatRequestError(e, 'Could not apply the model/task change.'));
    }
  }

  return (
    <ModiffDisclosure label="Change model / task" panelClassName="grid gap-2 py-2">
      <p className="text-xs text-modiff-subtle-text">
        Choose a reviewed workflow. The current composition and custom edits remain available as a saved draft in this
        workflow; compatible public values carry across.
      </p>
      <ModiffButton onClick={() => void useHuggingFaceNodeLibraryStore.getState().fetchLibrary()} disabled={busy}>
        {library ? 'Refresh workflows' : 'Load workflows'}
      </ModiffButton>
      {libraryError ? <p role="alert">{libraryError}</p> : null}
      <ModiffFieldShell label="Workflow">
        <ModiffSelect
          aria-label="Replacement Block workflow"
          value={target}
          onValueChange={setTarget}
          options={[
            { value: '', label: 'Select a model and task' },
            ...drafts.map(([key, draft]) => ({
              value: `draft:${key}`,
              label: `Restore draft · ${draft.definitionSnapshot.displayName}`,
            })),
            ...choices
              .filter((c) => c.admission.id !== instance.definitionRef.definitionId)
              .map((c) => ({
                value: c.admission.id,
                label: `${c.definition.label} · ${c.admission.studioMode ?? c.definition.workflowId}`,
              })),
          ]}
        />
      </ModiffFieldShell>
      <ModiffButton disabled={busy || !target} onClick={() => void prepare()}>
        Preview model / task change
      </ModiffButton>
      {busy ? (
        <ModiffButton
          onClick={() => {
            pending.current?.abort();
            pending.current = null;
            setBusy(false);
          }}
        >
          Cancel preparation
        </ModiffButton>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-modiff-text">
          {error}
        </p>
      ) : null}
      {preview ? (
        <ModiffDialog
          open
          title="Review Block model / task change"
          onClose={() => {
            setPreview(null);
            setError(null);
          }}
        >
          <div className="grid gap-3 text-sm">
            <p>
              {instance.definitionSnapshot.displayName} → {preview.destination.definitionSnapshot.displayName}
            </p>
            <p>
              The current edited graph is retained outside execution. Restore its draft to recover custom nodes,
              unsupported settings and internal connections. External connections must fit the destination interface.
              Undo restores the entire change.
            </p>
            <p>
              Required inputs:{' '}
              {preview.destination.effectiveInterface.boundary.inputs
                .filter((p) => p.required)
                .map((p) => p.label)
                .join(', ') || 'No required public media inputs declared.'}
            </p>
            {error ? <p role="alert">{error}</p> : null}
            <ModiffButton onClick={apply}>Apply graph change</ModiffButton>
          </div>
        </ModiffDialog>
      ) : null}
    </ModiffDisclosure>
  );
}
