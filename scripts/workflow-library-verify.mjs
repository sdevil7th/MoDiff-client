import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { canonicalJsonHash, stableJsonValue as stable } from './canonical-json.mjs';
import {
  workflowNodeAttentionBackendError,
  workflowNodeDeviceOffloadError,
} from './workflow-library-contract.mjs';

const ROOT = process.cwd();
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(ROOT, '..', 'MoDiff'));
const LAYOUT_ALGORITHM = 'modiff-layered-v1';
const LAYOUT_HORIZONTAL_GAP = 140;
const LAYOUT_VERTICAL_GAP = 72;
const LAYOUT_EPSILON = 0.01;
const pairArgument = process.argv.find((argument) => argument.startsWith('--pair='));
const requestedPair = pairArgument?.slice('--pair='.length) ?? null;
if (requestedPair && !/^[A-Za-z\d_]+\|[a-z\d_]+$/.test(requestedPair)) {
  throw new Error('The workflow pair must use --pair=ModelType|mode.');
}
const manifestPath = join(BACKEND_ROOT, 'data', 'workflow-library-manifest.json');
if (!existsSync(manifestPath)) throw new Error('Workflow manifest is missing. Run npm run workflows:generate.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1) throw new Error(`Unsupported workflow manifest schema: ${manifest.schemaVersion}`);
const expectedPairCount = Number(manifest.supportedPairCount);
if (!Number.isInteger(expectedPairCount) || expectedPairCount <= 0) {
  throw new Error(`Workflow manifest has an invalid supportedPairCount: ${manifest.supportedPairCount}.`);
}
if (!Array.isArray(manifest.workflows) || manifest.workflows.length !== expectedPairCount) {
  throw new Error(
    `Expected ${expectedPairCount} canonical supported workflows, found ${manifest.workflows?.length ?? 0}.`,
  );
}

const pairs = new Set();

function graphLayoutSignature(graph) {
  return stable(
    [...(graph?.nodes ?? [])]
      .map((node) => ({
        id: node.id,
        parentId: node.parentId ?? null,
        position: node.position,
        width: node.width ?? null,
        height: node.height ?? null,
        measured: node.measured ?? null,
      }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id))),
  );
}

function graphLayoutHash(graph) {
  return createHash('sha256')
    .update(JSON.stringify(graphLayoutSignature(graph)))
    .digest('hex');
}

const OUTPUT_NODE_KEYS = new Set([
  'modules.Audio.Export',
  'modules.Image.Preview',
  'modules.Primitive.DataViewer',
  'modules.Video.Export',
  'modules.Video.ExportWithAudio',
]);

function verifyNoDeadWorkflowNodes(workflow, graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const incident = new Set();
  for (const edge of edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    incoming.get(edge.target)?.push(edge.source);
    incident.add(edge.source);
    incident.add(edge.target);
  }

  const outputNodes = nodes.filter((node) => OUTPUT_NODE_KEYS.has(`${node?.data?.module}.${node?.data?.action}`));
  if (outputNodes.length === 0) {
    throw new Error(`${workflow.id} has no preview, export, or data-viewer output node.`);
  }

  const used = new Set(outputNodes.map((node) => node.id));
  const pending = [...used];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    for (const sourceId of incoming.get(nodeId) ?? []) {
      if (used.has(sourceId)) continue;
      used.add(sourceId);
      pending.push(sourceId);
    }
  }

  const disabled = nodes.filter((node) => node?.data?.uiState?.disabled === true);
  if (disabled.length > 0) {
    throw new Error(
      `${workflow.id} contains disabled nodes that cannot contribute to execution: ${disabled
        .map((node) => node.id)
        .join(', ')}.`,
    );
  }
  const isolated = nodes.filter((node) => !incident.has(node.id));
  if (isolated.length > 0) {
    throw new Error(`${workflow.id} contains isolated nodes: ${isolated.map((node) => node.id).join(', ')}.`);
  }
  const unreachable = nodes.filter((node) => !used.has(node.id));
  if (unreachable.length > 0) {
    throw new Error(
      `${workflow.id} contains nodes outside every output dependency path: ${unreachable
        .map((node) => node.id)
        .join(', ')}.`,
    );
  }
}

