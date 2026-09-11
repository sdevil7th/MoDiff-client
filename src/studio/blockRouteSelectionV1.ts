import type { Edge } from '@xyflow/react';

import type { HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';
import { REGISTERED_BLOCK_V2_ROUTES } from './registeredBlockV2Routes';
import { blockValueTypesAreCompatibleV2 } from './blockValueTypeCompatibilityV2';
import {
  blockModularContainerNodeIdsV2,
  blockInstancePreviewBindingsV2,
  normalizeBlockInstanceV2,
  type BlockInstanceV2,
  type BlockJsonValue,
  type BlockRouteDraftV1,
} from './blockSchemaV2';

export type RegisteredBlockRouteV1 = {
  key: string;
  catalogDefinitionId: string;
  compiledDefinitionId: string;
  label: string;
};

export type RegisteredBlockRouteSetV1 = {
  schemaVersion: 1;
  routeSetId: string;
  label: string;
  portableValueIds: readonly string[];
  routes: readonly RegisteredBlockRouteV1[];
};

function exactRegisteredRouteV1(
  key: string,
  label: string,
  catalogDefinitionId: string,
  admissionId: string,
): RegisteredBlockRouteV1 {
  const matches = REGISTERED_BLOCK_V2_ROUTES.filter(
    (route) => route.definitionId === catalogDefinitionId && route.admissionId === admissionId,
  );
  if (matches.length !== 1)
    throw new Error(`Registered model route ${catalogDefinitionId} / ${admissionId} is unavailable or ambiguous.`);
  return { key, label, catalogDefinitionId, compiledDefinitionId: admissionId };
}

export const REGISTERED_BLOCK_ROUTE_SETS_V1: readonly RegisteredBlockRouteSetV1[] = [
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:text-to-image:v1',
    label: 'Text-to-image pipeline',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'qwen-image-2512',
        'Qwen Image 2512',
        'diffusers.modular:QwenImageModularPipeline:text2image',
        'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'flux-1-dev',
        'FLUX.1 Dev',
        'diffusers.modular:FluxModularPipeline:text2image',
        'diffusers.cluster-admission:FluxModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'sdxl-base-1.0',
        'Stable Diffusion XL 1.0',
        'diffusers.modular:StableDiffusionXLModularPipeline:text2image',
        'diffusers.cluster-admission:StableDiffusionXLModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'z-image',
        'Z-Image',
        'diffusers.modular:ZImageModularPipeline:text2image',
        'diffusers.cluster-admission:ZImageModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'anima',
        'Anima',
        'diffusers.modular:AnimaModularPipeline:text2image',
        'diffusers.cluster-admission:AnimaModularPipeline:text2image:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'ernie-image',
        'ERNIE Image',
        'diffusers.modular:ErnieImageModularPipeline:text2image',
        'diffusers.cluster-admission:ErnieImageModularPipeline:text2image:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'flux-2',
        'FLUX.2',
        'diffusers.modular:Flux2ModularPipeline:text2image',
        'diffusers.cluster-admission:Flux2ModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'cosmos-3-distilled',
        'Cosmos 3 Distilled',
        'diffusers.modular:Cosmos3DistilledModularPipeline:text2image',
        'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:text2image:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'cosmos-3-omni',
        'Cosmos 3 Omni',
        'diffusers.modular:Cosmos3OmniModularPipeline:text2image',
        'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2image:workflow:official_top_level_blocks',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:image-to-image:v1',
    label: 'Image-to-image model',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'qwen-image-2512',
        'Qwen Image 2512',
        'diffusers.modular:QwenImageModularPipeline:image2image',
        'diffusers.cluster-admission:QwenImageModularPipeline:image2image:state_flow:image2image',
      ),
      exactRegisteredRouteV1(
        'flux-1-dev',
        'FLUX.1 Dev',
        'diffusers.modular:FluxModularPipeline:image2image',
        'diffusers.cluster-admission:FluxModularPipeline:image2image:mode:image_to_image',
      ),
      exactRegisteredRouteV1(
        'anima',
        'Anima',
        'diffusers.modular:AnimaModularPipeline:img2img',
        'diffusers.cluster-admission:AnimaModularPipeline:img2img:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'sdxl-base-1.0',
        'Stable Diffusion XL 1.0',
        'diffusers.modular:StableDiffusionXLModularPipeline:image2image',
        'diffusers.cluster-admission:StableDiffusionXLModularPipeline:image2image:mode:image_to_image',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:instruction-edit:v1',
    label: 'Instruction-edit model',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'qwen-image-edit',
        'Qwen Image Edit',
        'diffusers.modular:QwenImageEditModularPipeline:image_conditioned',
        'diffusers.cluster-admission:QwenImageEditModularPipeline:image_conditioned:mode:edit_image',
      ),
      exactRegisteredRouteV1(
        'qwen-image-edit-plus',
        'Qwen Image Edit Plus — Single image',
        'diffusers.modular:QwenImageEditPlusModularPipeline:default',
        'diffusers.cluster-admission:QwenImageEditPlusModularPipeline:default:mode:edit_image',
      ),
      exactRegisteredRouteV1(
        'qwen-image-edit-plus-multi-reference',
        'Qwen Image Edit Plus — Multi-reference',
        'diffusers.modular:QwenImageEditPlusModularPipeline:default',
        'diffusers.cluster-admission:QwenImageEditPlusModularPipeline:default:mode:multi_image_reference_edit',
      ),
      exactRegisteredRouteV1(
        'flux-kontext',
        'FLUX.1 Kontext',
        'diffusers.modular:FluxKontextModularPipeline:image_conditioned',
        'diffusers.cluster-admission:FluxKontextModularPipeline:image_conditioned:mode:edit_image',
      ),
      exactRegisteredRouteV1(
        'flux2-klein',
        'FLUX.2 Klein',
        'diffusers.modular:Flux2KleinModularPipeline:image_conditioned',
        'diffusers.cluster-admission:Flux2KleinModularPipeline:image_conditioned:mode:edit_image',
      ),
      exactRegisteredRouteV1(
        'flux2-klein-base',
        'FLUX.2 Klein Base',
        'diffusers.modular:Flux2KleinBaseModularPipeline:image_conditioned',
        'diffusers.cluster-admission:Flux2KleinBaseModularPipeline:image_conditioned:mode:edit_image',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:inpainting:v1',
    label: 'Inpainting model',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'qwen-image-2512',
        'Qwen Image 2512',
        'diffusers.modular:QwenImageModularPipeline:inpainting',
        'diffusers.cluster-admission:QwenImageModularPipeline:inpainting:state_flow:inpainting',
      ),
      exactRegisteredRouteV1(
        'qwen-image-edit',
        'Qwen Image Edit',
        'diffusers.modular:QwenImageEditModularPipeline:image_conditioned_inpainting',
        'diffusers.cluster-admission:QwenImageEditModularPipeline:image_conditioned_inpainting:state_flow:image_conditioned_inpainting',
      ),
      exactRegisteredRouteV1(
        'sdxl-base-1.0',
        'Stable Diffusion XL 1.0',
        'diffusers.modular:StableDiffusionXLModularPipeline:inpainting',
        'diffusers.cluster-admission:StableDiffusionXLModularPipeline:inpainting:mode:inpaint',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:control-image:v1',
    label: 'Control-image model',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'qwen-image-2512',
        'Qwen Image 2512',
        'diffusers.modular:QwenImageModularPipeline:controlnet_text2image',
        'diffusers.cluster-admission:QwenImageModularPipeline:controlnet_text2image:mode:control_image',
      ),
      exactRegisteredRouteV1(
        'sdxl-base-1.0',
        'Stable Diffusion XL 1.0',
        'diffusers.modular:StableDiffusionXLModularPipeline:controlnet_text2image',
        'diffusers.cluster-admission:StableDiffusionXLModularPipeline:controlnet_text2image:mode:control_image',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:text-to-video:v1',
    label: 'Text-to-video model',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'wan-2.1',
        'Wan 2.1',
        'diffusers.modular:WanModularPipeline:default',
        'diffusers.cluster-admission:WanModularPipeline:default:mode:text_to_video',
      ),
      exactRegisteredRouteV1(
        'wan-2.2',
        'Wan 2.2',
        'diffusers.modular:Wan22ModularPipeline:default',
        'diffusers.cluster-admission:Wan22ModularPipeline:default:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'ltx-video',
        'LTX Video',
        'diffusers.modular:LTXModularPipeline:text2video',
        'diffusers.cluster-admission:LTXModularPipeline:text2video:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'ltx-2',
        'LTX-2',
        'diffusers.modular:LTX2ModularPipeline:text2video',
        'diffusers.cluster-admission:LTX2ModularPipeline:text2video:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'hunyuan-video-1.5',
        'HunyuanVideo 1.5',
        'diffusers.modular:HunyuanVideo15ModularPipeline:text2video',
        'diffusers.cluster-admission:HunyuanVideo15ModularPipeline:text2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'helios',
        'Helios',
        'diffusers.modular:HeliosModularPipeline:text2video',
        'diffusers.cluster-admission:HeliosModularPipeline:text2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'helios-pyramid',
        'Helios Pyramid',
        'diffusers.modular:HeliosPyramidModularPipeline:text2video',
        'diffusers.cluster-admission:HeliosPyramidModularPipeline:text2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'helios-pyramid-distilled',
        'Helios Pyramid Distilled',
        'diffusers.modular:HeliosPyramidDistilledModularPipeline:text2video',
        'diffusers.cluster-admission:HeliosPyramidDistilledModularPipeline:text2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'cosmos-3-omni',
        'Cosmos 3 Omni',
        'diffusers.modular:Cosmos3OmniModularPipeline:text2video',
        'diffusers.cluster-admission:Cosmos3OmniModularPipeline:text2video:workflow:official_top_level_blocks',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:image-to-video:v1',
    label: 'Image-to-video model',
    portableValueIds: ['prompt', 'seed', 'image'],
    routes: [
      exactRegisteredRouteV1(
        'cosmos-3-distilled',
        'Cosmos 3 Distilled',
        'diffusers.modular:Cosmos3DistilledModularPipeline:image2video',
        'diffusers.cluster-admission:Cosmos3DistilledModularPipeline:image2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'cosmos-3-omni',
        'Cosmos 3 Omni',
        'diffusers.modular:Cosmos3OmniModularPipeline:image2video',
        'diffusers.cluster-admission:Cosmos3OmniModularPipeline:image2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'hunyuan-video-1.5',
        'HunyuanVideo 1.5',
        'diffusers.modular:HunyuanVideo15ModularPipeline:image2video',
        'diffusers.cluster-admission:HunyuanVideo15ModularPipeline:image2video:workflow:official_top_level_blocks',
      ),
      exactRegisteredRouteV1(
        'ltx-video',
        'LTX Video',
        'diffusers.modular:LTXModularPipeline:image2video',
        'diffusers.cluster-admission:LTXModularPipeline:image2video:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'ltx-2',
        'LTX-2',
        'diffusers.modular:LTX2ModularPipeline:image2video',
        'diffusers.cluster-admission:LTX2ModularPipeline:image2video:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'wan-2.2',
        'Wan 2.2',
        'diffusers.modular:Wan22Image2VideoModularPipeline:default',
        'diffusers.cluster-admission:Wan22Image2VideoModularPipeline:default:mode:equivalent_standard_route',
      ),
      exactRegisteredRouteV1(
        'wan-2.1',
        'Wan 2.1',
        'diffusers.modular:WanImage2VideoModularPipeline:image2video',
        'diffusers.cluster-admission:WanImage2VideoModularPipeline:image2video:mode:image_to_video',
      ),
    ],
  },
  {
    schemaVersion: 1,
    routeSetId: 'diffusers.route-set:klein-text-to-image:v1',
    label: 'Text-to-image pipeline',
    portableValueIds: ['prompt', 'seed'],
    routes: [
      exactRegisteredRouteV1(
        'flux2-klein',
        'FLUX.2 Klein',
        'diffusers.modular:Flux2KleinModularPipeline:text2image',
        'diffusers.cluster-admission:Flux2KleinModularPipeline:text2image:mode:text_to_image',
      ),
      exactRegisteredRouteV1(
        'flux2-klein-base',
        'FLUX.2 Klein Base',
        'diffusers.modular:Flux2KleinBaseModularPipeline:text2image',
        'diffusers.cluster-admission:Flux2KleinBaseModularPipeline:text2image:mode:text_to_image',
      ),
    ],
  },
];

