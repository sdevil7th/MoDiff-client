import { nanoid } from 'nanoid';
import { collisionFreeInsertPosition } from './insertionPosition';
import { insertStageLeaves, visualStageSourceIndex } from '../studio/visualStageOrder';
import type { CustomNodeType } from '../stores/useFlowStore';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  canonicalBlockStringifyV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  normalizeBlockInstanceV2,
  type BlockControlV2,
  type BlockDefinitionV2,
  type BlockJsonObject,
  type BlockPortV2,
  type BlockPreviewBindingV2,
} from '../studio/blockSchemaV2';
import { blockProjectionNodeIdV2, createBlockRootNodeV2, parameterCustomizationState } from '../studio/blockRuntimeV2';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { declaredImagePipelineStageTail, operationScope } from './operationScope';
import { operationOwnsModel } from './operationContracts';
import { remapOperationAuthoring } from './operationSharedInputs';
import { workflowTaskCategory } from './workflowTaskBrowser';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { hasInlineScalarControl } from '../studio/inlineScalarControl';
import { groupStoryboardShots } from './storyboardShotPresentation';

import {
  visualOperationGroup,
  unpackVisualOperationGroups,
  VISUAL_STAGE_LABELS,
  visualStagePresentation,
  VISUAL_STAGE_PROVIDER as PROVIDER,
  COMBINED_INPUT_PROVIDER,
  type VisualOperationGroup,
} from './visualOperationGroupProjection';
export {
  visualOperationGroup,
  visualOperationOwnerId,
  unpackVisualOperationGroups,
  planVisualSharedInput,
  VISUAL_STAGE_LABELS,
  VISUAL_STAGE_NAMES,
  type VisualOperationGroup,
} from './visualOperationGroupProjection';

function stageKind(node: CustomNodeType): VisualOperationGroup | null {
  const operation = operationAuthoring(node)?.operation;
  if (
    !operation &&
    node.data.studioRole === 'guider' &&
    Object.values(node.data.params).some((param) => param.display === 'output' && param.type === 'custom_guider')
  )
    return 'guidance';
  if (!operation || !['block', 'bundle'].includes(operation.decomposition)) return null;
  if (['text_encoder', 'vae_encoder', 'image_encoder'].includes(operation.nodeType)) return 'inputs';
  if (
    ['Image', 'Video'].includes(workflowTaskCategory(operation.task ?? '')) &&
    ['before_encode', 'video_encoder', 'condition_encoder', 'reference_encoder'].includes(operation.nodeType)
  )
    return 'inputs';
  if (['guidance', 'guidance_layers'].includes(operation.nodeType)) return 'guidance';
  if (
    ['Image', 'Audio', 'Video'].includes(workflowTaskCategory(operation.task ?? '')) &&
    (operation.nodeType === 'decoder' || operation.operationId === 'diffusion.decode_latents') &&
    operation.ports.some(
      (port) =>
        port.direction === 'output' &&
        port.types.includes(
          workflowTaskCategory(operation.task ?? '') === 'Video'
            ? 'video'
            : workflowTaskCategory(operation.task ?? '') === 'Audio'
              ? 'audio'
              : 'image',
        ),
    )
  )
    return 'output';
  return null;
}

const nodeKey = (node: CustomNodeType) => `${node.data.module}.${node.data.action}`;
const SETUP_UTILITIES = new Set([
  'modules.ModularDiffusers.Lora',
  'modules.DiffusersImage.LoadAdapter',
  'modules.DiffusersAudio.LoadAdapter',
  'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  'modules.DiffusersRuntime.DiffusersExecutionRecipe',
]);

/** Typed, connected setup suppliers only. Sharing a supplier keeps it external.
 * This is presentation membership, never permission to load or execute it. */
function connectedSetupMembers(graph: OperationGraph, ownerId: string, scopeIds: ReadonlySet<string>) {
  const ordinary = graph.nodes.filter(
    (node) => !node.parentId && !node.data.blockInstanceV2 && !node.data.blockProjectionOwnerId,
  );
  const members = new Set([ownerId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of ordinary.filter((node) => SETUP_UTILITIES.has(nodeKey(node)) && !members.has(node.id))) {
      // Descriptor/configuration suppliers feed the loader; a whole-pipeline
      // adapter consumes its pipeline. Every edge must be a declared socket.
      const connected = graph.edges.some((edge) => {
        if (!(
          (members.has(edge.target) && edge.source === node.id) ||
          (members.has(edge.source) && edge.target === node.id)
        ))
          return false;
        const source = graph.nodes.find((n) => n.id === edge.source)?.data.params[edge.sourceHandle ?? ''];
        const target = graph.nodes.find((n) => n.id === edge.target)?.data.params[edge.targetHandle ?? ''];
        return (
          source?.display === 'output' &&
          Boolean(
            target &&
            (target.display === 'input' || target.isInput) &&
            connectionTypesAreCompatible(source.type, target.type),
          )
        );
      });
      if (connected) {
        members.add(node.id);
        changed = true;
      }
    }
  }
  // A descriptor/configuration output shared outside this setup stays external.
  // Prune backwards as well: an earlier adapter feeding that shared supplier
  // must not be swallowed by the loader's visual wrapper.
  changed = true;
  while (changed) {
    changed = false;
    for (const id of [...members].filter((id) => id !== ownerId)) {
      const node = ordinary.find((node) => node.id === id)!;
      const directAdapter = ['modules.DiffusersImage.LoadAdapter', 'modules.DiffusersAudio.LoadAdapter'].includes(
        nodeKey(node),
      );
      if (
        graph.edges.some(
          (edge) => edge.source === id && !members.has(edge.target) && !(directAdapter && scopeIds.has(edge.target)),
        )
      ) {
        members.delete(id);
        changed = true;
      }
    }
  }
  return ordinary.filter((node) => members.has(node.id));
}

/** Select existing, connected implementations only. Never manufacture a mask,
 * decoder or modifier from a model name, task label or repository. */
