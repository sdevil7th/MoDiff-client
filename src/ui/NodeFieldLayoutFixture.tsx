import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import NodeContent from '../components/NodeContent';
import type { NodeParams } from '../stores/useNodeStore';

// Development-only visual fixture, mounted by the control matrix entry point.
// Uses the real NodeContent/NumberField/disclosure rather than copied markup.
export function NodeFieldLayoutFixture() {
  const [params, setParams] = useState<Record<string, NodeParams>>({
    prompt: { type: 'string', display: 'textarea', label: 'Prompt', value: 'Keep this prompt unchanged.' },
    max_sequence_length: {
      type: 'int',
      display: 'number',
      label: 'Maximum Sequence Length',
      value: 512,
      min: 1,
      max: 4096,
      fieldOptions: { controlTier: 'advanced' },
    },
  });
  return (
    <ReactFlowProvider>
      <main
        className="m-8 h-72 w-[300px] resize overflow-auto border border-modiff-border bg-modiff-surface p-3"
        data-testid="numeric-width-proof"
      >
        <NodeContent
          nodeId="numeric-width-proof"
          module="Proof"
          action="Numeric"
          params={params}
          updateStore={(key, value) => setParams((current) => ({ ...current, [key]: { ...current[key], value } }))}
        />
      </main>
    </ReactFlowProvider>
  );
}