function fail(message: string): never {
  throw new Error(`Cannot switch Block route: ${message}`);
}

function routeForDefinition(routeSet: RegisteredBlockRouteSetV1, definitionId: string) {
  return routeSet.routes.find((route) => route.compiledDefinitionId === definitionId) ?? null;
}

export function registeredRouteSetForBlockV1(instance: BlockInstanceV2) {
  // A reviewed same-pipeline checkpoint selector is an ordinary Block value:
  // changing it must not replace the definition, graph, interface, or layout.
  // Do not layer the older cross-family route switcher on top of that control.
  // Persisted routeSelection state is still honored so existing workflow drafts
  // remain recoverable, but newly inserted Blocks use their modelVariant
  // control as the single model selector.
  if (
    !instance.routeSelection &&
    instance.effectiveInterface.controls.some(({ controlId }) => controlId === 'modelVariant')
  )
    return null;
  const routeSet = instance.routeSelection
    ? REGISTERED_BLOCK_ROUTE_SETS_V1.find(({ routeSetId }) => routeSetId === instance.routeSelection!.routeSetId)
    : REGISTERED_BLOCK_ROUTE_SETS_V1.find(
        (candidate) => routeForDefinition(candidate, instance.definitionRef.definitionId) !== null,
      );
  if (!routeSet) return null;
  const activeRoute = routeForDefinition(routeSet, instance.definitionRef.definitionId);
  if (!activeRoute) fail(`active definition ${instance.definitionRef.definitionId} is not in ${routeSet.routeSetId}.`);
  if (instance.routeSelection && instance.routeSelection.selectedRouteKey !== activeRoute.key)
    fail('the persisted selected route does not match the active exact definition.');
  return { routeSet, activeRoute };
}

