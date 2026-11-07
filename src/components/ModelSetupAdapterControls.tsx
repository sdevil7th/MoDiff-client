import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  useStudioStore,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { blockViewModelV2 } from '../studio/blockRuntimeV2';
import { ModiffButton, ModiffDialog, ModiffDisclosure } from '../ui';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { commitOperationGraph, operationGraphSignature } from '../workflow/operationGraphTransaction';
import {
  modelSetupAdapterChain,
  modelSetupAdapterAddUnavailable,
  modelSetupAdapterEditUnavailable,
  modelSetupAdapterFields,
  planModelSetupAdapterEdit,
} from '../workflow/modelSetupAdapters';
import NodeContent from './NodeContent';

/** Populated rows are real graph nodes. The Add dialog is only a local draft
 * until the complete immutable adapter selection is explicitly applied. */
export default function ModelSetupAdapterControls({
  node,
  updateStore,
}: {
  node: CustomNodeType;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
}) {
  const graph = useFlowStore(useShallow((state) => ({ nodes: state.nodes, edges: state.edges })));
  const resourceMode = useStudioStore((state) => state.form.resourceMode);
  const discovered = useNodesStore(
    useShallow((state) => ({
      nodesRegistry: state.nodesRegistry,
      studioModelCapabilities: state.studioModelCapabilities,
      studioModelCapabilitiesAuthoritative: state.studioModelCapabilitiesAuthoritative,
      studioExecutionSpecInvalid: state.studioExecutionSpecInvalid,
      operationContracts: state.operationContracts,
      pipelineSupport: state.pipelineSupport,
      workflowModelDescriptors: state.workflowModelDescriptors,
      runtimeStatus: state.runtimeStatus,
      discoveryRequests: state.discoveryRequests,
    })),
  );
  const authority = { ...discovered, resourceMode };
  const [draft, setDraft] = useState<CustomNodeType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draftContext, setDraftContext] = useState<WorkflowOperationContext | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const view = blockViewModelV2(node.data.blockInstanceV2!);
  let chain: ReturnType<typeof modelSetupAdapterChain> | undefined;
  let unavailable: string | undefined;
  let addUnavailable: string | null = null;
  let editUnavailable: string | null = null;
  try {
    chain = modelSetupAdapterChain(graph, node.id);
    addUnavailable = modelSetupAdapterAddUnavailable(chain, authority);
    editUnavailable = modelSetupAdapterEditUnavailable(chain, authority);
  } catch (failure) {
    unavailable = failure instanceof Error ? failure.message : 'Adapter controls are unavailable.';
  }
  function apply(edit: Parameters<typeof planModelSetupAdapterEdit>[2]) {
    try {
      const graph = useFlowStore.getState().toObject();
      const context = edit.kind === 'add' || edit.kind === 'replace' ? draftContext : captureWorkflowOperationContext();
      if (!context) throw new Error('This adapter draft is no longer available. Reopen Add LoRA.');
      assertWorkflowOperationContext(context, { includeForm: false });
      const current = useNodesStore.getState();
      const next = planModelSetupAdapterEdit(
        graph,
        node.id,
        edit.kind === 'add' || edit.kind === 'replace' ? { ...edit, registry: current.nodesRegistry } : edit,
        { ...current, resourceMode: useStudioStore.getState().form.resourceMode },
      );
      commitOperationGraph(next, context, operationGraphSignature(graph), `${edit.kind} model adapter`);
      useStudioStore.getState().saveActiveWorkflowTab(true);
      setError(null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not edit this adapter.');
      return false;
    }
  }
  function add(replaceId?: string) {
    const graph = useFlowStore.getState().toObject();
    let currentChain: ReturnType<typeof modelSetupAdapterChain>;
    try {
      currentChain = modelSetupAdapterChain(graph, node.id);
      const unavailable = replaceId
        ? modelSetupAdapterEditUnavailable(currentChain, {
            ...useNodesStore.getState(),
            resourceMode: useStudioStore.getState().form.resourceMode,
          })
        : modelSetupAdapterAddUnavailable(currentChain, {
            ...useNodesStore.getState(),
            resourceMode: useStudioStore.getState().form.resourceMode,
          });
      if (unavailable) throw new Error(unavailable);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Adapter controls are unavailable.');
      return;
    }
    const previous = replaceId && currentChain.adapters.find((adapter) => adapter.id === replaceId);
    const draft = previous
      ? structuredClone(previous)
      : createNodeFromRegistry(currentChain.adapterKey, useNodesStore.getState().nodesRegistry, {
          x: 0,
          y: 0,
        });
    if (!draft) {
      setError('The backend adapter definition is unavailable. Refresh capabilities.');
      return;
    }
    if (!replaceId && !currentChain.native && currentChain.adapters.length && draft.data.params.replace_existing)
      draft.data.params.replace_existing.value = false;
    setReplacementId(replaceId ?? null);
    setDraft(draft);
    setDraftContext(captureWorkflowOperationContext());
    setError(null);
    setOpen(true);
  }
  return (
    <>
      <ModiffDisclosure
        label="Adapters"
        defaultOpen
        unmount={false}
        panelClassName="grid min-w-0 grid-cols-1 gap-2 px-1 pt-2"
      >
        {chain?.prefix && chain.native ? (
          <p className="text-xs text-modiff-subtle-text">Connected adapters remain supplied from outside this setup.</p>
        ) : null}
        {chain?.adapters.map((adapter, index) => {
          const semantic = adapter.id.slice(node.id.length + 1);
          const audio = chain!.adapterKey === 'modules.DiffusersAudio.LoadAdapter';
          const controls = node.data.blockInstanceV2!.effectiveInterface.controls.filter(
            (control) => control.binding.nodeId === semantic && (!audio || control.binding.fieldId === 'scale'),
          );
          return (
            <section key={adapter.id} className="grid min-w-0 grid-cols-1 gap-2" aria-label={`Adapter ${index + 1}`}>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-auto text-xs font-semibold">Adapter {index + 1}</span>
                <ModiffButton
                  size="compact"
                  disabled={index === 0 || Boolean(editUnavailable)}
                  onClick={() => apply({ kind: 'move', nodeId: adapter.id, offset: -1 })}
                >
                  Move up
                </ModiffButton>
                <ModiffButton
                  size="compact"
                  disabled={index === chain!.adapters.length - 1 || Boolean(editUnavailable)}
                  onClick={() => apply({ kind: 'move', nodeId: adapter.id, offset: 1 })}
                >
                  Move down
                </ModiffButton>
                {audio ? (
                  <ModiffButton size="compact" disabled={Boolean(editUnavailable)} onClick={() => add(adapter.id)}>
                    Replace LoRA
                  </ModiffButton>
                ) : null}
                <ModiffButton size="compact" onClick={() => apply({ kind: 'remove', nodeId: adapter.id })}>
                  Remove
                </ModiffButton>
              </div>
              <NodeContent
                nodeId={node.id}
                params={Object.fromEntries(
                  controls.map((control) => [
                    control.controlId,
                    {
                      ...view.controlParams[control.controlId]!,
                      disabled: view.controlParams[control.controlId]!.disabled || Boolean(editUnavailable),
                    },
                  ]),
                )}
                updateStore={(param, value, key) => {
                  if (key === 'disabled') {
                    updateStore(param, value, key);
                    return;
                  }
                  try {
                    const chain = modelSetupAdapterChain(useFlowStore.getState().toObject(), node.id);
                    const unavailable = modelSetupAdapterEditUnavailable(chain, {
                      ...useNodesStore.getState(),
                      resourceMode: useStudioStore.getState().form.resourceMode,
                    });
                    if (unavailable) throw new Error(unavailable);
                    updateStore(param, value, key);
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : 'Adapter controls are unavailable.');
                  }
                }}
                module="MoDiff"
                action="Model Setup adapters"
                mode="controls"
              />
            </section>
          );
        })}
        {unavailable ? <p className="text-xs text-modiff-subtle-text">{unavailable}</p> : null}
        {addUnavailable ? <p className="text-xs text-modiff-subtle-text">{addUnavailable}</p> : null}
        <ModiffButton size="compact" disabled={!chain || Boolean(addUnavailable)} onClick={() => add()}>
          Add LoRA
        </ModiffButton>
        {!open && error ? (
          <p role="alert" className="text-xs text-modiff-red">
            {error}
          </p>
        ) : null}
      </ModiffDisclosure>
      {open && draft ? (
        <ModiffDialog
          open
          title={replacementId ? 'Replace LoRA' : 'Add LoRA'}
          onClose={() => {
            setOpen(false);
            setDraft(null);
            setError(null);
          }}
          footer={
            <ModiffButton
              onClick={() => {
                const values = Object.fromEntries(
                  Object.entries(modelSetupAdapterFields(draft)).map(([name, field]) => [
                    name,
                    field.value ?? field.default,
                  ]),
                );
                if (
                  apply(
                    replacementId
                      ? { kind: 'replace', nodeId: replacementId, values, registry: authority.nodesRegistry }
                      : { kind: 'add', values, registry: authority.nodesRegistry },
                  )
                ) {
                  setOpen(false);
                  setDraft(null);
                }
              }}
            >
              {replacementId ? 'Replace adapter' : 'Add adapter'}
            </ModiffButton>
          }
        >
          <p className="mb-3 text-sm text-modiff-subtle-text">
            Select the adapter before adding it. Hub weights require an exact commit, weight filename and SHA-256. This
            action does not download or load weights.
          </p>
          <NodeContent
            nodeId={`adapter-draft-${node.id}`}
            params={modelSetupAdapterFields(draft)}
            module={draft.data.module}
            action={draft.data.action}
            mode="controls"
            updateStore={(name, value, key) => {
              if (key && key !== 'value') return;
              setDraft((draft) =>
                draft
                  ? {
                      ...draft,
                      data: {
                        ...draft.data,
                        params: {
                          ...draft.data.params,
                          [name]: { ...draft.data.params[name], value: value as NodeParams['value'] },
                        },
                      },
                    }
                  : null,
              );
            }}
          />
          {error ? (
            <p role="alert" className="text-sm text-modiff-red">
              {error}
            </p>
          ) : null}
        </ModiffDialog>
      ) : null}
    </>
  );
}
