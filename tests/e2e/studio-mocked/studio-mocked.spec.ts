import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare global {
  interface Window {
    __MODIFF_E2E__?: {
      getState: () => {
        flow: {
          visibleNodeCount: number;
          nodes: Array<{
            id: string;
            module: string;
            action: string;
            params?: Record<string, { value?: unknown; artifacts?: unknown; display?: string; type?: string }>;
            uiState?: { validationSeverity?: string; validationMessage?: string; collapsed?: boolean };
            progress?: number;
            executionStatus?: string;
            executionPhase?: string;
            progressMessage?: string;
            activeTaskId?: string | null;
            attemptIndex?: number;
            studioRole?: string;
            studioOwned?: boolean;
            studioAuxiliary?: boolean;
          }>;
          edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
          historyPast: number;
          historyFuture: number;
        };
        studio: {
          form: {
            mode?: string;
            modelType?: string;
            resourceMode?: string;
            quantizationMode?: string;
            offloadMode?: string;
            prompt?: string;
            negativePrompt?: string;
            referenceImages?: string[];
            maskImage?: string;
            width?: number;
            height?: number;
            outpaintLeft?: number;
            outpaintRight?: number;
            outpaintTop?: number;
            outpaintBottom?: number;
            outpaintOverlap?: number;
            outpaintFeather?: number;
            outpaintFillColor?: string;
            sourceVideo?: string;
            maskVideo?: string;
            controlVideo?: string;
            sourceAudio?: string;
            referenceAudio?: string;
            numFrames?: number;
            fps?: number;
          };
          workflowTabs: unknown[];
          activeWorkflowTabId: string | null;
          activeTemplateId: string | null;
          canvasTransition?: { type?: string; workflowTabId?: string; templateId?: string } | null;
          graphFinalization?: {
            status?: string;
            skeletonMs?: number;
            finalizationMs?: number;
            timedOutGroups?: string[];
            managedEdgeCount?: number;
            message?: string | null;
          } | null;
          lastError?: string | null;
          graphBinding?: {
            nodes?: Record<string, string>;
            managedEdgeIds?: string[];
            managedNodeIds?: string[];
          } | null;
          outputs: Array<{
            id: string;
            nodeId: string;
            fieldKey: string;
            url: string;
            clientRunId?: string;
            runInputHash?: string;
            taskId?: string | null;
            mediaItems?: Array<{
              url: string;
              width?: number;
              height?: number;
              clientRunId?: string;
              runInputHash?: string;
            }>;
          }>;
          importedAssets: Array<{
            id: string;
            url: string;
            name: string;
            backendPath?: string;
            displayType?: string;
            storage?: string;
          }>;
        };
        runIssues: {
          issueDialogOpen: boolean;
          issues: Array<{ repoId?: string; blocking?: boolean }>;
        };
        nodes: {
          hfCache: unknown[];
          hfDownloadProgress: Record<
            string,
            { status?: string; progress?: number; task_id?: string; completed_at?: number | null; error?: string }
          >;
        };
      };
      connectGraph: (connection: {
        source: string;
        target: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      }) => void;
      applyTemplate: (templateId: string, formOverrides?: Record<string, unknown>) => Promise<void>;
      applyNodeDefinitionForAction: (action: string, params: Record<string, unknown>) => boolean;
      inspectCurrentGraph: () => {
        nodeCount: number;
        enabledExecutableCount: number;
        outputPathCount: number;
        outputRefs: Array<{ nodeId: string; nodeLabel?: string; connected: boolean }>;
        modelRefs: Array<{ kind: 'repo' | 'path'; value: string; paramKey: string }>;
        blockingIssues: Array<{ message: string; blocking: boolean; repoId?: string }>;
      };
      setGraphScenarioForTest: (
        scenario:
          'empty' | 'no_enabled' | 'outputless' | 'disconnected_output' | 'missing_model' | 'multi_model_compare',
      ) => void;
      addCustomNodeForTest: (key?: string) => string;
      setFirstNodeCollapsedByAction: (action: string, collapsed: boolean) => boolean;
      setFirstNodePositionByAction: (action: string, position: { x: number; y: number }) => boolean;
      setWebsocketConnection: (connection: { sid?: string | null; isConnected?: boolean }) => void;
      startStudioRunForTest: (identity: { clientRunId: string; runInputHash: string; taskId?: string | null }) => {
        clientRunId: string;
        runInputHash: string;
        taskId?: string | null;
      };
      seedStudioOutputsForTest: (
        outputs: Array<{
          id: string;
          url: string;
          workflowTabId?: string | null;
          createdAt?: number;
          modelLabel?: string;
          prompt?: string;
          displayType?: string;
        }>,
      ) => void;
      seedImportedAssetsForTest: (
        assets: Array<{
          id: string;
          url: string;
          name: string;
          backendPath?: string;
          displayType?: 'image' | 'video' | 'audio' | 'unknown';
          storage?: 'backend' | 'browser';
          createdAt?: number;
        }>,
      ) => void;
      openWorkspacePanelForTest: (
        tab: 'studio' | 'gallery' | 'queue' | 'setup' | 'share' | 'app' | 'blueprints',
      ) => void;
      sendWebsocketMessage: (message: Record<string, unknown>) => void;
    };
  }
}

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(THIS_DIR, '..', '..', '..');
const FRONTEND_PORT = Number(process.env.MODIFF_MOCK_FRONTEND_PORT || 5191);
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const managedProcesses: ChildProcessWithoutNullStreams[] = [];
const mockInstalledRepos = new Set<string>();
let mockDownloadCalls = 0;
let mockIncludeQuantizationNode = true;
let mockIncludeOutpaintNode = true;
let mockDynamicModularFields = false;
let mockFileUploadCalls = 0;
let mockDownloadFailureRepo: string | null = null;
let mockDownloadFailureMessage = '';
let mockHfTokenConfigured = false;

function mockAutoResourcePlan(form: Record<string, unknown> = {}) {
  const modelType = String(form.modelType ?? 'ZImageModularPipeline');
  const mode = String(form.mode ?? 'text_to_image');
  if (!(modelType === 'QwenImageModularPipeline' && mode === 'text_to_image')) {
    const defaultRepos: Record<string, string> = {
      ZImageModularPipeline: 'Tongyi-MAI/Z-Image-Turbo',
      QwenImageEditModularPipeline: 'Qwen/Qwen-Image-Edit',
      QwenImageEditPlusModularPipeline: 'Qwen/Qwen-Image-Edit-2511',
      QwenImageLayeredModularPipeline: 'Qwen/Qwen-Image-Layered',
      WanVACEPipeline: 'Wan-AI/Wan2.1-VACE-1.3B-diffusers',
      AceStepAudioPipeline: 'ACE-Step/acestep-v15-xl-turbo-diffusers',
      FluxSchnellPipeline: 'black-forest-labs/FLUX.1-schnell',
      FluxDevPipeline: 'black-forest-labs/FLUX.1-dev',
      FluxKreaPipeline: 'black-forest-labs/FLUX.1-Krea-dev',
      FluxKontextPipeline: 'black-forest-labs/FLUX.1-Kontext-dev',
      FluxFillPipeline: 'black-forest-labs/FLUX.1-Fill-dev',
      FluxDepthPipeline: 'black-forest-labs/FLUX.1-Depth-dev',
      FluxCannyPipeline: 'black-forest-labs/FLUX.1-Canny-dev',
      FluxReduxPipeline: 'black-forest-labs/FLUX.1-Redux-dev',
    };
    const defaultRepo = defaultRepos[modelType] ?? 'Tongyi-MAI/Z-Image-Turbo';
    const installed = mockInstalledRepos.has(defaultRepo);
    const executionPath =
      modelType === 'WanVACEPipeline'
        ? 'direct-wan-vace'
        : modelType === 'AceStepAudioPipeline'
          ? 'direct-diffusers-audio'
          : modelType.startsWith('Flux')
            ? 'direct-diffusers-image'
            : 'modular-diffusers';
    const candidate = {
      id: `${modelType}-${mode}-declared-safe`,
      executionPath,
      modelRepo: defaultRepo,
      resolvedArtifact: defaultRepo,
      artifact: defaultRepo,
      installTarget: {
        repo: defaultRepo,
        label: 'Auto model',
        reason: `Install ${defaultRepo} for Auto.`,
        actionLabel: 'Install Auto artifact',
      },
      dtype: 'bfloat16',
      quantizationMode: 'none',
      quantizedComponents: [],
      offloadMode: 'model_cpu',
      autoOffload: true,
      qualityTier: 'profile-default',
      generation: {
        width: Number(form.width ?? 1024),
        height: Number(form.height ?? 1024),
        steps: Number(form.steps ?? 30),
        guidanceScale: Number(form.guidanceScale ?? 4),
        negativePrompt: String(form.negativePrompt ?? ''),
        maxSequenceLength: Number(form.maxSequenceLength ?? 512),
      },
      installed,
      artifactStatus: { installed, complete: installed, reason: installed ? null : 'Artifact is not installed.' },
      requiresLocalProbe: false,
      proof: installed
        ? { status: 'declared_safe', source: 'mock_profile' }
        : { status: 'unproven', source: 'mock_profile', message: 'Artifact is not installed.' },
    };
    return {
      error: false,
      resourceMode: 'auto',
      status: installed ? 'ready' : 'needs_setup',
      statusLabel: installed ? 'Ready with local Auto recipe' : 'Needs setup',
      blockingReason: installed ? null : 'No compatible local artifact was found for Auto.',
      selectedCandidate: installed ? candidate : null,
      candidates: [candidate],
      hardware: { runtimeFingerprint: 'mock-runtime' },
      checkedAt: Date.now(),
    };
  }

  const qwenInstalled = mockInstalledRepos.has('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  const selectedCandidate = {
    id: 'qwen-t2i-prequantized-model-cpu',
    executionPath: 'direct-qwen-image',
    modelRepo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    resolvedArtifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    artifact: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
    installTarget: {
      repo: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
      label: 'Qwen Auto artifact',
      reason: 'Install unsloth/Qwen-Image-2512-unsloth-bnb-4bit for Qwen Auto.',
      actionLabel: 'Install quantized artifact',
    },
    dtype: 'bfloat16',
    quantizationMode: 'none',
    quantizedComponents: [],
    offloadMode: 'model_cpu',
    autoOffload: true,
    qualityTier: 'diffusers-compatible-prequantized-quality',
    generation: {
      width: 1024,
      height: 1024,
      steps: 50,
      guidanceScale: 4,
      negativePrompt: ' ',
      maxSequenceLength: 512,
    },
    installed: qwenInstalled,
    artifactStatus: {
      installed: qwenInstalled,
      complete: qwenInstalled,
      reason: qwenInstalled ? null : 'Artifact is not installed.',
    },
    requiresLocalProbe: false,
    proof: qwenInstalled
      ? { status: 'declared_safe', source: 'mock_requirements' }
      : { status: 'unproven', source: 'mock_requirements', message: 'Artifact is not installed.' },
  };
  return {
    error: false,
    resourceMode: 'auto',
    status: qwenInstalled ? 'ready' : 'needs_setup',
    statusLabel: qwenInstalled ? 'Ready with local Auto recipe' : 'Needs setup',
    blockingReason: qwenInstalled ? null : 'No compatible local artifact was found for Auto.',
    selectedCandidate: qwenInstalled ? selectedCandidate : null,
    candidates: [selectedCandidate],
    hardware: { runtimeFingerprint: 'mock-runtime' },
    requirementsMatched: qwenInstalled ? ['artifact', 'hardware', 'quality-defaults'] : [],
    requirementsMissing: qwenInstalled ? [] : ['Install unsloth/Qwen-Image-2512-unsloth-bnb-4bit for Qwen Auto.'],
    checkedAt: Date.now(),
  };
}

const legacyStudioFormWithoutVideoFields = {
  mode: 'text_to_image',
  modelType: 'ZImageModularPipeline',
  prompt: 'legacy persisted prompt',
  negativePrompt: '',
  aspectRatio: '1:1',
  width: 1024,
  height: 1024,
  seed: 42,
  randomSeed: true,
  steps: 8,
  guidanceScale: 1,
  dtype: 'bfloat16',
  device: 'cuda:0',
  autoOffload: true,
  trustRemoteCode: false,
  strength: 0.8,
  layers: 4,
  outpaintLeft: 256,
  outpaintRight: 256,
  outpaintTop: 0,
  outpaintBottom: 0,
  outpaintOverlap: 24,
  outpaintFeather: 8,
  outpaintFillColor: '#000000',
  alphaMode: 'ignore',
  referenceImages: [],
  maskImage: '',
  controlImage: '',
};