export function definitionForRegisteredRouteV1(
  definitions: readonly HuggingFaceNodeLibraryDefinition[],
  route: RegisteredBlockRouteV1,
) {
  const matches = definitions.filter(({ id }) => id === route.catalogDefinitionId);
  if (matches.length !== 1) fail(`destination ${route.label} is unavailable or ambiguous in the current catalog.`);
  return matches[0]!;
}

function draftFromInstance(instance: BlockInstanceV2, routeKey: string): BlockRouteDraftV1 {
  return {
    schemaVersion: 1,
    routeKey,
    definitionRef: structuredClone(instance.definitionRef),
    definitionSnapshot: structuredClone(instance.definitionSnapshot),
    effectiveGraph: structuredClone(instance.effectiveGraph),
    effectiveInterface: structuredClone(instance.effectiveInterface),
    values: structuredClone(instance.values),
    customization: structuredClone(instance.customization),
    internalLayout: structuredClone(instance.presentation.internalLayout),
    ...(instance.presentation.internalLayoutMode
      ? { internalLayoutMode: instance.presentation.internalLayoutMode }
      : {}),
    ...(instance.presentation.collapsedContainerNodeIds
      ? { collapsedContainerNodeIds: structuredClone(instance.presentation.collapsedContainerNodeIds) }
      : {}),
  };
}

