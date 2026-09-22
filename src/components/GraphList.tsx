// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useEffect, useState, useMemo, useCallback } from 'react';
import config from '../../app.config';

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileJson2,
  Folder,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  ModiffButton,
  ModiffIconButton,
  ModiffInput,
  ModiffMenuAction,
  ModiffMenuRoot,
  ModiffMenuSurface,
  ModiffMenuTrigger,
  ModiffSearchInput,
  ModiffSelect,
  TreeButtonRow,
  TreeChildrenPanel,
  TreeStaticRow,
} from '../ui';
import { GraphControlButton } from '../ui/GraphControls';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { workflowSnapshotFromGraph } from '../studio/workflowInference';
import { enqueueSnackbar } from '../ui/snackbar';
import { createLatestRequestGate, formatRequestError, requestJson, RequestError } from '../utils/requestJson';
import type { WorkflowTab } from '../studio/types';
import {
  backendWorkflowTab,
  deleteWorkflowNow,
  markWorkflowTabOpen,
  saveDetachedWorkflowNow,
} from '../studio/useWorkflowBackendSync';

export interface GraphData {
  isDir: boolean;
  path: string;
  name: string;
  children?: GraphData[];
  modelType?: string;
  mode?: string;
  mediaKind?: string;
  supportTier?: string;
  qualificationStatus?: string;
  requiredArtifacts?: string[];
}

const graphListRequestGate = createLatestRequestGate<'graphs'>();
const SAVED_WORKFLOWS_PAGE_SIZE = 50;

