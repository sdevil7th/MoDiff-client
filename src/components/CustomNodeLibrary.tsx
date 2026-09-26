import { useEffect, useState } from 'react';
import { Boxes, ChevronDown } from 'lucide-react';
import { useNodesStore } from '../stores/useNodeStore';
import { ModiffButton, TreeButtonRow, TreeChildrenPanel } from '../ui';
import { cx } from '../utils/classNames';

/** Discovery reads files only; loading remains an explicit management action. */
export default function CustomNodeLibrary({
  search,
  insert,
  manage,
}: {
  search: string;
  insert: (key: string) => void;
  manage: () => void;
}) {
  const modules = useNodesStore((state) => state.customModules);
  const registry = useNodesStore((state) => state.nodesRegistry);
  const fetchModules = useNodesStore((state) => state.fetchCustomModules);
  const error = useNodesStore((state) => state.customModuleError);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        await fetchModules();
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchModules]);
  const needle = search.trim().toLowerCase();
  const open = expanded || Boolean(needle);
  const entries = Object.entries(registry).filter(
    ([key, node]) =>
      key.startsWith('custom.') &&
      modules.some((item) => item.enabled && key.startsWith(item.moduleKey + '.')) &&
      (!needle || `${node.label} ${key}`.toLowerCase().includes(needle)),
  );
  return (
    <section data-testid="node-group-custom-nodes" className="mb-2 rounded-modiff-compact border border-modiff-border">
      <TreeButtonRow
        aria-expanded={open}
        open={open}
        onClick={() => setExpanded(!expanded)}
        className="min-h-10 justify-between font-semibold"
      >
        <span className="flex items-center gap-2">
          <Boxes size={16} className="text-hf-yellow" />
          Custom nodes
        </span>
        <span className="flex items-center gap-2 text-xs text-modiff-subtle-text">
          {entries.length}
          <ChevronDown size={14} className={cx(open && 'rotate-180')} />
        </span>
      </TreeButtonRow>
      {open ? (
        <TreeChildrenPanel level={1}>
          {entries.map(([key, node]) => (
            <TreeButtonRow
              key={key}
              draggable
              level={1}
              onClick={() => insert(key)}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', key);
                event.dataTransfer.effectAllowed = 'move';
              }}
            >
              <span className="min-w-0 break-words">{node.label || node.action}</span>
            </TreeButtonRow>
          ))}
          {modules
            .filter((item) => !item.enabled && (!needle || item.name.toLowerCase().includes(needle)))
            .map((item) => (
              <TreeButtonRow
                key={item.name}
                level={1}
                onClick={manage}
                title={item.diagnostic ?? 'Load this source in Manage nodes'}
              >
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-xs text-modiff-subtle-text">
                  {item.status === 'disabled' && !item.approvedHash ? 'Not loaded' : item.status}
                </span>
              </TreeButtonRow>
            ))}
          {!modules.length ? (
            <p className="p-2 text-xs text-modiff-subtle-text">
              No custom nodes yet. Add a node or drop a Python node onto the canvas.
            </p>
          ) : null}
          {error ? (
            <p role="status" className="p-2 text-xs text-modiff-red">
              {error}
            </p>
          ) : null}
          <ModiffButton fullWidth tone="ghost" onClick={manage}>
            Manage nodes
          </ModiffButton>
        </TreeChildrenPanel>
      ) : null}
    </section>
  );
}
