import type { NodeParams } from '../stores/useNodeStore';
import type { BlockControlV2, BlockInstanceV2 } from '../studio/blockSchemaV2';
import { workflowTaskCategory } from './workflowTaskBrowser';
import {
  COMBINED_INPUT_PROVIDER,
  VISUAL_STAGE_PROVIDER,
  visualOperationStageKind,
  visualStageHasNestedStructure,
} from './visualOperationGroupProjection';

/** Scope by declared encoder tasks, not by model names or unrelated custom nodes. */
export function isFocusedImageEncoding(instance: BlockInstanceV2 | undefined) {
  if (
    !instance ||
    ![`${VISUAL_STAGE_PROVIDER}inputs`, COMBINED_INPUT_PROVIDER].includes(
      instance.definitionSnapshot.source.provider ?? '',
    )
  )
    return false;
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
  if (!instance) return false;
  const provider = instance?.definitionSnapshot.source.provider;
  if (provider !== `${VISUAL_STAGE_PROVIDER}guidance` && !isFocusedImageEncoding(instance)) return false;
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
  if (!instance?.effectiveGraph.nodes.length || visualStageHasNestedStructure(instance)) return false;
  const kind = visualOperationStageKind(instance);
  return Boolean(kind && (kind !== 'guidance' || isFocusedGuidance(instance)));
}

/** Old saved stages occasionally carried a Block's expanded flag. Only an explicit edit opens their operations. */
export function isStageEditorOpen(instance: BlockInstanceV2 | undefined): boolean {
  return Boolean(
    instance?.presentation?.stageEditorOpen && instance.presentation.expanded && visualOperationStageKind(instance),
  );
}

/** Rendering only: never remove a declared boundary or an existing connection. */
export function encodingVisibleConnectors(
  params: Record<string, NodeParams>,
  instance: BlockInstanceV2,
  showImplementation = false,
): Record<string, NodeParams> {
  const technical = new Map<string, { field: string; owner: string }>();
  const { inputs, outputs } = instance.effectiveInterface.boundary;
  for (const port of [...inputs.filter((input) => !input.required), ...outputs]) {
    const field = port.binding.fieldOrPortId;
    const node = instance.effectiveGraph.nodes.find((item) => item.nodeId === port.binding.nodeId);
    const guidance = (node?.data.operationAuthoring as { operation?: { nodeType?: string } } | undefined)?.operation
      ?.nodeType;
    if (
      field === 'doc' ||
      field === 'route_state_in' ||
      field === 'route_state_out' ||
      (field === 'layers' && guidance === 'guidance_layers')
    ) {
      technical.set(port.portId, { field, owner: String(node?.data.label || port.binding.nodeId) });
    }
  }
  const visible: Record<string, NodeParams> = {};
  for (const [id, param] of Object.entries(params)) {
    // Optional image encoding also supplies sockets before a real encoder exists in a text-only graph.
    const optional = param.fieldOptions?.encodingImplementationOutput;
    const port =
      technical.get(id) ?? (typeof optional === 'string' ? { field: optional, owner: 'Image encoder' } : undefined);
    if (port && !showImplementation && !param.isConnected) continue;
    visible[id] =
      port?.field === 'doc' && param.label === 'Doc' ? { ...param, label: `Documentation · ${port.owner}` } : param;
  }
  return visible;
}

/** EncodePrompt uses prompt_input ahead of prompt; preserve the local fallback. */
export function encodingControlParam(control: BlockControlV2, param: NodeParams, externalPrompt: boolean): NodeParams {
  return externalPrompt && control.binding.fieldId === 'prompt' ? { ...param, disabled: true } : param;
}