function operationStageMembers(
  graph: OperationGraph,
  ownerId: string,
  kind: VisualOperationGroup,
  combineGuidance = false,
) {
  const scope = operationScope(graph, ownerId);
  if (kind === 'inputs' && combineGuidance) {
    const ids = new Set(scope.map((node) => node.id));
    for (const node of graph.nodes) {
      if (
        ids.has(node.id) ||
        node.parentId ||
        node.data.blockInstanceV2 ||
        node.data.blockProjectionOwnerId ||
        operationAuthoring(node) ||
        stageKind(node) !== 'guidance'
      )
        continue;
      const outgoing = graph.edges.filter((edge) => edge.source === node.id);
      if (
        outgoing.length &&
        outgoing.every((edge) => {
          const from = node.data.params[edge.sourceHandle ?? ''];
          const to = scope.find((target) => target.id === edge.target)?.data.params[edge.targetHandle ?? ''];
          return (
            ids.has(edge.target) &&
            from?.display === 'output' &&
            from.type === 'custom_guider' &&
            to?.type === 'custom_guider' &&
            (to.display === 'input' || to.isInput)
          );
        }) &&
        !graph.edges.some((edge) => edge.target === node.id && !ids.has(edge.source))
      )
        scope.push(node);
    }
  }
  if (kind === 'inputs' || kind === 'guidance') {
    const members = scope.filter(
      (node) => stageKind(node) === kind || (kind === 'inputs' && combineGuidance && stageKind(node) === 'guidance'),
    );
    return kind === 'guidance' &&
      members.length > 1 &&
      !graph.edges.some(
        (edge) => members.some((node) => node.id === edge.source) && members.some((node) => node.id === edge.target),
      )
      ? []
      : members;
  }
  const ordinary = graph.nodes.filter(
    (node) => !node.parentId && !node.data.blockInstanceV2 && !node.data.blockProjectionOwnerId,
  );
  const scopeIds = new Set(scope.map((node) => node.id));
  const owner = scope.find((node) => node.id === ownerId)!;
  const category = workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '');
  if (!['Image', 'Audio', 'Video'].includes(category)) return [];
  if (category === 'Video' && ['imageInput', 'references'].includes(kind)) {
    const task = operationAuthoring(owner)!.operation.task;
    if ((kind === 'imageInput') !== ['image_to_video', 'image_to_video_with_audio'].includes(task ?? '')) return [];
    return ordinary.filter(
      (node) =>
        nodeKey(node) === 'modules.Image.Load' &&
        graph.edges.some(
          (edge) =>
            edge.source === node.id &&
            edge.sourceHandle === 'image' &&
            scopeIds.has(edge.target) &&
            (() => {
              const target = graph.nodes.find((candidate) => candidate.id === edge.target);
              const input = target?.data.params[edge.targetHandle ?? ''];
              return (
                input &&
                (input.display === 'input' || input.isInput) &&
                connectionTypesAreCompatible('image', input.type)
              );
            })(),
        ) &&
        graph.edges.filter((edge) => edge.source === node.id).every((edge) => scopeIds.has(edge.target)),
    );
  }
  if (category === 'Video' && kind === 'mask') {
    const canvases = ordinary.filter(
      (node) =>
        nodeKey(node) === 'modules.VideoConditioning.OutpaintCanvas' &&
        graph.edges.some(
          (edge) => edge.source === node.id && edge.sourceHandle === 'mask' && scopeIds.has(edge.target),
        ),
    );
    if (canvases.length === 1) return canvases;
    const pairs = ordinary.flatMap((align) => {
      if (
        nodeKey(align) !== 'modules.VideoConditioning.AlignMask' ||
        !graph.edges.some(
          (edge) =>
            edge.source === align.id &&
            edge.sourceHandle === 'output' &&
            scopeIds.has(edge.target) &&
            edge.targetHandle === 'mask',
        )
      )
        return [];
      const inputs = graph.edges.filter((edge) => edge.target === align.id && edge.targetHandle === 'mask');
      const load =
        inputs.length === 1 &&
        ordinary.find((node) => node.id === inputs[0]!.source && nodeKey(node) === 'modules.Video.Load');
      return load && graph.edges.filter((edge) => edge.source === load.id).every((edge) => edge.target === align.id)
        ? [[load, align]]
        : [];
    });
    return pairs.length === 1 ? pairs[0]! : [];
  }
  if (kind === 'videoInput' || kind === 'references') {
    const video = kind === 'videoInput';
    if (category !== (video ? 'Video' : 'Image')) return [];
    const media = video ? 'video' : 'image';
    const pairs = ordinary.flatMap((prepare) => {
      if (nodeKey(prepare) !== (video ? 'modules.VideoConditioning.Normalize' : 'modules.ImageOperations.StitchImages'))
        return [];
      const consumers = graph.edges.filter((edge) => edge.source === prepare.id);
      if (
        !consumers.length ||
        !consumers.every(
          (edge) =>
            scopeIds.has(edge.target) ||
            (video &&
              edge.targetHandle === 'video' &&
              ordinary.some(
                (node) =>
                  node.id === edge.target &&
                  ['modules.VideoConditioning.AlignMask', 'modules.VideoConditioning.OutpaintCanvas'].includes(
                    nodeKey(node),
                  ),
              )),
        ) ||
        !consumers.some((edge) => edge.sourceHandle === 'output' && edge.targetHandle === media)
      )
        return [];
      const sources = graph.edges.filter((edge) => edge.target === prepare.id && edge.targetHandle === media);
      const wire = sources[0];
      if (sources.length !== 1 || wire?.sourceHandle !== media) return [];
      const loader = ordinary.find(
        (node) => node.id === wire.source && nodeKey(node) === (video ? 'modules.Video.Load' : 'modules.Image.Load'),
      );
      if (!loader || graph.edges.some((edge) => edge.source === loader.id && edge.target !== prepare.id)) return [];
      return [[loader, prepare]];
    });
    return pairs.length === 1 ? pairs[0]! : [];
  }
  if (kind === 'generate') {
    const supplied = (target: string, port: string, source: string, field: string) => {
      const wires = graph.edges.filter((edge) => edge.target === target && edge.targetHandle === port);
      return wires.length === 1 && wires[0]!.source === source && wires[0]!.sourceHandle === field;
    };
    // A declared sampler and its adjacent state decoder form the same visible
    // Generate stage across modalities. Match the exact task, shared component
    // owner and typed state edge; model names do not determine membership.
    const ownerOperation = operationAuthoring(owner)?.operation;
    const declared = (node: CustomNodeType, nodeType: string) => {
      const operation = operationAuthoring(node)?.operation;
      return (
        operation?.nodeType === nodeType &&
        ['block', 'bundle'].includes(operation.decomposition) &&
        operation.pipelineClass === ownerOperation?.pipelineClass &&
        operation.task === ownerOperation?.task
      );
    };
    const nativePairs = scope
      .filter((node) => declared(node, 'denoise'))
      .flatMap((sampler) =>
        scope
          .filter(
            (node) =>
              (declared(node, 'decoder') || declared(node, 'decode')) &&
              sampler.data.params.state_out?.type === 'modular_workflow_state' &&
              node.data.params.state_in?.type === 'modular_workflow_state' &&
              supplied(sampler.id, 'pipeline_components', ownerId, 'pipeline_components') &&
              supplied(node.id, 'pipeline_components', ownerId, 'pipeline_components') &&
              supplied(node.id, 'state_in', sampler.id, 'state_out'),
          )
          .map((decoder) => [sampler, decoder]),
      );
    if (nativePairs.length) return nativePairs.length === 1 ? nativePairs[0]! : [];
    if (category === 'Image') {
      const denoise = scope.find((node) => nodeKey(node) === 'modules.ModularDiffusers.WorkflowImageDenoise');
      const decode = scope.find((node) => nodeKey(node) === 'modules.ModularDiffusers.WorkflowDecodeImage');
      if (
        denoise &&
        decode &&
        supplied(denoise.id, 'pipeline_components', ownerId, 'pipeline_components') &&
        supplied(decode.id, 'pipeline_components', ownerId, 'pipeline_components') &&
        supplied(decode.id, 'state_in', denoise.id, 'state_out')
      )
        return [denoise, decode];
      // Retained component-based image recipes use the same visible Generate
      // stage. Fold only one real sampler/decoder pair owned by this loader.
      const pairs = scope
        .filter((node) => nodeKey(node) === 'modules.ModularDiffusers.Denoise')
        .flatMap((sampler) =>
          scope
            .filter((node) => nodeKey(node) === 'modules.ModularDiffusers.DecodeLatents')
            .filter(
              (decoder) =>
                supplied(sampler.id, 'unet', ownerId, 'unet_out') &&
                supplied(sampler.id, 'scheduler', ownerId, 'scheduler') &&
                supplied(decoder.id, 'vae', ownerId, 'vae_out') &&
                supplied(decoder.id, 'latents', sampler.id, 'latents'),
            )
            .map((decoder) => [sampler, decoder]),
        );
      if (pairs.length) return pairs.length === 1 ? pairs[0]! : [];
      const sampler = scope.find((node) => nodeKey(node) === 'modules.DiffusersImage.Denoise');
      const decoder = scope.find((node) => nodeKey(node) === 'modules.DiffusersImage.DecodeLatents');
      const pipelines = graph.edges.filter((edge) => edge.target === sampler?.id && edge.targetHandle === 'pipeline');
      if (!sampler || !decoder || pipelines.length !== 1) return [];
      const source = pipelines[0]!;
      const tail = declaredImagePipelineStageTail(
        graph,
        ownerId,
        graph.edges.filter((edge) => edge.source === source.source && edge.sourceHandle === source.sourceHandle),
      );
      return tail?.some((node) => node.id === sampler.id) && tail.some((node) => node.id === decoder.id)
        ? [sampler, decoder]
        : [];
    }
    const rendered = scope.find(
      (node) =>
        nodeKey(node) === 'modules.DiffusersVideo.Generate' &&
        operationAuthoring(node)?.operation.nodeType === 'denoise',
    );
    const encoding = scope.find((node) => nodeKey(node) === 'modules.DiffusersVideo.EncodeInputs');
    if (
      category === 'Video' &&
      rendered &&
      encoding &&
      supplied(rendered.id, 'pipeline', ownerId, 'pipeline') &&
      supplied(rendered.id, 'encoded_inputs', encoding.id, 'encoded_inputs')
    )
      return [rendered];
    const denoise = scope.find((node) => nodeKey(node) === 'modules.DiffusersVideo.Denoise');
    const decode = scope.find(
      (node) => nodeKey(node) === 'modules.DiffusersVideo.DecodeLatents' && stageKind(node) === 'output',
    );
    if (category !== 'Video' || !denoise || !decode) return [];
    return supplied(denoise.id, 'pipeline', ownerId, 'pipeline') &&
      supplied(decode.id, 'pipeline', ownerId, 'pipeline') &&
      supplied(decode.id, 'latents', denoise.id, 'latents_out') &&
      supplied(decode.id, 'latent_binding', denoise.id, 'latent_binding')
      ? [denoise, decode]
      : [];
  }
  if (
    category === 'Audio' &&
    kind !== 'output' &&
    !(
      kind === 'setup' &&
      nodeKey(owner) === 'modules.DiffusersAudio.LoadPipeline' &&
      owner.data.params.pipeline?.type === 'audio_diffusion_pipeline'
    )
  )
    return [];
  if (kind === 'setup') {
    if (operationAuthoring(owner)?.operation.decomposition === 'integrated') return [];
    return connectedSetupMembers(graph, ownerId, scopeIds);
  }
  if (kind === 'output') {
    const decoders = scope.filter(
      (node) =>
        stageKind(node) === 'output' ||
        (category === 'Video' &&
          nodeKey(node) === 'modules.DiffusersVideo.Generate' &&
          operationAuthoring(node)?.operation.nodeType === 'denoise'),
    );
    const members = new Set<string>();
    for (const decoder of decoders) {
      const media = category === 'Video' ? 'video' : category === 'Audio' ? 'audio' : 'image';
      const outputs = operationAuthoring(decoder)!.operation.ports.filter(
        (port) => port.direction === 'output' && port.types.includes(media),
      );
      const previews = ordinary.filter(
        (node) =>
          (media === 'video'
            ? ['modules.Video.Export', 'modules.Video.ExportWithAudio', 'modules.Video.ExportAsset'].includes(
                nodeKey(node),
              )
            : nodeKey(node) === (media === 'audio' ? 'modules.Audio.Export' : 'modules.Image.Preview')) &&
          node.data.params.preview?.display === `ui_${media}` &&
          (media === 'image' ||
            (node.data.params.preview.dataSource === 'file' &&
              node.data.params.file?.display === 'output' &&
              node.data.params.file.type === media)) &&
          (nodeKey(node) !== 'modules.Video.ExportWithAudio' ||
            (graph.edges.filter((edge) => edge.target === node.id && edge.targetHandle === 'audio').length === 1 &&
              graph.edges.some(
                (edge) =>
                  edge.target === node.id &&
                  edge.targetHandle === 'audio' &&
                  edge.source === decoder.id &&
                  operationAuthoring(decoder)!.operation.ports.some(
                    (port) =>
                      port.direction === 'output' && port.types.includes('audio') && port.name === edge.sourceHandle,
                  ),
              ))) &&
          graph.edges.filter((edge) => edge.target === node.id && edge.targetHandle === media).length === 1 &&
          graph.edges.some(
            (edge) =>
              edge.source === decoder.id &&
              outputs.some((port) => edge.sourceHandle === port.name) &&
              edge.target === node.id &&
              edge.targetHandle === media,
          ),
      );
      if (previews.length) {
        members.add(decoder.id);
        for (const preview of previews) members.add(preview.id);
      }
    }
    return ordinary.filter((node) => members.has(node.id));
  }
  if (kind !== 'mask' || category !== 'Image') return [];
  const task = operationAuthoring(owner)!.operation.task;
  if (!['inpaint', 'outpaint'].includes(task ?? '')) return [];
  const members = new Set<string>();
  for (const canvas of ordinary.filter((node) => nodeKey(node) === 'modules.DiffusersImage.OutpaintCanvas')) {
    const image = graph.edges.find(
      (edge) =>
        edge.source === canvas.id &&
        edge.sourceHandle === 'canvas' &&
        scopeIds.has(edge.target) &&
        edge.targetHandle === 'image',
    );
    const mask =
      image &&
      graph.edges.some(
        (edge) =>
          edge.source === canvas.id &&
          edge.sourceHandle === 'mask_image' &&
          edge.target === image.target &&
          edge.targetHandle === 'mask_image',
      );
    const source = graph.edges.find(
      (edge) => edge.target === canvas.id && edge.targetHandle === 'image' && edge.sourceHandle === 'image',
    );
    const loader =
      source && ordinary.find((node) => node.id === source.source && nodeKey(node) === 'modules.Image.Load');
    if (
      mask &&
      loader &&
      !graph.edges.some(
        (edge) =>
          (edge.source === loader.id && edge.target !== canvas.id) ||
          (edge.source === canvas.id && !scopeIds.has(edge.target)),
      )
    ) {
      members.add(canvas.id);
      members.add(loader.id);
    }
  }
  return ordinary.filter((node) => members.has(node.id));
}

