// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { NodeData, useNodesStore } from '../stores/useNodeStore';

import { ModiffPopover, ModiffSearchInput } from '../ui';
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
  prepareOperationConnection,
  matchingNodeHandleForDrop,
  savedBlockSearchEntries,
} from '../workflow/nodeConnectionSearch';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { savedBlockMatchesSearch, type StoredUserBlockDefinition } from '../studio/userBlockLibrary';

type SearchEntry = {
  key: string;
  label: string;
  node?: NodeData;
  block?: StoredUserBlockDefinition;
  revision?: string;
  operation?: OperationContract;
};

interface NodeSearchDialogProps {
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  onSelect: (nodeKey: string, node: NodeData, block?: StoredUserBlockDefinition) => void;
  nodes: Record<string, NodeData>;
  dataType?: string | string[];
  handleType?: 'source' | 'target' | null | undefined;
}

const NodeSearchDialog = ({
  anchorPosition,
  onClose,
  onSelect,
  nodes,
  dataType,
  handleType,
}: NodeSearchDialogProps) => {
  const { pipeline, task, view, support } = useNodeDiscovery();
  const operations = useNodesStore((s) => s.operationContracts);
  const resolve = useNodesStore((s) => s.resolveOperation);
  const workflow = useStudioStore((s) => s.activeWorkflowTabId);
  const canvasEpoch = useStudioStore((s) => s.workflowCanvasEpoch);
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blocks = useUserBlockStore((state) => state.blocks);
  const definitions = useUserBlockStore((state) => state.blockDefinitionsV2);
  const loaded = useUserBlockStore((state) => state.loaded);
  const fetchBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const error = useUserBlockStore((state) => state.error);
  const savedEntries = useMemo(() => savedBlockSearchEntries([...definitions, ...blocks]), [definitions, blocks]);

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
  const filteredNodes = useMemo<SearchEntry[]>(
    () => [
      ...operationSearchEntries(operations, pipeline, task, dataType, handleType, searchQuery, nodes).map(
        (operation) => ({
          key: `operation:${operation.operationId}`,
          label: operationLabel(operation),
          operation,
        }),
      ),
      ...connectionSearchEntries(catalogNodes, dataType, handleType, searchQuery, view).map(([key, node]) => ({
        key,
        node,
        label: node.label,
      })),
      ...savedEntries
        .filter(
          ({ block, node }) =>
            savedBlockMatchesSearch(block, searchQuery) &&
            (!handleType || matchingNodeHandleForDrop(node, dataType, handleType)),
        )
        .map((entry) => ({ ...entry, label: entry.node.label })),
    ],
    [catalogNodes, operations, pipeline, task, view, dataType, handleType, searchQuery, savedEntries, nodes],
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

  const activeIndex = Math.min(selectedIndex, Math.max(0, filteredNodes.length - 1));

  const handleClose = useCallback(() => {
    pending.current?.abort();
    onClose();
    setTimeout(() => {
      setSearchQuery('');
      setSelectedIndex(0);
    }, 0);
  }, [onClose]);

  const selectEntry = useCallback(
    async (entry: SearchEntry) => {
      if (pending.current) return;
      if (!entry.operation) {
        if (entry.node) onSelect(entry.key, entry.node, entry.block);
        handleClose();
        return;
      }
      const request = new AbortController();
      const context = captureWorkflowOperationContext();
      const selection = useNodeDiscoveryStore.getState().selection;
      pending.current = request;
      setBusy(true);
      setResolutionError(null);
      try {
        const node = await resolve(entry.operation, request.signal);
        if (request.signal.aborted || useNodeDiscoveryStore.getState().selection !== selection) return;
        assertWorkflowOperationContext(context, { includeForm: false });
        onSelect(
          entry.operation.nodeKey,
          withOperationAuthoring(
            prepareOperationConnection(node, entry.operation, dataType, handleType),
            entry.operation,
          ),
        );
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
    [resolve, onSelect, handleClose, dataType, handleType],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (filteredNodes.length > 0) {
            setSelectedIndex((prev) => (prev + 1) % filteredNodes.length);
          }
          break;
        case 'ArrowUp':
          event.preventDefault();
          if (filteredNodes.length > 0) {
            setSelectedIndex((prev) => (prev - 1 + filteredNodes.length) % filteredNodes.length);
          }
          break;
        case 'Enter':
          if (filteredNodes[activeIndex]) {
            void selectEntry(filteredNodes[activeIndex]);
          }
          break;
        case 'Escape':
          handleClose();
          break;
      }
    },
    [filteredNodes, activeIndex, selectEntry, handleClose],
  );

  if (!anchorPosition) {
    return null;
  }

  return (
    <ModiffPopover
      anchor={anchorPosition}
      ariaLabel="Search nodes"
      closeOnOutside={false}
      gap={0}
      modal
      onClose={handleClose}
      open
      panelClassName="flex max-h-[512px] w-[368px] flex-col overflow-hidden border-4 border-modiff-bg bg-modiff-panel"
      placement="bottom-start"
    >
      <div className="shrink-0 p-2">
        <ModiffSearchInput
          ref={inputRef}
          aria-label="Search nodes"
          aria-activedescendant={filteredNodes[activeIndex] ? `node-search-${activeIndex}` : undefined}
          autoFocus
          placeholder="Search nodes and Saved Blocks"
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
      <OperationDiscoveryFields inPopover />
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

      {handleType ? (
        <p className="shrink-0 px-3 pb-2 text-xs text-modiff-subtle-text">
          {handleType === 'source' ? 'Nodes with compatible inputs' : 'Nodes with compatible outputs'}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto" role="listbox" aria-label="Matching nodes">
        {filteredNodes.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-modiff-text">
              {handleType ? 'No compatible nodes found' : 'No results found'}
            </div>
            <div className="text-xs text-modiff-subtle-text">
              {handleType ? 'Try another search or start from a different port.' : 'Try a different search query'}
            </div>
          </div>
        ) : (
          filteredNodes.map((entry, index) => (
            <GraphControlButton
              type="button"
              key={entry.key}
              id={`node-search-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void selectEntry(entry)}
              className={cx(
                'block w-full px-3 py-2 text-left transition hover:bg-modiff-surface-hover',
                index === activeIndex && 'bg-modiff-surface',
              )}
            >
              <div className="truncate text-sm text-modiff-text">{entry.label}</div>
              {entry.block ? (
                <div className="text-xs text-modiff-subtle-text">Saved Block · {entry.revision}</div>
              ) : null}
              {entry.operation ? (
                <div className="text-xs text-modiff-subtle-text">
                  {entry.operation.pipelineClass} · {entry.operation.task?.replace(/_/gu, ' ')}
                </div>
              ) : null}
              {entry.node?.description ? (
                <div className="truncate text-xs text-modiff-subtle-text">
                  {entry.node.description.substring(0, 72) + (entry.node.description.length > 72 ? '...' : '')}
                </div>
              ) : null}
            </GraphControlButton>
          ))
        )}
      </div>
    </ModiffPopover>
  );
};

export default NodeSearchDialog;
