import type { NodeChange } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';

type Change = NodeChange<CustomNodeType>;

/** Keep browser measurements out of ResizeObserver's synchronous delivery.
 * User gestures remain synchronous; ghost previews never enter persisted state.
 */
export function createNodeMeasurementDispatch(options: {
  apply: (changes: Change[]) => void;
  epoch: () => number;
  node: (id: string) => CustomNodeType | undefined;
  schedule: (callback: () => void) => number;
  cancel: (frame: number) => void;
}) {
  const pending = new Map<string, Change>();
  let frame: number | null = null;
  let epoch = options.epoch();
  const clear = () => {
    if (frame !== null) options.cancel(frame);
    frame = null;
    pending.clear();
  };
  return {
    clear,
    dispatch(changes: Change[]) {
      if (epoch !== options.epoch()) {
        clear();
        epoch = options.epoch();
      }
      const immediate: Change[] = [];
      const passiveBatch =
        changes.some((change) => change.type === 'dimensions' && change.resizing === undefined) &&
        changes.every(
          (change) =>
            (change.type === 'dimensions' && change.resizing === undefined) ||
            (change.type === 'position' && change.dragging === undefined),
        );
      for (const change of changes) {
        if (passiveBatch && 'id' in change) {
          if (options.node(change.id)) pending.set(`${change.id}:${change.type}`, change);
        } else {
          if ('id' in change)
            for (const [key, queued] of pending) {
              if ('id' in queued && queued.id === change.id) pending.delete(key);
            }
          immediate.push(change);
        }
      }
      if (immediate.length) options.apply(immediate);
      if (pending.size && frame === null)
        frame = options.schedule(() => {
          frame = null;
          const measurements =
            epoch === options.epoch()
              ? [...pending.values()].filter((change) => {
                  if (change.type === 'position') return Boolean(options.node(change.id));
                  if (change.type !== 'dimensions' || !change.dimensions) return false;
                  const node = options.node(change.id);
                  return (
                    node &&
                    (node.measured?.width !== change.dimensions.width ||
                      node.measured?.height !== change.dimensions.height ||
                      (change.setAttributes &&
                        (node.width !== change.dimensions.width || node.height !== change.dimensions.height)))
                  );
                })
              : [];
          pending.clear();
          if (measurements.length) options.apply(measurements);
        });
    },
  };
}