function verifyCanonicalLayout(workflow, graph, graphLayout) {
  const metadata = graph.layout;
  if (
    metadata?.algorithm !== LAYOUT_ALGORITHM ||
    metadata?.horizontalGap !== LAYOUT_HORIZONTAL_GAP ||
    metadata?.verticalGap !== LAYOUT_VERTICAL_GAP
  ) {
    throw new Error(`${workflow.id} is missing canonical ${LAYOUT_ALGORITHM} layout metadata.`);
  }
  if (metadata.positionHash !== graphLayoutHash(graph)) {
    throw new Error(`${workflow.id} canonical layout position hash does not match its nodes.`);
  }

  const rearranged = graphLayout.arrangeGraphNodes(graph.nodes ?? [], graph.edges ?? []);
  if (
    JSON.stringify(graphLayoutSignature({ nodes: rearranged })) !==
    JSON.stringify(graphLayoutSignature({ nodes: graph.nodes ?? [] }))
  ) {
    throw new Error(`${workflow.id} does not equal a deterministic re-layout of its persisted nodes.`);
  }

  const nodesByParent = new Map();
  for (const node of graph.nodes ?? []) {
    const parentId = node.parentId ?? '__root__';
    nodesByParent.set(parentId, [...(nodesByParent.get(parentId) ?? []), node]);
  }
  for (const siblings of nodesByParent.values()) {
    for (let leftIndex = 0; leftIndex < siblings.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < siblings.length; rightIndex += 1) {
        const left = siblings[leftIndex];
        const right = siblings[rightIndex];
        const leftSize = graphLayout.graphNodeSize(left);
        const rightSize = graphLayout.graphNodeSize(right);
        const horizontalClearance = Math.max(
          right.position.x - (left.position.x + leftSize.width),
          left.position.x - (right.position.x + rightSize.width),
        );
        const verticalClearance = Math.max(
          right.position.y - (left.position.y + leftSize.height),
          left.position.y - (right.position.y + rightSize.height),
        );
        if (
          horizontalClearance + LAYOUT_EPSILON < LAYOUT_HORIZONTAL_GAP &&
          verticalClearance + LAYOUT_EPSILON < LAYOUT_VERTICAL_GAP
        ) {
          throw new Error(
            `${workflow.id} nodes ${left.id} and ${right.id} violate the ${LAYOUT_HORIZONTAL_GAP}px/${LAYOUT_VERTICAL_GAP}px layout clearance.`,
          );
        }
      }
    }
  }
}

