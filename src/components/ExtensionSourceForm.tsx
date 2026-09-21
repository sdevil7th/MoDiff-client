import { useEffect, useRef, useState } from 'react';
import type { ExtensionSource, ResolvedExtensionSource } from '../studio/customExtensions';
import { resolveExtensionSource } from '../studio/extensionSourceResolution';
import { formatRequestError } from '../utils/requestJson';
import { DetailLine } from '../ui/DetailLine';
import { ModiffButton, ModiffFieldShell, ModiffInput, ModiffSelect } from '../ui';

export default function ExtensionSourceForm({
  initialKind,
  busy,
  onStage,
}: {
  initialKind: ExtensionSource['kind'];
  busy: boolean;
  onStage: (source: ExtensionSource) => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [revision, setRevision] = useState('');
  const [resolved, setResolved] = useState<
    (ResolvedExtensionSource & { requestSource: string; requestRevision: string }) | null
  >(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setResolving(false);
    setResolved(null);
    setError(null);
    return () => {
      pending.current?.abort();
    };
  }, [kind, source, revision, busy]);

  async function resolve() {
    if (busy || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setResolving(true);
    setResolved(null);
    setError(null);
    try {
      const result = await resolveExtensionSource(source.trim(), revision, controller.signal);
      if (!controller.signal.aborted) setResolved({ ...result, requestSource: source, requestRevision: revision });
    } catch (failure) {
      if (!controller.signal.aborted) setError(formatRequestError(failure, 'Could not resolve this source.'));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setResolving(false);
      }
    }
  }

  const current = resolved?.requestSource === source && resolved?.requestRevision === revision ? resolved : null;
  const exact = /^[a-f0-9]{40}$/u.test(revision);
  const pinned =
    kind === 'hub'
      ? (current ?? (exact && !source.includes('://') ? { source: source.trim(), revision } : null))
      : null;
  return (
    <div className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
      <ModiffFieldShell label="Source type">
        <ModiffSelect
          aria-label="Extension source type"
          value={kind}
          disabled={busy}
          options={[
            { value: 'local', label: 'Local Python folder' },
            { value: 'hub', label: 'Hugging Face Modular block' },
            { value: 'git', label: 'Git at exact commit' },
          ]}
          onValueChange={(value) => {
            if (value === 'local' || value === 'hub' || value === 'git') setKind(value);
          }}
        />
      </ModiffFieldShell>
      <ModiffInput
        aria-label="Extension source"
        placeholder={
          kind === 'local'
            ? 'Backend folder path'
            : kind === 'git'
              ? 'HTTPS Git URL'
              : 'Hugging Face URL or owner/repository'
        }
        value={source}
        disabled={busy}
        onChange={(e) => setSource(e.target.value)}
      />
      <ModiffInput
        aria-label="Extension module name"
        placeholder="Module name, e.g. PromptTools"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />
      {kind !== 'local' ? (
        <ModiffInput
          aria-label="Extension exact revision"
          placeholder={kind === 'hub' ? 'Branch, tag or commit (default: main)' : '40-character commit SHA'}
          value={revision}
          disabled={busy}
          onChange={(e) => setRevision(e.target.value)}
        />
      ) : null}
      {kind === 'hub' ? (
        <>
          <div className="flex flex-wrap gap-2">
            <ModiffButton disabled={busy || resolving || !source.trim()} onClick={() => void resolve()}>
              {resolving ? 'Resolving revision…' : 'Resolve revision'}
            </ModiffButton>
            {resolving ? (
              <ModiffButton
                onClick={() => {
                  pending.current?.abort();
                  pending.current = null;
                  setResolving(false);
                }}
              >
                Cancel resolution
              </ModiffButton>
            ) : null}
          </div>
          {current ? (
            <div role="status" className="break-all text-xs text-modiff-subtle-text">
              Resolved {current.source} · {current.requestedRevision} → {current.revision}. Stage this exact commit to
              inspect its source.
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-modiff-red">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
      <ModiffButton
        disabled={
          busy ||
          resolving ||
          !source.trim() ||
          !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ||
          (kind === 'git' && !exact) ||
          (kind === 'hub' && !pinned)
        }
        onClick={() =>
          onStage({
            kind,
            name,
            source: pinned?.source ?? source.trim(),
            ...(kind !== 'local' ? { revision: pinned?.revision ?? revision } : {}),
          })
        }
      >
        Stage source
      </ModiffButton>
      <DetailLine tone="muted">
        {kind === 'local'
          ? 'Staging copies this folder. Edit the installed path shown in the review after staging.'
          : 'Revision lookup reads metadata only. Staging downloads code and metadata at the exact commit; it does not install packages or model weights.'}
      </DetailLine>
    </div>
  );
}
