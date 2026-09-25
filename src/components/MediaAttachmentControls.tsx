import { useEffect, useRef, useState } from 'react';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { assertWorkflowOperationContext, captureWorkflowOperationContext } from '../stores/useStudioStore';
import { operationAuthoring } from '../workflow/operationAuthoring';
import {
  mediaAttachmentChoices,
  planMediaAttachment,
  planBlockMediaAttachment,
  executableMediaOperations,
} from '../workflow/mediaAttachment';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { commitOperationGraph, operationGraphSignature } from '../workflow/operationGraphTransaction';
import { ModiffButton, ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import { formatRequestError } from '../utils/requestJson';
import { nodeConnectorParam, nodeConnectorParams } from '../studio/nodeConnectorResolution';

export default function MediaAttachmentControls({
  node,
  initialSource,
  onAttached,
  inline = false,
}: {
  node: CustomNodeType;
  initialSource?: { nodeId: string; handleId: string };
  onAttached?: () => void;
  inline?: boolean;
}) {
  const operations = useNodesStore((state) => state.operationContracts);
  const support = useNodesStore((state) => state.pipelineSupport);
  const nodes = useFlowStore((state) => state.nodes);
  const [selected, setSelected] = useState('');
  const [sourceKey, setSourceKey] = useState(
    initialSource ? JSON.stringify([initialSource.nodeId, initialSource.handleId]) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const hint = operationAuthoring(node);
  const choices = mediaAttachmentChoices(
    executableMediaOperations(operations, support),
    hint?.operation.pipelineClass ?? '',
  );
  const choice =
    choices.find((item) => item.key === selected) ??
    choices.find((item) => item.task === hint?.operation.task) ??
    choices[0];
  if (!choice || (node.parentId && !node.data.blockProjectionOwnerId)) return null;
  const sources = nodes.flatMap((candidate) => {
    const params = { ...nodeConnectorParams(candidate) };
    if (initialSource?.nodeId === candidate.id) {
      const initial = nodeConnectorParam(candidate, initialSource.handleId);
      if (initial) params[initialSource.handleId] = initial;
    }
    return Object.entries(params)
      .filter(
        ([, field]) =>
          field.display === 'output' &&
          !field.hidden &&
          !field.disabled &&
          (Array.isArray(field.type) ? field.type : [field.type]).includes(choice.kind),
      )
      .map(([handle, field]) => ({
        value: JSON.stringify([candidate.id, handle]),
        label: `${candidate.data.label} · ${field.label ?? handle}`,
      }));
  });
  async function attach() {
    if (!choice || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const context = captureWorkflowOperationContext();
    const graph = useFlowStore.getState().toObject();
    const signature = operationGraphSignature(graph);
    setBusy(true);
    setError(null);
    try {
      if (sourceKey && !sources.some((item) => item.value === sourceKey))
        throw new Error('The selected source is no longer compatible. Choose a source for this input role.');
      const profile = node.data.params.execution_profile_id?.value;
      const starter = await requestOperationStarter(
        hint!.operation.pipelineClass,
        choice.task,
        operations,
        controller.signal,
        typeof profile === 'string' && profile ? profile : undefined,
      );
      if (controller.signal.aborted) return;
      assertWorkflowOperationContext(context, { includeForm: false });
      const source =
        sourceKey && sources.some((item) => item.value === sourceKey)
          ? (JSON.parse(sourceKey) as [string, string])
          : null;
      const sourcePort = source ? { nodeId: source[0], handleId: source[1] } : undefined;
      const next = node.data.blockProjectionOwnerId
        ? planBlockMediaAttachment(
            graph,
            node.data.blockProjectionOwnerId,
            node.data.blockProjectionNodeId!,
            starter,
            choice,
            useNodesStore.getState().nodesRegistry,
            sourcePort,
          )
        : planMediaAttachment(graph, node.id, starter, choice, useNodesStore.getState().nodesRegistry, sourcePort);
      commitOperationGraph(next, context, signature, 'Attach media input');
      onAttached?.();
    } catch (failure) {
      if (!controller.signal.aborted) setError(formatRequestError(failure, 'Could not attach this input.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <ModiffDisclosure
      label="Add image / audio input"
      collapsible={!initialSource && !inline}
      panelClassName="grid gap-2 py-2"
    >
      <ModiffFieldShell label="Use input for">
        <ModiffSelect
          aria-label="Media input role"
          value={choice.key}
          disabled={busy}
          options={choices.map((item) => ({ value: item.key, label: item.label }))}
          onValueChange={(value) => {
            setSelected(value);
            setError(null);
          }}
        />
      </ModiffFieldShell>
      <ModiffFieldShell label="Source">
        <ModiffSelect
          aria-label="Media input source"
          value={sources.some((item) => item.value === sourceKey) ? sourceKey : ''}
          disabled={busy}
          options={[{ value: '', label: `Add Load ${choice.kind === 'image' ? 'Image' : 'Audio'}` }, ...sources]}
          onValueChange={setSourceKey}
        />
      </ModiffFieldShell>
      <p className="text-xs text-modiff-subtle-text">
        Reuses this model and adds only the required encoding stages. Existing prompts and custom branches are retained.
      </p>
      <ModiffButton tone="primary" disabled={busy} onClick={() => void attach()}>
        {busy ? 'Preparing input…' : 'Attach input'}
      </ModiffButton>
      {error ? (
        <p role="alert" className="text-xs text-modiff-red">
          {error}
        </p>
      ) : null}
    </ModiffDisclosure>
  );
}