function verifyWorkflow(workflow, expectedTier, graphLayout) {
  if (pairs.has(workflow.id)) throw new Error(`Duplicate canonical workflow: ${workflow.id}`);
  pairs.add(workflow.id);
  if (workflow.supportTier !== expectedTier) throw new Error(`${workflow.id} is not in the ${expectedTier} tier.`);
  if (workflow.graphQualificationStatus !== workflow.qualificationStatus) {
    throw new Error(`${workflow.id} graph qualification does not match its compatibility status.`);
  }
  if (!['unqualified', 'observed-on-recorded-platform'].includes(workflow.runtimeQualificationStatus)) {
    throw new Error(`${workflow.id} has an invalid runtime qualification status.`);
  }
  if (workflow.optimizationQualificationStatus !== 'unqualified') {
    throw new Error(`${workflow.id} claims optimization qualification without an exact recipe receipt.`);
  }
  if (!Array.isArray(workflow.qualifiedRuntimeProfiles)) {
    throw new Error(`${workflow.id} must declare its qualified runtime-profile coverage.`);
  }
  if (workflow.qualificationScope !== 'exact-model-recipe-runtime-hardware') {
    throw new Error(`${workflow.id} has an invalid qualification scope.`);
  }
  const graphPath = join(BACKEND_ROOT, 'data', 'graphs', workflow.graphPath);
  if (!existsSync(graphPath)) throw new Error(`${workflow.id} graph is missing: ${workflow.graphPath}`);
  const raw = readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(raw);
  verifyCanonicalLayout(workflow, graph, graphLayout);
  verifyNoDeadWorkflowNodes(workflow, graph);
  const nodeIds = new Set((graph.nodes ?? []).map((node) => node.id));
  for (const node of graph.nodes ?? []) {
    if (node.parentId && !nodeIds.has(node.parentId)) {
      throw new Error(`${workflow.id} node ${node.id} references missing parent ${node.parentId}.`);
    }
    if (node.parentId) {
      const parent = graph.nodes.find((candidate) => candidate.id === node.parentId);
      if (parent?.type !== 'loop' && parent?.data?.type !== 'group') {
        throw new Error(`${workflow.id} node ${node.id} has a non-container parent ${node.parentId}.`);
      }
    }
    if (node?.data?.action === 'DiffusersExecutionRecipe') {
      const params = node.data.params ?? {};
      const attentionBackend = params.attention_backend?.value;
      const device = params.device?.value;
      const attentionError = workflowNodeAttentionBackendError(node);
      if (attentionError) throw new Error(`${workflow.id} ${attentionError}.`);
      if (String(attentionBackend ?? '').startsWith('_native_') && String(device ?? '').startsWith('cpu')) {
        throw new Error(`${workflow.id} selects accelerator attention ${attentionBackend} on ${device}.`);
      }
    }
    const offloadError = workflowNodeDeviceOffloadError(node);
    if (offloadError) throw new Error(`${workflow.id} ${offloadError}.`);
  }
  if (workflow.mediaKind === 'video') {
    const videoPipelineNodes = (graph.nodes ?? []).filter(
      (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'LoadPipeline',
    );
    const threeDPipelineNodes = (graph.nodes ?? []).filter(
      (node) => node?.data?.module === 'modules.DiffusersThreeD' && node?.data?.action === 'LoadPipeline',
    );
    const pipelineNodes = [...videoPipelineNodes, ...threeDPipelineNodes];
    const modularModels = (graph.nodes ?? []).filter(
      (node) => node?.data?.module === 'modules.ModularDiffusers' && node?.data?.action === 'ModelsLoader',
    );
    if (pipelineNodes.length === 0) {
      if (modularModels.length !== 1) {
        throw new Error(`${workflow.id} video graph has no reviewed Diffusers pipeline.`);
      }
      const models = modularModels[0];
      const modelType = models.data.params?.model_type?.value;
      const repository = models.data.params?.repo_id?.value;
      const revision = models.data.params?.revision?.value;
      if (
        !workflow.pipelineClasses.includes(modelType) ||
        repository?.source !== 'hub' ||
        !workflow.requiredArtifacts.includes(repository.value) ||
        !/^[0-9a-f]{40}$/.test(String(revision ?? ''))
      ) {
        throw new Error(`${workflow.id} modular video loader is missing its exact reviewed artifact identity.`);
      }
      const roleNodes = new Map((graph.nodes ?? []).map((node) => [node?.data?.studioRole, node.id]));
      const route = [
        ['models', 'text_encoders', 'prompt', 'text_encoders'],
        ['models', 'image_encoder', 'imageEmbeddings', 'image_encoder'],
        ['models', 'vae_out', 'imageEncode', 'vae'],
        ['models', 'unet_out', 'denoise', 'unet'],
        ['models', 'scheduler', 'denoise', 'scheduler'],
        ['models', 'vae_out', 'denoise', 'vae'],
        ['models', 'vae_out', 'decode', 'vae'],
        ['loadImage', 'image', 'imageEmbeddings', 'image'],
        ['loadImage', 'image', 'imageEncode', 'image'],
        ['loadLastImage', 'image', 'imageEmbeddings', 'last_image'],
        ['loadLastImage', 'image', 'imageEncode', 'last_image'],
        ['prompt', 'embeddings', 'denoise', 'embeddings'],
        ['imageEmbeddings', 'image_embeds', 'denoise', 'image_embeds'],
        ['imageEmbeddings', 'route_state_out', 'imageEncode', 'route_state_in'],
        ['imageEncode', 'image_condition_latents', 'denoise', 'image_condition_latents'],
        ['imageEncode', 'route_state_out', 'denoise', 'route_state_in'],
        ['denoise', 'latents', 'decode', 'latents'],
        ['denoise', 'route_state_out', 'decode', 'route_state_in'],
        ['decode', 'videos', 'videoExport', 'video'],
      ];
      for (const [sourceRole, sourceHandle, targetRole, targetHandle] of route) {
        if (
          !(graph.edges ?? []).some(
            (edge) =>
              edge.source === roleNodes.get(sourceRole) &&
              edge.sourceHandle === sourceHandle &&
              edge.target === roleNodes.get(targetRole) &&
              edge.targetHandle === targetHandle,
          )
        ) {
          throw new Error(`${workflow.id} modular video route is missing ${sourceRole}.${sourceHandle}.`);
        }
      }
    }
    for (const pipeline of pipelineNodes) {
      const recipeEdge = (graph.edges ?? []).find(
        (edge) => edge.target === pipeline.id && edge.targetHandle === 'execution_recipe',
      );
      if (!recipeEdge) throw new Error(`${workflow.id} video pipeline ${pipeline.id} has no execution recipe.`);
      const recipe = (graph.nodes ?? []).find((node) => node.id === recipeEdge.source);
      if (recipe?.data?.action !== 'DiffusersExecutionRecipe' || recipeEdge.sourceHandle !== 'execution_recipe') {
        throw new Error(`${workflow.id} video pipeline ${pipeline.id} has an invalid execution-recipe edge.`);
      }
      const quantizationEdge = (graph.edges ?? []).find(
        (edge) => edge.target === recipe.id && edge.targetHandle === 'quantization_config',
      );
      const quantization = (graph.nodes ?? []).find((node) => node.id === quantizationEdge?.source);
      if (
        quantization?.data?.action !== 'PipelineQuantizationConfigV2' ||
        quantizationEdge?.sourceHandle !== 'quantization_config'
      ) {
        throw new Error(`${workflow.id} video execution recipe has no component-selective quantization flow.`);
      }
      if (pipeline.data.module === 'modules.DiffusersThreeD') {
        const model = pipeline.data.params?.model_id?.value;
        const pipelineClass = pipeline.data.params?.pipeline_class?.value;
        const revision = pipeline.data.params?.revision?.value;
        const generate = (graph.nodes ?? []).find(
          (node) =>
            node?.data?.module === 'modules.DiffusersThreeD' && node?.data?.action === 'GenerateRenderedArtifact',
        );
        const exportNode = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.Video' && node?.data?.action === 'Export',
        );
        const hasPipelineRoute = (graph.edges ?? []).some(
          (edge) =>
            edge.source === pipeline.id &&
            edge.sourceHandle === 'pipeline' &&
            edge.target === generate?.id &&
            edge.targetHandle === 'pipeline',
        );
        const hasRenderedOrbitRoute = (graph.edges ?? []).some(
          (edge) =>
            edge.source === generate?.id &&
            edge.sourceHandle === 'video' &&
            edge.target === exportNode?.id &&
            edge.targetHandle === 'video',
        );
        if (
          !workflow.pipelineClasses.includes(pipelineClass) ||
          model?.source !== 'hub' ||
          !workflow.requiredArtifacts.includes(model.value) ||
          !/^[0-9a-f]{40}$/.test(String(revision ?? '')) ||
          pipeline.data.params?.mode?.value !== 'text_to_3d' ||
          !hasPipelineRoute ||
          !hasRenderedOrbitRoute
        ) {
          throw new Error(`${workflow.id} rendered-3D graph is missing its exact reviewed artifact or orbit route.`);
        }
        continue;
      }
      const recipeParams = recipe.data.params ?? {};
      if (recipeParams.vae_slicing?.value !== true || typeof recipeParams.vae_tiling?.value !== 'boolean') {
        throw new Error(`${workflow.id} video execution recipe must enable VAE slicing and explicitly select tiling.`);
      }
      const pipelineClass = pipeline.data.params?.pipeline_class?.value;
      const animateMotionArtifacts = {
        AnimateDiffPipeline: {
          repo: 'guoyww/animatediff-motion-adapter-v1-5-2',
          revision: '6167b88ffe39b4441fdf2113e77b99a6f56b7906',
        },
        AnimateLCMPipeline: {
          repo: 'wangfuyun/AnimateLCM',
          revision: '3d4d00fc113225e1040f4d3bec504b6ec750c10c',
        },
      };
      const animateMotion = animateMotionArtifacts[pipelineClass];
      if (animateMotion) {
        const base = pipeline.data.params?.model_id?.value;
        const baseRevision = pipeline.data.params?.revision?.value;
        const motion = pipeline.data.params?.motion_adapter_id?.value;
        const motionRevision = pipeline.data.params?.motion_adapter_revision?.value;
        if (
          base?.source !== 'hub' ||
          base.value !== 'stable-diffusion-v1-5/stable-diffusion-v1-5' ||
          baseRevision !== '451f4fe16113bff5a5d2269ed5ad43b0592e9a14' ||
          motion?.source !== 'hub' ||
          motion.value !== animateMotion.repo ||
          motionRevision !== animateMotion.revision ||
          !workflow.requiredArtifacts.includes(base.value) ||
          !workflow.requiredArtifacts.includes(motion.value) ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_tiling?.value !== false
        ) {
          throw new Error(`${workflow.id} AnimateDiff graph is missing its exact base, motion, or scheduler recipe.`);
        }
      }
      if (pipelineClass === 'CogVideoXPipeline') {
        const base = pipeline.data.params?.model_id?.value;
        const revision = pipeline.data.params?.revision?.value;
        const quantizationParams = quantization.data.params ?? {};
        if (
          base?.source !== 'hub' ||
          base.value !== 'zai-org/CogVideoX-2b' ||
          revision !== '1137dacfc2c9c012bed6a0793f4ecf2ca8e7ba01' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          quantizationParams.components?.value !== '' ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_slicing?.value !== true ||
          recipeParams.vae_tiling?.value !== false
        ) {
          throw new Error(`${workflow.id} CogVideoX graph is missing its exact artifact or safe execution recipe.`);
        }
      }
      if (pipelineClass === 'AllegroPipeline') {
        const base = pipeline.data.params?.model_id?.value;
        const revision = pipeline.data.params?.revision?.value;
        const quantizationParams = quantization.data.params ?? {};
        const generate = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'Generate',
        );
        const generateParams = generate?.data?.params ?? {};
        if (
          base?.source !== 'hub' ||
          base.value !== 'rhymes-ai/Allegro' ||
          revision !== 'c1b9207bb5cb79e2aa08f3d139c17d26c0de55b6' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          quantizationParams.components?.value !== '' ||
          recipeParams.offload_mode?.value !== 'sequential_cpu' ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_slicing?.value !== true ||
          recipeParams.vae_tiling?.value !== false ||
          generateParams.width?.value !== 1280 ||
          generateParams.height?.value !== 720 ||
          generateParams.num_frames?.value !== 88 ||
          generateParams.num_inference_steps?.value !== 100 ||
          generateParams.guidance_scale?.value !== 7.5 ||
          generateParams.max_sequence_length?.value !== 512
        ) {
          throw new Error(`${workflow.id} Allegro graph is missing its exact artifact or bounded native recipe.`);
        }
      }
      if (pipelineClass === 'LattePipeline') {
        const base = pipeline.data.params?.model_id?.value;
        const revision = pipeline.data.params?.revision?.value;
        const quantizationParams = quantization.data.params ?? {};
        const generate = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'Generate',
        );
        const generateParams = generate?.data?.params ?? {};
        if (
          base?.source !== 'hub' ||
          base.value !== 'maxin-cn/Latte-1' ||
          revision !== '0653024365272f061fc44d1078134df22842b687' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          quantizationParams.components?.value !== '' ||
          recipeParams.offload_mode?.value !== 'sequential_cpu' ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_slicing?.value !== true ||
          recipeParams.vae_tiling?.value !== false ||
          generateParams.width?.value !== 512 ||
          generateParams.height?.value !== 512 ||
          generateParams.num_frames?.value !== 16 ||
          generateParams.num_inference_steps?.value !== 50 ||
          generateParams.guidance_scale?.value !== 7.5 ||
          generateParams.max_sequence_length?.value !== 120
        ) {
          throw new Error(`${workflow.id} Latte graph is missing its exact artifact or bounded native recipe.`);
        }
      }
      if (pipelineClass === 'MochiPipeline') {
        const base = pipeline.data.params?.model_id?.value;
        const revision = pipeline.data.params?.revision?.value;
        const quantizationParams = quantization.data.params ?? {};
        const generate = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'Generate',
        );
        const generateParams = generate?.data?.params ?? {};
        if (
          base?.source !== 'hub' ||
          base.value !== 'genmo/mochi-1-preview' ||
          revision !== '14be5fcea23095ed330cb214647916a451e38b6e' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          quantizationParams.components?.value !== '' ||
          recipeParams.offload_mode?.value !== 'sequential_cpu' ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_slicing?.value !== true ||
          recipeParams.vae_tiling?.value !== false ||
          generateParams.width?.value !== 848 ||
          generateParams.height?.value !== 480 ||
          generateParams.num_frames?.value !== 31 ||
          generateParams.num_inference_steps?.value !== 64 ||
          generateParams.guidance_scale?.value !== 4.5 ||
          generateParams.max_sequence_length?.value !== 256
        ) {
          throw new Error(`${workflow.id} Mochi graph is missing its exact artifact or bounded native recipe.`);
        }
      }
      if (['SanaVideoPipeline', 'SanaImageToVideoPipeline'].includes(pipelineClass)) {
        const base = pipeline.data.params?.model_id?.value;
        const revision = pipeline.data.params?.revision?.value;
        const quantizationParams = quantization.data.params ?? {};
        const generate = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'Generate',
        );
        const generateParams = generate?.data?.params ?? {};
        const imageConditioned = pipelineClass === 'SanaImageToVideoPipeline';
        const loadImage = (graph.nodes ?? []).find((node) => node?.data?.studioRole === 'loadImage');
        const imageEdge = (graph.edges ?? []).some(
          (edge) =>
            edge?.source === loadImage?.id &&
            edge?.target === generate?.id &&
            edge?.targetHandle === 'reference_images',
        );
        if (
          base?.source !== 'hub' ||
          base.value !== 'Efficient-Large-Model/SANA-Video_2B_480p_diffusers' ||
          revision !== 'db5f398b13ca086d09a50ce156c20527773841b1' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          quantizationParams.components?.value !== '' ||
          recipeParams.offload_mode?.value !== 'sequential_cpu' ||
          recipeParams.attention_backend?.value !== '_native_math' ||
          recipeParams.attention_components?.value !== '' ||
          recipeParams.vae_slicing?.value !== true ||
          recipeParams.vae_tiling?.value !== false ||
          generateParams.width?.value !== 832 ||
          generateParams.height?.value !== 480 ||
          generateParams.num_frames?.value !== 81 ||
          generateParams.num_inference_steps?.value !== 50 ||
          generateParams.guidance_scale?.value !== 6 ||
          generateParams.max_sequence_length?.value !== 300 ||
          Boolean(loadImage && imageEdge) !== imageConditioned
        ) {
          throw new Error(`${workflow.id} SANA-Video graph is missing its exact artifact or bounded native recipe.`);
        }
      }
      const generateNodes = (graph.nodes ?? []).filter(
        (node) =>
          node?.data?.module === 'modules.DiffusersVideo' &&
          ['Generate', 'GenerateVideoAudio'].includes(node?.data?.action),
      );
      for (const generate of generateNodes) {
        if (generate.data.params?.mode?.value !== workflow.mode) {
          throw new Error(`${workflow.id} video generator ${generate.id} does not preserve mode ${workflow.mode}.`);
        }
      }
      if (['WanPipeline', 'Wan22Pipeline', 'WanTI2VPipeline'].includes(pipelineClass)) {
        if (
          recipeParams.attention_backend?.value !== '_native_flash' ||
          recipeParams.attention_components?.value !== 'transformer'
        ) {
          throw new Error(`${workflow.id} Wan text pipeline must select native flash on the transformer.`);
        }
      }
    }
  }
  if (workflow.mediaKind === 'image' || workflow.mediaKind === 'audio') {
    const facadeModule = workflow.mediaKind === 'image' ? 'modules.DiffusersImage' : 'modules.DiffusersAudio';
    const pipelineNodes = (graph.nodes ?? []).filter(
      (node) => node?.data?.module === facadeModule && node?.data?.action === 'LoadPipeline',
    );
    for (const pipeline of pipelineNodes) {
      const recipeEdge = (graph.edges ?? []).find(
        (edge) => edge.target === pipeline.id && edge.targetHandle === 'execution_recipe',
      );
      const recipe = (graph.nodes ?? []).find((node) => node.id === recipeEdge?.source);
      const quantizationEdge = (graph.edges ?? []).find(
        (edge) => edge.target === recipe?.id && edge.targetHandle === 'quantization_config',
      );
      const quantization = (graph.nodes ?? []).find((node) => node.id === quantizationEdge?.source);
      if (
        recipe?.data?.action !== 'DiffusersExecutionRecipe' ||
        recipeEdge?.sourceHandle !== 'execution_recipe' ||
        quantization?.data?.action !== 'PipelineQuantizationConfigV2' ||
        quantizationEdge?.sourceHandle !== 'quantization_config'
      ) {
        throw new Error(
          `${workflow.id} generic Diffusers pipeline is missing its runtime recipe or quantization flow.`,
        );
      }
      if (
        workflow.mediaKind === 'image' &&
        pipeline.data.params?.pipeline_class?.value === 'HunyuanDiTControlNetPipeline'
      ) {
        const pipelineParams = pipeline.data.params ?? {};
        const recipeParams = recipe.data.params ?? {};
        const quantizationParams = quantization.data.params ?? {};
        const generate = (graph.nodes ?? []).find(
          (node) => node?.data?.module === 'modules.DiffusersImage' && node?.data?.action === 'ControlGenerate',
        );
        const generateParams = generate?.data?.params ?? {};
        const preprocessor = (graph.nodes ?? []).find((node) => node?.data?.studioRole === 'controlPreprocessor');
        const preprocessorParams = preprocessor?.data?.params ?? {};
        const base = pipelineParams.model_id?.value;
        const control = pipelineParams.conditioning_model_id?.value;
        if (
          base?.source !== 'hub' ||
          base.value !== 'Tencent-Hunyuan/HunyuanDiT-v1.2-Diffusers-Distilled' ||
          pipelineParams.revision?.value !== 'ba991d1546d8c50936c4c16398ed0a87b9b99fb1' ||
          control?.source !== 'hub' ||
          control.value !== 'Tencent-Hunyuan/HunyuanDiT-v1.2-ControlNet-Diffusers-Canny' ||
          pipelineParams.conditioning_revision?.value !== 'b2d21391ebcf78939344cfec84891932f9d53aa0' ||
          pipelineParams.dtype?.value !== 'float16' ||
          !workflow.requiredArtifacts.includes(base.value) ||
          !workflow.requiredArtifacts.includes(control.value) ||
          JSON.stringify(quantizationParams.components?.value) !== '["transformer"]' ||
          recipeParams.offload_mode?.value !== 'model_cpu' ||
          generateParams.width?.value !== 1024 ||
          generateParams.height?.value !== 1024 ||
          generateParams.num_inference_steps?.value !== 50 ||
          generateParams.guidance_scale?.value !== 6 ||
          generateParams.conditioning_scale?.value !== 1 ||
          generateParams.max_sequence_length?.value !== 256 ||
          preprocessorParams.low_threshold?.value !== 0.1 ||
          preprocessorParams.high_threshold?.value !== 0.2
        ) {
          throw new Error(`${workflow.id} Hunyuan-DiT ControlNet graph is missing its exact safe assembly or recipe.`);
        }
      }
    }
  }
  if (workflow.mediaKind !== 'video') {
    const embeddedVideoPipelines = (graph.nodes ?? []).filter(
      (node) => node?.data?.module === 'modules.DiffusersVideo' && node?.data?.action === 'LoadPipeline',
    );
    for (const pipeline of embeddedVideoPipelines) {
      const recipeEdge = (graph.edges ?? []).find(
        (edge) => edge.target === pipeline.id && edge.targetHandle === 'execution_recipe',
      );
      const recipe = (graph.nodes ?? []).find((node) => node.id === recipeEdge?.source);
      const quantizationEdge = (graph.edges ?? []).find(
        (edge) => edge.target === recipe?.id && edge.targetHandle === 'quantization_config',
      );
      const quantization = (graph.nodes ?? []).find((node) => node.id === quantizationEdge?.source);
      if (
        recipe?.data?.action !== 'DiffusersExecutionRecipe' ||
        quantization?.data?.action !== 'PipelineQuantizationConfigV2'
      ) {
        throw new Error(`${workflow.id} embedded video pipeline is missing its runtime recipe or quantization flow.`);
      }
    }
  }
  const expectedPreviewDisplay = {
    image: 'ui_image',
    video: 'ui_video',
    audio: 'ui_audio',
    text: 'ui_text',
  }[workflow.mediaKind];
  if (expectedPreviewDisplay) {
    const previewFields = (graph.nodes ?? []).flatMap((node) =>
      Object.entries(node?.data?.params ?? {})
        .filter(([, param]) => param?.display === expectedPreviewDisplay)
        .map(([fieldKey, param]) => ({ node, fieldKey, param })),
    );
    if (previewFields.length === 0) {
      throw new Error(`${workflow.id} has no ${expectedPreviewDisplay} output presentation field.`);
    }
    for (const { node, fieldKey, param } of previewFields) {
      if (
        Object.prototype.hasOwnProperty.call(param, 'value') ||
        Object.prototype.hasOwnProperty.call(param, 'artifacts')
      ) {
        throw new Error(
          `${workflow.id} persists volatile preview data on ${node.id}.${fieldKey}; only the UI field contract may be saved.`,
        );
      }
      if (param.type !== 'url' && expectedPreviewDisplay !== 'ui_text') {
        throw new Error(`${workflow.id} has an invalid type on ${node.id}.${fieldKey}.`);
      }
      if (typeof param.dataSource !== 'string' || param.dataSource.length === 0) {
        throw new Error(`${workflow.id} has no output source for ${node.id}.${fieldKey}.`);
      }
      const sourceParam = node?.data?.params?.[param.dataSource];
      if (!sourceParam || sourceParam.display !== 'output') {
        throw new Error(`${workflow.id} preview ${node.id}.${fieldKey} points to missing output ${param.dataSource}.`);
      }
    }
  }
  const digest = canonicalJsonHash(graph);
  if (digest !== workflow.graphHash) throw new Error(`${workflow.id} graph hash does not match its manifest.`);
  if (
    /(?:file:\/\/|\/(?:home|Users|root|tmp|mnt|workspace)(?:\/|$)|[A-Za-z]:[\\/]|\\\\|localhost|127\.0\.0\.1|\/cache\/)/i.test(
      raw,
    )
  ) {
    throw new Error(`${workflow.id} contains machine-specific state.`);
  }
  if (/modules\.WanVACE\.(?:LoadPipeline|Generate)/.test(raw)) {
    throw new Error(`${workflow.id} uses a legacy Wan node instead of the generic video contract.`);
  }
}

