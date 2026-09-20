import { ModiffCheckbox } from '../ui';
import { useNodeDiscoveryStore } from '../stores/useNodeDiscoveryStore';

export default function NodeDiscoveryFilters() {
  const view = useNodeDiscoveryStore((s) => s.view);
  const setView = useNodeDiscoveryStore((s) => s.setView);
  const implementation = view === 'advanced' || view === 'all';
  const experimental = view === 'experimental' || view === 'all';
  return (
    <div className="space-y-1 px-3 pb-2" role="group" aria-label="Node discovery options">
      <ModiffCheckbox
        label="Show implementation nodes"
        checked={implementation}
        onCheckedChange={(checked) =>
          setView(checked ? (experimental ? 'all' : 'advanced') : experimental ? 'experimental' : 'common')
        }
      />
      <ModiffCheckbox
        label="Show experimental nodes"
        checked={experimental}
        onCheckedChange={(checked) =>
          setView(checked ? (implementation ? 'all' : 'experimental') : implementation ? 'advanced' : 'common')
        }
      />
    </div>
  );
}
