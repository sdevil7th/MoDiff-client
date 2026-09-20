import { lazy, Suspense, useId, useState, type ReactNode } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { ModiffTabs, StatusLine } from '../ui';

const NodeInspectionDetails = lazy(() => import('./NodeInspectionDetails'));

export type NodeInspectorSection = 'parameters' | 'interface' | 'implementation' | 'docs' | 'run';
const sections: { value: NodeInspectorSection; label: string }[] = [
  { value: 'parameters', label: 'Parameters' },
  { value: 'interface', label: 'Interface' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'docs', label: 'Docs' },
  { value: 'run', label: 'Run details' },
];

/** One view of the selected canvas node; no separate settings or schema discovery. */
export default function NodeInspectorSections({ node, children }: { node: CustomNodeType; children: ReactNode }) {
  const [section, setSection] = useState<NodeInspectorSection>('parameters');
  const id = useId();
  return (
    <div className="grid min-w-0 gap-3">
      <ModiffTabs
        aria-label="Node inspector sections"
        className="flex-wrap"
        size="dense"
        value={section}
        onValueChange={setSection}
        options={sections.map((item) => ({ ...item, id: `${id}-${item.value}`, controls: `${id}-panel` }))}
      />
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${section}`} tabIndex={0}>
        {section === 'parameters' ? (
          children
        ) : (
          <Suspense fallback={<StatusLine>Loading node details…</StatusLine>}>
            <NodeInspectionDetails node={node} section={section} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
