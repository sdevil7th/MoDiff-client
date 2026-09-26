import { useMemo, useState } from 'react';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { guidanceFields, updateGuidanceField } from '../workflow/guidanceNodeFields';
import NodeContent from './NodeContent';

export default function GuidanceNodeControls({ instance }: { instance: BlockInstanceV2 }) {
  const fields = useMemo(() => guidanceFields(instance), [instance]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="nodrag nowheel grid gap-2">
      <NodeContent
        nodeId={instance.instanceId}
        params={Object.fromEntries(fields.map((f) => [f.id, { ...f.param, disabled: busy || f.param.disabled }]))}
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