function instanceFromDraft(
  current: BlockInstanceV2,
  draft: BlockRouteDraftV1,
  routeSelection: NonNullable<BlockInstanceV2['routeSelection']>,
) {
  return normalizeBlockInstanceV2({
    schemaVersion: 2,
    instanceId: current.instanceId,
    definitionRef: draft.definitionRef,
    definitionSnapshot: draft.definitionSnapshot,
    effectiveGraph: draft.effectiveGraph,
    effectiveInterface: draft.effectiveInterface,
    values: draft.values,
    customization: draft.customization,
    presentation: {
      ...current.presentation,
      internalLayout: draft.internalLayout,
      ...(draft.internalLayoutMode ? { internalLayoutMode: draft.internalLayoutMode } : {}),
      ...(draft.collapsedContainerNodeIds
        ? { collapsedContainerNodeIds: draft.collapsedContainerNodeIds }
        : { collapsedContainerNodeIds: blockModularContainerNodeIdsV2(draft.effectiveGraph) }),
    },
    previewStates: blockInstancePreviewBindingsV2(draft.definitionSnapshot, draft.effectiveGraph).map((binding) => ({
      binding,
      status: 'idle',
    })),
    authorities: [],
    routeSelection,
  });
}

/**
 * Materialize one inactive draft as a validation-only destination candidate.
 * Callers must still bind it to the current registered route and verify the
 * canonical SHA-256 before bypassing the live compiler.
 */