function waitForHttp(url: string, timeoutMs = 60_000) {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        setTimeout(tick, 400);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function ensureFrontend() {
  if (!(await isPortFree(FRONTEND_PORT))) return;
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${FRONTEND_PORT}`]
      : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(FRONTEND_PORT)];
  const child = spawn(command, args, {
    cwd: CLIENT_ROOT,
    env: { ...process.env, VITE_BACKEND_PROXY_TARGET: 'http://127.0.0.1:65530' },
  });
  managedProcesses.push(child);
  await waitForHttp(FRONTEND_URL);
}

const nodeDef = (module: string, action: string, category: string, params: Record<string, unknown>) => ({
  type: 'custom',
  module,
  action,
  label: `${module}.${action}`,
  category,
  params,
});

const mockRegistry = {
  'modules.ModularDiffusers.ModelsLoader': nodeDef('modules.ModularDiffusers', 'ModelsLoader', 'loader', {
    model_type: {
      type: 'string',
      display: 'select',
      value: 'ZImageModularPipeline',
      options: ['ZImageModularPipeline', 'QwenImageModularPipeline'],
    },
    repo_id: { type: 'string', value: 'Tongyi-MAI/Z-Image-Turbo' },
    dtype: { type: 'string', value: 'bfloat16' },
    device: { type: 'string', value: 'cuda:0' },
    quant_config: { type: 'quant_config', display: 'input' },
    auto_offload: { type: 'bool', value: true },
    offload_mode: {
      type: 'string',
      value: 'model_cpu',
      options: ['auto_cpu', 'none', 'model_cpu', 'group_cpu', 'group_disk'],
    },
    trust_remote_code: { type: 'bool', value: false },
    text_encoders: { type: 'TextEncoders', display: 'output' },
    unet_out: { type: 'DenoiseModel', display: 'output' },
    vae_out: { type: 'VAE', display: 'output' },
    scheduler: { type: 'Scheduler', display: 'output' },
  }),
  'modules.ModularDiffusers.EncodePrompt': nodeDef('modules.ModularDiffusers', 'EncodePrompt', 'text', {
    text_encoders: { type: 'TextEncoders', display: 'input' },
    prompt: { type: 'text', display: 'text', value: '' },
    negative_prompt: { type: 'text', display: 'text', value: '' },
    embeddings: { type: 'TextEmbeddings', display: 'output' },
  }),
  'modules.ModularDiffusers.Denoise': nodeDef('modules.ModularDiffusers', 'Denoise', 'sampler', {
    unet: { type: 'DenoiseModel', display: 'input' },
    scheduler: { type: 'Scheduler', display: 'input' },
    embeddings: { type: 'TextEmbeddings', display: 'input' },
    width: { type: 'int', value: 1024 },
    height: { type: 'int', value: 1024 },
    seed: { type: 'int', display: 'random', value: { value: 42, isRandom: true } },
    num_inference_steps: { type: 'int', value: 8 },
    guidance_scale: { type: 'float', value: 1 },
    latents: { type: 'Latents', display: 'output' },
  }),
  'modules.ModularDiffusers.DecodeLatents': nodeDef('modules.ModularDiffusers', 'DecodeLatents', 'image', {
    vae: { type: 'VAE', display: 'input' },
    latents: { type: 'Latents', display: 'input' },
    images: { type: 'image', display: 'output' },
  }),
  'modules.Image.Preview': nodeDef('modules.Image', 'Preview', 'image', {
    image: { type: 'image', display: 'input' },
    selected_image: { type: 'image', display: 'ui_image', value: [] },
  }),
  'modules.Image.Load': nodeDef('modules.Image', 'Load', 'image', {
    image: { type: 'image', display: 'output' },
    file: { type: 'str', display: 'filebrowser', value: '' },
    alpha_channel: { type: 'string', value: 'ignore', options: ['ignore', 'add alpha', 'remove alpha'] },
  }),
  'modules.ModularDiffusers.QuantizationConfigNode': nodeDef(
    'modules.ModularDiffusers',
    'QuantizationConfigNode',
    'loader',
    {
      model_id: {
        label: 'Model ID',
        display: 'modelselect',
        type: 'string',
        value: { source: 'hub', value: '' },
        fieldOptions: { noValidation: true, sources: ['hub', 'local'] },
      },
      subfolder: { label: 'Subfolder', type: 'string', value: 'transformer' },
      component: {
        label: 'Component',
        type: 'string',
        value: 'transformer',
        options: ['transformer', 'text_encoder', 'qwen_low_vram'],
      },
      quant_type: { label: 'Quant Type', type: 'string', options: ['bnb_4bit', 'bnb_8bit'], value: 'bnb_4bit' },
      bnb_4bit_quant_type: { label: '4-bit Quant Type', type: 'string', options: ['nf4', 'fp4'], value: 'nf4' },
      bnb_4bit_compute_dtype: {
        label: 'Compute Dtype',
        type: 'string',
        options: ['', 'float32', 'float16', 'bfloat16'],
        value: 'bfloat16',
      },
      bnb_4bit_use_double_quant: { label: 'Double Quant', type: 'boolean', value: true },
      quantization_config: { label: 'Quantization Config', type: 'quant_config', display: 'output' },
    },
  ),
  'modules.DiffusersImage.LoadPipeline': nodeDef('modules.DiffusersImage', 'LoadPipeline', 'Diffusers Image', {
    model_id: { type: 'string', value: 'black-forest-labs/FLUX.1-schnell' },
    pipeline_class: { type: 'string', value: 'FluxPipeline' },
    dtype: { type: 'string', value: 'bfloat16' },
    device: { type: 'string', value: 'cuda:0' },
    pipeline: { type: 'image_diffusion_pipeline', display: 'output' },
  }),
  'modules.DiffusersImage.Generate': nodeDef('modules.DiffusersImage', 'Generate', 'Diffusers Image', {
    pipeline: { type: 'image_diffusion_pipeline', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    images: { type: 'image', display: 'output' },
  }),
  'modules.DiffusersImage.Edit': nodeDef('modules.DiffusersImage', 'Edit', 'Diffusers Image', {
    pipeline: { type: 'image_diffusion_pipeline', display: 'input' },
    image: { type: 'image', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    images: { type: 'image', display: 'output' },
  }),
  'modules.DiffusersImage.Inpaint': nodeDef('modules.DiffusersImage', 'Inpaint', 'Diffusers Image', {
    pipeline: { type: 'image_diffusion_pipeline', display: 'input' },
    image: { type: 'image', display: 'input' },
    mask_image: { type: 'image', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    images: { type: 'image', display: 'output' },
  }),
  'modules.DiffusersImage.ControlGenerate': nodeDef('modules.DiffusersImage', 'ControlGenerate', 'Diffusers Image', {
    pipeline: { type: 'image_diffusion_pipeline', display: 'input' },
    control_image: { type: 'image', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    images: { type: 'image', display: 'output' },
  }),
  'modules.DiffusersAudio.LoadPipeline': nodeDef('modules.DiffusersAudio', 'LoadPipeline', 'Diffusers Audio', {
    model_id: { type: 'string', value: 'ACE-Step/acestep-v15-xl-turbo-diffusers' },
    dtype: { type: 'string', value: 'bfloat16' },
    device: { type: 'string', value: 'cuda:0' },
    pipeline: { type: 'diffusers_audio_pipeline', display: 'output' },
  }),
  'modules.DiffusersAudio.Generate': nodeDef('modules.DiffusersAudio', 'Generate', 'Diffusers Audio', {
    pipeline: { type: 'diffusers_audio_pipeline', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    audio: { type: 'audio', display: 'output' },
  }),
  'modules.Audio.Export': nodeDef('modules.Audio', 'Export', 'audio', {
    audio: { type: 'audio', display: 'input' },
    file: { type: 'str', value: '{PATH:audio}/MoDiff_{HASH:6}.wav' },
  }),
  'modules.QwenImage.LoadPipeline': nodeDef('modules.QwenImage', 'LoadPipeline', 'Qwen Image', {
    pipeline: { type: 'qwen_image_pipeline', display: 'output' },
    model_id: {
      display: 'modelselect',
      type: 'string',
      value: { source: 'hub', value: 'Qwen/Qwen-Image-2512' },
      fieldOptions: { noValidation: true, sources: ['hub', 'local'] },
    },
    dtype: { type: 'string', value: 'bfloat16' },
    device: { type: 'string', value: 'cuda:0' },
    quantization_mode: { type: 'string', value: 'bnb_4bit', options: ['none', 'bnb_4bit'] },
    quantized_components: {
      type: 'string',
      display: 'select',
      value: ['transformer', 'text_encoder'],
      options: ['transformer', 'text_encoder'],
    },
    bnb_4bit_quant_type: { type: 'string', value: 'nf4', options: ['nf4', 'fp4'] },
    bnb_4bit_compute_dtype: { type: 'string', value: 'bfloat16', options: ['float32', 'float16', 'bfloat16'] },
    bnb_4bit_use_double_quant: { type: 'bool', value: true },
    auto_offload: { type: 'bool', value: true },
    offload_mode: {
      type: 'string',
      value: 'model_cpu',
      options: ['auto_cpu', 'none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'],
    },
    resolved_artifact: { type: 'string', display: 'output' },
  }),
  'modules.QwenImage.Generate': nodeDef('modules.QwenImage', 'Generate', 'Qwen Image', {
    pipeline: { type: 'qwen_image_pipeline', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    negative_prompt: { type: 'text', display: 'textarea', value: '' },
    width: { type: 'int', value: 1024 },
    height: { type: 'int', value: 1024 },
    seed: { type: 'int', display: 'random', value: { value: 42, isRandom: true } },
    num_inference_steps: { type: 'int', value: 50 },
    true_cfg_scale: { type: 'float', value: 4 },
    output_type: { type: 'string', value: 'pil' },
    max_sequence_length: { type: 'int', value: 512 },
    images: { type: 'image', display: 'output' },
  }),
  'modules.QwenImage.LoadInpaintPipeline': nodeDef('modules.QwenImage', 'LoadInpaintPipeline', 'Qwen Image', {
    pipeline: { type: 'qwen_image_inpaint_pipeline', display: 'output' },
    model_id: {
      display: 'modelselect',
      type: 'string',
      value: { source: 'hub', value: 'Qwen/Qwen-Image-Edit' },
      fieldOptions: { noValidation: true, sources: ['hub', 'local'] },
    },
    dtype: { type: 'string', value: 'bfloat16' },
    device: { type: 'string', value: 'cuda:0' },
    quant_config: { type: 'quant_config', display: 'input' },
    auto_offload: { type: 'bool', value: true },
    offload_mode: {
      type: 'string',
      value: 'model_cpu',
      options: ['auto_cpu', 'none', 'model_cpu', 'sequential_cpu', 'group_cpu', 'group_disk'],
    },
  }),
  'modules.QwenImage.OutpaintCanvas': nodeDef('modules.QwenImage', 'OutpaintCanvas', 'Qwen Image', {
    image: { type: 'image', display: 'input' },
    width: { type: 'int', value: 1344 },
    height: { type: 'int', value: 768 },
    left: { type: 'int', value: 256 },
    right: { type: 'int', value: 256 },
    top: { type: 'int', value: 0 },
    bottom: { type: 'int', value: 0 },
    overlap: { type: 'int', value: 24 },
    feather: { type: 'float', value: 8 },
    fill_color: { type: 'string', value: '#000000' },
    canvas: { type: 'image', display: 'output' },
    mask_image: { type: 'image', display: 'output' },
    width_out: { type: 'int', display: 'output' },
    height_out: { type: 'int', display: 'output' },
  }),
  'modules.QwenImage.Inpaint': nodeDef('modules.QwenImage', 'Inpaint', 'Qwen Image', {
    pipeline: { type: 'qwen_image_inpaint_pipeline', display: 'input' },
    image: { type: 'image', display: 'input' },
    mask_image: { type: 'image', display: 'input' },
    prompt: { type: 'text', display: 'textarea', value: '' },
    negative_prompt: { type: 'text', display: 'textarea', value: '' },
    width: { type: 'int', value: 1024 },
    height: { type: 'int', value: 1024 },
    seed: { type: 'int', display: 'random', value: { value: 42, isRandom: true } },
    num_inference_steps: { type: 'int', value: 40 },
    true_cfg_scale: { type: 'float', value: 4 },
    strength: { type: 'float', value: 0.6 },
    output_type: { type: 'string', value: 'pil' },
    max_sequence_length: { type: 'int', value: 512 },
    images: { type: 'image', display: 'output' },
  }),
};

const mockGraphList = [
  {
    isDir: true,
    path: 'modiff',
    name: 'modiff',
    children: [{ isDir: false, path: 'modiff/z_image_quick_concept.json', name: 'z_image_quick_concept.json' }],
  },
  {
    isDir: true,
    path: 'modular_diffusers',
    name: 'modular_diffusers',
    children: [{ isDir: false, path: 'modular_diffusers/qwen_text_rendering.json', name: 'qwen_text_rendering.json' }],
  },
  {
    isDir: true,
    path: 'saved',
    name: 'Saved',
    children: [{ isDir: false, path: 'saved/custom_graph.json', name: 'custom_graph.json' }],
  },
  {
    isDir: true,
    path: 'imported',
    name: 'Imported',
    children: [{ isDir: false, path: 'imported/reference_edit.json', name: 'reference_edit.json' }],
  },
];

async function installMockRoutes(page: Page) {
  mockFileUploadCalls = 0;
  await page.route('**/cache', async (route) => {
    const body = route.request().postDataJSON() as { nodes?: unknown } | null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ error: false, nodes: Array.isArray(body?.nodes) ? body.nodes : [] }),
    });
  });
  await page.route('**/cache/**', async (route) => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYGJAQoAHQMBgOrlxjcAAAAASUVORK5CYII=',
      'base64',
    );
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'content-disposition': 'inline; filename="mock-output.png"' },
      body: png,
    });
  });
  await page.route('**/file**', async (route) => {
    if (route.request().method() === 'POST') {
      mockFileUploadCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ error: false, path: `data/images/imported-reference-${mockFileUploadCalls}.png` }),
      });
      return;
    }
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYGJAQoAHQMBgOrlxjcAAAAASUVORK5CYII=',
      'base64',
    );
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'content-disposition': 'inline; filename="imported-reference.png"' },
      body: png,
    });
  });
  await page.route('**/nodes**', async (route) => {
    const nodes = Object.fromEntries(
      Object.entries(mockRegistry)
        .filter(([key]) => {
          if (!mockIncludeQuantizationNode && key === 'modules.ModularDiffusers.QuantizationConfigNode') return false;
          if (!mockIncludeOutpaintNode && key === 'modules.QwenImage.OutpaintCanvas') return false;
          return true;
        })
        .map(([key, value]) => {
          if (!mockDynamicModularFields) return [key, value];
          if (key === 'modules.ModularDiffusers.EncodePrompt') {
            return [
              key,
              nodeDef('modules.ModularDiffusers', 'EncodePrompt', 'text', {
                text_encoders: { type: 'TextEncoders', display: 'input' },
              }),
            ];
          }
          if (key === 'modules.ModularDiffusers.Denoise') {
            return [
              key,
              nodeDef('modules.ModularDiffusers', 'Denoise', 'sampler', {
                unet: { type: 'DenoiseModel', display: 'input' },
              }),
            ];
          }
          return [key, value];
        }),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ instance: 'mock', nodes }),
    });
  });
  await page.route('**/listgraphs', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockGraphList) });
  });
  await page.route('**/hf_cache**', async (route) => {
    const compact = new URL(route.request().url()).searchParams.get('compact') === '1';
    const installed = Array.from(mockInstalledRepos);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        compact
          ? installed
          : installed.map((id) => ({
              id,
              type: 'model',
              size: 0,
              last_accessed: 0,
              revisions: [{ hash: `${id}-mock-revision`, size: 0, last_modified: 0 }],
              class_names: [],
            })),
      ),
    });
  });
  await page.route('**/local_models**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/model_cache/diagnostics**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        locations: [{ label: 'Mock HF cache', path: 'mock', exists: true, repo_count: 0, runnable: true }],
        external_model_packages: [],
        hf_compatible_external_repos: [],
      }),
    });
  });
  await page.route('**/model_capabilities**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ capabilities: [] }) });
  });
  await page.route('**/custom_modules', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ modules: [] }) });
  });
  await page.route('**/auto_resource/plans', async (route) => {
    const body = route.request().postDataJSON() as { forms?: Array<Record<string, unknown>>; keys?: string[] } | null;
    const forms = Array.isArray(body?.forms) ? body.forms : [];
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    const plans = forms.map((form, index) => ({
      ...mockAutoResourcePlan(form),
      planKey: keys[index],
    }));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plans }) });
  });
  await page.route('**/auto_resource/plan', async (route) => {
    const body = route.request().postDataJSON() as { form?: Record<string, unknown> } | null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockAutoResourcePlan(body?.form)),
    });
  });
  await page.route('**/studio_outputs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputs: [] }) });
  });
  await page.route('**/runtime/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ready: true,
        config: { hf_token_configured: mockHfTokenConfigured },
        packages: {
          torch: {
            available: true,
            cuda_available: true,
            cuda_device_count: 1,
            cuda_devices: [
              {
                index: 0,
                name: 'Mock CUDA 16GB',
                memory_total_bytes: 16 * 1024 ** 3,
                memory_free_bytes: 15 * 1024 ** 3,
              },
            ],
          },
        },
      }),
    });
  });
  await page.route('**/hf_download**', async (route) => {
    mockDownloadCalls += 1;
    const url = new URL(route.request().url());
    const repoId = url.searchParams.get('repo_id') ?? 'missing';
    if (mockDownloadFailureRepo === repoId) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: mockDownloadFailureMessage || `403 gated repo: account is not authorized for ${repoId}`,
          repo_id: repoId,
        }),
      });
      return;
    }
    mockInstalledRepos.add(repoId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ error: false, result: true, task_id: 'mock-install-1', repo_id: repoId }),
    });
  });
}

async function setStudioViewMode(page: Page, mode: 'auto' | 'expert') {
  const toggle = page.getByTestId('topbar-auto-switch');
  const expected = mode === 'auto' ? 'true' : 'false';
  if ((await toggle.getAttribute('aria-checked')) !== expected) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-checked', expected);
}

async function openTemplateBrowser(page: Page) {
  await page.getByTestId('left-tab-templates').click();
  await page.getByTestId('left-open-template-browser').click();
  await expect(page.getByTestId('template-browser-search')).toBeVisible();
}

test.afterAll(() => {
  for (const child of managedProcesses.reverse()) {
    if (!child.killed) child.kill();
  }
});

test.beforeEach(() => {
  mockDynamicModularFields = false;
  mockDownloadFailureRepo = null;
  mockDownloadFailureMessage = '';
  mockHfTokenConfigured = false;
});

test('model downloads show topbar activity, session progress, and completion notification', async ({ page }) => {
  mockInstalledRepos.clear();
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;

  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL);
  await expect(page.getByText('MoDiff')).toBeVisible();

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'hf_download_progress',
      repo_id: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
      task_id: 'download-e2e-1',
      download_id: 'download-e2e-1',
      status: 'downloading',
      phase: 'downloading',
      progress: 0.34,
      downloaded_bytes: Math.round(6.19 * 1024 ** 3),
      total_bytes: Math.round(18.4 * 1024 ** 3),
      remaining_bytes: Math.round(12.21 * 1024 ** 3),
      bytes_per_second: 1_690_000,
      eta_seconds: 7_225,
      completed_file_count: 3,
      total_file_count: 23,
      cache_dir: 'C:/Users/example/.cache/huggingface/hub',
      started_at: Date.now() / 1000 - 465,
      updated_at: Date.now() / 1000,
    });
  });

  await expect(page.getByTestId('topbar-download-activity')).toContainText('34%');
  await expect(page.getByTestId('download-session-list')).toBeVisible();
  await expect(page.getByTestId('session-download-unsloth/Qwen-Image-2512-unsloth-bnb-4bit')).toContainText(
    '6.2 GB of 18 GB',
  );
  await expect(page.getByTestId('session-download-unsloth/Qwen-Image-2512-unsloth-bnb-4bit')).toContainText(
    '3/23 files',
  );

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'hf_download_progress',
      repo_id: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit',
      task_id: 'download-e2e-1',
      download_id: 'download-e2e-1',
      status: 'complete',
      phase: 'complete',
      progress: 1,
      downloaded_bytes: Math.round(18.4 * 1024 ** 3),
      total_bytes: Math.round(18.4 * 1024 ** 3),
      remaining_bytes: 0,
      completed_file_count: 23,
      total_file_count: 23,
      started_at: Date.now() / 1000 - 600,
      completed_at: Date.now() / 1000,
      updated_at: Date.now() / 1000,
    });
  });

  await expect(
    page.getByRole('status').filter({ hasText: 'unsloth/Qwen-Image-2512-unsloth-bnb-4bit installed' }),
  ).toBeVisible();
  await expect(page.getByTestId('session-download-unsloth/Qwen-Image-2512-unsloth-bnb-4bit')).toContainText('Complete');
});

test('mocked Studio normalizes legacy persisted forms without video fields', async ({ page }) => {
  mockInstalledRepos.clear();
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ensureFrontend();
  await installMockRoutes(page);
  await page.addInitScript((legacyForm) => {
    const oldTemplateId = ['z', 'co' + 'mfy', 'cinematic_contact_sheet'].join('_');
    window.localStorage.setItem(
      'modiff.studio',
      JSON.stringify({
        state: {
          selectedMode: 'text_to_image',
          form: legacyForm,
          activeTemplateId: oldTemplateId,
          workflowTabs: [
            {
              id: 'legacy-tab',
              title: 'Legacy tab',
              createdAt: 1,
              updatedAt: 1,
              dirty: false,
              source: 'template',
              sourceLabel: oldTemplateId,
              snapshot: {
                nodes: [],
                edges: [],
                viewport: { x: 0, y: 0, zoom: 1 },
                studioForm: legacyForm,
                studioGraphBinding: null,
                selectedMode: 'text_to_image',
                activeTemplateId: oldTemplateId,
                sourceOutputId: null,
              },
            },
          ],
          activeWorkflowTabId: 'legacy-tab',
          outputs: [
            {
              id: 'legacy-output',
              url: '/file?file=legacy-output.png',
              mode: 'text_to_image',
              modelType: 'ZImageModularPipeline',
              templateId: oldTemplateId,
              formSnapshot: legacyForm,
            },
          ],
        },
        version: 0,
      }),
    );
  }, legacyStudioFormWithoutVideoFields);

  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  const state = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  expect(state.studio.form.sourceVideo).toBe('');
  expect(state.studio.form.maskVideo).toBe('');
  expect(state.studio.form.controlVideo).toBe('');
  expect(state.studio.form.numFrames).toBe(81);
  expect(state.studio.form.fps).toBe(16);
  expect(state.studio.form.quantizationMode).toBe('none');
  expect(state.studio.activeTemplateId).toBe('z_image_cinematic_contact_sheet');
  expect(state.studio.workflowTabs[0].sourceLabel).toBe('z_image_cinematic_contact_sheet');
  expect(state.studio.workflowTabs[0].snapshot.activeTemplateId).toBe('z_image_cinematic_contact_sheet');
  expect(state.studio.outputs[0].templateId).toBe('z_image_cinematic_contact_sheet');

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('mocked Studio keeps model health contextual and hides advanced FLUX by default', async ({ page }) => {
  mockInstalledRepos.clear();
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  await page.getByTestId('left-tab-models').click();
  await expect(page.getByTestId('left-model-installed')).toBeVisible();
  await expect(page.getByTestId('left-model-supported')).toBeVisible();
  await page.getByRole('button', { name: /^Image \d+$/ }).click();
  await expect(page.getByTestId('left-model-FluxSchnellPipeline')).toBeVisible();
  await expect(page.getByText('FLUX.1-dev', { exact: true })).toHaveCount(0);
  await expect(page.getByText('FLUX.1-Krea-dev', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Hardware blocks', { exact: true })).toHaveCount(0);
  await page.getByTestId('left-tab-nodes').click();
  await expect(page.getByTestId('node-browser-view-essential')).toHaveCount(0);
  await page.getByTestId('node-group-Load').click();
  await expect(page.getByTestId('node-row-modules-DiffusersImage-LoadPipeline')).toContainText('Load pipeline');
  await expect(page.getByTestId('node-row-modules-DiffusersImage-LoadPipeline')).not.toContainText('Diffusers');
  await expect(page.getByTestId('node-row-modules-DiffusersAudio-LoadPipeline')).toContainText('Load pipeline');
  await expect(page.getByTestId('node-row-modules-QwenImage-LoadPipeline')).toHaveCount(0);
  await page.getByTestId('node-group-Generate').click();
  await expect(page.getByTestId('node-row-modules-DiffusersImage-Generate')).toContainText('Generate image');
  await expect(page.getByTestId('node-row-modules-DiffusersAudio-Generate')).toContainText('Generate audio');
  await page.getByTestId('node-group-Edit').click();
  await expect(page.getByTestId('node-row-modules-DiffusersImage-Edit')).toContainText('Edit image');
  await page.getByTestId('node-group-Preview').click();
  await expect(page.getByTestId('node-row-modules-Image-Preview')).toContainText('Preview');
  await page.getByTestId('node-group-Export').click();
  await expect(page.getByTestId('node-row-modules-Audio-Export')).toContainText('Export');
  await setStudioViewMode(page, 'expert');
  await expect(page.getByTestId('node-browser-view-essential')).toBeVisible();
  await page.getByTestId('node-browser-view-advanced').click();
  await page.getByTestId('node-group-Qwen-Image').click();
  await expect(page.getByTestId('node-row-modules-QwenImage-LoadPipeline')).toBeVisible();
  await setStudioViewMode(page, 'auto');

  await page.getByTestId('left-tab-templates').click();
  await page.getByTestId('left-open-template-browser').click();
  await expect(page.getByTestId('template-browser-search')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-getting-started')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-image')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-edit')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-control')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-performance')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-planning')).toHaveCount(0);
  await page.getByTestId('template-browser-category-all').click();
  await page.getByTestId('template-browser-search').fill('flux');
  await expect(page.getByTestId('template-browser-use-flux_schnell_text_to_image')).toBeVisible();
  await expect(page.getByTestId('template-browser-use-flux_dev_expert_text_to_image')).toHaveCount(0);
  await expect(page.getByTestId('template-browser-use-flux_kontext_edit')).toHaveCount(0);
  await expect(page.getByTestId('template-browser-use-flux_fill_inpaint')).toHaveCount(0);
  await expect(page.getByTestId('template-browser-use-flux_control_canny')).toHaveCount(0);
  const modelFilterText = await page.getByRole('combobox').first().textContent();
  expect(modelFilterText).not.toContain('FLUX.1-dev');
  expect(modelFilterText).not.toContain('FLUX.1-Krea-dev');

  await page.getByTestId('template-browser-use-flux_schnell_text_to_image').click();
  await expect(page.getByTestId('template-detail-flux_schnell_text_to_image')).toBeVisible();
  await page.getByTestId('template-browser-create-flux_schnell_text_to_image').click();
  await expect(page.getByTestId('template-browser-search')).toBeHidden();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.activeTemplateId;
    })
    .toBe('flux_schnell_text_to_image');

  await page.getByTestId('left-tab-models').click();
  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  await page.getByText('Advanced diagnostics', { exact: true }).click();
  await expect(page.getByTestId('setup-workflow-model-health')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('setup-model-FluxSchnellPipeline')).toBeVisible();
  await expect(page.getByTestId('setup-install-FluxSchnellPipeline')).toBeVisible();
  await expect(page.getByTestId('setup-model-FluxDevPipeline')).toHaveCount(0);
  await expect(page.getByText('FLUX.1-dev', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('setup-workflow-model-health')).not.toContainText('Auto:');
  await expect(page.getByTestId('setup-workflow-model-health')).not.toContainText('Backend modes:');
});

test('mocked Workflows panel groups MoDiff examples in Auto and reveals raw roots in Expert', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  await page.getByTestId('left-tab-workflows').click();
  await expect(page.getByTestId('workflow-list')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('workflow-source-MoDiff-Examples')).toBeVisible();
  await expect(page.getByTestId('workflow-source-Saved')).toBeVisible();
  await expect(page.getByTestId('workflow-source-Imported')).toBeVisible();
  await expect(page.getByTestId('workflow-source-modiff')).toHaveCount(0);
  await expect(page.getByTestId('workflow-source-modular-diffusers')).toHaveCount(0);

  await setStudioViewMode(page, 'expert');
  await expect(page.getByTestId('workflow-source-modiff')).toBeVisible();
  await expect(page.getByTestId('workflow-source-modular-diffusers')).toBeVisible();
  await expect(page.getByTestId('workflow-source-MoDiff-Examples')).toHaveCount(0);
});

test('mocked Gallery and workflow export use the latest active workflow output', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  const activeWorkflowTabId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  expect(activeWorkflowTabId).toBeTruthy();
  const now = Date.now();
  await page.evaluate(
    ({ tabId, timestamp }) => {
      window.__MODIFF_E2E__!.seedStudioOutputsForTest([
        {
          id: 'stale-global-output',
          url: '/cache/stale-global-output.png',
          workflowTabId: null,
          createdAt: timestamp + 3000,
          modelLabel: 'Stale global output',
          prompt: 'global stale prompt',
        },
        {
          id: 'other-workflow-output',
          url: '/cache/other-workflow-output.png',
          workflowTabId: 'other-workflow-tab',
          createdAt: timestamp + 2000,
          modelLabel: 'Other workflow output',
          prompt: 'other workflow prompt',
        },
        {
          id: 'active-workflow-output',
          url: '/cache/active-workflow-output.png',
          workflowTabId: tabId,
          createdAt: timestamp,
          modelLabel: 'Active workflow output',
          prompt: 'active workflow prompt',
        },
      ]);
    },
    { tabId: activeWorkflowTabId, timestamp: now },
  );

  await page.getByTestId('left-tab-assets').click();
  await expect(page.getByTestId('left-gallery-output-0')).toBeVisible();
  await expect(page.getByTestId('left-gallery-output-0')).toHaveAttribute('title', /Active workflow output/);
  await expect(page.getByTestId('left-gallery-output-1')).toHaveCount(0);
  await expect(page.getByTestId('left-gallery-thumbnails')).not.toContainText('No outputs yet.');

  await setStudioViewMode(page, 'expert');
  await page.getByTestId('topbar-export').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('topbar-export-workflow-package').click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const workflowPackage = JSON.parse(await fs.readFile(downloadPath!, 'utf8')) as {
    latestOutput?: { id?: string; url?: string };
  };
  expect(workflowPackage.latestOutput).toMatchObject({
    id: 'active-workflow-output',
    url: '/cache/active-workflow-output.png',
  });
});

test('mocked imported assets fill active Studio input slots', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('ACE-Step/acestep-v15-xl-turbo-diffusers');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_control_image_layout', {
        controlImage: '',
        referenceImages: [],
      });
    } catch {
      // The mocked registry intentionally omits the legacy ControlNet graph nodes.
    }
    window.__MODIFF_E2E__!.seedImportedAssetsForTest([
      {
        id: 'control-map',
        name: 'control-map.png',
        url: '/cache/control-map.png',
        displayType: 'image',
      },
    ]);
  });
  await page.getByTestId('left-tab-assets').click();
  await expect(page.getByTestId('left-imported-asset-0')).toBeVisible();
  await page.getByTestId('left-imported-asset-0').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.form.controlImage;
    })
    .toBe('/cache/control-map.png');

  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_inpaint_object_replace', {
        referenceImages: [],
        maskImage: '',
      });
    } catch {
      // Some graph nodes are intentionally absent from the mocked registry.
    }
    window.__MODIFF_E2E__!.seedImportedAssetsForTest([
      {
        id: 'inpaint-source',
        name: 'inpaint-source.png',
        url: '/cache/inpaint-source.png',
        displayType: 'image',
      },
      {
        id: 'inpaint-mask',
        name: 'inpaint-mask.png',
        url: '/cache/inpaint-mask.png',
        displayType: 'image',
      },
    ]);
  });
  await page.getByTestId('left-imported-asset-0').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.form.referenceImages?.[0];
    })
    .toBe('/cache/inpaint-source.png');
  await page.getByTestId('left-imported-asset-1').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.form.maskImage;
    })
    .toBe('/cache/inpaint-mask.png');

  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('ace_step_audio_continuation', {
        sourceAudio: '',
      });
    } catch {
      // The field-routing behavior can still be tested when graph synthesis is mocked out.
    }
    window.__MODIFF_E2E__!.seedImportedAssetsForTest([
      {
        id: 'source-audio',
        name: 'source-audio.wav',
        url: '/cache/source-audio.wav',
        displayType: 'audio',
      },
    ]);
  });
  await page.getByTestId('left-imported-asset-0').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        mode: current.studio.form.mode,
        sourceAudio: current.studio.form.sourceAudio,
      };
    })
    .toEqual({
      mode: 'audio_continuation',
      sourceAudio: '/cache/source-audio.wav',
    });
});

test('mocked imported assets can be added through browser file selection', async ({ page }, testInfo) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  const imagePath = testInfo.outputPath('imported-reference.png');
  await fs.writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYGJAQoAHQMBgOrlxjcAAAAASUVORK5CYII=',
      'base64',
    ),
  );

  await page.getByTestId('left-tab-assets').click();
  await expect(page.getByTestId('left-imported-thumbnails')).toContainText('Import assets');
  await page.getByLabel('Import assets').setInputFiles(imagePath);

  await expect(page.getByTestId('left-imported-asset-0')).toBeVisible();
  await expect(page.getByTestId('left-imported-asset-0')).toHaveAttribute('title', 'imported-reference.png');
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.importedAssets?.map(
        (asset: { name?: string; displayType?: string; url?: string; backendPath?: string; storage?: string }) => ({
          backendPath: asset.backendPath,
          displayType: asset.displayType,
          name: asset.name,
          storage: asset.storage,
          urlIsBackendFile: Boolean(asset.url?.includes('/file?file=')),
        }),
      );
    })
    .toEqual([
      {
        backendPath: 'data/images/imported-reference-1.png',
        displayType: 'image',
        name: 'imported-reference.png',
        storage: 'backend',
        urlIsBackendFile: true,
      },
    ]);
  expect(mockFileUploadCalls).toBe(1);

  await page.getByTestId('left-imported-asset-0').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.studio.form.referenceImages?.[0];
    })
    .toBe('data/images/imported-reference-1.png');
});

test('mocked full Gallery exposes generated and imported asset controls', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  const activeWorkflowTabId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  const now = Date.now();
  await page.evaluate(
    ({ tabId, timestamp }) => {
      window.__MODIFF_E2E__!.seedStudioOutputsForTest([
        {
          id: 'gallery-output-a',
          url: '/cache/gallery-output-a.png',
          workflowTabId: tabId,
          createdAt: timestamp + 1000,
          modelLabel: 'Gallery output A',
          prompt: 'gallery output A prompt',
        },
        {
          id: 'gallery-output-b',
          url: '/cache/gallery-output-b.png',
          workflowTabId: tabId,
          createdAt: timestamp,
          modelLabel: 'Gallery output B',
          prompt: 'gallery output B prompt',
        },
      ]);
      window.__MODIFF_E2E__!.seedImportedAssetsForTest([
        {
          id: 'gallery-import',
          name: 'gallery-import.png',
          url: '/file?file=data%2Fimages%2Fgallery-import.png',
          backendPath: 'data/images/gallery-import.png',
          displayType: 'image',
          storage: 'backend',
        },
      ]);
    },
    { tabId: activeWorkflowTabId, timestamp: now },
  );

  await page.getByTestId('topbar-gallery').click();
  const gallery = page.getByTestId('gallery-panel');
  await expect(gallery).toBeVisible();
  await expect(page.getByTestId('gallery-kind-generated')).toContainText('Generated 2');
  await expect(page.getByTestId('gallery-kind-imported')).toContainText('Imported 1');
  await expect(page.getByTestId('gallery-output-0')).toBeVisible();
  await expect(page.getByTestId('gallery-download-package-0')).toBeVisible();
  await expect(page.getByTestId('gallery-restore-0')).toBeVisible();
  await expect(page.getByTestId('gallery-rerun-0')).toBeVisible();
  await expect(page.getByTestId('gallery-delete-0')).toBeVisible();
  await expect(page.getByTestId('gallery-copy-metadata-0')).toBeVisible();

  await page.getByTestId('gallery-view-inspect').click();
  await expect(page.getByTestId('gallery-inspect-view')).toBeVisible();
  await page.getByTestId('gallery-view-compare').click();
  await expect(page.getByTestId('gallery-compare-view')).toBeVisible();
  await page.getByTestId('gallery-view-lineage').click();
  await expect(page.getByTestId('gallery-lineage-view')).toBeVisible();

  await page.getByTestId('gallery-kind-imported').click();
  await expect(page.getByTestId('gallery-imported-grid')).toBeVisible();
  await expect(page.getByTestId('gallery-imported-storage-0')).toContainText('Backend');
  await expect(page.getByTestId('gallery-imported-storage-0')).toHaveAttribute(
    'title',
    'data/images/gallery-import.png',
  );
  await expect(page.getByTestId('gallery-imported-use-0')).toBeVisible();
  await expect(page.getByTestId('gallery-imported-delete-0')).toBeVisible();
  await page.getByTestId('gallery-imported-use-0').click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        mode: current.studio.form.mode,
        reference: current.studio.form.referenceImages?.[0],
      };
    })
    .toEqual({
      mode: 'edit_image',
      reference: 'data/images/gallery-import.png',
    });
  await expect(page.getByTestId('gallery-panel')).toHaveCount(0);
});

test('mocked topbar Export menu is compact in Auto and raw in Expert', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  const activeWorkflowTabId = await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.activeWorkflowTabId);
  await page.evaluate(
    ({ tabId }) => {
      window.__MODIFF_E2E__!.seedStudioOutputsForTest([
        {
          id: 'export-output',
          url: '/cache/export-output.png',
          workflowTabId: tabId,
          modelLabel: 'Export output',
          prompt: 'export output prompt',
        },
      ]);
    },
    { tabId: activeWorkflowTabId },
  );

  await page.getByTestId('topbar-export').click();
  await expect(page.getByTestId('topbar-export-menu')).toBeVisible();
  await expect(page.getByTestId('topbar-export-workflow-package')).toBeVisible();
  await expect(page.getByTestId('topbar-export-latest-output')).toBeVisible();
  await expect(page.getByTestId('topbar-export-open-gallery')).toBeVisible();
  await expect(page.getByTestId('topbar-export-raw-workflow')).toHaveCount(0);
  await expect(page.getByTestId('topbar-export-api-graph')).toHaveCount(0);

  await page.getByTestId('topbar-export-open-gallery').click();
  await expect(page.getByTestId('gallery-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('gallery-panel')).toHaveCount(0);

  await setStudioViewMode(page, 'expert');
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await page.getByTestId('topbar-export').click();
  await expect(page.getByTestId('topbar-export-workflow-package')).toBeVisible();
  await expect(page.getByTestId('topbar-export-raw-workflow')).toBeVisible();
  await expect(page.getByTestId('topbar-export-api-graph')).toBeVisible();
  await expect(page.getByTestId('topbar-export-api-graph')).toBeEnabled();
});

test('mocked Run as app tab is Expert-only and graph-output gated', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('studio'));
  await expect(page.getByTestId('workspace-tabs-more')).toHaveCount(0);

  await setStudioViewMode(page, 'expert');
  await expect(page.getByTestId('workspace-tabs-more')).toHaveCount(0);
  await page.evaluate(() => window.__MODIFF_E2E__!.setGraphScenarioForTest('outputless'));
  await expect(page.getByTestId('workspace-tabs-more')).toHaveCount(0);

  await page.evaluate(() => window.__MODIFF_E2E__!.setGraphScenarioForTest('multi_model_compare'));
  const morePanels = page.getByTestId('workspace-tabs-more');
  await expect(morePanels).toBeVisible();
  await morePanels.getByRole('button', { name: 'More panels' }).click();
  await page.getByRole('menuitem', { name: 'Run as app' }).click();
  await expect(page.getByTestId('workspace-tab-app')).toBeVisible();
  await expect(page.getByTestId('app-mode-panel')).toContainText('Run as app');
  await expect(page.getByTestId('app-mode-create')).toBeEnabled();
  await page.getByTestId('app-mode-create').click();
  await expect(page.getByTestId('app-mode-run')).toBeDisabled();
});

test('mocked Model Manager stays compact, grouped, and install-target aware', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockHfTokenConfigured = true;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await expect(page.getByTestId('task-launcher')).toBeVisible();

  await page.getByTestId('left-tab-models').click();
  await page.getByTestId('left-open-model-manager').click();
  const dialog = page.getByTestId('model-manager-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('model-manager-installed')).toBeVisible();
  await expect(dialog.getByTestId('model-manager-supported')).toBeVisible();
  await expect(dialog.getByTestId('model-manager-supported-FluxSchnellPipeline')).toBeVisible();
  await expect(dialog.getByTestId('model-manager-supported-FluxDevPipeline')).toHaveCount(0);
  await expect(dialog.getByText('FLUX.1-dev', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('Auto:', { exact: false })).toHaveCount(0);
  await expect(dialog.getByText('Backend modes:', { exact: false })).toHaveCount(0);

  const fluxInstall = dialog.getByTestId('model-manager-install-FluxSchnellPipeline');
  await expect(fluxInstall).toContainText('Install');
  await fluxInstall.click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        calls: mockDownloadCalls,
        status: current.nodes.hfDownloadProgress['black-forest-labs/FLUX.1-schnell']?.status,
        cached: current.nodes.hfCache.includes('black-forest-labs/FLUX.1-schnell'),
      };
    })
    .toEqual({ calls: 1, status: 'complete', cached: true });
  await expect(fluxInstall).toContainText('Ready', { timeout: 30_000 });
});

test('mocked gated model install failures stay compact and actionable', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockHfTokenConfigured = true;
  mockDownloadFailureRepo = 'black-forest-labs/FLUX.1-schnell';
  mockDownloadFailureMessage =
    '403 gated repo: account example-user is not authorized for black-forest-labs/FLUX.1-schnell. Visit Hugging Face, accept the model license, configure the token, then retry the download.';
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });

  await page.getByTestId('left-tab-models').click();
  await page.getByTestId('left-open-model-manager').click();
  const dialog = page.getByTestId('model-manager-dialog');
  await expect(dialog).toBeVisible();

  const fluxInstall = dialog.getByTestId('model-manager-install-FluxSchnellPipeline');
  await fluxInstall.click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        calls: mockDownloadCalls,
        status: current.nodes.hfDownloadProgress['black-forest-labs/FLUX.1-schnell']?.status,
      };
    })
    .toEqual({ calls: 1, status: 'error' });

  await expect(page.getByTestId('session-download-black-forest-labs/FLUX.1-schnell')).toContainText('Access required');
  await expect(page.getByTestId('session-download-black-forest-labs/FLUX.1-schnell')).not.toContainText(
    'account example-user is not authorized',
  );
  await expect(fluxInstall).toContainText('Retry');
  await expect(fluxInstall).toHaveAttribute('title', /not authorized/);
});

test('mocked Expert Model Manager exposes diagnostics and hidden profiles', async ({ page }) => {
  mockInstalledRepos.clear();
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await setStudioViewMode(page, 'expert');

  await page.getByTestId('topbar-models').click();
  const expertDialog = page.getByTestId('model-manager-dialog');
  await expect(expertDialog).toBeVisible();
  await expect(expertDialog.getByTestId('model-manager-diagnostics')).toBeVisible();
  await expect(expertDialog.getByTestId('model-manager-supported-FluxDevPipeline')).toBeVisible();
});

test('mocked workflow artifact requirements are contextual and role grouped', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });

  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_control_image_layout', {
        controlImage: 'mock-control.png',
        referenceImages: ['mock-control.png'],
        resourceMode: 'expert',
      });
    } catch {
      // The mocked registry intentionally omits the legacy ControlNet graph nodes.
    }
  });
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        mode: current.studio.form.mode,
        modelType: current.studio.form.modelType,
      };
    })
    .toEqual({ mode: 'control_image', modelType: 'QwenImageModularPipeline' });

  await page.getByTestId('left-tab-models').click();
  const currentModels = page.getByTestId('left-model-current');
  await expect(currentModels).toBeVisible();
  await expect(currentModels).toContainText('Qwen ControlNet Union');
  await expect(currentModels).toContainText('Control');
  const controlRequirement = page.getByTestId(
    'left-model-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
  );
  await expect(
    controlRequirement.getByTestId(
      'left-install-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
    ),
  ).toContainText('Install');

  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  await page.getByText('Advanced diagnostics', { exact: true }).click();
  const setupRequirement = page.getByTestId(
    'setup-model-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
  );
  await expect(setupRequirement).toBeVisible();
  await expect(
    setupRequirement.getByTestId(
      'setup-install-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
    ),
  ).toContainText('Install');

  await page.getByTestId('setup-models').click();
  const dialog = page.getByTestId('model-manager-dialog');
  await expect(dialog).toBeVisible();
  const managerRequirement = dialog.getByTestId(
    'model-manager-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
  );
  await expect(managerRequirement).toBeVisible();
  const managerInstall = managerRequirement.getByTestId(
    'model-manager-install-requirement-mode:QwenImageModularPipeline:control_image:qwen-controlnet-union',
  );
  await expect(managerInstall).toContainText('Install');
  await managerInstall.click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        cached: current.nodes.hfCache.includes('InstantX/Qwen-Image-ControlNet-Union'),
        calls: mockDownloadCalls,
      };
    })
    .toEqual({ cached: true, calls: 1 });
});

test('mocked custom graph inspector blocks invalid graphs in Auto and Expert', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();

  const scenarios: Array<{
    scenario: 'empty' | 'no_enabled' | 'outputless' | 'disconnected_output' | 'missing_model';
    title: RegExp;
    summary: { nodeCount: number; enabledExecutableCount: number; outputPathCount: number };
  }> = [
    {
      scenario: 'empty',
      title: /Add nodes before running\./,
      summary: { nodeCount: 0, enabledExecutableCount: 0, outputPathCount: 0 },
    },
    {
      scenario: 'no_enabled',
      title: /Add nodes before running\./,
      summary: { nodeCount: 2, enabledExecutableCount: 0, outputPathCount: 0 },
    },
    {
      scenario: 'outputless',
      title: /Add a connected output node before running\./,
      summary: { nodeCount: 1, enabledExecutableCount: 1, outputPathCount: 0 },
    },
    {
      scenario: 'disconnected_output',
      title: /Connect the graph to an output before running\./,
      summary: { nodeCount: 2, enabledExecutableCount: 2, outputPathCount: 0 },
    },
    {
      scenario: 'missing_model',
      title: /missing\/GraphModel is required by imported workflow node/,
      summary: { nodeCount: 2, enabledExecutableCount: 2, outputPathCount: 1 },
    },
  ];

  for (const mode of ['auto', 'expert'] as const) {
    await setStudioViewMode(page, mode);

    for (const item of scenarios) {
      await page.evaluate((scenario) => {
        window.__MODIFF_E2E__!.setGraphScenarioForTest(scenario);
      }, item.scenario);

      const summary = await page.evaluate(() => window.__MODIFF_E2E__!.inspectCurrentGraph());
      expect(summary.nodeCount).toBe(item.summary.nodeCount);
      expect(summary.enabledExecutableCount).toBe(item.summary.enabledExecutableCount);
      expect(summary.outputPathCount).toBe(item.summary.outputPathCount);
      expect(summary.blockingIssues.some((issue) => item.title.test(issue.message))).toBe(true);

      const taskSummary = page.getByTestId('studio-task-model-summary');
      if (item.summary.nodeCount === 0) {
        await expect(taskSummary).toContainText('Current task');
        await expect(taskSummary).not.toContainText('Custom graph');
      } else {
        await expect(taskSummary).toContainText('Current graph');
        await expect(taskSummary).toContainText('Custom graph');
        await expect(page.getByTestId('studio-model-select')).toHaveCount(0);
      }
      await expect(page.getByTestId('studio-run-readiness')).toContainText(item.title, { timeout: 30_000 });
      await expect(page.getByTestId('studio-run')).toBeDisabled({ timeout: 30_000 });
    }
  }
});

test('mocked custom graph artifact requirements show a compact install action', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.setGraphScenarioForTest('missing_model');
  });

  const requirementId = 'graph:scenario-model:repo_id:missing/GraphModel';
  const readiness = page.getByTestId('studio-run-readiness');
  await expect(readiness).toContainText('missing/GraphModel', { timeout: 30_000 });
  await readiness.click();
  const runIssues = page.getByTestId('run-issues-dialog');
  await expect(runIssues.getByRole('heading', { name: 'Run blocked' })).toBeVisible();
  await expect(runIssues).toContainText('missing/GraphModel');
  await page.keyboard.press('Escape');
  await expect(runIssues).toHaveCount(0);

  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('setup'));
  await page.getByText('Advanced diagnostics', { exact: true }).click();
  await expect(page.getByTestId('setup-current-graph-health')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('setup-current-graph-health')).toContainText('Graph needs attention');
  const setupRow = page.getByTestId(`setup-graph-requirement-${requirementId}`);
  await expect(setupRow).toBeVisible();
  await expect(setupRow).toContainText('GraphModel');

  await page.evaluate(() => window.__MODIFF_E2E__!.openWorkspacePanelForTest('studio'));
  await page.getByTestId('studio-run-readiness').click();
  await expect(runIssues.getByRole('heading', { name: 'Run blocked' })).toBeVisible();
  const install = runIssues.getByRole('button', { name: 'Install', exact: true });
  await expect(install).toContainText('Install');
  await install.click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        cached: current.nodes.hfCache.includes('missing/GraphModel'),
        calls: mockDownloadCalls,
      };
    })
    .toEqual({ cached: true, calls: 1 });
});

test('mocked custom graph inspector summarizes multi-model comparison graphs', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.setGraphScenarioForTest('multi_model_compare');
  });

  const summary = await page.evaluate(() => window.__MODIFF_E2E__!.inspectCurrentGraph());
  expect(summary.nodeCount).toBe(4);
  expect(summary.enabledExecutableCount).toBe(4);
  expect(summary.outputPathCount).toBe(2);
  expect(summary.outputRefs.filter((item) => item.connected)).toHaveLength(2);
  expect(summary.modelRefs.some((item) => item.value === 'Tongyi-MAI/Z-Image-Turbo')).toBe(true);
  expect(summary.modelRefs.some((item) => item.value === 'Qwen/Qwen-Image-2512')).toBe(true);
  expect(summary.blockingIssues).toHaveLength(0);

  await expect(page.getByTestId('studio-task-model-summary')).toContainText('Graph models');
  await expect(page.getByTestId('studio-task-model-summary')).toContainText('2 model refs');
  await expect(page.getByTestId('studio-model-select')).toHaveCount(0);
  await expect(page.getByTestId('studio-run-readiness')).toContainText('Ready');
  await expect(page.getByTestId('studio-prompt-input')).toHaveCount(0);
  await expect(page.getByTestId('studio-run')).toBeEnabled();
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });
});

test('mocked Studio switches managed recipes to compact custom graph inspector after manual canvas edits', async ({
  page,
}) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await expect(page.getByTestId('studio-task-model-summary')).toContainText('Current task');
  await expect(page.getByTestId('studio-pinned-graph-inputs')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        return Boolean(current.studio.graphBinding);
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.addCustomNodeForTest('modules.Image.Preview');
  });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        return {
          bound: Boolean(current.studio.graphBinding),
          nodeCount: current.flow.nodes.length,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      bound: false,
      nodeCount: 4,
    });
  await expect(page.getByTestId('studio-task-model-summary')).toContainText('Current graph');
  await expect(page.getByTestId('studio-task-model-summary')).toContainText('Custom graph');
  await expect(page.getByTestId('studio-prompt-input')).toHaveCount(0);
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });
});

test('mocked Studio blocks missing models, marks loader red, and keeps local tabs', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-Edit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await expect(page.getByTestId('task-launcher')).toBeVisible();
  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await expect(page.getByTestId('studio-section-panel-task')).toBeVisible();
  await expect(page.getByTestId('studio-section-panel-prompt')).toHaveCount(0);
  await expect(page.getByTestId('studio-pinned-graph-inputs')).toBeVisible();
  await openTemplateBrowser(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('template-browser-search')).toBeHidden();
  await page.getByTestId('left-tab-assets').click();
  await expect(page.getByTestId('left-open-gallery-library')).toBeVisible();
  await page.getByTestId('left-tab-models').click();
  await expect(page.getByTestId('left-open-model-manager')).toBeVisible();
  await openTemplateBrowser(page);
  await expect(page.getByTestId('template-browser-use-z_image_quick_concept')).toBeVisible();
  await expect(page.getByTestId('template-browser-card-z_image_quick_concept')).toContainText('20-45 sec');
  await page.getByTestId('template-browser-category-all').click();
  await expect(page.getByTestId('template-browser-use-z_image_cinematic_contact_sheet')).toBeVisible();
  await expect(page.getByTestId('template-browser-use-qwen_product_ad_composite')).toBeVisible();
  await expect(page.getByTestId('template-browser-use-qwen_packaging_dieline')).toBeVisible();
  await expect(page.getByTestId('template-browser-use-qwen_inpaint_object_replace')).toBeVisible();
  await expect(page.getByTestId('template-browser-category-planning')).toBeHidden();
  await page.getByTestId('template-browser-use-qwen_outpaint_aspect_template').click();
  await expect(page.getByTestId('template-detail-qwen_outpaint_aspect_template')).toBeVisible();
  await expect(page.getByTestId('template-readiness-qwen_outpaint_aspect_template')).toContainText('Needs input');
  await expect(page.getByTestId('template-browser-create-qwen_outpaint_aspect_template')).toContainText('Create graph');
  await page.getByTestId('template-browser-use-z_image_quick_concept').click();
  await expect(page.getByTestId('template-detail-z_image_quick_concept')).toBeVisible();
  await expect(page.getByTestId('template-detail-z_image_quick_concept')).toContainText('8-12 GB with offload');
  await expect(page.getByTestId('template-readiness-z_image_quick_concept')).toContainText('Needs model');
  await page.getByTestId('template-browser-create-z_image_quick_concept').click();
  await expect(page.getByTestId('template-browser-search')).toBeHidden();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        activeTemplateId: current.studio.activeTemplateId,
        tabCount: current.studio.workflowTabs.length,
      };
    })
    .toEqual({ activeTemplateId: 'z_image_quick_concept', tabCount: 2 });
  await expect(page.getByTestId('studio-pinned-graph-inputs')).toBeVisible();

  await expect(page.getByTestId('studio-run')).toBeDisabled();
  const missingModelReadiness = page.getByTestId('studio-run-readiness');
  await expect(missingModelReadiness).toContainText('Run blocked', { timeout: 30_000 });
  await missingModelReadiness.click();
  const runIssues = page.getByTestId('run-issues-dialog');
  await expect(runIssues).toContainText('Tongyi-MAI/Z-Image-Turbo');
  await page.keyboard.press('Escape');

  const state = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  const loaderNode = state.flow.nodes.find((node) => node.studioRole === 'diffusersImagePipeline');
  expect(loaderNode?.module).toBe('modules.DiffusersImage');
  expect(loaderNode?.params?.pipeline_class?.value).toBe('ZImagePipeline');
  expect(loaderNode?.uiState?.validationSeverity).toBe('error');

  const graphAfterRunBlock = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  const studioNodeIds = graphAfterRunBlock.flow.nodes
    .filter((node) => node.studioRole)
    .map((node) => node.id)
    .sort();
  expect(studioNodeIds).toHaveLength(3);
  expect(graphAfterRunBlock.flow.nodes.some((node) => node.studioRole === 'diffusersImageGenerate')).toBe(true);
  expect(graphAfterRunBlock.flow.edges.length).toBeGreaterThan(0);
  const fieldHookCount = await page.evaluate(() => document.querySelectorAll('.modiff-field').length);
  expect(fieldHookCount).toBeGreaterThan(0);
  const graphVisuals = await page.evaluate(() => {
    const edges = [...document.querySelectorAll('.react-flow__edge .react-flow__edge-path')]
      .map((edgePath) => getComputedStyle(edgePath).stroke)
      .filter(Boolean);
    const handles = [...document.querySelectorAll('.react-flow__handle')].map((handle) => {
      const style = getComputedStyle(handle);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        width: style.width,
        height: style.height,
      };
    });

    return {
      edgeColors: [...new Set(edges)],
      handleColors: [...new Set(handles.map((handle) => handle.backgroundColor))],
      handleSizes: [...new Set(handles.map((handle) => `${handle.width}x${handle.height}`))],
      handleRadii: [...new Set(handles.map((handle) => handle.borderRadius))],
    };
  });
  expect(graphVisuals.edgeColors.length).toBeGreaterThanOrEqual(2);
  expect(graphVisuals.handleColors.length).toBeGreaterThanOrEqual(2);
  expect(graphVisuals.handleSizes).toEqual(['12pxx12px']);
  expect(graphVisuals.handleRadii).toEqual(['4px']);
  const originalEdges = graphAfterRunBlock.flow.edges;
  const firstEdge = originalEdges[0];
  const replacementEdge = originalEdges.find((edge) => edge.source !== firstEdge?.source && edge.sourceHandle);
  expect(firstEdge).toBeTruthy();
  expect(replacementEdge).toBeTruthy();
  await page.evaluate(
    ({ source, sourceHandle, target, targetHandle }) => {
      window.__MODIFF_E2E__!.connectGraph({ source, sourceHandle, target, targetHandle });
    },
    {
      source: replacementEdge!.source,
      sourceHandle: replacementEdge!.sourceHandle ?? null,
      target: firstEdge!.target,
      targetHandle: firstEdge!.targetHandle ?? null,
    },
  );
  const rewiredEdges = await page.evaluate(() => window.__MODIFF_E2E__!.getState().flow.edges);
  expect(rewiredEdges).not.toEqual(originalEdges);
  await page.keyboard.press('Control+Z');
  await expect
    .poll(async () => (await page.evaluate(() => window.__MODIFF_E2E__!.getState())).flow.edges)
    .toEqual(originalEdges);
  await page.keyboard.press('Control+Y');
  await expect
    .poll(async () => (await page.evaluate(() => window.__MODIFF_E2E__!.getState())).flow.edges)
    .toEqual(rewiredEdges);

  await setStudioViewMode(page, 'expert');
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('z_image_quick_concept', { resourceMode: 'expert' });
  });
  const graphAfterSecondUpdate = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  const expertStudioNodeIds = graphAfterSecondUpdate.flow.nodes
    .filter((node) => node.studioRole)
    .map((node) => node.id)
    .sort();
  expect(expertStudioNodeIds).toHaveLength(5);
  expect(
    graphAfterSecondUpdate.flow.nodes.some((node) => node.studioRole === 'models' && node.action === 'ModelsLoader'),
  ).toBe(true);
  expect(graphAfterSecondUpdate.flow.edges.length).toBeGreaterThanOrEqual(graphAfterRunBlock.flow.edges.length);

  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('z_image_quick_concept', { resourceMode: 'expert' });
    await window.__MODIFF_E2E__!.applyTemplate('z_image_quick_concept', { resourceMode: 'expert' });
  });
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        ids: current.flow.nodes
          .filter((node) => node.studioRole)
          .map((node) => node.id)
          .sort(),
        nodeCount: current.flow.nodes.length,
        edgeCount: current.flow.edges.length,
      };
    })
    .toEqual({
      ids: expertStudioNodeIds,
      nodeCount: graphAfterSecondUpdate.flow.nodes.length,
      edgeCount: graphAfterSecondUpdate.flow.edges.length,
    });

  const renderedGraphNodeAction = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>('[data-testid^="graph-node-action-"]');
    return node?.dataset.testid?.replace('graph-node-action-', '') ?? '';
  });
  expect(renderedGraphNodeAction).toBeTruthy();
  await page.getByTestId(`graph-node-action-${renderedGraphNodeAction}`).first().dispatchEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    button: 2,
    clientX: 360,
    clientY: 260,
  });
  await page.getByTestId('node-menu-collapse-toggle').click();
  const collapsedState = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  expect(
    collapsedState.flow.nodes.some((node) => node.action === renderedGraphNodeAction && node.uiState?.collapsed),
  ).toBe(true);

  await missingModelReadiness.click();
  await runIssues.getByRole('button', { name: 'Install', exact: true }).first().click();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        calls: mockDownloadCalls,
        status: current.nodes.hfDownloadProgress['Tongyi-MAI/Z-Image-Turbo']?.status,
        cached: current.nodes.hfCache.includes('Tongyi-MAI/Z-Image-Turbo'),
      };
    })
    .toEqual({ calls: 1, status: 'complete', cached: true });
  await page.keyboard.press('Escape');
  await expect(runIssues).toBeHidden();

  await page.getByTestId('workflow-tab-new').click();
  const tabState = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
  expect(tabState.studio.workflowTabs.length).toBeGreaterThanOrEqual(2);
  expect(tabState.studio.activeWorkflowTabId).toBeTruthy();
});

test('mocked Studio blanks the canvas while creating a template workflow', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Tongyi-MAI/Z-Image-Turbo');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return current.flow.nodes.length;
    })
    .toBeGreaterThan(0);

  await openTemplateBrowser(page);
  await page.getByTestId('template-browser-use-z_image_quick_concept').click();
  await expect(page.getByTestId('template-detail-z_image_quick_concept')).toBeVisible();

  const transitionVisible = page.waitForFunction(
    () => {
      const current = window.__MODIFF_E2E__!.getState();
      return current.studio.canvasTransition?.type === 'template_graph_building' && current.flow.visibleNodeCount === 0;
    },
    null,
    { timeout: 30_000 },
  );
  await page.getByTestId('template-browser-create-z_image_quick_concept').click();
  await transitionVisible;

  await expect(page.getByTestId('template-browser-search')).toBeHidden();
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        activeTemplateId: current.studio.activeTemplateId,
        transition: current.studio.canvasTransition,
        visibleNodeCount: current.flow.visibleNodeCount,
      };
    })
    .toEqual({
      activeTemplateId: 'z_image_quick_concept',
      transition: null,
      visibleNodeCount: 3,
    });
});

test('mocked Studio renders direct Qwen template skeleton without waiting on Modular fields', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await openTemplateBrowser(page);
  await page.getByTestId('template-browser-category-all').click();
  await page.getByTestId('template-browser-use-qwen_low_vram_product_concept').click();
  await expect(page.getByTestId('template-detail-qwen_low_vram_product_concept')).toBeVisible();
  await page.getByTestId('template-browser-create-qwen_low_vram_product_concept').click();

  await expect(page.getByTestId('template-browser-search')).toBeHidden();
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        return {
          activeTemplateId: current.studio.activeTemplateId,
          transition: current.studio.canvasTransition,
          visibleNodeCount: current.flow.visibleNodeCount,
          finalization: current.studio.graphFinalization?.status,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      activeTemplateId: 'qwen_low_vram_product_concept',
      transition: null,
      visibleNodeCount: 3,
      finalization: 'complete',
    });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const pipelineNode = current.flow.nodes.find(
          (node) => node.action === 'LoadPipeline' && node.module === 'modules.QwenImage',
        );
        const generateNode = current.flow.nodes.find(
          (node) => node.action === 'Generate' && node.module === 'modules.QwenImage',
        );
        const pipelineEdge = current.flow.edges.find(
          (edge) =>
            edge.source === pipelineNode?.id &&
            edge.target === generateNode?.id &&
            edge.sourceHandle === 'pipeline' &&
            edge.targetHandle === 'pipeline',
        );
        return {
          finalization: current.studio.graphFinalization?.status,
          promptValue: generateNode?.params?.prompt?.value,
          offloadMode: pipelineNode?.params?.offload_mode?.value,
          quantizedComponents: pipelineNode?.params?.quantized_components?.value,
          pipelineEdge: Boolean(pipelineEdge),
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      finalization: 'complete',
      promptValue: await page.evaluate(() => window.__MODIFF_E2E__!.getState().studio.form.prompt),
      offloadMode: 'model_cpu',
      quantizedComponents: [],
      pipelineEdge: true,
    });
});

test('mocked Studio blocks Expert Modular Qwen run while prompt embeddings are still finalizing', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await setStudioViewMode(page, 'expert');
  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
        resourceMode: 'expert',
        quantizationMode: 'bnb_4bit',
        dtype: 'bfloat16',
        autoOffload: true,
        offloadMode: 'model_cpu',
        device: 'cuda:0',
      });
    } catch {
      // The dynamic registry intentionally leaves prompt embeddings unresolved.
    }
  });
  await expect(page.getByTestId('studio-run')).toBeDisabled({ timeout: 30_000 });
  await expect(page.getByTestId('studio-run-readiness')).toContainText('Run blocked', { timeout: 30_000 });
  await expect(page.getByTestId('studio-graph-finalization')).toContainText('prompt embeddings', { timeout: 30_000 });
});

test('mocked Studio wires direct Qwen Auto graph on a 16GB CUDA device', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
      resourceMode: 'auto',
      device: 'cuda:0',
    });
  });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await setStudioViewMode(page, 'auto');
  await expect(page.getByTestId('studio-task-model-summary')).toContainText('Qwen-Image-2512', { timeout: 30_000 });
  await expect(page.getByTestId('studio-pinned-graph-inputs')).toBeVisible();
  await expect(page.getByTestId('studio-update-graph')).toHaveCount(0);
  await expect
    .poll(async () => {
      const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
      return {
        resourceMode: current.studio.form.resourceMode,
        width: current.studio.form.width,
        height: current.studio.form.height,
      };
    })
    .toEqual({ resourceMode: 'auto', width: 1024, height: 768 });
  await expect(page.getByTestId('studio-run-readiness')).toContainText('Ready', { timeout: 30_000 });
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const pipelineNode = current.flow.nodes.find(
          (node) => node.module === 'modules.QwenImage' && node.action === 'LoadPipeline',
        );
        const generateNode = current.flow.nodes.find(
          (node) => node.module === 'modules.QwenImage' && node.action === 'Generate',
        );
        const quantNode = current.flow.nodes.find((node) => node.action === 'QuantizationConfigNode');
        const pipelineEdge = current.flow.edges.find(
          (edge) =>
            edge.source === pipelineNode?.id &&
            edge.target === generateNode?.id &&
            edge.sourceHandle === 'pipeline' &&
            edge.targetHandle === 'pipeline',
        );
        return {
          quantizationMode: current.studio.form.quantizationMode,
          resourceMode: current.studio.form.resourceMode,
          offloadMode: current.studio.form.offloadMode,
          steps: current.studio.form.steps,
          guidanceScale: current.studio.form.guidanceScale,
          pipelineRole: pipelineNode?.studioRole,
          generateRole: generateNode?.studioRole,
          quantNodeVisible: Boolean(quantNode),
          quantizedComponents: pipelineNode?.params?.quantized_components?.value,
          generateWidth: generateNode?.params?.width?.value,
          generateHeight: generateNode?.params?.height?.value,
          generateSteps: generateNode?.params?.num_inference_steps?.value,
          generateGuidance: generateNode?.params?.true_cfg_scale?.value,
          pipelineEdge: Boolean(pipelineEdge),
          graphBindingRole: Boolean(current.studio.graphBinding?.nodes?.qwenPipeline),
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      quantizationMode: 'none',
      resourceMode: 'auto',
      offloadMode: 'model_cpu',
      steps: 50,
      guidanceScale: 4,
      pipelineRole: 'qwenPipeline',
      generateRole: 'qwenGenerate',
      quantNodeVisible: false,
      quantizedComponents: [],
      generateWidth: 1024,
      generateHeight: 768,
      generateSteps: 50,
      generateGuidance: 4,
      pipelineEdge: true,
      graphBindingRole: true,
    });

  await setStudioViewMode(page, 'expert');
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const actions = current.flow.nodes.map((node) => node.action);
        return {
          resourceMode: current.studio.form.resourceMode,
          hasDirectPipeline: actions.includes('LoadPipeline'),
          hasDirectGenerate: actions.includes('Generate'),
          hasQuantization: actions.includes('QuantizationConfigNode'),
          hasModels: actions.includes('ModelsLoader'),
          hasPrompt: actions.includes('EncodePrompt'),
          hasDenoise: actions.includes('Denoise'),
          hasDecode: actions.includes('DecodeLatents'),
          hasPreview: actions.includes('Preview'),
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      resourceMode: 'expert',
      hasDirectPipeline: false,
      hasDirectGenerate: false,
      hasQuantization: false,
      hasModels: true,
      hasPrompt: true,
      hasDenoise: true,
      hasDecode: true,
      hasPreview: true,
    });

  await setStudioViewMode(page, 'auto');
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const pipelineNode = current.flow.nodes.find(
          (node) => node.module === 'modules.QwenImage' && node.action === 'LoadPipeline',
        );
        const generateNode = current.flow.nodes.find(
          (node) => node.module === 'modules.QwenImage' && node.action === 'Generate',
        );
        const quantNode = current.flow.nodes.find((node) => node.action === 'QuantizationConfigNode');
        return {
          resourceMode: current.studio.form.resourceMode,
          offloadMode: current.studio.form.offloadMode,
          pipelineRole: pipelineNode?.studioRole,
          generateRole: generateNode?.studioRole,
          quantNodeVisible: Boolean(quantNode),
          graphBindingRole: Boolean(current.studio.graphBinding?.nodes?.qwenPipeline),
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      resourceMode: 'auto',
      offloadMode: 'model_cpu',
      pipelineRole: 'qwenPipeline',
      generateRole: 'qwenGenerate',
      quantNodeVisible: false,
      graphBindingRole: true,
    });
});

test('mocked Studio image preview actions and progress ignore stale websocket messages', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockInstalledRepos.add('unsloth/Qwen-Image-2512-unsloth-bnb-4bit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
      resourceMode: 'auto',
      device: 'cuda:0',
    });
  });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        return {
          generate: current.flow.nodes.find((node) => node.action === 'Generate')?.id,
          preview: current.flow.nodes.find((node) => node.action === 'Preview')?.id,
        };
      },
      { timeout: 30_000 },
    )
    .toMatchObject({ generate: expect.any(String), preview: expect.any(String) });

  const graphIds = await page.evaluate(() => {
    const current = window.__MODIFF_E2E__!.getState();
    window.__MODIFF_E2E__!.setFirstNodePositionByAction('Preview', { x: -120, y: -40 });
    return {
      generate: current.flow.nodes.find((node) => node.action === 'Generate')!.id,
      preview: current.flow.nodes.find((node) => node.action === 'Preview')!.id,
    };
  });
  const canvasPreviewNode = page.locator(`[data-id="${graphIds.preview}"]`);

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.startStudioRunForTest({
      clientRunId: 'run-current',
      runInputHash: 'hash-current',
      taskId: 'task-current',
    });
  });

  await page.evaluate(({ generate }) => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'task_started',
      sid: 'mock-sid',
      current: { task_id: 'task-current', name: 'Mock run', progress: 0, status: 'running' },
      queued: [],
    });
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'progress',
      task_id: 'task-current',
      client_run_id: 'run-current',
      run_input_hash: 'hash-current',
      attempt_index: 0,
      node: generate,
      status: 'running',
      phase: 'denoising',
      message: 'Denoising 2/10',
      progress: 20,
    });
  }, graphIds);

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const generate = current.flow.nodes.find((node) => node.id === graphIds.generate);
        return {
          progress: generate?.progress,
          status: generate?.executionStatus,
          phase: generate?.executionPhase,
          message: generate?.progressMessage,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      progress: 20,
      status: 'running',
      phase: 'denoising',
      message: 'Denoising 2/10',
    });
  await expect(page.getByTestId('run-session-shelf')).toContainText('Mock run', { timeout: 10_000 });
  await expect(page.getByTestId('session-run-task-current')).toContainText('Denoising 2/10', { timeout: 10_000 });

  await page.evaluate(({ generate }) => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'progress',
      task_id: 'older-task',
      attempt_index: 0,
      node: generate,
      status: 'running',
      phase: 'loading',
      message: 'Stale loading',
      progress: 80,
    });
  }, graphIds);

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const generate = current.flow.nodes.find((node) => node.id === graphIds.generate);
        return {
          progress: generate?.progress,
          phase: generate?.executionPhase,
          message: generate?.progressMessage,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      progress: 20,
      phase: 'denoising',
      message: 'Denoising 2/10',
    });

  await page.evaluate(({ preview }) => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'update_value',
      task_id: 'task-current',
      client_run_id: 'run-current',
      run_input_hash: 'hash-current',
      attempt_index: 0,
      node: preview,
      key: 'selected_image',
      data_type: 'image',
      value: ['/cache/preview-node/output/0?format=PNG&filename=mock-output.png'],
      artifacts: [
        {
          url: '/cache/preview-node/output/0?format=PNG&filename=mock-output.png',
          nodeId: preview,
          fieldKey: 'selected_image',
          index: 0,
          mimeType: 'image/png',
          filename: 'mock-output.png',
          width: 2,
          height: 2,
          clientRunId: 'run-current',
          runInputHash: 'hash-current',
          taskId: 'task-current',
          source: 'cache',
        },
      ],
    });
  }, graphIds);

  const previewImage = canvasPreviewNode.getByAltText(/Selected_image/i);
  await expect(previewImage).toBeVisible({ timeout: 10_000 });
  await expect(previewImage).toHaveCSS('image-rendering', 'auto');
  const imageLayout = await page.evaluate(({ preview }) => {
    const node = document.querySelector(`[data-id="${preview}"]`) as HTMLElement | null;
    const frame = document.querySelector(
      `[data-testid="node-preview-image-${preview}-selected_image-0"]`,
    ) as HTMLElement | null;
    const handle = node?.querySelector('.react-flow__handle') as HTMLElement | null;
    const nodeRect = node?.getBoundingClientRect();
    const frameRect = frame?.getBoundingClientRect();
    const handleRect = handle?.getBoundingClientRect();
    return {
      frameHeight: frameRect?.height ?? 0,
      handleOffset: nodeRect && handleRect ? Math.round(handleRect.top + handleRect.height / 2 - nodeRect.top) : -1,
      nodeHeight: nodeRect?.height ?? 0,
    };
  }, graphIds);
  expect(imageLayout.frameHeight).toBeGreaterThan(120);
  expect(imageLayout.frameHeight).toBeLessThanOrEqual(370);
  expect(imageLayout.nodeHeight).toBeLessThan(560);
  expect(imageLayout.handleOffset).toBeGreaterThanOrEqual(0);
  const downloadButton = canvasPreviewNode.getByTitle(/Download Selected_image 1/i);
  await expect(downloadButton).toHaveCount(1);
  await expect(canvasPreviewNode.getByTitle(/Copy Selected_image 1 URL/i)).toHaveCount(1);
  await expect(canvasPreviewNode.getByTitle(/Open Selected_image 1 full size/i)).toHaveCount(1);
  await expect(canvasPreviewNode.getByText('Previous')).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const output = current.studio.outputs.find(
          (item) => item.nodeId === graphIds.preview && item.fieldKey === 'selected_image',
        );
        return {
          count: current.studio.outputs.length,
          clientRunId: output?.clientRunId,
          runInputHash: output?.runInputHash,
          width: output?.mediaItems?.[0]?.width,
          height: output?.mediaItems?.[0]?.height,
        };
      },
      { timeout: 10_000 },
    )
    .toEqual({
      count: 1,
      clientRunId: 'run-current',
      runInputHash: 'hash-current',
      width: 2,
      height: 2,
    });

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'task_completed',
      sid: 'mock-sid',
      task_id: 'task-current',
      name: 'Mock run',
      current: null,
      queued: {},
    });
  });
  await expect(page.getByTestId('session-run-task-current')).toContainText('Completed', { timeout: 10_000 });
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        return current.tasks.sessionRuns.find((run) => run.id === 'task-current')?.status;
      },
      { timeout: 10_000 },
    )
    .toBe('completed');

  const downloadPromise = page.waitForEvent('download');
  await downloadButton.evaluate((button) => (button as HTMLButtonElement).click());
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mock-output.png');

  await page.evaluate(({ preview }) => {
    window.__MODIFF_E2E__!.startStudioRunForTest({
      clientRunId: 'run-next',
      runInputHash: 'hash-next',
      taskId: 'task-next',
    });
    window.__MODIFF_E2E__!.setFirstNodePositionByAction('Preview', { x: 180, y: 40 });
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'task_started',
      sid: 'mock-sid',
      current: { task_id: 'task-next', name: 'Mock run next', progress: 0, status: 'running' },
      queued: [],
    });
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'progress',
      task_id: 'task-next',
      client_run_id: 'run-next',
      run_input_hash: 'hash-next',
      attempt_index: 0,
      node: preview,
      status: 'running',
      phase: 'previewing',
      message: 'Waiting for this run',
      progress: -1,
    });
  }, graphIds);
  const waitingPreviewPanel = canvasPreviewNode.locator('div.border-dashed', { hasText: 'Waiting for this run' });
  await expect(canvasPreviewNode.getByAltText(/Selected_image/i)).toHaveCount(0);
  await expect(waitingPreviewPanel).toBeVisible({ timeout: 10_000 });
  const waitingLayout = await page.evaluate(
    ({ preview, imageHandleOffset }) => {
      const node = document.querySelector(`[data-id="${preview}"]`) as HTMLElement | null;
      const frame = document.querySelector(
        `[data-testid="node-preview-empty-${preview}-selected_image"]`,
      ) as HTMLElement | null;
      const handle = node?.querySelector('.react-flow__handle') as HTMLElement | null;
      const nodeRect = node?.getBoundingClientRect();
      const frameRect = frame?.getBoundingClientRect();
      const handleRect = handle?.getBoundingClientRect();
      const handleOffset =
        nodeRect && handleRect ? Math.round(handleRect.top + handleRect.height / 2 - nodeRect.top) : -1;
      return {
        frameHeight: frameRect?.height ?? 0,
        handleOffset,
        handleShift: Math.abs(handleOffset - imageHandleOffset),
        nodeHeight: nodeRect?.height ?? 0,
      };
    },
    { ...graphIds, imageHandleOffset: imageLayout.handleOffset },
  );
  expect(waitingLayout.frameHeight).toBeGreaterThan(120);
  expect(waitingLayout.frameHeight).toBeLessThanOrEqual(370);
  expect(waitingLayout.nodeHeight).toBeLessThan(680);
  expect(waitingLayout.handleShift).toBeLessThanOrEqual(4);
  await expect(canvasPreviewNode.getByText('Previous')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(({ preview }) => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'update_value',
      task_id: 'task-current',
      client_run_id: 'run-current',
      run_input_hash: 'hash-current',
      attempt_index: 0,
      node: preview,
      key: 'selected_image',
      data_type: 'image',
      value: ['/cache/preview-node/output/stale?format=PNG&filename=stale-output.png'],
    });
  }, graphIds);
  await expect(canvasPreviewNode.getByAltText(/Selected_image/i)).toHaveCount(0);
  await expect(waitingPreviewPanel).toBeVisible();

  await page.evaluate(() => {
    window.__MODIFF_E2E__!.sendWebsocketMessage({
      type: 'task_failed',
      sid: 'mock-sid',
      task_id: 'task-next',
      client_run_id: 'run-next',
      run_input_hash: 'hash-next',
      message: 'Mock failure',
      queued: {},
      current: null,
    });
  });
  await expect
    .poll(
      async () => {
        return page.evaluate(({ preview }) => {
          const current = window.__MODIFF_E2E__!.getState();
          const previewNode = current.flow.nodes.find((node) => node.id === preview);
          return previewNode?.uiState ?? null;
        }, graphIds);
      },
      { timeout: 10_000 },
    )
    .toMatchObject({
      validationSeverity: 'error',
      validationMessage: 'Run failed before producing a new output.',
    });
  await expect(page.getByRole('button', { name: 'Node error details' }).first()).toHaveAttribute(
    'title',
    /Run failed before producing a new output\./,
    { timeout: 10_000 },
  );
  await expect(page.locator(`[data-id="${graphIds.preview}"]`)).not.toContainText(
    'Run failed before producing a new output.',
  );
  await expect(canvasPreviewNode.getByText('Previous')).toBeVisible();

  const longBackendError = `Preview failure details ${'hardware artifact loader trace '.repeat(80)}`;
  await page.evaluate(
    ({ preview, message }) => {
      window.__MODIFF_E2E__!.sendWebsocketMessage({
        type: 'node_error',
        task_id: 'task-next',
        client_run_id: 'run-next',
        run_input_hash: 'hash-next',
        node: preview,
        message,
      });
    },
    { ...graphIds, message: longBackendError },
  );
  await expect(canvasPreviewNode.getByRole('button', { name: 'Node error details' })).toHaveAttribute(
    'title',
    longBackendError,
    { timeout: 10_000 },
  );
  await expect(canvasPreviewNode).not.toContainText(longBackendError.slice(0, 160));
  const errorLayout = await page.evaluate(
    ({ preview, waitingHandleOffset }) => {
      const node = document.querySelector(`[data-id="${preview}"]`) as HTMLElement | null;
      const handle = node?.querySelector('.react-flow__handle') as HTMLElement | null;
      const nodeRect = node?.getBoundingClientRect();
      const handleRect = handle?.getBoundingClientRect();
      const handleOffset =
        nodeRect && handleRect ? Math.round(handleRect.top + handleRect.height / 2 - nodeRect.top) : -1;
      return {
        handleOffset,
        handleShift: Math.abs(handleOffset - waitingHandleOffset),
        nodeHeight: nodeRect?.height ?? 0,
      };
    },
    { ...graphIds, waitingHandleOffset: waitingLayout.handleOffset },
  );
  expect(errorLayout.nodeHeight).toBeLessThanOrEqual(waitingLayout.nodeHeight + 8);
  expect(errorLayout.handleShift).toBeLessThanOrEqual(4);
});

test('mocked Studio leaves newly-created Expert Qwen quantization node expanded', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await setStudioViewMode(page, 'expert');
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
      resourceMode: 'expert',
      quantizationMode: 'bnb_4bit',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      device: 'cuda:0',
    });
  });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const quantNode = current.flow.nodes.find((node) => node.action === 'QuantizationConfigNode');
        return {
          resourceMode: current.studio.form.resourceMode,
          quantizationMode: current.studio.form.quantizationMode,
          quantAuxiliary: quantNode?.studioAuxiliary,
          quantCollapsed: quantNode?.uiState?.collapsed,
          graphBindingRole: Boolean(current.studio.graphBinding?.nodes?.qwenQuantization),
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      resourceMode: 'expert',
      quantizationMode: 'bnb_4bit',
      quantAuxiliary: true,
      quantCollapsed: false,
      graphBindingRole: true,
    });
});

test('mocked Studio builds registered Diffusers edit, inpaint, and control facades', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('black-forest-labs/FLUX.1-Kontext-dev');
  mockInstalledRepos.add('black-forest-labs/FLUX.1-Fill-dev');
  mockInstalledRepos.add('black-forest-labs/FLUX.1-Canny-dev');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  mockDynamicModularFields = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  const cases = [
    {
      templateId: 'flux_kontext_edit',
      overrides: { referenceImages: ['mock-source.png'], resourceMode: 'expert', device: 'cuda:0' },
      targetAction: 'Edit',
      targetRole: 'diffusersImageEdit',
      pipelineClass: 'FluxKontextPipeline',
      sourceHandle: 'image',
      needsMask: false,
    },
    {
      templateId: 'flux_fill_inpaint',
      overrides: {
        referenceImages: ['mock-source.png'],
        maskImage: 'mock-mask.png',
        resourceMode: 'expert',
        device: 'cuda:0',
      },
      targetAction: 'Inpaint',
      targetRole: 'diffusersImageInpaint',
      pipelineClass: 'FluxFillPipeline',
      sourceHandle: 'image',
      needsMask: true,
    },
    {
      templateId: 'flux_control_canny',
      overrides: { controlImage: 'mock-control.png', resourceMode: 'expert', device: 'cuda:0' },
      targetAction: 'ControlGenerate',
      targetRole: 'diffusersImageControl',
      pipelineClass: 'FluxControlPipeline',
      sourceHandle: 'control_image',
      needsMask: false,
    },
  ] as const;

  for (const item of cases) {
    await page.evaluate(
      async ({ templateId, overrides }) => {
        await window.__MODIFF_E2E__!.applyTemplate(templateId, overrides);
      },
      { templateId: item.templateId, overrides: item.overrides },
    );

    await expect
      .poll(
        async () => {
          const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
          const pipeline = current.flow.nodes.find((node) => node.studioRole === 'diffusersImagePipeline');
          const source = current.flow.nodes.find((node) => node.studioRole === 'loadImage');
          const mask = current.flow.nodes.find((node) => node.studioRole === 'loadMask');
          const target = current.flow.nodes.find((node) => node.action === item.targetAction);
          const preview = current.flow.nodes.find((node) => node.studioRole === 'preview');
          const hasEdge = (
            sourceId: string | undefined,
            targetId: string | undefined,
            sourceHandle: string,
            targetHandle: string,
          ) =>
            current.flow.edges.some(
              (edge) =>
                edge.source === sourceId &&
                edge.target === targetId &&
                edge.sourceHandle === sourceHandle &&
                edge.targetHandle === targetHandle,
            );

          return {
            targetRole: target?.studioRole,
            pipelineClass: pipeline?.params?.pipeline_class?.value,
            pipelineEdge: hasEdge(pipeline?.id, target?.id, 'pipeline', 'pipeline'),
            sourceEdge: hasEdge(source?.id, target?.id, 'image', item.sourceHandle),
            maskEdge: hasEdge(mask?.id, target?.id, 'image', 'mask_image'),
            outputEdge: hasEdge(target?.id, preview?.id, 'images', 'image'),
            managedNodes: current.studio.graphBinding?.managedNodeIds?.length,
            managedEdges: current.studio.graphBinding?.managedEdgeIds?.length,
          };
        },
        { timeout: 30_000 },
      )
      .toEqual({
        targetRole: item.targetRole,
        pipelineClass: item.pipelineClass,
        pipelineEdge: true,
        sourceEdge: true,
        maskEdge: item.needsMask,
        outputEdge: true,
        managedNodes: item.needsMask ? 5 : 4,
        managedEdges: item.needsMask ? 4 : 3,
      });
  }
});

test('mocked Studio wires direct Qwen inpaint graph with source and mask inputs', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-Edit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-inpaint').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_inpaint_mask_draft', {
      referenceImages: ['mock-source.png'],
      maskImage: 'mock-mask.png',
      quantizationMode: 'bnb_4bit',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      device: 'cuda:0',
    });
  });

  await expect(page.getByTestId('studio-run-readiness')).toContainText('Ready', { timeout: 30_000 });
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const quantNode = current.flow.nodes.find((node) => node.action === 'QuantizationConfigNode');
        const pipelineNode = current.flow.nodes.find((node) => node.action === 'LoadInpaintPipeline');
        const inpaintNode = current.flow.nodes.find((node) => node.action === 'Inpaint');
        const previewNode = current.flow.nodes.find((node) => node.action === 'Preview');
        const sourceNode = current.flow.nodes.find((node) => node.studioRole === 'loadImage');
        const maskNode = current.flow.nodes.find((node) => node.studioRole === 'loadMask');
        const edgeMatches = (
          source: string | undefined,
          target: string | undefined,
          sourceHandle: string,
          targetHandle: string,
        ) =>
          current.flow.edges.some(
            (edge) =>
              edge.source === source &&
              edge.target === target &&
              edge.sourceHandle === sourceHandle &&
              edge.targetHandle === targetHandle,
          );

        return {
          mode: current.studio.form.modelType,
          sourceInput: current.studio.form.referenceImages?.[0],
          maskInput: current.studio.form.maskImage,
          quantRole: quantNode?.studioRole,
          pipelineRole: pipelineNode?.studioRole,
          inpaintRole: inpaintNode?.studioRole,
          quantEdge: edgeMatches(quantNode?.id, pipelineNode?.id, 'quantization_config', 'quant_config'),
          pipelineEdge: edgeMatches(pipelineNode?.id, inpaintNode?.id, 'pipeline', 'pipeline'),
          sourceEdge: edgeMatches(sourceNode?.id, inpaintNode?.id, 'image', 'image'),
          maskEdge: edgeMatches(maskNode?.id, inpaintNode?.id, 'image', 'mask_image'),
          previewEdge: edgeMatches(inpaintNode?.id, previewNode?.id, 'images', 'image'),
          managedNodes: current.studio.graphBinding?.managedNodeIds?.length,
          managedEdges: current.studio.graphBinding?.managedEdgeIds?.length,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      mode: 'QwenImageEditModularPipeline',
      sourceInput: 'mock-source.png',
      maskInput: 'mock-mask.png',
      quantRole: undefined,
      pipelineRole: 'qwenInpaintPipeline',
      inpaintRole: 'qwenInpaint',
      quantEdge: false,
      pipelineEdge: true,
      sourceEdge: true,
      maskEdge: true,
      previewEdge: true,
      managedNodes: 5,
      managedEdges: 4,
    });
});

test('mocked Studio wires direct Qwen outpaint graph with generated canvas and mask', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-Edit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-outpaint').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_outpaint_draft', {
      referenceImages: ['mock-source.png'],
      quantizationMode: 'bnb_4bit',
      dtype: 'bfloat16',
      autoOffload: true,
      offloadMode: 'model_cpu',
      device: 'cuda:0',
    });
  });

  await expect(page.getByTestId('studio-pinned-graph-inputs')).toBeVisible();
  await expect(page.getByTestId('studio-run-readiness')).toContainText('Ready', { timeout: 30_000 });
  await expect(page.getByTestId('studio-run')).toBeEnabled({ timeout: 30_000 });

  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__MODIFF_E2E__!.getState());
        const quantNode = current.flow.nodes.find((node) => node.action === 'QuantizationConfigNode');
        const pipelineNode = current.flow.nodes.find((node) => node.action === 'LoadInpaintPipeline');
        const outpaintNode = current.flow.nodes.find((node) => node.action === 'OutpaintCanvas');
        const inpaintNode = current.flow.nodes.find((node) => node.action === 'Inpaint');
        const previewNode = current.flow.nodes.find((node) => node.action === 'Preview');
        const sourceNode = current.flow.nodes.find((node) => node.studioRole === 'loadImage');
        const edgeMatches = (
          source: string | undefined,
          target: string | undefined,
          sourceHandle: string,
          targetHandle: string,
        ) =>
          current.flow.edges.some(
            (edge) =>
              edge.source === source &&
              edge.target === target &&
              edge.sourceHandle === sourceHandle &&
              edge.targetHandle === targetHandle,
          );

        return {
          mode: current.studio.form.mode,
          modelType: current.studio.form.modelType,
          sourceInput: current.studio.form.referenceImages?.[0],
          width: current.studio.form.width,
          height: current.studio.form.height,
          outpaintLeft: current.studio.form.outpaintLeft,
          outpaintRight: current.studio.form.outpaintRight,
          quantRole: quantNode?.studioRole,
          pipelineRole: pipelineNode?.studioRole,
          outpaintRole: outpaintNode?.studioRole,
          inpaintRole: inpaintNode?.studioRole,
          quantEdge: edgeMatches(quantNode?.id, pipelineNode?.id, 'quantization_config', 'quant_config'),
          pipelineEdge: edgeMatches(pipelineNode?.id, inpaintNode?.id, 'pipeline', 'pipeline'),
          sourceEdge: edgeMatches(sourceNode?.id, outpaintNode?.id, 'image', 'image'),
          canvasEdge: edgeMatches(outpaintNode?.id, inpaintNode?.id, 'canvas', 'image'),
          maskEdge: edgeMatches(outpaintNode?.id, inpaintNode?.id, 'mask_image', 'mask_image'),
          previewEdge: edgeMatches(inpaintNode?.id, previewNode?.id, 'images', 'image'),
          managedNodes: current.studio.graphBinding?.managedNodeIds?.length,
          managedEdges: current.studio.graphBinding?.managedEdgeIds?.length,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      mode: 'outpaint',
      modelType: 'QwenImageEditModularPipeline',
      sourceInput: 'mock-source.png',
      width: 1344,
      height: 768,
      outpaintLeft: 288,
      outpaintRight: 288,
      quantRole: undefined,
      pipelineRole: 'qwenInpaintPipeline',
      outpaintRole: 'qwenOutpaintCanvas',
      inpaintRole: 'qwenInpaint',
      quantEdge: false,
      pipelineEdge: true,
      sourceEdge: true,
      canvasEdge: true,
      maskEdge: true,
      previewEdge: true,
      managedNodes: 5,
      managedEdges: 5,
    });
});

test('mocked Studio blocks Qwen outpaint when backend canvas node is missing', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-Edit');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = false;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-outpaint').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_outpaint_draft', {
        referenceImages: ['mock-source.png'],
        quantizationMode: 'bnb_4bit',
        dtype: 'bfloat16',
        autoOffload: true,
        device: 'cuda:0',
      });
    } catch {
      // The form is intentionally applied before graph creation fails.
    }
  });

  const outpaintReadiness = page.getByTestId('studio-run-readiness');
  await expect(outpaintReadiness).toContainText('Run blocked', { timeout: 30_000 });
  await outpaintReadiness.click();
  const outpaintIssues = page.getByTestId('run-issues-dialog');
  await expect(outpaintIssues).toContainText('Qwen outpaint needs direct backend canvas and mask support');
  await expect(outpaintIssues).toContainText('OutpaintCanvas');
  await expect(page.getByTestId('studio-run')).toBeDisabled();
});

test('mocked Studio blocks Expert Modular Qwen 4-bit mode when backend quantization node is missing', async ({
  page,
}) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = false;
  mockIncludeOutpaintNode = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));

  await page.getByTestId('launcher-mode-text_to_image').click();
  await expect(page.getByTestId('studio-panel')).toBeVisible();
  await setStudioViewMode(page, 'expert');
  await page.evaluate(async () => {
    try {
      await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
        resourceMode: 'expert',
        quantizationMode: 'bnb_4bit',
        dtype: 'bfloat16',
        autoOffload: true,
        offloadMode: 'model_cpu',
        device: 'cuda:0',
      });
    } catch {
      // The form remains applied so readiness can explain the missing backend node.
    }
  });

  const quantizationReadiness = page.getByTestId('studio-run-readiness');
  await expect(quantizationReadiness).toContainText('Run blocked', { timeout: 30_000 });
  await quantizationReadiness.click();
  const quantizationIssues = page.getByTestId('run-issues-dialog');
  await expect(quantizationIssues).toContainText('Expert 4-bit mode needs updated Diffusers backend support');
  await expect(quantizationIssues).toContainText('QuantizationConfigNode');
  await expect(page.getByTestId('studio-run')).toBeDisabled();
});

test('mocked dynamic node definitions update node and field metadata without value changes', async ({ page }) => {
  mockInstalledRepos.clear();
  mockInstalledRepos.add('Qwen/Qwen-Image-2512');
  mockDownloadCalls = 0;
  mockIncludeQuantizationNode = true;
  mockIncludeOutpaintNode = true;
  await ensureFrontend();
  await installMockRoutes(page);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 30_000 });
  await page.evaluate(() => window.__MODIFF_E2E__!.setWebsocketConnection({ sid: 'mock-sid', isConnected: true }));
  await page.getByTestId('launcher-mode-text_to_image').click();
  await page.evaluate(async () => {
    await window.__MODIFF_E2E__!.applyTemplate('qwen_low_vram_product_concept', {
      resourceMode: 'auto',
      device: 'cuda:0',
    });
  });

  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.action === 'Generate')?.id ?? null,
        ),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  const generateNodeId = await page.evaluate(
    () => window.__MODIFF_E2E__!.getState().flow.nodes.find((node) => node.action === 'Generate')!.id,
  );

  await page.evaluate(
    ({ nodeId }) => {
      const node = window.__MODIFF_E2E__!.getState().flow.nodes.find((item) => item.id === nodeId)!;
      const current = node.params.num_inference_steps!;
      const currentValue = Number(current.value);
      window.__MODIFF_E2E__!.sendWebsocketMessage({
        type: 'node_definition',
        node: nodeId,
        label: 'Dynamic Generate',
        params: {
          num_inference_steps: {
            type: current.type,
            display: current.display,
            value: current.value,
            default: current.value,
            label: 'Dynamic steps',
            description: 'Updated by the backend definition.',
            min: 5,
            max: currentValue,
            step: 5,
          },
        },
      });
    },
    { nodeId: generateNodeId },
  );

  const generateNode = page.locator(`[data-id="${generateNodeId}"]`);
  await expect(generateNode).toContainText('Dynamic Generate', { timeout: 10_000 });
  await expect(generateNode.getByText('Dynamic steps', { exact: true })).toBeVisible();
  await expect(generateNode.getByRole('button', { name: 'Decrease Dynamic steps' })).toBeVisible();
  await expect(generateNode.getByRole('button', { name: 'Increase Dynamic steps' })).toBeDisabled();
});
