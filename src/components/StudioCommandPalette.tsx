import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  Download,
  GalleryVerticalEnd,
  Images,
  Octagon,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  X,
} from 'lucide-react';

import { StudioButton, StudioIconButton, StudioTextInput } from '../ui';

type CommandItem = {
  id: string;
  label: string;
  detail: string;
  icon: ReactNode;
  disabled?: boolean;
  run: () => void;
};

type StudioCommandPaletteProps = {
  isWorking: boolean;
  runBlocked: boolean;
  expertMode?: boolean;
  onRun: () => void;
  onInterrupt: () => void;
  onUpdateGraph: () => void;
  onExport: () => void;
  onSavePrompt: () => void;
  onOpenGallery: () => void;
  onOpenTemplateGallery: () => void;
  onOpenSetup: () => void;
  onRestoreLatest: () => void;
  onRerunLatest: () => void;
  onCompareLatest: () => void;
  hasGalleryItems: boolean;
  hasComparePair: boolean;
};

export function StudioCommandPalette({
  isWorking,
  runBlocked,
  expertMode = false,
  hasComparePair,
  hasGalleryItems,
  onCompareLatest,
  onExport,
  onInterrupt,
  onRun,
  onUpdateGraph,
  onSavePrompt,
  onOpenGallery,
  onOpenTemplateGallery,
  onOpenSetup,
  onRestoreLatest,
  onRerunLatest,
}: StudioCommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: 'run',
        label: 'Run workflow',
        detail: 'Queue the current Studio graph.',
        icon: <Play size={15} />,
        disabled: isWorking || runBlocked,
        run: onRun,
      },
      ...(expertMode
        ? ([
            {
              id: 'update',
              label: 'Sync graph',
              detail: 'Reconcile Studio fields with visible graph nodes.',
              icon: <RefreshCw size={15} />,
              disabled: isWorking,
              run: onUpdateGraph,
            },
          ] satisfies CommandItem[])
        : []),
      {
        id: 'interrupt',
        label: 'Interrupt run',
        detail: 'Ask the backend to stop the active or queued execution.',
        icon: <Octagon size={15} />,
        run: onInterrupt,
      },
      {
        id: 'save-prompt',
        label: 'Save prompt',
        detail: 'Store the current prompt as a reusable snippet.',
        icon: <Save size={15} />,
        run: onSavePrompt,
      },
      ...(expertMode
        ? ([
            {
              id: 'export',
              label: 'Export API graph',
              detail: 'Download the current runnable graph JSON.',
              icon: <Download size={15} />,
              run: onExport,
            },
          ] satisfies CommandItem[])
        : []),
      {
        id: 'gallery',
        label: 'Open gallery',
        detail: 'Inspect, compare, restore, rerun, and export outputs.',
        icon: <Images size={15} />,
        run: onOpenGallery,
      },
      {
        id: 'compare',
        label: 'Compare latest',
        detail: 'Open the latest two Gallery outputs side by side.',
        icon: <ArrowLeftRight size={15} />,
        disabled: !hasComparePair,
        run: onCompareLatest,
      },
      {
        id: 'restore-latest',
        label: 'Restore latest',
        detail: 'Restore the newest Gallery workflow into Studio.',
        icon: <RotateCcw size={15} />,
        disabled: !hasGalleryItems,
        run: onRestoreLatest,
      },
      {
        id: 'rerun-latest',
        label: 'Rerun latest',
        detail: 'Restore and queue the newest Gallery workflow.',
        icon: <Play size={15} />,
        disabled: !hasGalleryItems || isWorking || runBlocked,
        run: onRerunLatest,
      },
      {
        id: 'templates',
        label: 'Browse templates',
        detail: 'Search categorized workflow templates for the current task.',
        icon: <GalleryVerticalEnd size={15} />,
        run: onOpenTemplateGallery,
      },
      {
        id: 'setup',
        label: 'Open setup',
        detail: 'Repair missing models and runtime readiness.',
        icon: <Settings size={15} />,
        run: onOpenSetup,
      },
    ],
    [
      expertMode,
      hasComparePair,
      hasGalleryItems,
      isWorking,
      onCompareLatest,
      onExport,
      onInterrupt,
      onOpenGallery,
      onOpenSetup,
      onOpenTemplateGallery,
      onRestoreLatest,
      onRerunLatest,
      onRun,
      onSavePrompt,
      onUpdateGraph,
      runBlocked,
    ],
  );

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) => `${command.label} ${command.detail}`.toLowerCase().includes(normalized));
  }, [commands, query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (modifier && event.key === 'Enter' && !isWorking && !runBlocked) {
        event.preventDefault();
        onRun();
      }
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWorking, onRun, runBlocked]);

  const runCommand = (command: CommandItem) => {
    if (command.disabled) return;
    command.run();
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <StudioButton tone="ghost" fullWidth icon={<GalleryVerticalEnd size={15} />} onClick={() => setOpen(true)}>
        Command palette
      </StudioButton>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-modiff-bg/80 p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Studio command palette"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setOpen(false);
              setQuery('');
            }
          }}
        >
          <div className="mx-auto mt-16 max-w-xl border border-modiff-border bg-modiff-surface p-2 shadow-modiff-node">
            <div className="mb-2 flex items-center gap-2">
              <StudioTextInput
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands"
                className="flex-1"
              />
              <StudioIconButton title="Close command palette" onClick={() => setOpen(false)}>
                <X size={15} />
              </StudioIconButton>
            </div>
            <div className="grid gap-1">
              {filteredCommands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  disabled={command.disabled}
                  onClick={() => runCommand(command)}
                  className="flex items-center gap-2 border border-transparent px-2 py-2 text-left transition hover:border-hf-yellow hover:bg-modiff-bg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="grid size-7 shrink-0 place-items-center text-hf-yellow">{command.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-modiff-text">{command.label}</span>
                    <span className="block text-xs text-gray-400">{command.detail}</span>
                  </span>
                </button>
              ))}
              {filteredCommands.length === 0 && <p className="p-2 text-xs text-gray-400">No matching commands.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
