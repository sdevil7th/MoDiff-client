import { DetailLine } from '../ui/DetailLine';
import { useEffect, useRef, useState } from 'react';
import { useNodesStore } from '../stores/useNodeStore';
import { inspectExtension, type ExtensionInfo, type ExtensionSource } from '../studio/customExtensions';
import { formatRequestError } from '../utils/requestJson';
import {
  ModiffButton,
  ModiffCheckbox,
  ModiffFieldShell,
  ModiffInput,
  ModiffSelect,
  ModiffBadge,
  ModiffDisclosure,
} from '../ui';

export default function CustomExtensionsPanel() {
  const modules = useNodesStore((state) => state.customModules);
  const fetchModules = useNodesStore((state) => state.fetchCustomModules);
  const install = useNodesStore((state) => state.installCustomModule);
  const enable = useNodesStore((state) => state.setCustomModuleEnabled);
  const [kind, setKind] = useState<ExtensionSource['kind']>('local');
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [revision, setRevision] = useState('');
  const [inspection, setInspection] = useState<ExtensionInfo | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void fetchModules();
    return () => {
      mounted.current = false;
    };
  }, [fetchModules]);

  async function perform(action: () => Promise<ExtensionInfo | null>, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    setConsent(false);
    try {
      const result = await action();
      if (mounted.current) {
        setInspection(result);
        setMessage(success);
      }
    } catch (failure) {
      if (mounted.current) {
        setInspection(null);
        setError(formatRequestError(failure, 'Could not change this extension.'));
      }
      await fetchModules();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <section className="grid gap-3" aria-label="Custom nodes" data-testid="custom-extensions-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-modiff-text">Custom nodes</h3>
        <ModiffButton
          disabled={busy}
          onClick={() => {
            void perform(async () => {
              await fetchModules();
              return null;
            }, 'Sources refreshed; no code reloaded.');
          }}
        >
          Refresh sources
        </ModiffButton>
      </div>
      <p className="text-xs text-modiff-subtle-text">
        Stage source, inspect its code and dependencies, then explicitly enable it. Enabled nodes appear in search and
        typed suggestions in Creator and Developer.
      </p>
      <div className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
        <ModiffFieldShell label="Source type">
          <ModiffSelect
            aria-label="Extension source type"
            value={kind}
            disabled={busy}
            options={[
              { value: 'local', label: 'Local Python folder' },
              { value: 'git', label: 'Git at exact commit' },
              { value: 'hub', label: 'Hub Modular block at exact commit' },
            ]}
            onValueChange={(value) => {
              if (value === 'local' || value === 'git' || value === 'hub') setKind(value);
            }}
          />
        </ModiffFieldShell>
        <ModiffInput
          aria-label="Extension source"
          placeholder={
            kind === 'local' ? 'Backend folder path' : kind === 'git' ? 'HTTPS Git URL' : 'Hub owner/repository'
          }
          value={source}
          disabled={busy}
          onChange={(event) => setSource(event.target.value)}
        />
        <ModiffInput
          aria-label="Extension module name"
          placeholder="Module name, e.g. PromptTools"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        {kind !== 'local' ? (
          <ModiffInput
            aria-label="Extension exact revision"
            placeholder="40-character commit SHA"
            value={revision}
            disabled={busy}
            onChange={(event) => setRevision(event.target.value)}
          />
        ) : null}
        <ModiffButton
          disabled={
            busy ||
            !source.trim() ||
            !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ||
            (kind !== 'local' && !/^[a-f0-9]{40}$/u.test(revision))
          }
          onClick={() => {
            void perform(async () => {
              const result = await install({
                kind,
                source: source.trim(),
                name,
                ...(kind !== 'local' ? { revision } : {}),
              });
              return result.module ?? null;
            }, 'Source staged. Python execution is disabled.');
          }}
        >
          Stage source
        </ModiffButton>
        <DetailLine tone="muted">
          Remote staging downloads code and metadata at the specified commit. It does not install packages or model
          weights.
        </DetailLine>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-modiff-red">
          {error}
        </p>
      ) : null}
      {message || busy ? (
        <p role="status" className="text-xs text-modiff-subtle-text">
          {busy ? 'Working…' : message}
        </p>
      ) : null}
      <div className="grid gap-2">
        {modules.length === 0 ? (
          <DetailLine tone="muted">No custom sources staged.</DetailLine>
        ) : (
          modules.map((item) => (
            <div key={item.name} className="grid gap-2 rounded-modiff-compact border border-modiff-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-modiff-text">{item.name}</span>
                <ModiffBadge tone={item.enabled ? 'success' : 'warning'}>{item.status}</ModiffBadge>
              </div>
              {item.diagnostic ? <DetailLine tone="warning">{item.diagnostic}</DetailLine> : null}
              <div className="flex flex-wrap gap-2">
                <ModiffButton
                  disabled={busy}
                  onClick={() => {
                    void perform(() => inspectExtension(item.name), 'Inspection complete; no source code imported.');
                  }}
                >
                  {item.enabled || item.status === 'changed' ? 'Review reload' : 'Inspect source'}
                </ModiffButton>
                {item.canDisable ? (
                  <ModiffButton
                    tone="danger"
                    disabled={busy}
                    onClick={() => {
                      void perform(async () => {
                        await enable(item.name, false);
                        return null;
                      }, 'Disabled. Restart the backend to remove any import side effects.');
                    }}
                  >
                    Disable
                  </ModiffButton>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      {inspection ? (
        <section
          className="grid gap-2 rounded-modiff-compact border border-hf-yellow/40 p-3"
          aria-label="Extension review"
        >
          <h4 className="text-sm font-semibold text-modiff-text">Review {inspection.name}</h4>
          <div className="break-all text-xs text-modiff-subtle-text">Edit installed source: {inspection.path}</div>
          <div className="break-all text-xs text-modiff-subtle-text">
            Code and dependency identity: {inspection.codeHash}
          </div>
          {inspection.revision ? (
            <div className="break-all text-xs text-modiff-subtle-text">Source commit: {inspection.revision}</div>
          ) : null}
          <DetailLine tone={inspection.runtimeRole === 'manual' ? 'warning' : 'muted'}>
            Resource declaration: {inspection.runtimeRole || 'manual'}.{' '}
            {inspection.runtimeRole === 'data'
              ? 'Author declares no model loading. Auto does not execute custom code during inspection.'
              : inspection.runtimeRole === 'connected_components'
                ? 'Models must come from connected reviewed loaders. Auto retains owners for custom code.'
                : 'Use Custom memory for source with manual resource management.'}
          </DetailLine>
          {inspection.preview
            ? Object.entries(inspection.preview.nodes).map(([action, node]) => (
                <div key={action} className="text-xs text-modiff-text">
                  <strong>{node.label}</strong>
                  {Object.entries(node.params).map(([field, definition]) => (
                    <div key={field} className="text-modiff-subtle-text">
                      {field}: {Array.isArray(definition.type) ? definition.type.join(' | ') : definition.type || 'any'}{' '}
                      · {definition.display === 'output' ? 'output' : 'input/control'}
                    </div>
                  ))}
                </div>
              ))
            : null}
          {inspection.preview?.diagnostics.map((item) => (
            <DetailLine key={item} tone="warning">
              {item}
            </DetailLine>
          ))}
          <div className="text-xs font-semibold text-modiff-text">Declared dependencies</div>
          {inspection.dependencies.length ? (
            inspection.dependencies.map((dep) => (
              <DetailLine key={dep.requirement} tone={dep.status === 'satisfied' ? 'muted' : 'warning'}>
                {dep.requirement} · {dep.installed || 'not installed'} · {dep.status}
              </DetailLine>
            ))
          ) : (
            <DetailLine tone="muted">None declared. Review imports in the source; this is not a sandbox.</DetailLine>
          )}
          <ModiffDisclosure
            label={`Source files (${inspection.files.length})`}
            panelClassName="text-xs text-modiff-subtle-text"
          >
            {inspection.files.map((file) => (
              <div key={file.name} className="break-all">
                {file.name} · {file.bytes} bytes · {file.sha256}
              </div>
            ))}
          </ModiffDisclosure>
          <ModiffCheckbox
            checked={consent}
            disabled={busy}
            onCheckedChange={setConsent}
            label="I reviewed this exact code and dependencies and allow it to run with backend and browser permissions"
          />
          <div className="flex flex-wrap gap-2">
            <ModiffButton
              tone="primary"
              disabled={
                busy ||
                !consent ||
                !inspection.codeHash ||
                inspection.dependencies.some((dep) => dep.status !== 'satisfied')
              }
              onClick={() => {
                const selected = inspection;
                void perform(async () => {
                  await enable(selected.name, true, selected.codeHash ?? undefined);
                  return null;
                }, 'Code enabled. Find its nodes in normal search. Affected cached results were released.');
              }}
            >
              {inspection.enabled || inspection.status === 'changed' ? 'Enable and reload code' : 'Enable code'}
            </ModiffButton>
            <ModiffButton
              disabled={busy}
              onClick={() => {
                setInspection(null);
                setConsent(false);
                setMessage(null);
              }}
            >
              Cancel review
            </ModiffButton>
          </div>
        </section>
      ) : null}
    </section>
  );
}
