import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NodeData } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useFlowStore } from '../stores/useFlowStore';
import { useUserBlockStore } from '../stores/useUserBlockStore';

import {
  Activity,
  Box as BoxIcon,
  Boxes,
  ChevronDown,
  FlaskConical,
  Filter,
  Image,
  LayoutGrid,
  Maximize,
  Search,
  Truck,
  Type,
  User,
  Webhook,
} from 'lucide-react';
import { cx } from '../utils/classNames';
import { TreeButtonRow, TreeChildrenPanel, TreeStaticRow } from '../ui';
import { createUserBlockNode, USER_BLOCK_DRAG_PREFIX } from '../studio/userBlocks';
import type { UserBlockDefinition } from '../studio/types';
import {
  compareNodeSurfaceCategories,
  nodeCatalogEntries,
  type NodeCatalogEntry,
  type NodeCatalogVisibility,
  type NodeSurfaceCategory,
} from '../studio/nodeCatalog';

type NodeCatalogView = 'essential' | 'advanced' | 'legacy';

function NodeList() {
  const { nodesRegistry } = useNodesStore();
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const addNode = useFlowStore((state) => state.addNode);
  const viewport = useFlowStore((state) => state.viewport);
  const nodeCount = useFlowStore((state) => state.nodes.length);
  const userBlocks = useUserBlockStore((state) => state.blocks);
  const userBlocksLoaded = useUserBlockStore((state) => state.loaded);
  const fetchUserBlocks = useUserBlockStore((state) => state.fetchBlocks);
  const [search, setSearch] = useState('');
  const [catalogView, setCatalogView] = useState<NodeCatalogView>(
    studioViewMode === 'expert' ? 'advanced' : 'essential',
  );
  const expertMode = studioViewMode === 'expert';

  useEffect(() => {
    setCatalogView(studioViewMode === 'expert' ? 'advanced' : 'essential');
  }, [studioViewMode]);

  useEffect(() => {
    if (!userBlocksLoaded) {
      void fetchUserBlocks();
    }
  }, [fetchUserBlocks, userBlocksLoaded]);

  const handleInsertUserBlock = useCallback(
    (block: UserBlockDefinition) => {
      addNode(createUserBlockNode(block, insertPositionForViewport(viewport, nodeCount)));
    },
    [addNode, nodeCount, viewport],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-modiff-border bg-modiff-surface px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-modiff-compact border border-modiff-border bg-modiff-bg text-hf-yellow">
              <Boxes size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-modiff-text">Nodes</h2>
              <p className="truncate text-xs text-modiff-muted">{Object.keys(nodesRegistry).length} available</p>
            </div>
          </div>
        </div>
      </header>
      <div className="p-2">
        <label className="flex h-8 items-center gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text focus-within:border-hf-yellow">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-500"
          />
        </label>
      </div>
      {expertMode ? (
        <div className="mb-0.5 grid grid-cols-3 gap-0 border-y border-modiff-border bg-modiff-surface p-0.5">
          <GroupByButton
            active={catalogView === 'essential'}
            onClick={() => setCatalogView('essential')}
            testId="node-browser-view-essential"
          >
            Essentials
          </GroupByButton>
          <GroupByButton
            active={catalogView === 'advanced'}
            onClick={() => setCatalogView('advanced')}
            testId="node-browser-view-advanced"
          >
            Advanced
          </GroupByButton>
          <GroupByButton
            active={catalogView === 'legacy'}
            onClick={() => setCatalogView('legacy')}
            testId="node-browser-view-legacy"
          >
            Legacy
          </GroupByButton>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 select-none overflow-y-auto p-1">
        <NodeGroupList
          nodes={nodesRegistry}
          search={search}
          view={expertMode ? catalogView : 'essential'}
          expertMode={expertMode}
          userBlocks={userBlocks}
          onInsertUserBlock={handleInsertUserBlock}
        />
      </div>
    </div>
  );
}

function insertPositionForViewport(viewport: ReturnType<typeof useFlowStore.getState>['viewport'], nodeCount: number) {
  const zoom = viewport.zoom || 1;
  const offset = (nodeCount % 6) * 36;
  return {
    x: (-viewport.x + 180 + offset) / zoom,
    y: (-viewport.y + 120 + offset) / zoom,
  };
}

function getIcon(category: string) {
  if (!category) category = 'default';
  switch (category.toLowerCase()) {
    case 'image':
      return <Image size={16} />;
    case 'edit':
    case 'editing':
      return <Filter size={16} />;
    case 'generate':
    case 'generation':
      return <Activity size={16} />;
    case 'condition':
    case 'conditioning':
      return <Webhook size={16} />;
    case 'preview':
      return <Image size={16} />;
    case 'export':
      return <Maximize size={16} />;
    case 'adapters':
      return <Webhook size={16} />;
    case 'audio':
      return <Activity size={16} />;
    case 'video':
      return <LayoutGrid size={16} />;
    case 'text':
      return <Type size={16} />;
    case 'primitive':
      return <BoxIcon size={16} />;
    case 'custom':
      return <User size={16} />;
    case 'load':
    case 'loader':
    case 'loaders':
      return <Truck size={16} />;
    case 'sampler':
      return <Activity size={16} />;
    case 'embedding':
      return <LayoutGrid size={16} />;
    case 'upscaler':
      return <Maximize size={16} />;
    case 'image_filter':
      return <Filter size={16} />;
    default:
      return <Webhook size={16} />;
  }
}

function entryMatchesView(entry: NodeCatalogEntry, view: NodeCatalogView) {
  if (entry.visibility === 'internal') return false;
  if (view === 'essential') return entry.visibility === 'essential';
  if (view === 'advanced') return entry.visibility === 'essential' || entry.visibility === 'advanced';
  return entry.visibility === 'legacy';
}

function entryMatchesSearch(entry: NodeCatalogEntry, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    entry.label,
    entry.description,
    entry.surfaceCategory,
    entry.node.label,
    entry.node.module,
    entry.node.action,
    entry.node.category,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

function visibilityLabel(visibility: NodeCatalogVisibility) {
  if (visibility === 'essential') return null;
  if (visibility === 'advanced') return 'Advanced';
  if (visibility === 'legacy') return 'Legacy';
  return 'Internal';
}

function normalizedTestId(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function NodeGroupList({
  nodes,
  search,
  view,
  expertMode,
  userBlocks,
  onInsertUserBlock,
}: {
  nodes: Record<string, NodeData>;
  search: string;
  view: NodeCatalogView;
  expertMode: boolean;
  userBlocks: UserBlockDefinition[];
  onInsertUserBlock: (block: UserBlockDefinition) => void;
}) {
  const { activeNodeGroups, setActiveNodeGroups } = useSettingsStore();

  const groups = useMemo(() => {
    return nodeCatalogEntries(nodes)
      .filter((entry) => entryMatchesView(entry, view))
      .filter((entry) => entryMatchesSearch(entry, search))
      .reduce(
        (acc, entry) => {
          const group = expertMode
            ? entry.node.category || entry.node.module || entry.surfaceCategory
            : entry.surfaceCategory;
          if (!acc[group]) {
            acc[group] = [];
          }
          acc[group].push(entry);
          return acc;
        },
        {} as Record<string, NodeCatalogEntry[]>,
      );
  }, [expertMode, nodes, search, view]);

  const orderedGroups = Object.entries(groups).sort(([left], [right]) =>
    expertMode
      ? left.localeCompare(right)
      : compareNodeSurfaceCategories(left as NodeSurfaceCategory, right as NodeSurfaceCategory),
  );
  const matchingUserBlocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return userBlocks;
    return userBlocks.filter((block) => `${block.name} ${block.id}`.toLowerCase().includes(query));
  }, [search, userBlocks]);
  const userBlocksOpen = activeNodeGroups.includes('User Nodes');

  return (
    <>
      {matchingUserBlocks.length > 0 ? (
        <div
          data-testid="node-group-User-Nodes"
          className={cx(
            'mb-1 rounded-modiff-compact border border-transparent transition-colors',
            userBlocksOpen && 'border-modiff-border bg-white/[0.04]',
          )}
        >
          <TreeButtonRow
            className="min-h-10 justify-between px-2 font-semibold"
            onClick={() => setActiveNodeGroups('User Nodes')}
            open={userBlocksOpen}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
                <Boxes size={15} />
              </span>
              <span className="min-w-0 truncate leading-none">User Nodes</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-muted">
                {matchingUserBlocks.length}
              </span>
              <ChevronDown
                size={16}
                className={cx('text-gray-400 transition-transform', userBlocksOpen && 'rotate-180')}
              />
            </span>
          </TreeButtonRow>
          {userBlocksOpen ? (
            <TreeChildrenPanel level={1}>
              {matchingUserBlocks.map((block) => (
                <TreeStaticRow
                  key={block.id}
                  data-testid={`user-block-row-${normalizedTestId(block.id)}`}
                  draggable
                  level={1}
                  role="button"
                  tabIndex={0}
                  title="Add block"
                  className="cursor-grab hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
                  onClick={() => onInsertUserBlock(block)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onInsertUserBlock(block);
                    }
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', `${USER_BLOCK_DRAG_PREFIX}${block.id}`);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
                    <Boxes size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{block.name}</span>
                </TreeStaticRow>
              ))}
            </TreeChildrenPanel>
          ) : null}
        </div>
      ) : null}
      {orderedGroups.length === 0 && matchingUserBlocks.length === 0 ? (
        <div className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-sm text-modiff-muted">
          No nodes match this view.
        </div>
      ) : (
        orderedGroups.map(([group, entries]) => {
          const isOpen = activeNodeGroups.includes(group);
          return (
            <div
              key={group}
              data-testid={`node-group-${normalizedTestId(group)}`}
              className={cx(
                'mb-1 rounded-modiff-compact border border-transparent transition-colors',
                isOpen && 'border-modiff-border bg-white/[0.04]',
              )}
            >
              <TreeButtonRow
                className="min-h-10 justify-between px-2 font-semibold"
                onClick={() => setActiveNodeGroups(group)}
                open={isOpen}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">{getIcon(group)}</span>
                  <span className="min-w-0 truncate leading-none">{group}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-muted">
                    {entries.length}
                  </span>
                  <ChevronDown size={16} className={cx('text-gray-400 transition-transform', isOpen && 'rotate-180')} />
                </span>
              </TreeButtonRow>
              {isOpen ? (
                <TreeChildrenPanel level={1}>
                  {[...entries]
                    .sort((a, b) =>
                      (expertMode ? a.node.label || a.key : a.label).localeCompare(
                        expertMode ? b.node.label || b.key : b.label,
                      ),
                    )
                    .map((entry) => {
                      const rowLabel = expertMode
                        ? entry.node.label || `${entry.node.module}.${entry.node.action}`
                        : entry.label;
                      return (
                        <TreeStaticRow
                          key={entry.key}
                          data-testid={`node-row-${normalizedTestId(entry.key)}`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', entry.dragKey);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          draggable
                          level={1}
                          title={entry.legacyReason || entry.description || `${entry.node.module}.${entry.node.action}`}
                          className={cx(`category-${entry.node.category}`, 'cursor-grab hover:bg-white/10')}
                        >
                          <span className="grid size-4 shrink-0 place-items-center text-hf-yellow">
                            {entry.runtimeKind === 'diffusers_accelerated' ? (
                              <Boxes size={15} />
                            ) : entry.visibility === 'legacy' ? (
                              <FlaskConical size={15} />
                            ) : (
                              getIcon(entry.surfaceCategory)
                            )}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{rowLabel}</span>
                          {visibilityLabel(entry.visibility) ? (
                            <span className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-1.5 py-0.5 text-xs font-semibold text-modiff-muted">
                              {visibilityLabel(entry.visibility)}
                            </span>
                          ) : null}
                        </TreeStaticRow>
                      );
                    })}
                </TreeChildrenPanel>
              ) : null}
            </div>
          );
        })
      )}
    </>
  );
}

function GroupByButton({
  active,
  children,
  onClick,
  testId,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={cx(
        'h-8 rounded-modiff-compact text-sm font-semibold transition',
        active ? 'bg-hf-yellow text-black' : 'text-gray-300 hover:bg-white/10 hover:text-white',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default NodeList;
