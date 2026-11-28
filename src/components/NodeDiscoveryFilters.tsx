import { ModiffCheckbox } from '../ui';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';

export default function NodeDiscoveryFilters() {
  const view = useNodeDiscoveryStore((s) => s.view);
  const setView = useNodeDiscoveryStore((s) => s.setView);
  const implementation = view === 'advanced' || view === 'all';
  const experimental = view === 'experimental' || view === 'all';
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-2 pb-2" role="group" aria-label="Node discovery options">
      <ModiffCheckbox
        label="Implementation"
        aria-label="Show implementation nodes"
        title="Show individual implementation nodes"
        className="gap-1 text-xs"
        checked={implementation}
        onCheckedChange={(checked) =>
          setView(checked ? (experimental ? 'all' : 'advanced') : experimental ? 'experimental' : 'common')
        }
      />
      <ModiffCheckbox
        label="Experimental"
        aria-label="Show experimental nodes"
        title="Show experimental nodes"
        className="gap-1 text-xs"
        checked={experimental}
        onCheckedChange={(checked) =>
          setView(checked ? (implementation ? 'all' : 'experimental') : implementation ? 'advanced' : 'common')
        }
      />
    </div>
  );
}
