import { useEffect, useState, useMemo, useCallback } from 'react';
import config from '../../app.config';

import { FileJson2, Folder, FolderOpen, LoaderCircle, RotateCcw, Search } from 'lucide-react';
import { TreeButtonRow, TreeChildrenPanel, TreeStaticRow } from '../ui';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { workflowSnapshotFromGraph } from '../studio/workflowInference';
import { enqueueSnackbar } from '../ui/snackbar';
import { createLatestRequestGate, formatRequestError, requestJson, RequestError } from '../utils/requestJson';

export interface GraphData {
  isDir: boolean;
  path: string;
  name: string;
  children?: GraphData[];
}

const graphListRequestGate = createLatestRequestGate<'graphs'>();

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
  const [isLoading, setIsLoading] = useState(false);
  const [graphs, setGraphs] = useState<GraphData[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const edgeType = useSettingsStore((state) => state.edgeType);
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);

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

  // Fetch graphs on component mount
  useEffect(() => {
    fetchGraphs();
  }, [fetchGraphs]);

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

  const filteredGraphs = useMemo(() => {
    if (!search) {
      return visibleGraphs;
    }

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

    const allFiles = getAllFiles(visibleGraphs);
    return allFiles.filter((file) => file.name.toLowerCase().includes(search.toLowerCase()));
  }, [search, visibleGraphs]);

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

  const renderDir = (node: GraphData, level = 0) => {
    if (node.isDir && !search) {
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
          level={search ? 0 : level}
          className="group cursor-pointer hover:bg-white/10"
          onDoubleClick={() => {
            void openWorkflow(node);
          }}
          title="Double-click to open workflow as a new tab"
        >
          <FileJson2 size={15} className="shrink-0 text-gray-400 group-hover:text-hf-yellow" />
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
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded-modiff-compact text-gray-400 opacity-0 transition hover:bg-white/10 hover:text-hf-yellow group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
            title="Open workflow"
            aria-label={`Open ${node.name}`}
            onClick={() => {
              void openWorkflow(node);
            }}
          >
            <FileJson2 size={14} />
          </button>
        </TreeStaticRow>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-modiff-border bg-modiff-surface px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-bg text-hf-yellow">
              <Folder size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-modiff-text">Workflows</h2>
              <p className="truncate text-xs text-modiff-muted">Saved and example graphs</p>
            </div>
          </div>
        </div>
      </header>
      <div className="flex items-center gap-2 p-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text focus-within:border-hf-yellow">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-500"
          />
        </label>
        <button
          type="button"
          title="Reload graphs"
          disabled={isLoading}
          className="grid size-8 shrink-0 place-items-center rounded-modiff-compact text-hf-yellow transition hover:bg-white/10 hover:text-hf-orange disabled:pointer-events-none disabled:opacity-40"
          onClick={() => {
            fetchGraphs();
            setExpanded(new Set());
            setSearch('');
          }}
        >
          {isLoading ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={17} />}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-gray-400">Loading...</div>
      ) : (
        <div className="select-none" data-testid="workflow-list">
          {filteredGraphs.length > 0 ? (
            filteredGraphs.map((item) => renderDir(item, 0))
          ) : (
            <div className="m-2 rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-muted">
              No saved, imported, or example workflows found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GraphList;