type SavedWorkflowSummary = Omit<WorkflowTab, 'snapshot'> & { snapshot?: WorkflowTab['snapshot'] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseGraphEntry(value: unknown, index: number): GraphData {
  if (
    !isRecord(value) ||
    typeof value.isDir !== 'boolean' ||
    typeof value.path !== 'string' ||
    typeof value.name !== 'string'
  ) {
    throw new Error(`Workflow entry ${index + 1} is invalid.`);
  }
  if (value.children !== undefined && !Array.isArray(value.children)) {
    throw new Error(`Workflow entry ${index + 1} has invalid children.`);
  }
  return {
    isDir: value.isDir,
    path: value.path,
    name: value.name,
    children: value.children?.map(parseGraphEntry),
    modelType: typeof value.modelType === 'string' ? value.modelType : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    mediaKind: typeof value.mediaKind === 'string' ? value.mediaKind : undefined,
    supportTier: typeof value.supportTier === 'string' ? value.supportTier : undefined,
    qualificationStatus: typeof value.qualificationStatus === 'string' ? value.qualificationStatus : undefined,
    requiredArtifacts: Array.isArray(value.requiredArtifacts)
      ? value.requiredArtifacts.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

function backendWorkflowSummary(value: unknown): SavedWorkflowSummary | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title : 'Workflow',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    dirty: false,
    source: typeof value.source === 'string' ? (value.source as WorkflowTab['source']) : 'manual',
    sourceLabel: typeof value.sourceLabel === 'string' ? value.sourceLabel : undefined,
    backendRevision: typeof value.revision === 'number' ? value.revision : 0,
  };
}

function parseGraphList(value: unknown) {
  if (!Array.isArray(value)) throw new Error('The workflow list response must be an array.');
  return value.map(parseGraphEntry);
}

const MODIFF_EXAMPLE_ROOTS = new Set(['modiff', 'modular_diffusers']);

function mergeMoDiffExampleRoots(graphs: GraphData[]) {
  const exampleRoots = graphs.filter((node) => node.isDir && MODIFF_EXAMPLE_ROOTS.has(node.name));
  if (exampleRoots.length === 0) return graphs;

  const mergedRoot: GraphData = {
    isDir: true,
    path: 'modiff_examples',
    name: 'MoDiff Examples',
    children: exampleRoots.flatMap((node) => node.children ?? []),
  };
  const firstIndex = graphs.findIndex((node) => node.isDir && MODIFF_EXAMPLE_ROOTS.has(node.name));
  const rest = graphs.filter((node) => !(node.isDir && MODIFF_EXAMPLE_ROOTS.has(node.name)));
  return [...rest.slice(0, Math.max(firstIndex, 0)), mergedRoot, ...rest.slice(Math.max(firstIndex, 0))];
}

function workflowTestId(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function GraphList() {
  const [libraryTab, setLibraryTab] = useState<'examples' | 'saved'>('examples');
  const [isLoading, setIsLoading] = useState(false);
  const [graphs, setGraphs] = useState<GraphData[]>([]);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflowSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [savedPage, setSavedPage] = useState(0);
  const [mediaFilter, setMediaFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [readinessFilter, setReadinessFilter] = useState('all');
  const edgeType = useSettingsStore((state) => state.edgeType);
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setAlertOpener = useSettingsStore((state) => state.setAlertOpener);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const workflowTabs = useStudioStore((state) => state.workflowTabs);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const switchWorkflowTab = useStudioStore((state) => state.switchWorkflowTab);
  const renameWorkflowTab = useStudioStore((state) => state.renameWorkflowTab);
  const mergeBackendWorkflow = useStudioStore((state) => state.mergeBackendWorkflow);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchGraphs = useCallback(async () => {
    const ticket = graphListRequestGate.begin('graphs');
    setIsLoading(true);
    try {
      const data = await requestJson(`${config.serverAddress}/listgraphs`, {
        signal: ticket.signal,
        parse: parseGraphList,
      });
      if (ticket.isLatest()) setGraphs(data);
    } catch (error) {
      if (ticket.isLatest()) console.error('Error fetching graphs:', error);
    } finally {
      if (ticket.isLatest()) setIsLoading(false);
      ticket.finish();
    }
  }, []);

  const fetchSavedWorkflows = useCallback(async () => {
    try {
      const payload = await requestJson<unknown>(`${config.serverAddress}/workflows?view=summary`);
      const records = isRecord(payload) && Array.isArray(payload.workflows) ? payload.workflows : [];
      setSavedWorkflows(records.map(backendWorkflowSummary).filter((tab): tab is SavedWorkflowSummary => Boolean(tab)));
    } catch (error) {
      console.warn('Could not refresh My workflows.', error);
    }
  }, []);

  // Fetch graphs on component mount
  useEffect(() => {
    fetchGraphs();
    void fetchSavedWorkflows();
  }, [fetchGraphs, fetchSavedWorkflows]);

  const toggleDir = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const visibleGraphs = useMemo(
    () => (studioViewMode === 'expert' ? graphs : mergeMoDiffExampleRoots(graphs)),
    [graphs, studioViewMode],
  );

  const allWorkflowFiles = useMemo(() => {
    const getAllFiles = (nodes: GraphData[]): GraphData[] => {
      const files: GraphData[] = [];
      const traverse = (node: GraphData) => {
        if (node.isDir) {
          if (node.children) {
            node.children.forEach(traverse);
          }
        } else {
          files.push(node);
        }
      };
      nodes.forEach(traverse);
      return files;
    };

    return getAllFiles(visibleGraphs);
  }, [visibleGraphs]);

  const filterOptions = useMemo(
    () => ({
      media: [...new Set(allWorkflowFiles.map((file) => file.mediaKind).filter(Boolean))] as string[],
      models: [...new Set(allWorkflowFiles.map((file) => file.modelType).filter(Boolean))] as string[],
      modes: [...new Set(allWorkflowFiles.map((file) => file.mode).filter(Boolean))] as string[],
    }),
    [allWorkflowFiles],
  );

  const filtersActive =
    search ||
    mediaFilter !== 'all' ||
    modelFilter !== 'all' ||
    modeFilter !== 'all' ||
    tierFilter !== 'all' ||
    readinessFilter !== 'all';
  const savedWorkflowRows = useMemo(() => {
    const byId = new Map<string, SavedWorkflowSummary>(savedWorkflows.map((tab) => [tab.id, tab]));
    workflowTabs.forEach((tab) => byId.set(tab.id, tab));
    return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [savedWorkflows, workflowTabs]);
  const visibleSavedWorkflowRows = savedWorkflowRows.filter((tab) =>
    tab.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  // Each row owns an accessible action menu. Mounting an unbounded library
  // makes unrelated graph edits and run feedback expensive to render.
  const lastSavedPage = Math.max(0, Math.ceil(visibleSavedWorkflowRows.length / SAVED_WORKFLOWS_PAGE_SIZE) - 1);
  const currentSavedPage = Math.min(savedPage, lastSavedPage);
  const savedOffset = currentSavedPage * SAVED_WORKFLOWS_PAGE_SIZE;
  const savedPageRows = visibleSavedWorkflowRows.slice(savedOffset, savedOffset + SAVED_WORKFLOWS_PAGE_SIZE);
  const filteredGraphs = useMemo(() => {
    if (!filtersActive) return visibleGraphs;
    return allWorkflowFiles.filter(
      (file) =>
        file.name.toLowerCase().includes(search.toLowerCase()) &&
        (mediaFilter === 'all' || file.mediaKind === mediaFilter) &&
        (modelFilter === 'all' || file.modelType === modelFilter) &&
        (modeFilter === 'all' || file.mode === modeFilter) &&
        (tierFilter === 'all' || file.supportTier === tierFilter) &&
        (readinessFilter === 'all' || file.qualificationStatus === readinessFilter),
    );
  }, [
    allWorkflowFiles,
    filtersActive,
    mediaFilter,
    modeFilter,
    modelFilter,
    readinessFilter,
    search,
    tierFilter,
    visibleGraphs,
  ]);

  const openWorkflow = useCallback(
    async (node: GraphData) => {
      if (node.isDir) return;
      try {
        const url = `${config.serverAddress}/file?file=${encodeURIComponent(node.path)}&t=${Date.now()}`;
        const graph = await requestJson<Record<string, unknown>>(url, {
          parse: (value) => {
            if (!isRecord(value)) throw new Error('The workflow file is not a JSON object.');
            if (value.error) {
              throw new RequestError(String(value.error), { kind: 'application', url, payload: value });
            }
            return value;
          },
        });
        createWorkflowTab(
          node.name || 'Imported graph',
          workflowSnapshotFromGraph(graph, edgeType, useStudioStore.getState().form),
          'import',
          node.path,
        );
        setRightPanelOpen(true);
        setRightPanelTab('studio');
        enqueueSnackbar('Workflow opened as a new tab', { variant: 'success', autoHideDuration: 2200 });
      } catch (error) {
        enqueueSnackbar(formatRequestError(error, 'Could not open the workflow.'), {
          variant: 'error',
          autoHideDuration: 6000,
        });
      }
    },
    [createWorkflowTab, edgeType, setRightPanelOpen, setRightPanelTab],
  );

  const fetchSavedWorkflow = useCallback(async (tab: SavedWorkflowSummary) => {
    if (tab.snapshot) return tab as WorkflowTab;
    const payload = await requestJson<unknown>(`${config.serverAddress}/workflows/${encodeURIComponent(tab.id)}`);
    const complete = backendWorkflowTab(payload);
    if (!complete) throw new Error(`MoDiff returned an invalid saved workflow for ${tab.title}.`);
    return complete;
  }, []);

  const duplicateSavedWorkflow = async (id: string) => {
    useStudioStore.getState().saveActiveWorkflowTab(true);
    const tab = savedWorkflowRows.find((item) => item.id === id);
    if (!tab) return;
    try {
      const complete = await fetchSavedWorkflow(tab);
      createWorkflowTab(`${complete.title} copy`, complete.snapshot, 'manual', complete.sourceLabel);
      enqueueSnackbar('Workflow duplicated', { variant: 'success', autoHideDuration: 2200 });
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, `Could not duplicate ${tab.title}.`), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    }
  };

  const exportSavedWorkflow = async (id: string) => {
    useStudioStore.getState().saveActiveWorkflowTab(true);
    const tab = savedWorkflowRows.find((item) => item.id === id);
    if (!tab) return;
    try {
      const complete = await fetchSavedWorkflow(tab);
      const blob = new Blob([JSON.stringify(complete.snapshot, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${complete.title.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'workflow'}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, `Could not export ${tab.title}.`), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    }
  };

  const deleteSavedWorkflow = (id: string) => {
    const tab = savedWorkflowRows.find((item) => item.id === id);
    if (!tab) return;
    setAlertOpener({
      title: 'Delete workflow?',
      message: `${tab.title}${tab.dirty ? ' has unsaved changes.' : ''} This removes it from My workflows.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: () => {
        void deleteWorkflowNow(id)
          .then(() => {
            setSavedWorkflows((current) => current.filter((item) => item.id !== id));
            enqueueSnackbar(`Deleted ${tab.title}`, { variant: 'success', autoHideDuration: 2200 });
          })
          .catch((error) => {
            enqueueSnackbar(formatRequestError(error, `Could not delete ${tab.title}.`), {
              variant: 'error',
              autoHideDuration: 6000,
            });
          });
        setAlertOpener(null);
      },
      onCancel: () => setAlertOpener(null),
    });
  };

  const openSavedWorkflow = async (tab: SavedWorkflowSummary) => {
    try {
      const complete = await fetchSavedWorkflow(tab);
      markWorkflowTabOpen(complete.id);
      if (!workflowTabs.some((item) => item.id === complete.id)) {
        mergeBackendWorkflow(complete);
      }
      switchWorkflowTab(complete.id);
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, `Could not open ${tab.title}.`), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    }
  };

  const renameSavedWorkflow = async (tab: SavedWorkflowSummary, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === tab.title) return;
    if (workflowTabs.some((item) => item.id === tab.id)) {
      renameWorkflowTab(tab.id, trimmed);
      return;
    }
    try {
      const complete = await fetchSavedWorkflow(tab);
      const saved = await saveDetachedWorkflowNow({ ...complete, title: trimmed, dirty: true });
      setSavedWorkflows((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      enqueueSnackbar(formatRequestError(error, `Could not rename ${tab.title}.`), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    }
  };

  const renderDir = (node: GraphData, level = 0) => {
    if (node.isDir && !filtersActive) {
      const isOpen = expanded.has(node.path);
      const children = node.children || [];
      return (
        <div key={node.path}>
          <TreeButtonRow
            data-testid={`workflow-source-${workflowTestId(node.name)}`}
            onClick={() => toggleDir(node.path)}
            level={level}
            open={isOpen}
          >
            {isOpen ? (
              <FolderOpen size={16} className="shrink-0 text-hf-yellow" />
            ) : (
              <Folder size={16} className="shrink-0 text-hf-yellow" />
            )}
            <span className="min-w-0 truncate">{node.name}</span>
          </TreeButtonRow>

          {isOpen ? (
            <TreeChildrenPanel level={level + 1}>
              {children.map((child) => renderDir(child, level + 1))}
            </TreeChildrenPanel>
          ) : null}
        </div>
      );
    } else if (!node.isDir) {
      return (
        <TreeStaticRow
          key={node.path}
          data-testid={`workflow-file-${workflowTestId(node.path)}`}
          level={filtersActive ? 0 : level}
          className="group cursor-pointer hover:bg-modiff-surface-hover"
          onDoubleClick={() => {
            void openWorkflow(node);
          }}
          title="Double-click to open workflow as a new tab"
        >
          <FileJson2 size={15} className="shrink-0 text-modiff-subtle-text group-hover:text-hf-yellow" />
          <span
            draggable
            className="min-w-0 flex-1 cursor-grab truncate"
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', node.path);
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            {node.name}
          </span>
          {node.mediaKind ? (
            <span className="text-modiff-tiny rounded bg-modiff-surface-hover/50 px-1.5 py-0.5 uppercase text-modiff-subtle-text">
              {node.mediaKind}
            </span>
          ) : null}
          <ModiffIconButton
            size="compact"
            className="text-modiff-subtle-text opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            label={`Open ${node.name}`}
            onClick={() => {
              void openWorkflow(node);
            }}
          >
            <FileJson2 size={14} />
          </ModiffIconButton>
        </TreeStaticRow>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <header className="border-b border-modiff-border bg-modiff-surface px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-bg text-hf-yellow">
              <Folder size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-modiff-text">Workflows</h2>
              <p className="truncate text-xs text-modiff-subtle-text">Saved and example graphs</p>
            </div>
          </div>
        </div>
      </header>
      <div className="flex flex-wrap gap-2 p-2">
        <ModiffButton tone="primary" onClick={() => useStudioStore.getState().createWorkflowTab('')}>
          New task workflow
        </ModiffButton>
        <ModiffButton aria-pressed={libraryTab === 'examples'} onClick={() => setLibraryTab('examples')}>
          Example workflows
        </ModiffButton>
        <ModiffButton aria-pressed={libraryTab === 'saved'} onClick={() => setLibraryTab('saved')}>
          My workflows
        </ModiffButton>
      </div>
      <div className="flex items-center gap-2 p-2">
        <ModiffSearchInput
          aria-label="Search workflows"
          className="min-w-0 flex-1"
          placeholder="Search workflows"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setSavedPage(0);
          }}
          onClear={() => {
            setSearch('');
            setSavedPage(0);
          }}
        />
        <ModiffIconButton
          label="Reload workflows"
          disabled={isLoading}
          className="text-hf-yellow hover:text-hf-orange"
          onClick={() => {
            void fetchGraphs();
            void fetchSavedWorkflows();
            setExpanded(new Set());
            setSearch('');
            setSavedPage(0);
            setMediaFilter('all');
            setModelFilter('all');
            setModeFilter('all');
            setTierFilter('all');
            setReadinessFilter('all');
          }}
        >
          {isLoading ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={17} />}
        </ModiffIconButton>
      </div>
      {libraryTab === 'saved' ? (
        <section
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
          data-testid="my-workflows"
        >
          <h3 className="text-modiff-label mb-1 px-1 font-semibold uppercase text-modiff-subtle-text">My workflows</h3>
          {lastSavedPage > 0 && (
            <div className="mb-1 flex min-w-0 items-center justify-between gap-1 text-xs text-modiff-subtle-text">
              <ModiffIconButton
                size="compact"
                label="Previous saved workflows"
                disabled={currentSavedPage === 0}
                onClick={() => setSavedPage(currentSavedPage - 1)}
              >
                <ChevronLeft size={14} />
              </ModiffIconButton>
              <span>
                {savedOffset + 1}–{savedOffset + savedPageRows.length} of {visibleSavedWorkflowRows.length}
              </span>
              <ModiffIconButton
                size="compact"
                label="Next saved workflows"
                disabled={currentSavedPage === lastSavedPage}
                onClick={() => setSavedPage(currentSavedPage + 1)}
              >
                <ChevronRight size={14} />
              </ModiffIconButton>
            </div>
          )}
          <div className="grid gap-1">
            {savedPageRows.map((tab) => (
              <div
                key={tab.id}
                className={`group flex min-h-8 min-w-0 items-center gap-1 overflow-hidden rounded-modiff-compact px-2 text-xs ${tab.id === activeWorkflowTabId ? 'bg-hf-yellow/10 text-hf-yellow' : 'text-modiff-text hover:bg-modiff-surface-hover/50'}`}
                data-testid={`saved-workflow-${tab.id}`}
              >
                <FileJson2 size={14} className="shrink-0" />
                {renamingTabId === tab.id ? (
                  <ModiffInput
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={() => {
                      void renameSavedWorkflow(tab, renameValue);
                      setRenamingTabId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                      if (event.key === 'Escape') setRenamingTabId(null);
                    }}
                    controlSize="compact"
                    className="nodrag nowheel min-w-0 flex-1 border-hf-yellow"
                  />
                ) : (
                  <GraphControlButton
                    type="button"
                    className="min-h-7 min-w-0 flex-1 truncate text-left"
                    onClick={() => void openSavedWorkflow(tab)}
                  >
                    {tab.dirty ? '* ' : ''}
                    {tab.title}
                  </GraphControlButton>
                )}
                <ModiffMenuRoot className="shrink-0">
                  <ModiffMenuTrigger>
                    <ModiffIconButton
                      size="compact"
                      label={`Actions for ${tab.title}`}
                      className="text-modiff-subtle-text hover:text-hf-yellow"
                    >
                      <MoreHorizontal size={14} />
                    </ModiffIconButton>
                  </ModiffMenuTrigger>
                  <ModiffMenuSurface anchor="bottom end" className="min-w-40">
                    <ModiffMenuAction
                      icon={<Pencil size={13} />}
                      onClick={() => {
                        setRenamingTabId(tab.id);
                        setRenameValue(tab.title);
                      }}
                    >
                      Rename
                    </ModiffMenuAction>
                    <ModiffMenuAction icon={<Copy size={13} />} onClick={() => void duplicateSavedWorkflow(tab.id)}>
                      Duplicate
                    </ModiffMenuAction>
                    <ModiffMenuAction icon={<Download size={13} />} onClick={() => void exportSavedWorkflow(tab.id)}>
                      Export
                    </ModiffMenuAction>
                    <ModiffMenuAction
                      tone="danger"
                      icon={<Trash2 size={13} />}
                      onClick={() => deleteSavedWorkflow(tab.id)}
                    >
                      Delete
                    </ModiffMenuAction>
                  </ModiffMenuSurface>
                </ModiffMenuRoot>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-1 px-2 pb-2">
            {[
              ['Media', mediaFilter, setMediaFilter, filterOptions.media],
              ['Model', modelFilter, setModelFilter, filterOptions.models],
              ['Mode', modeFilter, setModeFilter, filterOptions.modes],
              ['Tier', tierFilter, setTierFilter, ['supported', 'experimental']],
              [
                'Readiness',
                readinessFilter,
                setReadinessFilter,
                ['graph-qualified', 'runtime-qualified', 'unqualified'],
              ],
            ].map(([label, value, setter, options]) => (
              <div key={String(label)} className="min-w-0 text-modiff-label uppercase text-modiff-subtle-text">
                <span>{String(label)}</span>
                <ModiffSelect
                  aria-label={`Filter workflows by ${String(label).toLowerCase()}`}
                  value={String(value)}
                  onValueChange={setter as (next: string) => void}
                  options={[
                    { value: 'all', label: 'All' },
                    ...(options as string[]).sort().map((option) => ({
                      value: option,
                      label: option.replace(/_/g, ' '),
                    })),
                  ]}
                  size="compact"
                  className="mt-0.5 w-full normal-case"
                />
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="text-center text-sm text-modiff-subtle-text">Loading...</div>
          ) : (
            <div className="min-h-0 flex-1 select-none overflow-y-auto overscroll-contain" data-testid="workflow-list">
              {filteredGraphs.length > 0 ? (
                filteredGraphs.map((item) => renderDir(item, 0))
              ) : visibleSavedWorkflowRows.length === 0 ? (
                <div className="m-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-subtle-text">
                  No saved, imported, or example workflows found.
                </div>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default GraphList;
