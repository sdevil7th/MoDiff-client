// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { NodeData } from '../stores/useNodeStore';

import { ModiffPopover, ModiffSearchInput } from '../ui';
import { GraphControlButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';
import { connectionSearchEntries } from '../workflow/nodeConnectionSearch';
import { matchesSearchKeywords } from '../utils/searchKeywords';

interface NodeSearchDialogProps {
  anchorPosition: { top: number; left: number } | null;
  onClose: () => void;
  onSelect: (nodeKey: string, node: NodeData) => void;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const dataTypeFilteredNodes = useMemo(
    () => connectionSearchEntries(nodes, dataType, handleType),
    [nodes, dataType, handleType],
  );

  // Apply search query filter directly to the memoized results
  const filteredNodes = dataTypeFilteredNodes.filter(([key, node]) =>
    matchesSearchKeywords(searchQuery, [key, node.label, node.description, node.module, node.action]),
  );

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(() => {
      setSearchQuery('');
      setSelectedIndex(0);
    }, 0);
  }, [onClose]);

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
          if (filteredNodes[selectedIndex]) {
            const [key, node] = filteredNodes[selectedIndex];
            onSelect(key, node);
          }
          handleClose();
          break;
        case 'Escape':
          handleClose();
          break;
      }
    },
    [filteredNodes, selectedIndex, onSelect, handleClose],
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
          aria-activedescendant={filteredNodes[selectedIndex] ? `node-search-${selectedIndex}` : undefined}
          autoFocus
          placeholder="Search nodes"
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
          filteredNodes.map(([key, node], index) => (
            <GraphControlButton
              type="button"
              key={key}
              id={`node-search-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              onClick={() => {
                onSelect(key, node);
                handleClose();
              }}
              className={cx(
                'block w-full px-3 py-2 text-left transition hover:bg-modiff-surface-hover',
                index === selectedIndex && 'bg-modiff-surface',
              )}
            >
              <div className="truncate text-sm text-modiff-text">{node.label}</div>
              {node.description ? (
                <div className="truncate text-xs text-modiff-subtle-text">
                  {node.description.substring(0, 72) + (node.description.length > 72 ? '...' : '')}
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
