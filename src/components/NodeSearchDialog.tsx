// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { NodeData } from '../stores/useNodeStore';

import { ModiffPopover, ModiffSearchInput } from '../ui';
import { GraphControlButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';

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

  // Memoize the data type filtering
  const dataTypeFilteredNodes = useMemo(() => {
    if (!dataType) {
      return Object.entries(nodes);
    }

    const dataTypes = Array.isArray(dataType) ? dataType : [dataType];

    return Object.entries(nodes).filter(([, node]) => {
      // Check if any param has display "input" and matches the dataType
      return Object.values(node.params).some((param) => {
        if (handleType === 'source' && param.display !== 'input') {
          return false;
        }

        if (handleType === 'target' && param.display !== 'output') {
          return false;
        }

        // Get the param type (could be string or array of strings)
        const paramType = param.type || 'default';
        const paramTypes = Array.isArray(paramType) ? paramType : [paramType];

        // Check if any of the param types match dataType or is "any"
        return (
          paramTypes.includes('any') || dataTypes.includes('any') || paramTypes.some((type) => dataTypes.includes(type))
        );
      });
    });
  }, [nodes, dataType, handleType]);

  // Apply search query filter directly to the memoized results
  const filteredNodes = dataTypeFilteredNodes.filter(
    ([, node]) =>
      node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.description ?? '').toLowerCase().includes(searchQuery.toLowerCase()),
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
      panelClassName="w-[368px] max-h-[512px] overflow-hidden border-4 border-modiff-bg bg-modiff-panel"
      placement="bottom-start"
    >
      <div className="p-2">
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

      <div className="max-h-[456px] overflow-auto" role="listbox" aria-label="Matching nodes">
        {filteredNodes.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <div className="text-sm font-semibold text-modiff-text">No results found</div>
            <div className="text-xs text-modiff-subtle-text">Try a different search query</div>
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