export function availableOperationStageGroups(graph: OperationGraph, ownerId: string): VisualOperationGroup[] {
  const unpacked = unpackVisualOperationGroups(graph);
  const grouped = new Set([...unpacked.members.values()].flat());
  return (Object.keys(VISUAL_STAGE_LABELS) as VisualOperationGroup[]).filter((kind) => {
    const members = operationStageMembers(unpacked.graph, ownerId, kind);
    return members.length > 0 && members.every((node) => !grouped.has(node.id));
  });
}

/** Shared authoring uses the same diagnosed membership as the visible grouper. */
export function operationStageMemberIds(graph: OperationGraph, ownerId: string, kind: VisualOperationGroup) {
  return operationStageMembers(graph, ownerId, kind).map((node) => node.id);
}

/** Compose ordinary leaves into the existing V2 contract; no library write. */
function sharedModelInput(port: BlockPortV2) {
  return (
    (port.binding.fieldOrPortId === 'pipeline_components' &&
      port.valueType === 'diffusers_modular_pipeline_components') ||
    (port.binding.fieldOrPortId === 'pipeline' &&
      ['image_diffusion_pipeline', 'video_diffusion_pipeline', 'audio_diffusion_pipeline'].includes(port.valueType))
  );
}

function retainsGeneratedModelBindings(
  port: BlockPortV2,
  definition: BlockDefinitionV2,
  effectiveGraph: BlockDefinitionV2['graph'],
) {
  if (!sharedModelInput(port) || !port.mirrorBindings?.length) return false;
  const fields = [port.binding, ...port.mirrorBindings];
  if (fields.some((binding) => binding.fieldOrPortId !== port.binding.fieldOrPortId)) return false;
  const original = definition.boundary.inputs
    .filter((input) => input.valueType === port.valueType && input.binding.fieldOrPortId === port.binding.fieldOrPortId)
    .flatMap((input) => [input.binding, ...(input.mirrorBindings ?? [])]);
  const identity = (bindings: typeof fields) => bindings.map((binding) => canonicalBlockStringifyV2(binding)).sort();
  const matches = (bindings: typeof fields) =>
    canonicalBlockStringifyV2(identity(fields)) === canonicalBlockStringifyV2(identity(bindings));
  if (matches(original)) return true;
  // A task change can add native encoders while preserving the original saved
  // definition. Admit only the complete typed model-input census of one declared
  // task, never an arbitrary or partial custom mirror.
  if (!definition.source.provider?.startsWith(PROVIDER)) return false;
  const consumers = effectiveGraph.nodes.filter((node) => {
    const parameter = (node.data.params as CustomNodeType['data']['params'])?.[port.binding.fieldOrPortId];
    return (
      parameter?.type === port.valueType &&
      (parameter.display === 'input' || parameter.isInput) &&
      !effectiveGraph.edges.some(
        (edge) => edge.targetNodeId === node.nodeId && edge.targetPortId === port.binding.fieldOrPortId,
      )
    );
  });
  // Inspect the validated hint only; this does not construct or execute a node.
  const declared = consumers.map(
    (node) => operationAuthoring({ data: node.data } as unknown as CustomNodeType)?.operation,
  );
  return (
    consumers.length > 1 &&
    declared.every(
      (operation) =>
        operation &&
        ['block', 'bundle'].includes(operation.decomposition) &&
        operation.pipelineClass === declared[0]?.pipelineClass &&
        operation.task === declared[0]?.task,
    ) &&
    matches(consumers.map((node) => ({ nodeId: node.nodeId, fieldOrPortId: port.binding.fieldOrPortId })))
  );
}