export function inactiveBlockRouteDraftInstanceV1(currentValue: BlockInstanceV2, targetKey: string) {
  const current = normalizeBlockInstanceV2(currentValue);
  const draft = current.routeSelection?.inactiveDrafts[targetKey];
  if (!draft) return null;
  return normalizeBlockInstanceV2({
    schemaVersion: 2,
    instanceId: current.instanceId,
    definitionRef: draft.definitionRef,
    definitionSnapshot: draft.definitionSnapshot,
    effectiveGraph: draft.effectiveGraph,
    effectiveInterface: draft.effectiveInterface,
    values: draft.values,
    customization: draft.customization,
    presentation: {
      ...current.presentation,
      internalLayout: draft.internalLayout,
      ...(draft.internalLayoutMode ? { internalLayoutMode: draft.internalLayoutMode } : {}),
      ...(draft.collapsedContainerNodeIds
        ? { collapsedContainerNodeIds: draft.collapsedContainerNodeIds }
        : { collapsedContainerNodeIds: blockModularContainerNodeIdsV2(draft.effectiveGraph) }),
    },
    previewStates: blockInstancePreviewBindingsV2(draft.definitionSnapshot, draft.effectiveGraph).map((binding) => ({
      binding,
      status: 'idle',
    })),
    authorities: [],
  });
}

function valueDeclaration(instance: BlockInstanceV2, valueId: string) {
  return (
    instance.effectiveInterface.controls.find(({ controlId }) => controlId === valueId) ??
    instance.effectiveInterface.boundary.inputs.find(({ portId }) => portId === valueId) ??
    null
  );
}

function declarationIsSealed(value: ReturnType<typeof valueDeclaration>) {
  return Boolean(value && 'sealed' in value && value.sealed);
}

/**
 * Carry every value whose stable logical id and declared type survive a route
 * switch. Route sets still list their minimum portable surface, but the exact
 * interface intersection is the stronger authority: adding a compatible
 * width/height/steps control upstream should not require another frontend
 * allow-list edit, while sealed model identity can never leak across routes.
 */
function carryCompatibleValues(
  current: BlockInstanceV2,
  destination: BlockInstanceV2,
  portableValueIds: readonly string[],
) {
  const values = structuredClone(destination.values);
  let carried = false;
  const candidateIds = [...portableValueIds, ...Object.keys(current.values)].filter(
    (valueId, index, all) => all.indexOf(valueId) === index,
  );
  candidateIds.forEach((valueId) => {
    if (!Object.prototype.hasOwnProperty.call(current.values, valueId)) return;
    if (!Object.prototype.hasOwnProperty.call(destination.values, valueId)) return;
    const sourceDeclaration = valueDeclaration(current, valueId);
    const destinationDeclaration = valueDeclaration(destination, valueId);
    if (!sourceDeclaration || !destinationDeclaration) return;
    if (declarationIsSealed(sourceDeclaration) || declarationIsSealed(destinationDeclaration)) return;
    if (!blockValueTypesAreCompatibleV2(sourceDeclaration.valueType, destinationDeclaration.valueType)) return;
    values[valueId] = structuredClone(current.values[valueId]) as BlockJsonValue;
    carried = true;
  });
  return { values, carried };
}

