import { operationOwnsModel } from '../workflow/operationContracts';
import { lazy, Suspense, useId, useState, type ReactNode } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { ModiffTabs, StatusLine } from '../ui';
import { isFocusedGuidance } from '../workflow/encodingNodePresentation';

const NodeInspectionDetails = lazy(() => import('./NodeInspectionDetails'));
const OperationOwnerControls = lazy(() => import('./OperationOwnerControls'));
const GuidanceNodeControls = lazy(() => import('./GuidanceNodeControls'));

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
          <div className="grid gap-3">
            {node.data.blockInstanceV2 ||
            node.data.userBlockSnapshot ||
            node.data.userBlockId ||
            operationOwnsModel(node.data.operationAuthoring?.operation) ? (
              <Suspense fallback={<StatusLine>Loading model controls…</StatusLine>}>
                <OperationOwnerControls node={node} />
              </Suspense>
            ) : null}
            {isFocusedGuidance(node.data.blockInstanceV2) ? (
              <Suspense fallback={<StatusLine>Loading guidance controls…</StatusLine>}>
                <GuidanceNodeControls instance={node.data.blockInstanceV2!} />
              </Suspense>
            ) : (
              children
            )}
          </div>
        ) : (
          <Suspense fallback={<StatusLine>Loading node details…</StatusLine>}>
            <NodeInspectionDetails node={node} section={section} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