export function groupVisualStages(
  graph: OperationGraph,
  memberIds: readonly string[],
  kind: VisualOperationGroup,
  previous?: CustomNodeType,
  options: {
    combineGuidance?: boolean;
    newDefinition?: boolean;
    implicitScalarControlNodeIds?: readonly string[];
  } = {},
): OperationGraph {
  const selected = new Set(memberIds);
  const members = graph.nodes.filter((node) => selected.has(node.id));
  if (!members.length) return graph;
  if (
    members.length !== selected.size ||
    members.some((node) => node.parentId || node.data.blockInstanceV2 || node.data.blockProjectionOwnerId)
  )
    throw new Error('Choose ordinary stage nodes from one model branch.');
  const implicitScalars = new Set(options.implicitScalarControlNodeIds ?? []);
  if (
    implicitScalars.size &&
    (kind !== 'inputs' ||
      [...implicitScalars].some(
        (id) => !selected.has(id) || operationAuthoring(members.find((node) => node.id === id)!)?.operation,
      ))
  )
    throw new Error('Implicit Inputs controls require explicitly adopted generic ordinary members.');
  const rootId = previous?.id ?? `visual-${nanoid()}`;
  const old = previous?.data.blockInstanceV2;
  if (old) {
    const customized =
      [...old.effectiveInterface.boundary.inputs, ...old.effectiveInterface.boundary.outputs].some(
        (port) =>
          port.mirrorBindings?.length &&
          !(
            ['inputs', 'generate'].includes(kind) &&
            retainsGeneratedModelBindings(port, old.definitionSnapshot, old.effectiveGraph)
          ),
      ) || old.effectiveInterface.controls.some((control) => control.mirrorBindings?.length);
    if (customized)
      throw new Error(
        'This group has a mirrored custom interface. Ungroup its stages before changing the task; its bindings have not been changed.',
      );
  }
  const remap = (id: string) =>
    selected.has(id) ? (id.startsWith(`${rootId}/`) ? id.slice(rootId.length + 1) : `stage-${id}`) : id;
  const preservePosition = ['imageInput', 'videoInput', 'references', 'generate', 'mask', 'composite'].includes(kind);
  const firstStage =
    members.find((node) =>
      kind === 'generate' ? nodeKey(node) === 'modules.DiffusersVideo.Denoise' : node.data.action === 'Load',
    ) ?? members[0]!;
  const position =
    previous?.position ??
    (preservePosition
      ? collisionFreeInsertPosition(
          firstStage.position,
          graph.nodes.filter((n) => !selected.has(n.id)),
          { width: 400, height: 420 },
        )
      : {
          x: Math.min(...members.map((node) => node.position.x)),
          y: Math.min(...members.map((node) => node.position.y)),
        });
  const bound = new Set(
    graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  const inputs: BlockPortV2[] = [],
    outputs: BlockPortV2[] = [],
    controls: BlockControlV2[] = [];
  const previews: BlockPreviewBindingV2[] = [];
  for (const node of members) {
    for (const [field, param] of Object.entries(node.data.params)) {
      const connected = graph.edges.some(
        (edge) =>
          (edge.source === node.id && edge.sourceHandle === field && !selected.has(edge.target)) ||
          (edge.target === node.id && edge.targetHandle === field && !selected.has(edge.source)),
      );
      if (
        ['ui_image', 'ui_audio', 'ui_video'].includes(param.display ?? '') &&
        ['output', 'imageInput', 'videoInput', 'references', 'mask', 'generate'].includes(kind)
      )
        previews.push({
          nodeId: remap(node.id),
          outputPortId: field,
          mediaType: param.display === 'ui_video' ? 'video' : param.display === 'ui_audio' ? 'audio' : 'image',
          ...(previews.length ? {} : { primary: true }),
        });
      if ((param.hidden && !connected) || param.display?.startsWith('ui_')) continue;
      const type = Array.isArray(param.type)
        ? param.type.join('|')
        : (param.type ?? (param.display === 'layerconfig' ? 'dict' : undefined));
      if (!type) continue;
      const id = `${remap(node.id)}:${field}`;
      // Ordinary fields may intentionally omit their visible label (for
      // example Image.Load.path). The explicit Block interface still needs a
      // non-empty name without changing the original leaf field.
      let label = (typeof param.label === 'string' && param.label.trim()) || field;
      if (kind === 'videoInput' && node.data.studioRole === 'loadControlVideo' && field === 'file')
        label = 'Control video';
      if (
        kind === 'videoInput' &&
        nodeKey(node) === 'modules.Video.Load' &&
        ['width', 'height', 'frames', 'fps'].includes(field)
      )
        label = `Source ${field === 'fps' ? 'FPS' : field}`;
      if (
        kind === 'videoInput' &&
        nodeKey(node) === 'modules.VideoConditioning.Normalize' &&
        ['width', 'height', 'num_frames'].includes(field)
      )
        label = `Target ${field === 'num_frames' ? 'frames' : field}`;
      const internalOutput =
        !connected &&
        (['setup', 'imageInput', 'videoInput', 'references', 'mask', 'generate', 'composite'].includes(kind) ||
          implicitScalars.has(node.id)) &&
        graph.edges.some((edge) => edge.source === node.id && edge.sourceHandle === field && selected.has(edge.target));
      if (
        (param.display === 'output' && !internalOutput) ||
        (!bound.has(`${node.id}\0${field}`) && (param.display === 'input' || param.isInput || connected))
      ) {
        (param.display === 'output' ? outputs : inputs).push({
          portId: id,
          label,
          valueType: type,
          required: false,
          binding: { nodeId: remap(node.id), fieldOrPortId: field },
        });
      }
      if (
        (param.display ||
          (stageKind(node) === 'guidance' && !param.isInput) ||
          ((['setup', 'mask', 'output', 'imageInput', 'videoInput', 'references', 'generate', 'composite'].includes(
            kind,
          ) ||
            implicitScalars.has(node.id)) &&
            (!param.isInput || hasInlineScalarControl(param)))) &&
        !['input', 'output'].includes(param.display ?? '') &&
        !param.signal &&
        !bound.has(`${node.id}\0${field}`)
      ) {
        if (
          (old?.presentation.removedControlBindings?.some((b) => b.nodeId === remap(node.id) && b.fieldId === field) ||
            (old?.effectiveGraph.nodes.some(
              (member) =>
                member.nodeId === remap(node.id) &&
                Boolean((member.data.params as Record<string, unknown> | undefined)?.[field]),
            ) &&
              old?.definitionSnapshot.controls.some(
                (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
              ))) &&
          !old?.effectiveInterface.controls.some(
            (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
          )
        )
          continue;
        const value = param.value ?? param.default;
        controls.push({
          controlId: id,
          label,
          valueType: type,
          order: controls.length,
          binding: { nodeId: remap(node.id), fieldId: field },
          ...(value === undefined ? {} : { defaultValue: JSON.parse(JSON.stringify(value)) }),
          group:
            stageKind(node) === 'inputs'
              ? operationAuthoring(node)?.operation.nodeType === 'text_encoder'
                ? 'Text'
                : workflowTaskCategory(operationAuthoring(node)?.operation.task ?? '') === 'Video'
                  ? operationAuthoring(node)?.operation.nodeType === 'video_encoder'
                    ? 'Video'
                    : 'Media'
                  : 'Image'
              : stageKind(node) === 'guidance'
                ? 'Guidance'
                : node.data.label?.trim() || VISUAL_STAGE_LABELS[kind],
        });
      }
    }
  }
  // One public component socket feeds both real stages through the V2 mirrored input.
  const redundantEdges = new Set<string>();
  if (kind === 'composite') {
    const counts = new Map<string, number>();
    for (const control of controls) counts.set(control.label, (counts.get(control.label) ?? 0) + 1);
    for (const control of controls)
      if ((counts.get(control.label) ?? 0) > 1) {
        const member = members.find((node) => remap(node.id) === control.binding.nodeId)!;
        control.label = `${member.data.label} · ${control.label}`;
      }
  }
  if (['inputs', 'generate'].includes(kind)) {
    // A shared typed model value is one public input, regardless of the model
    // adapter's node names. Independent or unconnected suppliers stay separate.
    const visited = new Set<string>();
    for (const primary of [...inputs].filter(sharedModelInput)) {
      const key = `${primary.binding.fieldOrPortId}:${primary.valueType}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const pipelines = inputs.filter(
        (port) => port.valueType === primary.valueType && port.binding.fieldOrPortId === primary.binding.fieldOrPortId,
      );
      // Keep the callback-bearing consumer as the public projection. Imported
      // graphs can list a callback-free decoder before its sampler. Every real
      // binding still receives its own native field actions through V2.
      const callbacks = (port: BlockPortV2) => {
        const member = members.find((member) => remap(member.id) === port.binding.nodeId)!;
        const value = member.data.params[port.binding.fieldOrPortId]!.onSignal;
        return Array.isArray(value) ? value.length : value ? 1 : 0;
      };
      pipelines.sort((left, right) => callbacks(right) - callbacks(left));
      const wires = pipelines.map((port) =>
        graph.edges.filter(
          (edge) =>
            members.some((member) => member.id === edge.target && remap(member.id) === port.binding.nodeId) &&
            edge.targetHandle === port.binding.fieldOrPortId,
        ),
      );
      // Some explicit-component routes offer an optional, empty bundle socket
      // as an alternative to their connected component sockets. Share that
      // empty alternative only within one demonstrable model-owner branch.
      const emptyOptional =
        pipelines.length > 1 &&
        wires.every((edges) => edges.length === 0) &&
        pipelines.every((port) => {
          const member = members.find((member) => remap(member.id) === port.binding.nodeId)!;
          const field = member.data.params[port.binding.fieldOrPortId]!;
          return !field.required && (field.value ?? field.default) == null;
        }) &&
        (() => {
          try {
            const flat = unpackVisualOperationGroups(graph).graph;
            return (
              flat.nodes.filter((owner) => {
                if (!operationOwnsModel(operationAuthoring(owner)?.operation)) return false;
                const scope = new Set(operationScope(flat, owner.id).map((node) => remap(node.id)));
                return pipelines.every((port) => scope.has(port.binding.nodeId));
              }).length === 1
            );
          } catch {
            return false;
          }
        })();
      if (
        pipelines.length > 1 &&
        (emptyOptional ||
          (wires.every((edges) => edges.length === 1) &&
            wires.every(
              (edges) =>
                edges[0]!.source === wires[0]![0]!.source && edges[0]!.sourceHandle === wires[0]![0]!.sourceHandle,
            )))
      ) {
        pipelines[0]!.mirrorBindings = pipelines
          .slice(1)
          .map((port) => port.binding)
          .sort((left, right) => {
            const a = `${left.nodeId}\0${left.fieldOrPortId}`,
              b = `${right.nodeId}\0${right.fieldOrPortId}`;
            return a < b ? -1 : a > b ? 1 : 0;
          });
        for (let index = 1; index < pipelines.length; index++) {
          inputs.splice(inputs.indexOf(pipelines[index]!), 1);
          if (wires[index]!.length) redundantEdges.add(wires[index]![0]!.id);
        }
      }
    }
  }
  // Every presentation stage retains its leaves' source order. Independent
  // inputs affect traversal and ordered references even in Setup/Encode/Output.
  const ordinaryIds = preservePosition
    ? insertStageLeaves(
        graph.nodes.filter((n) => !n.data.blockInstanceV2 && !n.data.blockProjectionOwnerId).map((n) => n.id),
        graph.nodes.flatMap(
          (root) =>
            root.data.blockInstanceV2?.effectiveGraph.nodes.flatMap((child) =>
              visualStageSourceIndex(child.data.visualStageSourceIndex)
                ? [{ index: child.data.visualStageSourceIndex, leaf: `${root.id}/${child.nodeId}` }]
                : [],
            ) ?? [],
        ),
      )
    : [];
  const innerGraph = {
    nodes: members.map((node) => {
      const data = structuredClone(node.data);
      if (preservePosition) data.visualStageSourceIndex ??= ordinaryIds.indexOf(node.id);
      const hint = remapOperationAuthoring(data.operationAuthoring, remap);
      if (hint) data.operationAuthoring = hint;
      return {
        nodeId: remap(node.id),
        nodeType: node.type ?? 'custom',
        data: JSON.parse(JSON.stringify(data)) as BlockJsonObject,
      };
    }),
    edges: graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => ({
        edgeId: edge.id.startsWith(`${rootId}/`) ? edge.id.slice(rootId.length + 1) : `edge-${edge.id}`,
        sourceNodeId: remap(edge.source),
        sourcePortId: edge.sourceHandle!,
        targetNodeId: remap(edge.target),
        targetPortId: edge.targetHandle!,
      })),
  };
  const graphHash = blockGraphHashV2(innerGraph);
  if (old) {
    // Preserve configured labels and sealed controls when their exact bindings
    // survive. Connected wires are lowered to those same leaves before adapting.
    for (const direction of ['inputs', 'outputs'] as const) {
      const ports = direction === 'inputs' ? inputs : outputs;
      for (const port of ports) {
        const prior = old.effectiveInterface.boundary[direction].find(
          (candidate) =>
            candidate.binding.nodeId === port.binding.nodeId &&
            candidate.binding.fieldOrPortId === port.binding.fieldOrPortId,
        );
        if (prior) {
          port.label = prior.label;
          port.required = prior.required;
        }
      }
    }
    for (const control of controls) {
      const prior = old.effectiveInterface.controls.find(
        (candidate) =>
          candidate.binding.nodeId === control.binding.nodeId && candidate.binding.fieldId === control.binding.fieldId,
      );
      if (prior) {
        control.label = prior.label;
        if (prior.group) control.group = prior.group;
        if (prior.sealed) control.sealed = true;
      }
    }
  }
  const base: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId: `definition-${rootId}`,
    displayName:
      old?.definitionSnapshot.displayName ??
      visualStagePresentation(
        kind,
        previews.some((preview) => preview.mediaType === 'video')
          ? 'video'
          : previews.length && previews.every((preview) => preview.mediaType === 'audio')
            ? 'audio'
            : null,
      ).label,
    source: {
      kind: 'user',
      provider: kind === 'inputs' && options.combineGuidance ? COMBINED_INPUT_PROVIDER : `${PROVIDER}${kind}`,
    },
    graph: { ...innerGraph, graphHash },
    boundary: { mode: 'explicit', inputs, outputs },
    controls,
    previews,
    ownership: { kind: 'user', definitionMutable: true },
    ...(options.newDefinition && old?.presentation.removedControlBindings
      ? { removedControlBindings: structuredClone(old.presentation.removedControlBindings) }
      : {}),
  };
  const definition = normalizeBlockDefinitionV2({ ...base, contentHash: blockDefinitionContentHashV2(base) });
  let instance = createBlockInstanceV2(definition, {
    instanceId: rootId,
    position,
    // Compact new text-only image encoders; preserve every existing/user size.
    // The renderer measures controls and grows safely when a route needs more.
    size: old?.presentation.size ?? {
      width: 400,
      height:
        kind === 'inputs'
          ? members.length === 1 &&
            operationAuthoring(members[0]!)?.operation.nodeType === 'text_encoder' &&
            workflowTaskCategory(operationAuthoring(members[0]!)?.operation.task ?? '') === 'Image'
            ? 400
            : 540
          : 420,
    },
    internalLayout: Object.fromEntries(
      members.map((node, index) => [
        remap(node.id),
        old?.presentation.internalLayout[remap(node.id)] ?? { x: 28 + index * 420, y: 110, width: 360, height: 460 },
      ]),
    ),
  });
  if (old && !options.newDefinition) {
    // The reusable definition is immutable. Adapt only this workflow's effective
    // graph/interface; current public values were materialized by unpack above.
    const adapted: typeof instance = {
      ...instance,
      definitionRef: old.definitionRef,
      definitionSnapshot: old.definitionSnapshot,
      effectiveInterface: {
        ...instance.effectiveInterface,
        baseInterfaceHash: old.effectiveInterface.baseInterfaceHash,
      },
      customization: {
        state: 'structure_changed',
        baseGraphHash: old.customization.baseGraphHash,
        effectiveGraphHash: graphHash,
      },
      previewStates: instance.previewStates.map(
        (preview) =>
          old.previewStates.find(
            (prior) =>
              prior.binding.nodeId === preview.binding.nodeId &&
              prior.binding.outputPortId === preview.binding.outputPortId &&
              prior.binding.mediaType === preview.binding.mediaType,
          ) ?? preview,
      ),
      presentation: {
        ...instance.presentation,
        expanded: old.presentation.expanded,
        ...(old.presentation.removedControlBindings
          ? { removedControlBindings: structuredClone(old.presentation.removedControlBindings) }
          : {}),
      },
    };
    // A task return can recover the exact original graph and interface. Derive
    // the state from the retained snapshot before enforcing the V2 invariant.
    adapted.customization.state = parameterCustomizationState(adapted);
    instance = normalizeBlockInstanceV2(adapted);
  }
  const root = createBlockRootNodeV2(instance, { selected: previous?.selected });
  const endpoint = (id: string, handle: string | null | undefined) => `${remap(id)}:${handle}`;
  const result = {
    nodes: [...graph.nodes.filter((node) => !selected.has(node.id)), root],
    edges: graph.edges
      .filter((edge) => !redundantEdges.has(edge.id) && !(selected.has(edge.source) && selected.has(edge.target)))
      .map((edge) => ({
        ...edge,
        ...(selected.has(edge.source)
          ? { source: rootId, sourceHandle: endpoint(edge.source, edge.sourceHandle) }
          : {}),
        ...(selected.has(edge.target)
          ? { target: rootId, targetHandle: endpoint(edge.target, edge.targetHandle) }
          : {}),
      })),
  };
  // Shared-value relationships can cross visual groups. Keep their references
  // tied to the actual projected loader after changing its owning wrapper.
  const replacements = new Map(members.map((node) => [node.id, blockProjectionNodeIdV2(rootId, remap(node.id))]));
  return remapVisualGroupReferences(result, (id) => replacements.get(id) ?? id);
}

/** Explicit, undoable repair for an existing workflow instance. Loading a saved
 * custom interface alone never changes its reusable definition or connections. */
export function mergeVisualStageSharedInputs(graph: OperationGraph, rootId: string): OperationGraph {
  const root = graph.nodes.find((node) => node.id === rootId);
  const kind = root && visualOperationGroup(root);
  if (!root || !kind || !['inputs', 'generate'].includes(kind))
    throw new Error('Choose an Encode Inputs or Generate stage to merge its shared model inputs.');
  const before = root.data.blockInstanceV2!.effectiveInterface.boundary.inputs.length;
  const unpacked = unpackVisualOperationGroups(graph, new Set([rootId]));
  const next = groupVisualStages(unpacked.graph, unpacked.members.get(rootId)!, kind, root);
  const after = next.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!.effectiveInterface.boundary.inputs
    .length;
  if (after >= before)
    throw new Error(
      'No shared model inputs can be merged. Use the same model output, or empty optional inputs belonging to one model branch.',
    );
  return next;
}

function remapVisualGroupReferences(graph: OperationGraph, remap: (id: string) => string): OperationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const hint = remapOperationAuthoring(node.data.operationAuthoring, remap);
      const instance = node.data.blockInstanceV2;
      const data = { ...node.data, ...(hint ? { operationAuthoring: hint } : {}) };
      if (instance) {
        const effectiveGraph = {
          ...instance.effectiveGraph,
          nodes: instance.effectiveGraph.nodes.map((child) => {
            const hint = remapOperationAuthoring(child.data.operationAuthoring, remap);
            return hint
              ? { ...child, data: { ...child.data, operationAuthoring: JSON.parse(JSON.stringify(hint)) } }
              : child;
          }),
        };
        effectiveGraph.graphHash = blockGraphHashV2(effectiveGraph);
        if (effectiveGraph.graphHash !== instance.effectiveGraph.graphHash) {
          const next = {
            ...instance,
            effectiveGraph,
            customization: { ...instance.customization, effectiveGraphHash: effectiveGraph.graphHash },
          };
          next.customization.state = parameterCustomizationState(next);
          data.blockInstanceV2 = normalizeBlockInstanceV2(next);
        }
      }
      return { ...node, data };
    }),
  };
}

export function groupOperationStages(
  graph: OperationGraph,
  ownerId: string,
  kinds: VisualOperationGroup[] = ['inputs', 'guidance'],
  combineGuidance = false,
) {
  const unpacked = unpackVisualOperationGroups(graph);
  const grouped = new Set([...unpacked.members.values()].flat());
  const generated = new Set<string>();
  let next = graph;
  for (const kind of kinds) {
    let members = operationStageMembers(unpacked.graph, ownerId, kind, combineGuidance);
    // A fresh Generate owns its adjacent native decoder. Keep the proven
    // downstream file exporter as Output without moving that decoder twice.
    // Explicit grouping of existing saved stages retains its previous scope.
    if (kind === 'output' && members.some((node) => generated.has(node.id)))
      members = members.filter((node) => !generated.has(node.id));
    if (members.some((node) => grouped.has(node.id))) continue;
    if (members.length) {
      next = groupVisualStages(
        next,
        members.map((node) => node.id),
        kind,
        undefined,
        { combineGuidance: kind === 'inputs' && combineGuidance },
      );
      for (const node of members) grouped.add(node.id);
      if (kind === 'generate') for (const node of members) generated.add(node.id);
    }
  }
  return next;
}

export function groupNewOperationGraph(graph: OperationGraph, options: { legacyStageOrder?: boolean } = {}) {
  // Existing decomposed template creators retain their historical traversal.
  // Fresh Example imports instead preserve the canonical source's own order.
  const legacyStageOrder =
    options.legacyStageOrder && graph.nodes.some((node) => operationOwnsModel(operationAuthoring(node)?.operation));
  // Capture one order before folding any stages. Reconstructing it separately
  // after each fold can exchange repeated reference-image loaders.
  const sourceOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
  let next = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      legacyStageOrder || node.data.blockInstanceV2 || node.data.blockProjectionOwnerId
        ? node
        : { ...node, data: { ...node.data, visualStageSourceIndex: sourceOrder.get(node.id)! } },
    ),
  };
  next = groupStoryboardShots(next, groupVisualStages);
  for (const owner of graph.nodes.filter((node) => operationOwnsModel(operationAuthoring(node)?.operation)))
    next =
      workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '') === 'Image'
        ? groupOperationStages(next, owner.id, ['inputs', 'setup', 'generate', 'output', 'references', 'mask'], true)
        : workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '') === 'Video'
          ? groupOperationStages(next, owner.id, [
              'inputs',
              'guidance',
              'setup',
              'videoInput',
              'imageInput',
              'references',
              'mask',
              'generate',
              'output',
            ])
          : workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '') === 'Audio'
            ? groupOperationStages(next, owner.id, ['inputs', 'guidance', 'setup', 'output', 'videoInput', 'generate'])
            : groupOperationStages(next, owner.id);
  // The same real input preparation can precede a whole native pipeline.
  // Keep a separately consumed original clip external, with its own preview.
  for (const prepare of [...next.nodes]) {
    if (
      prepare.parentId ||
      prepare.data.blockInstanceV2 ||
      prepare.data.blockProjectionOwnerId ||
      nodeKey(prepare) !== 'modules.VideoConditioning.Normalize'
    )
      continue;
    const incoming = next.edges.filter((edge) => edge.target === prepare.id && edge.targetHandle === 'video');
    const wire = incoming[0];
    if (incoming.length !== 1 || wire?.sourceHandle !== 'video') continue;
    const loader = next.nodes.find((node) => node.id === wire.source);
    if (
      !loader ||
      loader.parentId ||
      loader.data.blockInstanceV2 ||
      loader.data.blockProjectionOwnerId ||
      nodeKey(loader) !== 'modules.Video.Load' ||
      next.edges.some((edge) => edge.source === loader.id && edge.target !== prepare.id)
    )
      continue;
    const consumers = next.edges.filter((edge) => edge.source === prepare.id && edge.sourceHandle === 'output');
    if (
      !consumers.length ||
      !consumers.some((edge) => {
        const target = next.nodes.find((node) => node.id === edge.target);
        const input = target?.data.params[edge.targetHandle ?? ''];
        return (
          target?.data.module === 'modules.DiffusersVideo' &&
          ['Generate', 'GenerateVideoAudio'].includes(target.data.action) &&
          input?.type === 'video' &&
          (input.display === 'input' || input.isInput)
        );
      })
    )
      continue;
    next = groupVisualStages(next, [loader.id, prepare.id], 'videoInput');
  }
  // Whole-pipeline paths already perform encoding/generation/decoding inside
  // their real native Generate operation. Fold only their actual setup chain;
  // do not invent an Encode stage or assign operation-authoring authority.
  // Legacy native modular and Transformers examples also own real, editable
  // model setup. Keep their authored fields inside the ordinary V2 boundary;
  // registry hydration must not introduce controls omitted by that recipe.
  for (const owner of [...next.nodes]) {
    if (
      owner.parentId ||
      owner.data.blockInstanceV2 ||
      owner.data.blockProjectionOwnerId ||
      !['modules.ModularDiffusers.ModelsLoader', 'modules.HuggingFaceTransformers.LoadImageTextToTextModel'].includes(
        nodeKey(owner),
      )
    )
      continue;
    const consumers = next.nodes.filter(
      (node) =>
        !node.parentId &&
        !node.data.blockInstanceV2 &&
        !node.data.blockProjectionOwnerId &&
        !operationAuthoring(node) &&
        nodeKey(node) === 'modules.HuggingFaceTransformers.GenerateImageVideoText' &&
        node.data.params.model?.type === owner.data.params.model?.type &&
        next.edges.some(
          (edge) =>
            edge.source === owner.id &&
            edge.sourceHandle === 'model' &&
            edge.target === node.id &&
            edge.targetHandle === 'model',
        ),
    );
    if (nodeKey(owner) === 'modules.ModularDiffusers.ModelsLoader') {
      const ordinary = next.nodes.filter(
        (node) =>
          !node.parentId &&
          !node.data.blockInstanceV2 &&
          !node.data.blockProjectionOwnerId &&
          !operationAuthoring(node),
      );
      const supplied = (target: string, field: string, source: string, output: string) =>
        next.edges.some(
          (edge) =>
            edge.source === source &&
            edge.sourceHandle === output &&
            edge.target === target &&
            edge.targetHandle === field,
        );
      const encoders = ordinary.filter(
        (node) =>
          node.data.module === 'modules.ModularDiffusers' &&
          [
            ['EncodePrompt', 'text_encoders', 'text_encoders'],
            ['ImageEmbeddings', 'image_encoder', 'image_encoder'],
            ['ImageEncode', 'vae', 'vae_out'],
          ].some(
            ([action, input, output]) => node.data.action === action && supplied(node.id, input!, owner.id, output!),
          ),
      );
      const pairs = ordinary
        .filter((node) => nodeKey(node) === 'modules.ModularDiffusers.Denoise')
        .flatMap((sampler) =>
          ordinary
            .filter((node) => nodeKey(node) === 'modules.ModularDiffusers.DecodeLatents')
            .filter(
              (decoder) =>
                supplied(sampler.id, 'unet', owner.id, 'unet_out') &&
                supplied(sampler.id, 'scheduler', owner.id, 'scheduler') &&
                supplied(decoder.id, 'vae', owner.id, 'vae_out') &&
                supplied(decoder.id, 'latents', sampler.id, 'latents'),
            )
            .map((decoder) => [sampler.id, decoder.id]),
        );
      if (encoders.length)
        next = groupVisualStages(
          next,
          encoders.map((node) => node.id),
          'inputs',
          undefined,
          {
            implicitScalarControlNodeIds: encoders.map((node) => node.id),
          },
        );
      if (pairs.length === 1) next = groupVisualStages(next, pairs[0]!, 'generate');
    }
    next = groupVisualStages(
      next,
      connectedSetupMembers(next, owner.id, new Set()).map((node) => node.id),
      'setup',
    );
    for (const node of consumers) next = groupVisualStages(next, [node.id], 'generate');
  }
  for (const owner of [...next.nodes]) {
    if (
      owner.parentId ||
      owner.data.blockInstanceV2 ||
      owner.data.blockProjectionOwnerId ||
      operationAuthoring(owner) ||
      owner.data.action !== 'LoadPipeline' ||
      ![
        'modules.DiffusersImage',
        'modules.DiffusersAudio',
        'modules.DiffusersVideo',
        'modules.DiffusersThreeD',
      ].includes(owner.data.module) ||
      owner.data.params.pipeline?.display !== 'output' ||
      ![
        'image_diffusion_pipeline',
        'audio_diffusion_pipeline',
        'video_diffusion_pipeline',
        'three_d_diffusion_pipeline',
      ].includes(String(owner.data.params.pipeline.type)) ||
      owner.data.params.execution_recipe?.type !== 'diffusers_execution_recipe' ||
      !(owner.data.params.execution_recipe.display === 'input' || owner.data.params.execution_recipe.isInput)
    )
      continue;
    const generation = next.nodes.filter(
      (node) =>
        !node.parentId &&
        !node.data.blockInstanceV2 &&
        !node.data.blockProjectionOwnerId &&
        !operationAuthoring(node) &&
        node.data.module === owner.data.module &&
        [
          'Generate',
          'Edit',
          'Inpaint',
          'ControlGenerate',
          'ControlEdit',
          'ControlInpaint',
          'UnconditionalGenerate',
          'PredictMap',
          'LayerDecompose',
          'GenerateVideoAudio',
          'GenerateRenderedArtifact',
        ].includes(node.data.action) &&
        node.data.params.pipeline?.type === owner.data.params.pipeline!.type &&
        (node.data.params.pipeline!.display === 'input' || node.data.params.pipeline!.isInput) &&
        next.edges.some(
          (edge) =>
            edge.source === owner.id &&
            edge.sourceHandle === 'pipeline' &&
            edge.target === node.id &&
            edge.targetHandle === 'pipeline',
        ),
    );
    const members = connectedSetupMembers(next, owner.id, new Set());
    next = groupVisualStages(
      next,
      members.map((node) => node.id),
      'setup',
    );
    // Keep the authored call fields inside the same real V2 Generate boundary.
    // Live root-schema hydration must not add inactive controls for other models.
    for (const node of generation) next = groupVisualStages(next, [node.id], 'generate');
  }
  // Export remains its own stage after an intervening upscale, assembly or
  // independent soundtrack. Group the actual file exporter and its complete
  // typed boundary, never pull those meaningful operations into Output.
  for (const node of [...next.nodes]) {
    const media =
      node.data.params.preview?.display === 'ui_video'
        ? 'video'
        : node.data.params.preview?.display === 'ui_audio'
          ? 'audio'
          : null;
    if (
      !media ||
      node.parentId ||
      node.data.blockInstanceV2 ||
      node.data.blockProjectionOwnerId ||
      node.data.params.preview?.dataSource !== 'file' ||
      node.data.params.file?.display !== 'output' ||
      !connectionTypesAreCompatible(node.data.params.file.type, media) ||
      ![
        'modules.Video.Export',
        'modules.Video.ExportAsset',
        'modules.Video.ExportWithAudio',
        'modules.Audio.Export',
      ].includes(nodeKey(node))
    )
      continue;
    const input = next.edges.filter((edge) => edge.target === node.id && edge.targetHandle === media);
    const complete = next.edges
      .filter((edge) => edge.target === node.id)
      .every((edge) => {
        const source = next.nodes.find((candidate) => candidate.id === edge.source)?.data.params[
          edge.sourceHandle ?? ''
        ];
        const target = node.data.params[edge.targetHandle ?? ''];
        return source?.display === 'output' && target && connectionTypesAreCompatible(source.type, target.type);
      });
    if (input.length === 1 && complete) next = groupVisualStages(next, [node.id], 'output');
  }
  // Fresh groups have no saved reusable baseline yet. Bind that baseline to the
  // completed ordinary graph, after all cross-group owner references are known.
  const existing = new Set(graph.nodes.map((node) => node.id));
  next = {
    ...next,
    nodes: next.nodes.map((node) => {
      if (existing.has(node.id)) {
        const originalIndex = graph.nodes.find((original) => original.id === node.id)?.data.visualStageSourceIndex;
        const data = { ...node.data };
        if (originalIndex === undefined) delete data.visualStageSourceIndex;
        else data.visualStageSourceIndex = originalIndex;
        return { ...node, data };
      }
      if (!visualOperationGroup(node)) return node;
      const instance = node.data.blockInstanceV2!;
      const base = { ...instance.definitionSnapshot, graph: instance.effectiveGraph };
      const definition = normalizeBlockDefinitionV2({ ...base, contentHash: blockDefinitionContentHashV2(base) });
      const fresh = createBlockInstanceV2(definition, { ...instance.presentation, instanceId: instance.instanceId });
      fresh.previewStates = instance.previewStates;
      return createBlockRootNodeV2(fresh, { selected: node.selected });
    }),
  };
  return next;
}

/** Planner adapter only: flatten the same effective graph, apply, then retain its presentation. */
export function restoreVisualOperationGroups(
  next: OperationGraph,
  unpacked: ReturnType<typeof unpackVisualOperationGroups>,
  replacements: Record<string, string> = {},
) {
  // Keep replacement runtime identities: a different pipeline must not reuse
  // a Python encoder instance merely to retain a visual wrapper's identity.
  let graph = next;
  for (const root of unpacked.roots) {
    for (const control of root.data.blockInstanceV2!.effectiveInterface.controls.filter((control) => control.sealed)) {
      const id = `${root.id}/${control.binding.nodeId}`;
      const before = unpacked.graph.nodes.find((node) => node.id === id)?.data.params[control.binding.fieldId];
      const after = next.nodes.find((node) => node.id === (replacements[id] ?? id))?.data.params[
        control.binding.fieldId
      ];
      if (
        !after ||
        canonicalBlockStringifyV2(before?.value ?? before?.default) !==
          canonicalBlockStringifyV2(after.value ?? after.default)
      )
        throw new Error(
          `The sealed ${control.label} control would change. Separate these stages or configure their interface before adapting the model or task. Nothing changed.`,
        );
    }
    const previousMembers = unpacked.members.get(root.id)!;
    const retained = previousMembers
      .map((id) => replacements[id] ?? id)
      .filter((id) => graph.nodes.some((node) => node.id === id));
    const kind = visualOperationGroup(root)!;
    const previousOwner = unpacked.graph.nodes.find(
      (node) =>
        operationOwnsModel(operationAuthoring(node)?.operation) &&
        operationScope(unpacked.graph, node.id).some((member) => previousMembers.includes(member.id)),
    );
    const owner =
      previousOwner && next.nodes.find((node) => node.id === (replacements[previousOwner.id] ?? previousOwner.id));
    const combined =
      kind === 'inputs' &&
      (root.data.blockInstanceV2!.definitionSnapshot.source.provider === COMBINED_INPUT_PROVIDER ||
        unpacked.graph.nodes.some((node) => previousMembers.includes(node.id) && stageKind(node) === 'guidance'));
    const added = owner ? operationStageMembers(next, owner.id, kind, combined).map((node) => node.id) : [];
    graph = groupVisualStages(graph, [...new Set([...retained, ...added])], kind, root);
  }
  return graph;
}

export function visualGroupOwners(graph: OperationGraph, groupId: string) {
  const unpacked = unpackVisualOperationGroups(graph);
  const members = unpacked.members.get(groupId) ?? [];
  return unpacked.graph.nodes.filter(
    (node) =>
      operationOwnsModel(operationAuthoring(node)?.operation) &&
      operationScope(unpacked.graph, node.id).some((member) => members.includes(member.id)),
  );
}

/** Explicit presentation conversion. Existing saved definitions stay untouched;
 * this workflow receives a new combined definition containing the same leaves. */
export function combineOperationInputStages(graph: OperationGraph, ownerId: string): OperationGraph {
  const unpacked = unpackVisualOperationGroups(graph);
  const members = operationStageMembers(unpacked.graph, ownerId, 'inputs', true);
  if (!members.some((node) => stageKind(node) === 'inputs') || !members.some((node) => stageKind(node) === 'guidance'))
    throw new Error('This branch has no separate encoding and Guidance stages to combine.');
  const selected = new Set(members.map((node) => node.id));
  const priorRoots = unpacked.roots.filter((root) => unpacked.members.get(root.id)!.some((id) => selected.has(id)));
  if (
    priorRoots.some(
      (root) =>
        !['inputs', 'guidance'].includes(visualOperationGroup(root)!) ||
        unpacked.members.get(root.id)!.some((id) => !selected.has(id)),
    )
  )
    throw new Error('These stages have additional grouped members. Separate them before combining.');
  if (
    priorRoots.length === 1 &&
    priorRoots[0]!.data.blockInstanceV2!.definitionSnapshot.source.provider === COMBINED_INPUT_PROVIDER
  )
    throw new Error('Encoding and Guidance are already combined.');
  if (
    priorRoots.some((root) => {
      const surface = root.data.blockInstanceV2!.effectiveInterface;
      return [...surface.boundary.inputs, ...surface.boundary.outputs, ...surface.controls].some(
        (field) => field.mirrorBindings?.length,
      );
    })
  )
    throw new Error('These stages have mirrored custom bindings. Separate them before combining. Nothing changed.');
  const previous = priorRoots.find((root) => visualOperationGroup(root) === 'inputs') ?? priorRoots[0];
  const rootId = previous?.id ?? `visual-${nanoid()}`;
  const semantic = (flatId: string) =>
    flatId.startsWith(`${rootId}/`) ? flatId.slice(rootId.length + 1) : `stage-${flatId}`;
  let baseline = previous;
  if (previous) {
    const old = previous.data.blockInstanceV2!;
    const controls = priorRoots.flatMap((root) =>
      root.data.blockInstanceV2!.effectiveInterface.controls.map((control) => ({
        ...control,
        binding: { ...control.binding, nodeId: semantic(`${root.id}/${control.binding.nodeId}`) },
      })),
    );
    const ports = (direction: 'inputs' | 'outputs') =>
      priorRoots.flatMap((root) =>
        root.data.blockInstanceV2!.effectiveInterface.boundary[direction].map((port) => ({
          ...port,
          binding: { ...port.binding, nodeId: semantic(`${root.id}/${port.binding.nodeId}`) },
        })),
      );
    const boundary = { mode: old.effectiveInterface.boundary.mode, inputs: ports('inputs'), outputs: ports('outputs') };
    const removed = priorRoots.flatMap((root) => {
      const instance = root.data.blockInstanceV2!;
      const removed = [
        ...(instance.presentation.removedControlBindings ?? []),
        ...instance.definitionSnapshot.controls
          .filter(
            (control) =>
              !instance.effectiveInterface.controls.some(
                (current) =>
                  current.binding.nodeId === control.binding.nodeId &&
                  current.binding.fieldId === control.binding.fieldId,
              ),
          )
          .map((control) => control.binding),
      ];
      return removed.map((binding) => ({ ...binding, nodeId: semantic(`${root.id}/${binding.nodeId}`) }));
    });
    const removedControlBindings = [
      ...new Map(removed.map((binding) => [`${binding.nodeId}\0${binding.fieldId}`, binding])).values(),
    ];
    // This temporary preservation surface is read by groupVisualStages only;
    // it never replaces or mutates the old immutable definition snapshot.
    baseline = {
      ...previous,
      data: {
        ...previous.data,
        blockInstanceV2: {
          ...old,
          effectiveInterface: { ...old.effectiveInterface, controls, boundary },
          presentation: { ...old.presentation, removedControlBindings },
        },
      },
    };
  }
  let next = groupVisualStages(unpacked.graph, [...selected], 'inputs', baseline, {
    combineGuidance: true,
    newDefinition: true,
  });
  next = restoreVisualOperationGroups(next, {
    ...unpacked,
    roots: unpacked.roots.filter((root) => !priorRoots.includes(root)),
  });
  return next;
}
