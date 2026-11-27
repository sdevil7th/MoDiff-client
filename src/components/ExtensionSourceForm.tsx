import { useRef, useState } from 'react';
import { FolderOpen, GitBranch, CloudDownload } from 'lucide-react';
import {
  extensionName,
  pythonFileImport,
  type ExtensionImport,
  type ExtensionSource,
} from '../studio/customExtensions';
import { useNodesStore } from '../stores/useNodeStore';
import { formatRequestError } from '../utils/requestJson';
import { ModiffButton, ModiffFieldShell, ModiffInput, ModiffDisclosure, ModiffFileInput } from '../ui';

const choices = [
  { value: 'local', label: 'Local', Icon: FolderOpen },
  { value: 'hub', label: 'Hugging Face', Icon: CloudDownload },
  { value: 'git', label: 'Git', Icon: GitBranch },
] as const;

export default function ExtensionSourceForm({
  initialKind,
  busy,
  onAdd,
}: {
  initialKind: ExtensionSource['kind'];
  busy: boolean;
  onAdd: (source: ExtensionImport) => Promise<void>;
}) {
  const [kind, setKind] = useState(initialKind);
  const [source, setSource] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [revision, setRevision] = useState('');
  const [error, setError] = useState<string | null>(null);
  const root = useNodesStore((state) => state.customModuleRoot);
  const fileInput = useRef<HTMLInputElement>(null);
  const resolvedName = name.trim() || extensionName(selectedFile?.name || source);
  return (
    <div className="grid gap-4" data-testid="extension-source-form">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Source type">
        {choices.map(({ value, label, Icon }) => (
          <ModiffButton
            key={value}
            disabled={busy}
            aria-pressed={kind === value}
            className="aria-pressed:border-hf-yellow aria-pressed:bg-hf-yellow/10 aria-pressed:text-hf-yellow"
            icon={<Icon size={16} />}
            onClick={() => {
              setKind(value);
              setSource('');
              setSelectedFile(null);
              setRevision('');
              setError(null);
            }}
          >
            {label}
            {kind === value ? ' ✓' : ''}
          </ModiffButton>
        ))}
      </div>
      {kind === 'local' ? (
        <div className="grid gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg p-3">
          <p className="text-sm">
            Choose a Python file from this computer, then select Add node to enable it on the backend.
          </p>
          <p className="break-all font-mono text-xs text-modiff-subtle-text">{root ?? 'custom/ on the backend'}</p>
          <p className="text-xs text-modiff-subtle-text">
            Files placed directly in this backend folder appear in Custom nodes. Select Load there to enable one.
          </p>
          <ModiffFileInput
            ref={fileInput}
            accept=".py"
            aria-label="Choose Python node file"
            className="hidden"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) {
                setSelectedFile(file);
                setSource('');
                setError(null);
              }
            }}
          />
          <ModiffButton disabled={busy} onClick={() => fileInput.current?.click()}>
            Choose Python file
          </ModiffButton>
          {selectedFile ? <p className="break-all text-sm">Selected: {selectedFile.name}</p> : null}
        </div>
      ) : (
        <ModiffFieldShell label={kind === 'hub' ? 'Hugging Face repository' : 'Git repository URL'}>
          <ModiffInput
            aria-label="Extension source"
            value={source}
            disabled={busy}
            placeholder={kind === 'hub' ? 'owner/repository' : 'https://host/owner/repository.git'}
            onChange={(event) => setSource(event.target.value)}
          />
        </ModiffFieldShell>
      )}
      <ModiffDisclosure label="Advanced options" panelClassName="grid gap-3 pt-2">
        {kind === 'local' ? (
          <ModiffFieldShell label="Copy an existing backend folder or Python file">
            <ModiffInput
              aria-label="Extension source"
              value={source}
              disabled={busy}
              onChange={(event) => {
                setSelectedFile(null);
                setSource(event.target.value);
              }}
            />
          </ModiffFieldShell>
        ) : (
          <ModiffFieldShell label="Branch, tag or commit (optional)">
            <ModiffInput
              aria-label="Extension revision"
              value={revision}
              disabled={busy}
              placeholder="Repository default"
              onChange={(event) => setRevision(event.target.value)}
            />
          </ModiffFieldShell>
        )}
        <ModiffFieldShell label="Package name (optional)">
          <ModiffInput
            aria-label="Extension module name"
            value={name}
            placeholder={source || selectedFile ? resolvedName : 'Derived from source'}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </ModiffFieldShell>
      </ModiffDisclosure>
      {error ? (
        <p role="alert" className="text-sm text-modiff-red">
          Node import failed
          <br />
          {error}
        </p>
      ) : null}
      <p className="text-xs text-modiff-subtle-text">
        Only add code you trust. Python nodes run with backend permissions. Dependencies are never installed
        automatically.
      </p>
      <ModiffButton
        tone="primary"
        fullWidth
        loading={busy}
        disabled={busy || (!selectedFile && !source.trim()) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(resolvedName)}
        onClick={async () => {
          if (selectedFile) {
            try {
              const upload = await pythonFileImport(selectedFile);
              await onAdd({ ...upload, name: resolvedName });
            } catch (failure) {
              setError(formatRequestError(failure, 'Node import failed.'));
            }
            return;
          }
          await onAdd({
            kind,
            source: source.trim(),
            name: resolvedName,
            ...(revision.trim() ? { revision: revision.trim() } : {}),
          });
        }}
      >
        Add node
      </ModiffButton>
    </div>
  );
}
