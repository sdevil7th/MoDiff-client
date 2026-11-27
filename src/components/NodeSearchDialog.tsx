import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { nodeDisplayLabel } from '../workflow/nodePresentation';
import { representedStageOperations, visualStageMatches, type StageMatch } from '../studio/visualNodeCatalog';
import { operationsForTask } from '../workflow/operationCatalog';
// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { NodeData, useNodesStore } from '../stores/useNodeStore';

import { ModiffCheckbox, ModiffPopover, ModiffSearchInput } from '../ui';
import { GraphControlButton } from '../ui/GraphControls';
import NodeDiscoveryFilters from './NodeDiscoveryFilters';
import OperationDiscoveryFields from './OperationDiscoveryFields';
import { useNodeDiscovery, useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';
import {
  useStudioStore,
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
} from '../stores/useStudioStore';
import { runtimeCatalogNodes } from '../studio/nodeCatalog';
import type { OperationContract } from '../workflow/operationContracts';
import { operationLabel } from '../workflow/operationCatalog';
import { withOperationAuthoring } from '../workflow/operationAuthoring';
import { formatRequestError } from '../utils/requestJson';
import { cx } from '../utils/classNames';
import {
  connectionSearchEntries,
  operationSearchEntries,
  operationWirePort,
  wireOperationScope,
  prepareOperationConnection,
  stageOperationMatchesWire,
  rankConnectionSearchEntries,
  matchingNodeHandleForDrop,
  savedBlockSearchEntries,
} from '../workflow/nodeConnectionSearch';
import type { ConnectionSearchOrigin } from '../workflow/nodeConnectionMatching';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { savedBlockMatchesSearch, type StoredUserBlockDefinition } from '../studio/userBlockLibrary';
import type { NodeSearchFactory } from '../workflow/useWorkflowConnections';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { createStoredUserBlockNode } from '../studio/storedUserBlockInsertion';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import { useRegisteredBlockInterfacesStore } from '../stores/useRegisteredBlockInterfacesStore';
import { buildHuggingFaceCatalogSections, type HuggingFaceCatalogEntry } from '../studio/huggingFaceNodeCatalog';
import { catalogNodeSearchEntries, createCatalogSearchNode } from '../workflow/catalogNodeSearch';

type SearchEntry = {
  stage?: StageMatch;
  port?: string;
  key: string;
  label: string;
  node?: NodeData;
  block?: StoredUserBlockDefinition;
  revision?: string;
  operation?: OperationContract;
  catalog?: HuggingFaceCatalogEntry;
};

interface NodeSearchDialogProps {
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  onSelect: (
    createNode: NodeSearchFactory,
    signal: AbortSignal,
    allowUnverified: boolean,
    port?: string,
  ) => Promise<void>;
  nodes: Record<string, NodeData>;
  dataType?: string | string[];
  handleType?: 'source' | 'target' | null | undefined;
  origin?: ConnectionSearchOrigin;
}

const NodeSearchDialog = ({
  anchorPosition,
  onClose,
  onSelect,
  nodes,
  dataType,
  handleType,
  origin,
}: NodeSearchDialogProps) => {
  const discovery = useNodeDiscovery();
  const { view, support } = discovery;
  const operations = useNodesStore((s) => s.operationContracts);
  const inferred = useMemo(() => wireOperationScope(origin, operations), [origin, operations]);
  const pipeline = discovery.selection ? discovery.pipeline : (inferred?.pipeline ?? discovery.pipeline);
  const task = discovery.selection ? discovery.task : (inferred?.task ?? discovery.task);
  const originField = origin && nodeConnectorParam({ data: origin.node }, origin.handleId);
  const portLabel = originField?.label || origin?.handleId;
  const stageCatalog = useNodesStore((s) => s.visualNodeCatalog);
  const resolve = useNodesStore((s) => s.resolveOperation);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const canvasEpoch = useStudioStore((s) => s.workflowCanvasEpoch);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [builtInOpen, setBuiltInOpen] = useState(true);
  const [customOpen, setCustomOpen] = useState(true);
  const [browseBlocks, setBrowseBlocks] = useState(false);
  const [allowUnverified, setAllowUnverified] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blocks = useUserBlockStore((state) => state.blocks);
  const definitions = useUserBlockStore((state) => state.blockDefinitionsV2);
  const loaded = useUserBlockStore((state) => state.loaded);
  const fetchBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const error = useUserBlockStore((state) => state.error);
  const savedEntries = useMemo(() => savedBlockSearchEntries([...definitions, ...blocks]), [definitions, blocks]);

  const library = useHuggingFaceNodeLibraryStore((s) => s.library);
  const libraryLoaded = useHuggingFaceNodeLibraryStore((s) => s.loaded);
  const libraryError = useHuggingFaceNodeLibraryStore((s) => s.error);
  const fetchLibrary = useHuggingFaceNodeLibraryStore((s) => s.fetchLibrary);
  const snapshot = useHuggingFaceModularConditionalStore((s) => s.snapshot);
  const snapshotLoaded = useHuggingFaceModularConditionalStore((s) => s.loaded);
  const snapshotError = useHuggingFaceModularConditionalStore((s) => s.error);
  const fetchSnapshot = useHuggingFaceModularConditionalStore((s) => s.fetchSnapshot);
  const interfaces = useRegisteredBlockInterfacesStore((s) => s.entries);
  const interfacesLoaded = useRegisteredBlockInterfacesStore((s) => s.loaded);
  const interfacesError = useRegisteredBlockInterfacesStore((s) => s.error);
  const fetchInterfaces = useRegisteredBlockInterfacesStore((s) => s.fetch);
  const form = useStudioStore((s) => s.form);
  const catalogContext = useMemo(
    () => (library ? { library, snapshot, registry: nodes, form } : null),
    [library, snapshot, nodes, form],
  );
  const catalogSections = useMemo(
    () => (library ? buildHuggingFaceCatalogSections(library, snapshot) : []),
    [library, snapshot],
  );
  const catalogEntries = useMemo(
    () =>
      catalogContext
        ? catalogNodeSearchEntries(
            catalogSections,
            catalogContext,
            interfaces,
            searchQuery,
            view,
            dataType,
            handleType,
            allowUnverified,
          )
        : [],
    [catalogSections, catalogContext, interfaces, searchQuery, view, dataType, handleType, allowUnverified],
  );

  useEffect(() => {
    if (!libraryLoaded) void fetchLibrary();
  }, [libraryLoaded, fetchLibrary]);
  useEffect(() => {
    if (!snapshotLoaded) void fetchSnapshot();
  }, [snapshotLoaded, fetchSnapshot]);
  useEffect(() => {
    if (handleType && !interfacesLoaded) void fetchInterfaces();
  }, [handleType, interfacesLoaded, fetchInterfaces]);

  useEffect(() => {
    if (!loaded) void fetchBlocks();
  }, [loaded, fetchBlocks]);

  // Focus the input when the dialog opens
  useEffect(() => {
    if (anchorPosition) {
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 10);
      return () => clearTimeout(timer);
    }
  }, [anchorPosition]);

  const catalogNodes = useMemo(
    () => runtimeCatalogNodes(nodes, operations, support, view, { pipeline, task }),
    [nodes, operations, support, view, pipeline, task],
  );
  const browsingCommon = (view === 'common' || view === 'experimental') && !handleType && !searchQuery.trim();
  const filteredNodes = useMemo<SearchEntry[]>(() => {
    const stages = stageCatalog
      ? visualStageMatches(stageCatalog, nodes, searchQuery, {
          all: Boolean(handleType) || view === 'advanced' || view === 'all',
          targeted: Boolean(handleType),
          showModelHints: !handleType,
          operations: pipeline ? operationsForTask(operations, pipeline, task) : undefined,
          compatible: (node, op) =>
            !handleType ||
            (op
              ? stageOperationMatchesWire(node, op, dataType, handleType, origin, allowUnverified)
              : Boolean(matchingNodeHandleForDrop(node, dataType, handleType, origin, allowUnverified))),
        })
      : [];
    const represented = representedStageOperations(stages);
    const entries = [
      ...stages.flatMap((stage) => {
        // A wire can match more than one action in the same generic stage.
        // Preserve the search winner first and expose each other genuine choice.
        const choices = handleType
          ? [
              stage,
              ...stage.choices.filter(
                (choice) =>
                  (choice.mode !== stage.mode || choice.operation !== stage.operation) &&
                  (!searchQuery.trim() || choice.mode.label.toLowerCase().includes(searchQuery.trim().toLowerCase())),
              ),
            ]
          : [stage];
        return choices.map((choice) => ({
          stage: { ...stage, ...choice, detail: choice === stage ? stage.detail : choice.mode.label },
          key: ['stage', stage.stage.id, choice.mode.node, choice.mode.label, choice.operation?.operationId].join(':'),
          label: stage.stage.label,
          node: choice.definition,
          operation: choice.operation,
        }));
      }),
      ...operationSearchEntries(
        operations,
        pipeline,
        task,
        dataType,
        handleType,
        searchQuery,
        nodes,
        origin,
        allowUnverified,
      )
        .filter((operation) => !represented.has(operation))
        .map((operation) => ({
          key: `operation:${operation.operationId}`,
          label: operationLabel(operation),
          operation,
          node: nodes[operation.nodeKey],
        })),
      ...connectionSearchEntries(
        stageCatalog
          ? Object.fromEntries(Object.entries(catalogNodes).filter(([, node]) => node.module.startsWith('custom.')))
          : catalogNodes,
        dataType,
        handleType,
        searchQuery,
        view,
        origin,
        allowUnverified,
      ).map(([key, node]) => ({
        key,
        node,
        label: nodeDisplayLabel(node),
      })),
      ...(browsingCommon && !browseBlocks ? [] : catalogEntries).map((catalog) => ({
        key: `catalog:${catalog.id}`,
        label: catalog.label,
        catalog,
      })),
      ...savedEntries
        .filter(
          ({ block, node }) =>
            savedBlockMatchesSearch(block, searchQuery) &&
            (!handleType || matchingNodeHandleForDrop(node, dataType, handleType, origin, allowUnverified)),
        )
        .map((entry) => ({ ...entry, label: entry.node.label })),
    ];
    const pinned = entries.map((entry: SearchEntry) => ({
      ...entry,
      port: handleType
        ? entry.operation
          ? operationWirePort(entry.node, entry.operation, dataType, handleType, origin, allowUnverified)
          : entry.node && matchingNodeHandleForDrop(entry.node, dataType, handleType, origin, allowUnverified)?.[0]
        : undefined,
    }));
    return rankConnectionSearchEntries(pinned, dataType, handleType, origin);
  }, [
    stageCatalog,
    catalogNodes,
    operations,
    pipeline,
    task,
    view,
    dataType,
    handleType,
    searchQuery,
    savedEntries,
    nodes,
    catalogEntries,
    browsingCommon,
    browseBlocks,
    origin,
    allowUnverified,
  ]);

  const { builtInEntries, customEntries } = useMemo(() => {
    return {
      builtInEntries: filteredNodes.filter((entry) => !entry.node?.module.startsWith('custom.')),
      customEntries: filteredNodes.filter((entry) => entry.node?.module.startsWith('custom.')),
    };
  }, [filteredNodes]);
  const visibleEntries = useMemo(
    () => [...(builtInOpen ? builtInEntries : []), ...(customOpen ? customEntries : [])],
    [builtInEntries, builtInOpen, customEntries, customOpen],
  );

  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setResolutionError(null);
    return () => {
      pending.current?.abort();
    };
  }, [pipeline, task, view, workflow, canvasEpoch, anchorPosition]);

  const activeIndex = Math.min(selectedIndex, Math.max(0, visibleEntries.length - 1));

  const handleClose = useCallback(() => {
    pending.current?.abort();
    onClose();
    setTimeout(() => {
      setSearchQuery('');
      setBrowseBlocks(false);
      setSelectedIndex(0);
    }, 0);
  }, [onClose]);

  const selectEntry = useCallback(
    async (entry: SearchEntry) => {
      if (pending.current || entry.stage?.requiresModel) return;
      const request = new AbortController();
      const context = captureWorkflowOperationContext();
      const selection = useNodeDiscoveryStore.getState().selection;
      pending.current = request;
      setBusy(true);
      setResolutionError(null);
      try {
        let createNode: NodeSearchFactory;
        if (entry.operation) {
          const operation = entry.operation;
          const node = await resolve(operation, request.signal);
          const data = withOperationAuthoring(
            prepareOperationConnection(node, operation, dataType, handleType, entry.port),
            operation,
          );
          createNode = (position) =>
            createNodeFromRegistry(operation.nodeKey, { [operation.nodeKey]: data }, position)!;
        } else if (entry.catalog && catalogContext) {
          const catalog = entry.catalog;
          createNode = async (position) => {
            const node = await createCatalogSearchNode(catalog, catalogContext, position, request.signal);
            if (useHuggingFaceNodeLibraryStore.getState().library !== catalogContext.library)
              throw new Error('The catalog changed. Select the Block again.');
            return node;
          };
        } else if (entry.block) {
          const block = entry.block;
          createNode = (position) => createStoredUserBlockNode(block, position);
        } else if (entry.node) {
          const node = entry.node;
          const key = entry.stage?.mode.node ?? entry.key;
          createNode = (position) => createNodeFromRegistry(key, { [key]: node }, position)!;
        } else return;
        if (request.signal.aborted || useNodeDiscoveryStore.getState().selection !== selection) return;
        assertWorkflowOperationContext(context, { includeForm: Boolean(entry.operation && entry.stage && !selection) });
        await onSelect(createNode, request.signal, allowUnverified, entry.port);
        if (request.signal.aborted) return;
        handleClose();
      } catch (error) {
        if (!request.signal.aborted)
          setResolutionError(formatRequestError(error, 'Could not resolve the selected node.'));
      } finally {
        if (pending.current === request) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
    [resolve, onSelect, handleClose, dataType, handleType, catalogContext, allowUnverified],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (visibleEntries.length > 0) {
            setSelectedIndex((prev) => (prev + 1) % visibleEntries.length);
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (visibleEntries.length > 0) {
            setSelectedIndex((prev) => (prev - 1 + visibleEntries.length) % visibleEntries.length);
          }
          break;
        case 'Enter':
          if (visibleEntries[activeIndex]) {
            void selectEntry(visibleEntries[activeIndex]);
          }
          break;
        case 'Escape':
          handleClose();
          break;
      }
    },
    [visibleEntries, activeIndex, selectEntry, handleClose],
  );

  if (!anchorPosition) {
    return null;
  }

  const renderEntry = (entry: SearchEntry, index: number) => (
    <GraphControlButton
      type="button"
      key={entry.key}
      id={`node-search-${index}`}
      role="option"
      aria-selected={index === activeIndex}
      disabled={busy || entry.stage?.requiresModel}
      aria-busy={busy || undefined}
      onClick={() => void selectEntry(entry)}
      className={cx(
        'block w-full px-3 py-2 text-left transition hover:bg-modiff-surface-hover',
        index === activeIndex && 'bg-modiff-surface',
      )}
    >
      <div className="truncate text-sm text-modiff-text">{entry.label}</div>
      {entry.stage && <div className="break-words text-xs text-modiff-subtle-text">{entry.stage.detail}</div>}
      {entry.block ? <div className="text-xs text-modiff-subtle-text">Saved Block · {entry.revision}</div> : null}
      {entry.catalog ? (
        <div className="text-xs text-modiff-subtle-text">
          {entry.catalog.kind === 'cluster' ? 'Block' : 'Implementation'} · {entry.catalog.readinessLabel}
        </div>
      ) : null}
      {entry.operation ? (
        <div className="text-xs text-modiff-subtle-text">
          {entry.operation.pipelineClass} · {entry.operation.task?.replace(/_/gu, ' ')}
        </div>
      ) : null}
      {entry.port && (
        <div className="break-words text-xs text-modiff-subtle-text">
          {handleType === 'source' ? 'Input' : 'Output'} ·{' '}
          {entry.node?.params[entry.port]?.label || entry.port.replace(/_/gu, ' ')}
        </div>
      )}
      {!entry.stage && !entry.port && entry.node?.description ? (
        <div className="truncate text-xs text-modiff-subtle-text">
          {entry.node.description.substring(0, 72) + (entry.node.description.length > 72 ? '...' : '')}
        </div>
      ) : null}
    </GraphControlButton>
  );

  const sectionHeader = (label: string, count: number, open: boolean, toggle: () => void) => (
    <GraphControlButton
      type="button"
      aria-expanded={open}
      onClick={toggle}
      className="flex w-full shrink-0 items-center gap-2 border-b border-modiff-border px-3 py-2 text-left text-xs font-semibold text-modiff-text"
    >
      <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-modiff-subtle-text">{count}</span>
    </GraphControlButton>
  );

  return (
    <ModiffPopover
      anchor={anchorPosition}
      ariaLabel="Search nodes"
      closeOnOutside={false}
      gap={0}
      modal
      onClose={handleClose}
      open
      panelClassName="flex h-[min(512px,calc(100dvh-16px))] w-[368px] flex-col overflow-hidden border-4 border-modiff-bg bg-modiff-panel"
      placement="bottom-start"
    >
      {handleType && portLabel && (
        <div className="border-b border-modiff-border px-3 py-2">
          <p className="text-sm font-semibold text-modiff-text">
            {handleType === 'source' ? 'Connect output' : 'Connect input'} · {portLabel}
          </p>
          {dataType && <p className="break-words text-xs text-modiff-subtle-text">{[dataType].flat().join(' / ')}</p>}
        </div>
      )}
      <div className="shrink-0 p-2">
        <ModiffSearchInput
          ref={inputRef}
          aria-label="Search nodes"
          aria-activedescendant={visibleEntries[activeIndex] ? `node-search-${activeIndex}` : undefined}
          autoFocus
          placeholder="Search nodes and Blocks"
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          onClear={() => {
            setSearchQuery('');
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            handleKeyDown(event.nativeEvent as KeyboardEvent);
          }}
        />
      </div>

      <NodeDiscoveryFilters />
      {browsingCommon && catalogEntries.length > 0 ? (
        <div className="px-3 pb-2">
          <ModiffCheckbox
            label={`Include catalog Blocks (${catalogEntries.length})`}
            checked={browseBlocks}
            onCheckedChange={setBrowseBlocks}
          />
        </div>
      ) : null}
      <OperationDiscoveryFields inPopover inferred={inferred} />
      {resolutionError ? (
        <p role="alert" className="px-3 pb-2 text-xs text-modiff-text">
          {resolutionError}
        </p>
      ) : null}
      {!loaded ? (
        <p role="status" className="px-3 pb-2 text-xs text-modiff-subtle-text">
          Loading Saved Blocks…
        </p>
      ) : null}
      {error ? (
        <div role="status" className="px-3 pb-2 text-xs text-modiff-subtle-text">
          Saved Blocks could not be loaded.
          <GraphControlButton onClick={() => void fetchBlocks()}>Retry Saved Blocks</GraphControlButton>
        </div>
      ) : null}

      {!libraryLoaded || !snapshotLoaded || (handleType && !interfacesLoaded) ? (
        <p role="status" className="px-3 pb-2 text-xs text-modiff-subtle-text">
          Loading catalog Blocks…
        </p>
      ) : null}
      {libraryError || snapshotError || (handleType && interfacesError) ? (
        <div role="status" className="px-3 pb-2 text-xs text-modiff-subtle-text">
          Some catalog Blocks or compatible ports could not be loaded.
          <GraphControlButton
            onClick={() => {
              if (libraryError) void fetchLibrary();
              if (snapshotError) void fetchSnapshot();
              if (interfacesError) void fetchInterfaces();
            }}
          >
            Retry catalog
          </GraphControlButton>
        </div>
      ) : null}

      {handleType ? (
        <div className="shrink-0 px-3 pb-2 text-xs text-modiff-subtle-text">
          <ModiffCheckbox
            checked={allowUnverified}
            onCheckedChange={setAllowUnverified}
            label="Show unverified matches (generic or missing types)"
          />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" role="listbox" aria-label="Matching nodes">
        <section className={cx('flex min-h-0 flex-col', builtInOpen && builtInEntries.length ? 'flex-1' : 'shrink-0')}>
          {sectionHeader('Built-in nodes and Blocks', builtInEntries.length, builtInOpen, () => {
            setBuiltInOpen((open) => !open);
            setSelectedIndex(0);
          })}
          {builtInOpen ? (
            <div className={cx(builtInEntries.length ? 'min-h-0 flex-1 overflow-auto' : 'shrink-0')}>
              {builtInEntries.length ? (
                builtInEntries.map((entry, index) => renderEntry(entry, index))
              ) : customEntries.length ? null : (
                <div className="px-4 py-4 text-center">
                  <div className="text-sm font-semibold text-modiff-text">
                    {handleType ? 'No compatible nodes found' : 'No results found'}
                  </div>
                  <div className="text-xs text-modiff-subtle-text">
                    {searchQuery.trim()
                      ? 'Clear the search to see other matches.'
                      : handleType
                        ? pipeline
                          ? 'This model and task have no matching built-in port. Try another pipeline or an enabled custom node with the same socket type.'
                          : 'Choose a pipeline to check model-specific ports, or use an enabled custom node with the same socket type.'
                        : 'Try a different search query.'}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
        {customEntries.length > 0 && (
          <section className={cx('flex min-h-0 flex-col', customOpen && 'flex-1')}>
            {sectionHeader('Custom nodes', customEntries.length, customOpen, () => {
              setCustomOpen((open) => !open);
              setSelectedIndex(0);
            })}
            {customOpen ? (
              <div className="min-h-0 flex-1 overflow-auto">
                {customEntries.map((entry, index) =>
                  renderEntry(entry, (builtInOpen ? builtInEntries.length : 0) + index),
                )}
              </div>
            ) : null}
          </section>
        )}
      </div>
    </ModiffPopover>
  );
};

export default NodeSearchDialog;
