import { useEffect, useRef, useState } from 'react';
import type { ApiGraphExport } from '../types/api';
import { assertWorkflowOperationContext, captureWorkflowOperationContext } from '../stores/useStudioStore';
import {
  buildServiceInterface,
  exportServicePackage,
  inspectServiceGraph,
  type ServiceCandidates,
} from '../studio/servicePackage';
import { ModiffButton, ModiffDialog, ModiffFieldShell, ModiffInput } from '../ui';
import { formatRequestError } from '../utils/requestJson';

type Props = { getGraph: () => Promise<{ apiGraph?: ApiGraphExport | null }>; onClose: () => void };

export default function ServiceExportDialog({ getGraph, onClose }: Props) {
  const context = useRef(captureWorkflowOperationContext());
  const [graph, setGraph] = useState<ApiGraphExport | null>(null);
  const [candidates, setCandidates] = useState<ServiceCandidates>({ inputs: [], outputs: [] });
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { apiGraph } = await getGraph();
        if (!apiGraph) throw new Error('Connect to MoDiff before exporting a service.');
        const fields = await inspectServiceGraph(apiGraph);
        assertWorkflowOperationContext(context.current);
        if (active) {
          setGraph(apiGraph);
          setCandidates(fields);
        }
      } catch (reason) {
        if (active) setError(formatRequestError(reason, 'Could not inspect this graph.'));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getGraph]);

  async function download() {
    if (!graph) return;
    setBusy(true);
    setError('');
    try {
      assertWorkflowOperationContext(context.current);
      const current = await getGraph();
      if (JSON.stringify(current.apiGraph) !== JSON.stringify(graph))
        throw new Error('The graph changed during export. Close this dialog and review the service fields again.');
      const service = await exportServicePackage(graph, buildServiceInterface(candidates, names));
      assertWorkflowOperationContext(context.current);
      const latest = await getGraph();
      if (JSON.stringify(latest.apiGraph) !== JSON.stringify(graph))
        throw new Error('The graph changed during export. Close this dialog and review the service fields again.');
      const url = URL.createObjectURL(new Blob([JSON.stringify(service, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'modiff-service.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (reason) {
      setError(formatRequestError(reason, 'Could not export this service.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModiffDialog
      open
      onClose={busy ? () => undefined : onClose}
      dismissible={!busy}
      title="Export service package"
      description="Name the inputs callers supply and the outputs they receive. Leave unused fields blank."
      testId="service-export-dialog"
      panelClassName="max-w-2xl"
      footer={
        <>
          <ModiffButton disabled={busy} onClick={onClose}>
            Cancel
          </ModiffButton>
          <ModiffButton disabled={!graph || busy} loading={busy} onClick={() => void download()} tone="primary">
            Download service package
          </ModiffButton>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-modiff-metadata text-modiff-subtle-text">
          Named inputs are required on each call; their current values are omitted. Other graph values remain in the
          package. Review prompts and metadata before sharing. Models need immutable revisions and custom nodes need the
          same reviewed source. This package runs through a local MoDiff server.
        </p>
        {error && (
          <p role="alert" className="text-modiff-metadata text-modiff-red">
            {error}
          </p>
        )}
        {!busy && !candidates.outputs.length && (
          <p>Add an Image Preview, Data Viewer, or another preview node to expose a service output.</p>
        )}
        {(['inputs', 'outputs'] as const).map((kind) => (
          <fieldset key={kind} disabled={busy} className="grid gap-2">
            <legend className="mb-2 font-semibold">{kind === 'inputs' ? 'Inputs' : 'Outputs'}</legend>
            {candidates[kind].map((candidate) => {
              const key = JSON.stringify([kind, candidate.nodeId, candidate.field]);
              return (
                <ModiffFieldShell
                  key={key}
                  label={`${candidate.nodeId} · ${candidate.field}`}
                  description={candidate.type}
                >
                  <ModiffInput
                    aria-label={`${kind} ${candidate.nodeId}.${candidate.field}`}
                    value={names[key] ?? ''}
                    placeholder="Service name (optional)"
                    onChange={(event) => setNames({ ...names, [key]: event.currentTarget.value })}
                  />
                </ModiffFieldShell>
              );
            })}
          </fieldset>
        ))}
      </div>
    </ModiffDialog>
  );
}