const layoutModuleServer = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { entries: [], noDiscovery: true },
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const graphLayout = await layoutModuleServer.ssrLoadModule('/src/workflow/graphLayout.ts');
  const selectedSupported = requestedPair
    ? manifest.workflows.filter((workflow) => `${workflow.modelType}|${workflow.mode}` === requestedPair)
    : manifest.workflows;
  const selectedExperimental = requestedPair
    ? (manifest.experimentalWorkflows ?? []).filter(
        (workflow) => `${workflow.modelType}|${workflow.mode}` === requestedPair,
      )
    : (manifest.experimentalWorkflows ?? []);
  const selectedCanonicalCount = [...selectedSupported, ...selectedExperimental].filter(
    (workflow) => !workflow.variant,
  ).length;
  if (requestedPair && selectedCanonicalCount !== 1) {
    throw new Error(`The requested canonical workflow pair is not unique: ${requestedPair}.`);
  }
  for (const workflow of selectedSupported) verifyWorkflow(workflow, 'supported', graphLayout);

  const expectedExperimentalCount = Number(manifest.experimentalWorkflowCount ?? 0);
  if (!Number.isInteger(expectedExperimentalCount) || expectedExperimentalCount < 0) {
    throw new Error(`Workflow manifest has an invalid experimentalWorkflowCount.`);
  }
  if (
    !Array.isArray(manifest.experimentalWorkflows) ||
    manifest.experimentalWorkflows.length !== expectedExperimentalCount
  ) {
    throw new Error(
      `Expected ${expectedExperimentalCount} qualified experimental workflows, found ${manifest.experimentalWorkflows?.length ?? 0}.`,
    );
  }
  for (const workflow of selectedExperimental) verifyWorkflow(workflow, 'experimental', graphLayout);

  process.stdout.write(
    `Verified ${selectedSupported.length} supported and ${selectedExperimental.length} qualified experimental portable workflows with deterministic canonical layouts.\n`,
  );
} finally {
  await layoutModuleServer.close();
}
