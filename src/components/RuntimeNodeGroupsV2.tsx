import { ChevronDown, Boxes, FlaskConical } from 'lucide-react';
import type { NodeCatalogEntry } from '../studio/nodeCatalog';
import { TreeButtonRow, TreeChildrenPanel } from '../ui';
import { cx } from '../utils/classNames';

export default function RuntimeNodeGroupsV2({
  entries,
  search,
  openGroups,
  toggle,
  insert,
}: {
  entries: NodeCatalogEntry[];
  search: string;
  openGroups: string[];
  toggle: (id: string) => void;
  insert: (key: string) => void;
}) {
  const groups = new Map<string, NodeCatalogEntry[]>();
  for (const entry of entries) {
    const role = entry.groupPath.slice(1).join(' / ') || 'Operations';
    groups.set(role, [...(groups.get(role) ?? []), entry]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, children]) => {
      const id = `runtime:${children[0]!.groupPath[0]}:${role}`;
      const open = Boolean(search.trim()) || openGroups.includes(id);
      return (
        <div key={id} data-testid={`node-subgroup-${id.replace(/[^a-zA-Z0-9]+/gu, '-')}`}>
          <TreeButtonRow
            level={1}
            aria-expanded={open}
            open={open}
            onClick={() => toggle(id)}
            className="min-h-9 justify-between font-medium"
          >
            <span className="min-w-0 truncate">{role}</span>
            <span className="flex items-center gap-2 text-xs text-modiff-subtle-text">
              {children.length}
              <ChevronDown size={14} className={cx('transition-transform', open && 'rotate-180')} />
            </span>
          </TreeButtonRow>
          {open ? (
            <TreeChildrenPanel level={2}>
              {[...children]
                .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
                .map((entry) => (
                  <TreeButtonRow
                    key={entry.key}
                    data-testid={`node-row-${entry.key.replace(/[^a-zA-Z0-9]+/gu, '-').replace(/^-|-$/gu, '')}`}
                    level={2}
                    draggable
                    onClick={() => insert(entry.dragKey)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', entry.dragKey);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    title={`${entry.node.label || entry.label} · ${entry.key}${entry.description ? `\n${entry.description}` : ''}`}
                    className="cursor-grab hover:bg-modiff-surface-hover"
                  >
                    {entry.visibility === 'experimental' ? (
                      <FlaskConical size={14} className="shrink-0 text-hf-yellow" />
                    ) : (
                      <Boxes size={14} className="shrink-0 text-hf-yellow" />
                    )}
                    <span className="min-w-0 flex-1 break-words">{entry.label}</span>
                  </TreeButtonRow>
                ))}
            </TreeChildrenPanel>
          ) : null}
        </div>
      );
    });
}
