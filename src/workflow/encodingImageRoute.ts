import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import type { OperationContract } from './operationContracts';
import type { PipelineSupport } from './operationCatalog';
import { isFocusedImageEncoding } from './encodingNodePresentation';

/** Select the smallest admitted extension of the existing task, not the first
 * image-consuming task. In particular retain ControlNet when already present,
 * never introduce it for an ordinary image input, and never require a new mask.
 * All stage identities and requiredness come from the backend contracts. */
export function optionalEncodingRoute(
  instance: BlockInstanceV2 | undefined,
  operations: OperationContract[],
  support: PipelineSupport[],
): OperationContract | null {
  if (!isFocusedImageEncoding(instance) || !instance) return null;
  if (instance.effectiveInterface.boundary.inputs.some((port) => port.valueType === 'image')) return null;
  const hints = instance.effectiveGraph.nodes.flatMap((stage) => {
    const hint = stage.data.operationAuthoring as { operation?: OperationContract } | undefined;
    return hint?.operation ? [hint.operation] : [];
  });
  const pipeline = hints[0]?.pipelineClass;
  if (!pipeline || hints.some((op) => op.pipelineClass !== pipeline)) return null;
  const current = operations.filter((op) => op.pipelineClass === pipeline && op.task === hints[0]?.task);
  const candidates = operations.flatMap((operation) => {
    if (
      operation.pipelineClass !== pipeline ||
      !operation.task ||
      operation.task.includes('video') ||
      !['vae_encoder', 'image_encoder'].includes(operation.nodeType) ||
      !operation.ports.some(
        (port) =>
          port.direction === 'input' && !port.hidden && port.semanticName === 'image' && port.types.includes('image'),
      ) ||
      !support.some(
        (item) =>
          item.pipelineClass === pipeline &&
          item.tasks.some(
            (task) =>
              task.task === operation.task &&
              task.execution === 'adapter' &&
              task.operationIds.includes(operation.operationId),
          ),
      )
    )
      return [];
    const route = operations.filter((op) => op.pipelineClass === pipeline && op.task === operation.task);
    if (current.some((op) => !route.some((next) => next.operationId === op.operationId))) return [];
    // Do not turn an image connection into a request for a mask/reference or any
    // other additional required media that the existing workflow did not need.
    if (
      route.some((op) =>
        op.ports.some(
          (port) =>
            port.direction === 'input' &&
            port.required &&
            !port.hidden &&
            port.types.includes('image') &&
            port.semanticName !== 'image' &&
            !current.some(
              (old) =>
                old.operationId === op.operationId &&
                old.ports.some((p) => p.direction === 'input' && p.required && p.semanticName === port.semanticName),
            ),
        ),
      )
    )
      return [];
    return [
      { operation, cost: route.filter((op) => !current.some((old) => old.operationId === op.operationId)).length },
    ];
  });
  const cost = Math.min(...candidates.map((item) => item.cost));
  const best = candidates.filter((item) => item.cost === cost);
  // Ambiguity is not permission to choose a different operation arbitrarily.
  return best.length === 1 ? best[0]!.operation : null;
}
