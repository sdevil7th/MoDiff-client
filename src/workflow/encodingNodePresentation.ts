import type { NodeParams } from '../stores/useNodeStore';
import type { BlockControlV2, BlockInstanceV2, BlockPortV2 } from '../studio/blockSchemaV2';
import { workflowTaskCategory } from './workflowTaskBrowser';

/** Scope by declared encoder tasks, not by model names or unrelated custom nodes. */
export function isFocusedImageEncoding(instance: BlockInstanceV2 | undefined) {
  if (instance?.definitionSnapshot.source.provider !== 'modiff.visual-stages.v1/inputs') return false;
  const encoders = instance.effectiveGraph.nodes.flatMap((stage) => {
    const operation = (
      stage.data.operationAuthoring as { operation?: { task?: string; nodeType?: string } } | undefined
    )?.operation;
    return operation && ['text_encoder', 'vae_encoder', 'image_encoder'].includes(operation.nodeType ?? '')
      ? [operation]
      : [];
  });
  return Boolean(
    encoders.length &&
    encoders.every((operation) => operation.task && workflowTaskCategory(operation.task) === 'Image'),
  );
}

/** Only the approved image/audio Guidance recipe gets the ordinary node view. */
export function isFocusedGuidance(instance: BlockInstanceV2 | undefined) {
  if (instance?.definitionSnapshot.source.provider !== 'modiff.visual-stages.v1/guidance') return false;
  const stages = instance.effectiveGraph.nodes.flatMap((stage) => {
    const operation = (
      stage.data.operationAuthoring as { operation?: { task?: string; nodeType?: string } } | undefined
    )?.operation;
    return operation && ['guidance', 'guidance_layers'].includes(operation.nodeType ?? '') ? [operation] : [];
  });
  return (
    stages.length > 0 &&
    stages.every((stage) => stage.task && ['Image', 'Audio'].includes(workflowTaskCategory(stage.task)))
  );
}

export function isFocusedStageNode(instance: BlockInstanceV2 | undefined) {
  return isFocusedImageEncoding(instance) || isFocusedGuidance(instance);
}

/** Rendering only: never remove a declared boundary or an existing connection. */
export function encodingVisibleConnectors(params: Record<string, NodeParams>, outputs: BlockPortV2[]) {
  // All declared sockets stay available for drag-to-add discovery, including Doc.
  void outputs;
  return params;
}

/** EncodePrompt uses prompt_input ahead of prompt; preserve the local fallback. */
export function encodingControlParam(control: BlockControlV2, param: NodeParams, externalPrompt: boolean): NodeParams {
  return externalPrompt && control.binding.fieldId === 'prompt' ? { ...param, disabled: true } : param;
}
