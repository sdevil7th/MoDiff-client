import { useMemo, useState } from 'react';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore } from '../stores/useFlowStore';
import { visibleGuidanceFields, updateGuidanceField } from '../workflow/guidanceNodeFields';
import NodeContent from './NodeContent';

const advancedGuiderFields = new Set(['guidance_rescale', 'use_original_formulation', 'start', 'stop']);

export default function GuidanceNodeControls({
  instance,
  controlIdPrefix,
}: {
  instance: BlockInstanceV2;
  controlIdPrefix?: string;
}) {
  const outputs = useFlowStore(
    useShallow((s) =>
      s.edges
        .filter((edge) => edge.source === instance.instanceId && edge.sourceHandle)
        .map((edge) => edge.sourceHandle!),
    ),
  );
  const fields = useMemo(() => visibleGuidanceFields(instance, new Set(outputs)), [instance, outputs]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="nodrag nowheel grid gap-2">
      <NodeContent
        nodeId={instance.instanceId}
        controlIdPrefix={controlIdPrefix}
        params={Object.fromEntries(
          fields.map((f) => [
            f.id,
            {
              ...f.param,
              disabled: busy || f.param.disabled,
              ...(advancedGuiderFields.has(f.field) && !f.param.fieldOptions?.controlTier
                ? { fieldOptions: { ...f.param.fieldOptions, controlTier: 'advanced' } }
                : {}),
            },
          ]),
        )}
        module="MoDiff"
        action="Guidance"
        mode="controls"
        updateStore={(id, value, key) => {
          if (busy || (key && key !== 'value')) return;
          setBusy(true);
          setError(null);
          void updateGuidanceField(instance.instanceId, id, value)
            .catch((failure: unknown) => {
              setError(failure instanceof Error ? failure.message : 'Could not update Guidance.');
            })
            .finally(() => setBusy(false));
        }}
      />
      {busy ? (
        <p role="status" className="text-xs text-modiff-subtle-text">
          Updating guidance controls…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-modiff-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
