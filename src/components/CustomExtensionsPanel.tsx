import { useEffect, useRef, useState } from 'react';
import { useNodesStore } from '../stores/useNodeStore';
import { inspectExtension, type ExtensionSource } from '../studio/customExtensions';
import ExtensionSourceForm from './ExtensionSourceForm';
import { formatRequestError } from '../utils/requestJson';
import { ModiffButton, ModiffBadge, ModiffDisclosure } from '../ui';

export default function CustomExtensionsPanel({
  initialKind = 'local',
  initialView = 'add',
}: {
  initialKind?: ExtensionSource['kind'];
  initialView?: 'add' | 'manage';
}) {
  const modules = useNodesStore((state) => state.customModules);
  const fetchModules = useNodesStore((state) => state.fetchCustomModules);
  const add = useNodesStore((state) => state.addCustomModule);
  const enable = useNodesStore((state) => state.setCustomModuleEnabled);
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void fetchModules();
    return () => {
      mounted.current = false;
    };
  }, [fetchModules]);

  async function perform(action: () => Promise<unknown>, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (mounted.current) setMessage(success);
    } catch (failure) {
      if (mounted.current) setError(formatRequestError(failure, 'Could not change this extension.'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="grid gap-4" aria-label="Custom nodes" data-testid="custom-extensions-panel">
      <div className="flex gap-2" role="group" aria-label="Custom node actions">
        <ModiffButton
          className="aria-pressed:border-hf-yellow aria-pressed:text-hf-yellow"
          disabled={busy}
          aria-pressed={view === 'add'}
          onClick={() => setView('add')}
        >
          Add node
        </ModiffButton>
        <ModiffButton
          className="aria-pressed:border-hf-yellow aria-pressed:text-hf-yellow"
          disabled={busy}
          aria-pressed={view === 'manage'}
          onClick={() => {
            setView('manage');
            void fetchModules();
          }}
        >
          Manage nodes
        </ModiffButton>
      </div>
      {view === 'add' ? (
        <ExtensionSourceForm
          initialKind={initialKind}
          busy={busy}
          onAdd={(source) =>
            perform(() => add(source), 'Added and enabled. Find your nodes in Custom nodes or connection search.')
          }
        />
      ) : (
        <div className="grid gap-2">
          <p className="text-xs text-modiff-subtle-text">
            Load or reload code you trust. Wait for running and queued work to finish before changing code.
          </p>
          <ModiffButton disabled={busy} onClick={() => void fetchModules()}>
            Refresh sources
          </ModiffButton>
          {modules.length === 0 ? (
            <p className="text-sm text-modiff-subtle-text">No custom nodes yet.</p>
          ) : (
            modules.map((item) => (
              <div key={item.name} className="grid gap-2 rounded-modiff-compact border border-modiff-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{item.name}</span>
                  <ModiffBadge tone={item.enabled ? 'success' : 'warning'}>
                    {item.status === 'disabled' && !item.approvedHash ? 'Not loaded' : item.status}
                  </ModiffBadge>
                </div>
                {item.diagnostic ? <p className="text-xs text-modiff-red">{item.diagnostic}</p> : null}
                <div className="flex gap-2">
                  <ModiffButton
                    disabled={busy || !item.codeHash}
                    onClick={() =>
                      void perform(async () => {
                        const current = await inspectExtension(item.name);
                        await enable(item.name, true, current.codeHash ?? undefined);
                      }, item.name + ' loaded. Its nodes are available in the library.')
                    }
                  >
                    {item.enabled || item.status === 'changed' ? 'Reload' : 'Load'}
                  </ModiffButton>
                  {item.canDisable ? (
                    <ModiffButton
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          () => enable(item.name, false),
                          'Disabled. Files are preserved; import side effects may require a backend restart.',
                        )
                      }
                    >
                      Disable
                    </ModiffButton>
                  ) : null}
                </div>
                <ModiffDisclosure
                  label="Source and dependencies"
                  panelClassName="grid gap-1 text-xs text-modiff-subtle-text"
                >
                  <p className="break-all">Edit source: {item.path}</p>
                  <p className="break-all">{item.revision ?? item.codeHash}</p>
                  <p>Memory declaration: {item.runtimeRole ?? 'manual'}</p>
                  {item.dependencies.map((dep) => (
                    <p key={dep.requirement}>
                      {dep.requirement} · {dep.status} · {dep.installed ?? 'not installed'}
                    </p>
                  ))}
                </ModiffDisclosure>
              </div>
            ))
          )}
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-modiff-red">
          {view === 'add' ? 'Node import failed' : 'Could not update node'}
          <br />
          {error}
        </p>
      ) : null}
      {busy || message ? (
        <p role="status" className="text-sm text-modiff-subtle-text">
          {busy ? 'Resolving source and loading code…' : message}
        </p>
      ) : null}
    </section>
  );
}
