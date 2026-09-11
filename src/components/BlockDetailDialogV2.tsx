import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import {
  rebuildReviewedModularComposition,
  reviewedModularCompositionRecipeForInstanceV2,
  type ModularCompositionReceipt,
} from '../studio/modularComposition';
import { stableStringify } from '../studio/stableHash';
import { ModiffButton, ModiffDialog } from '../ui';

type Props = { nodeId: string; onClose: () => void } & (
  | { mode: 'route'; busy: boolean; onSwitch: (save: boolean) => void }
  | { mode: 'composition'; instance: BlockInstanceV2 }
);

/** Selection-only details are deferred; the node frame and all sockets remain eager. */
export default function BlockDetailDialogV2(props: Props) {
  if (props.mode === 'composition') return <CompositionDialog {...props} />;
  return (
    <ModiffDialog
      open
      onClose={() => !props.busy && props.onClose()}
      title="Switch model route"
      testId={`switch-block-route-v1-${props.nodeId}`}
      panelClassName="max-w-lg"
      footer={
        <>
          <ModiffButton disabled={props.busy} onClick={props.onClose}>
            Cancel
          </ModiffButton>
          <ModiffButton disabled={props.busy} onClick={() => props.onSwitch(true)}>
            Save active route and switch
          </ModiffButton>
          <ModiffButton tone="primary" disabled={props.busy} onClick={() => props.onSwitch(false)}>
            Keep draft and switch
          </ModiffButton>
        </>
      }
    >
      <p className="text-sm text-modiff-subtle-text">
        This route has workflow-local changes. MoDiff can keep its exact values, internal graph, interface, and layout
        as an inactive workflow draft, then restore them when you switch back. Previews and run authority are not copied
        between models.
      </p>
    </ModiffDialog>
  );
}

function CompositionDialog({ nodeId, instance, onClose }: Extract<Props, { mode: 'composition' }>) {
  const library = useHuggingFaceNodeLibraryStore((state) => state.library);
  const conditional = useHuggingFaceModularConditionalStore((state) => state.snapshot);
  const libraryError = useHuggingFaceNodeLibraryStore((state) => state.error);
  const conditionalError = useHuggingFaceModularConditionalStore((state) => state.error);
  const hasUpstreamBlocks = instance.effectiveGraph.nodes.some(
    (node) => node.modularDiffusers?.kind === 'upstream_block',
  );
  const catalogReady = !hasUpstreamBlocks || Boolean(library && conditional);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  useEffect(() => {
    if (!hasUpstreamBlocks) return;
    let active = true;
    setLoadingCatalog(true);
    const catalog = useHuggingFaceNodeLibraryStore.getState();
    const hierarchy = useHuggingFaceModularConditionalStore.getState();
    void Promise.all([
      catalog.library ? Promise.resolve() : catalog.fetchLibrary(),
      hierarchy.snapshot ? Promise.resolve() : hierarchy.fetchSnapshot(),
    ]).finally(() => {
      if (active) setLoadingCatalog(false);
    });
    return () => {
      active = false;
    };
  }, [hasUpstreamBlocks, catalogAttempt]);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<ModularCompositionReceipt | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const plan = useMemo(() => {
    if (!catalogReady) return { recipe: null, error: null };
    try {
      return { recipe: reviewedModularCompositionRecipeForInstanceV2(instance, library, conditional), error: null };
    } catch (error) {
      return {
        recipe: null,
        error: error instanceof Error ? error.message : 'Could not derive the upstream Modular composition.',
      };
    }
  }, [instance, library, conditional, catalogReady]);
  const recipeKey = stableStringify(plan.recipe);
  useEffect(() => {
    setReceipt(null);
    setBackendError(null);
    setBusy(false);
    return () => request.current?.abort();
  }, [recipeKey]);
  const validate = async () => {
    if (!plan.recipe || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setReceipt(null);
    setBackendError(null);
    try {
      const result = await rebuildReviewedModularComposition(plan.recipe, controller.signal);
      if (!controller.signal.aborted) setReceipt(result);
    } catch (error) {
      if (!controller.signal.aborted)
        setBackendError(
          error instanceof Error ? error.message : 'The backend could not rebuild this Modular composition.',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <ModiffDialog
      open
      onClose={onClose}
      title="Block composition"
      testId={`user-block-composition-dialog-${nodeId}`}
      panelClassName="max-w-lg"
      footer={
        <>
          <ModiffButton onClick={onClose}>Close</ModiffButton>
          {!catalogReady ? (
            <ModiffButton disabled={loadingCatalog} onClick={() => setCatalogAttempt((attempt) => attempt + 1)}>
              {loadingCatalog ? 'Loading pinned catalog…' : 'Retry pinned catalog'}
            </ModiffButton>
          ) : null}
          {plan.recipe ? (
            <ModiffButton tone="primary" disabled={busy} onClick={() => void validate()}>
              {busy ? 'Rebuilding…' : 'Validate upstream composition'}
            </ModiffButton>
          ) : null}
        </>
      }
    >
      <div className="grid gap-2 text-sm text-modiff-subtle-text">
        {!catalogReady ? (
          <p role={loadingCatalog ? 'status' : 'alert'}>
            {loadingCatalog
              ? 'Loading the reviewed block catalog and hierarchy. Your workflow is unchanged.'
              : (libraryError ?? conditionalError ?? 'The pinned catalog is unavailable. Retry before validating.')}
          </p>
        ) : null}
        <p>
          {instance.effectiveGraph.nodes.length} ordinary internal nodes and {instance.effectiveGraph.edges.length}{' '}
          internal connections are owned by this workflow instance.
        </p>
        <p>
          Source: {instance.definitionSnapshot.source.kind}. Customization state:{' '}
          {instance.customization.state.replace(/_/gu, ' ')}.
        </p>
        {plan.recipe ? (
          <p data-testid={`block-v2-composition-summary-${nodeId}`}>
            Exact upstream recipe: {plan.recipe.operations.length} structural operation
            {plan.recipe.operations.length === 1 ? '' : 's'}. Parameter-only changes are stored directly on this
            workflow instance and do not rebuild sibling blocks.
          </p>
        ) : null}
        {plan.error ? (
          <p className="text-modiff-warning" data-testid={`block-v2-composition-error-${nodeId}`}>
            {plan.error}
          </p>
        ) : null}
        {receipt ? (
          <p className="text-modiff-green" data-testid={`block-v2-composition-receipt-${nodeId}`}>
            Upstream init_pipeline() rebuild passed for {receipt.composedPaths.length} paths. Receipt{' '}
            {receipt.receiptHash.slice(0, 20)}…
          </p>
        ) : null}
        {backendError ? <p className="text-modiff-red">{backendError}</p> : null}
        {receipt?.inspectionScope === 'edited_unpruned_tree' ? (
          <p>
            This checks the edited tree, including inactive branches. It does not load models or qualify a run.
            Execution checks each connected step's required components and inputs.
          </p>
        ) : null}
      </div>
    </ModiffDialog>
  );
}