function semanticLayoutKey(instance: BlockInstanceV2, nodeId: string) {
  const node = instance.effectiveGraph.nodes.find((candidate) => candidate.nodeId === nodeId);
  return node?.semanticRole || node?.modularDiffusers?.runtimeRole || nodeId;
}

/** Preserve only layout belonging to semantic stages that exist on both exact routes. */
function carryCompatibleInternalLayout(current: BlockInstanceV2, destination: BlockInstanceV2) {
  const sourceBySemanticRole = new Map<string, BlockInstanceV2['presentation']['internalLayout'][string]>();
  Object.entries(current.presentation.internalLayout).forEach(([nodeId, layout]) => {
    const key = semanticLayoutKey(current, nodeId);
    if (!sourceBySemanticRole.has(key)) sourceBySemanticRole.set(key, structuredClone(layout));
  });
  const result = structuredClone(destination.presentation.internalLayout);
  destination.effectiveGraph.nodes.forEach(({ nodeId }) => {
    const source = sourceBySemanticRole.get(semanticLayoutKey(destination, nodeId));
    if (source) result[nodeId] = structuredClone(source);
  });
  return result;
}

function rebaseStaleRegisteredDraft(
  current: BlockInstanceV2,
  draft: BlockRouteDraftV1,
  compiledDestination: BlockInstanceV2,
  targetKey: string,
  routeSelection: NonNullable<BlockInstanceV2['routeSelection']>,
) {
  if (draft.definitionRef.definitionId !== compiledDestination.definitionRef.definitionId)
    fail(`saved draft ${targetKey} belongs to a different registered definition.`);
  if (
    draft.customization.state === 'structure_changed' ||
    draft.effectiveGraph.graphHash !== draft.definitionSnapshot.graph.graphHash
  )
    fail(
      `saved draft ${targetKey} uses an older registered schema and contains structural changes; save it as a User Node before switching.`,
    );

  // A registered pin can advance when the reviewed runtime publishes a more
  // complete deterministic schema. Preserve every still-compatible value and
  // surviving child layout, but never restore the stale definition bytes.
  const restored = instanceFromDraft(current, draft, routeSelection);
  const carried = carryCompatibleValues(restored, compiledDestination, Object.keys(restored.values));
  const destinationNodeIds = new Set(compiledDestination.effectiveGraph.nodes.map(({ nodeId }) => nodeId));
  const internalLayout = Object.fromEntries(
    Object.entries(draft.internalLayout).filter(([nodeId]) => destinationNodeIds.has(nodeId)),
  );
  const rebasedDraft = draftFromInstance(
    {
      ...compiledDestination,
      values: carried.values,
      customization: carried.carried
        ? { ...compiledDestination.customization, state: 'parameters_changed' }
        : compiledDestination.customization,
      presentation: {
        ...compiledDestination.presentation,
        internalLayout: {
          ...compiledDestination.presentation.internalLayout,
          ...internalLayout,
        },
      },
    },
    targetKey,
  );
  return instanceFromDraft(current, rebasedDraft, routeSelection);
}

/**
 * Atomically select another exact definition while preserving one draft per
 * route. The destination must already have passed the registered transient
 * compiler; this reducer never infers or rewrites a pipeline class/model ID.
 */
export function switchBlockRouteInstanceV1(
  currentValue: BlockInstanceV2,
  targetKey: string,
  compiledDestinationValue: BlockInstanceV2,
) {
  const current = normalizeBlockInstanceV2(currentValue);
  const compiledDestination = normalizeBlockInstanceV2(compiledDestinationValue);
  const resolved = registeredRouteSetForBlockV1(current);
  if (!resolved) fail(`definition ${current.definitionRef.definitionId} is not in a registered route set.`);
  const { routeSet, activeRoute } = resolved;
  const targetRoute = routeSet.routes.find(({ key }) => key === targetKey);
  if (!targetRoute) fail(`route ${targetKey} is not in ${routeSet.routeSetId}.`);
  if (targetRoute.key === activeRoute.key) return current;
  if (compiledDestination.definitionRef.definitionId !== targetRoute.compiledDefinitionId)
    fail('the transient compiler returned a different destination definition.');
  if (
    compiledDestination.definitionSnapshot.ownership.kind !== 'registered' ||
    compiledDestination.definitionSnapshot.ownership.definitionMutable
  )
    fail('the destination is not one immutable registered definition.');

  const inactiveDrafts = structuredClone(current.routeSelection?.inactiveDrafts ?? {});
  const restoredDraft = inactiveDrafts[targetKey];
  delete inactiveDrafts[targetKey];
  inactiveDrafts[activeRoute.key] = draftFromInstance(current, activeRoute.key);
  const routeSelection = {
    schemaVersion: 1 as const,
    routeSetId: routeSet.routeSetId,
    selectedRouteKey: targetKey,
    inactiveDrafts,
  };
  if (restoredDraft) {
    if (restoredDraft.definitionRef.contentHash === compiledDestination.definitionRef.contentHash)
      return instanceFromDraft(current, restoredDraft, routeSelection);
    return rebaseStaleRegisteredDraft(current, restoredDraft, compiledDestination, targetKey, routeSelection);
  }

  const portable = carryCompatibleValues(current, compiledDestination, routeSet.portableValueIds);
  const freshDraft = draftFromInstance(
    {
      ...compiledDestination,
      values: portable.values,
      customization:
        portable.carried && compiledDestination.customization.state === 'unchanged'
          ? { ...compiledDestination.customization, state: 'parameters_changed' }
          : compiledDestination.customization,
      presentation: {
        ...compiledDestination.presentation,
        internalLayout: carryCompatibleInternalLayout(current, compiledDestination),
      },
    },
    targetKey,
  );
  return instanceFromDraft(current, freshDraft, routeSelection);
}

function portForEdge(instance: BlockInstanceV2, edge: Edge) {
  if (edge.target === instance.instanceId) {
    const port = instance.effectiveInterface.boundary.inputs.find(({ portId }) => portId === edge.targetHandle);
    return { direction: 'input' as const, handle: edge.targetHandle, port };
  }
  if (edge.source === instance.instanceId) {
    const port = instance.effectiveInterface.boundary.outputs.find(({ portId }) => portId === edge.sourceHandle);
    return { direction: 'output' as const, handle: edge.sourceHandle, port };
  }
  return null;
}

/** Refuse a switch before mutating the graph if any external edge would drift. */
export function assertBlockRouteEdgesCompatibleV1(
  current: BlockInstanceV2,
  destination: BlockInstanceV2,
  edges: readonly Edge[],
) {
  edges.forEach((edge) => {
    const source = portForEdge(current, edge);
    if (!source) return;
    if (!source.handle || !source.port)
      fail(`connected ${source.direction} edge ${edge.id} has no declared source port.`);
    const candidates =
      source.direction === 'input'
        ? destination.effectiveInterface.boundary.inputs
        : destination.effectiveInterface.boundary.outputs;
    const target = candidates.find(({ portId }) => portId === source.handle);
    if (!target)
      fail(
        `${source.direction} ${source.handle} is connected but ${destination.definitionSnapshot.displayName} does not expose it; disconnect or remap that edge first.`,
      );
    if (!blockValueTypesAreCompatibleV2(source.port.valueType, target.valueType))
      fail(`${source.direction} ${source.handle} changes type; disconnect or remap that edge first.`);
  });
}
