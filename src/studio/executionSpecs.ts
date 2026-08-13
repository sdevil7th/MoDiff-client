import { hashString, stableStringify } from './stableHash';
import type {
  StudioExecutionProfile,
  StudioExecutionSpec,
  StudioFormState,
  StudioGraphRole,
  StudioGraphBinding,
  StudioModelProfile,
  StudioMode,
  StudioModelType,
} from './types';

const SPEC_ID = /^[a-z\d][a-z\d._:-]{0,127}$/;
const FIELD_ID = /^[A-Za-z_][A-Za-z\d_]{0,63}$/;
const NODE_KEY = /^modules\.[A-Za-z\d_]+\.[A-Za-z\d_]+$/;
const PIPELINE_CLASS = /^[A-Za-z_][A-Za-z\d_.]{0,255}$/;
export const REPO_ID = /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/;
const SPEC_KEYS =
  'actions,autoFields,bindings,canonicalizationVersion,contentHash,defaultRepo,edges,executionPath,executionProfileId,id,loaderAction,loaderModule,mode,modelType,pipelineClass,roles,schemaVersion';
function listed<T extends string>(value: string) {
  return new Set(value.split('|') as T[]);
}
const SPEC_ROLES = listed<StudioGraphRole>(
  'models|prompt|imageEmbeddings|imageEncode|loadLastImage|controlnetModel|controlnet|denoise|decode|diffusersQuantization|diffusersRecipe|diffusersImagePipeline|diffusersImageGenerate|diffusersUnconditionalGenerate|diffusersPredictMap|loadImage|loadMask|qwenOutpaintCanvas|diffusersImageControl|diffusersImageEdit|diffusersImageInpaint|preview|wanPipeline|wanGenerate|videoExport|loadVideo|loadControlVideo|loadMaskVideo|loadPoseVideo|loadFaceVideo|loadBackgroundVideo|normalizeVideo|alignMaskVideo|audioPipeline|audioGenerate|audioExport|loadAudio|audioLoudnessMatch|audioJoin|speechModel|transcribeAudio|transcriptPreview',
);
const BINDING_SOURCES = listed(
  'quantizationMode|quantizedComponents|dualQuantizedComponents|pipelineQuantizedComponents|dtype|deviceMapNone|offloadMode|device|attentionBackend|nativeFlashAttention|nativeMath|empty|true|false|transformer|dualTransformer|videoVaeTiling|regionalCompile|denoiserCache|layerwiseCasting|channelsLast|artifact|defaultRevision|pipelineClass|kind|repo|revision|wanVaceRevision|mode|autoOffload|prompt|negativePrompt|width|height|seed|steps|guidanceScale|pagScale|pagAdaptiveScale|processingResolution|matchInputResolution|depth|batchSize|eta|classLabel|strength|layers|outputType|maxSequenceLength|controlImage|referenceImages|lastImage|maskImage|outpaintLeft|outpaintRight|outpaintTop|outpaintBottom|outpaintOverlap|outpaintFeather|outpaintFillColor|sourceVideo|controlVideo|maskVideo|poseVideo|faceVideo|backgroundVideo|maskThreshold127|inpaintMaskGrow96|outpaintMaskGrow0|conditioningScale|alphaMode|addAlpha|removeAlpha|numFrames|shift|fps|guidanceScale2|useGuidanceScale2|attentionKwargsJson|segmentFrameLength77|previousConditioningFrames1|motionEncodeBatchSize1|temporalTileSize80|temporalOverlap24|temporalOverlapConditionStrength05|adainFactor025|framepackSampling|latentWindowSize9|trueCfgScale1|text2music|text2audio|cover|continuation|repaint|transcribe|translate|sourceAudio|speechLanguage|speechTimestamps|speechChunkSeconds|speechStrideSeconds|lyrics|audioDuration|extensionDuration|vocalLanguage|bpmNormalized|keyscale|timesignature|repaintingStart|repaintingEnd|audioCoverStrength|sampleRate48000|numWaveforms1|referenceWindow15|targetPeakMinus1|maxAdjustment12|boundaryFade001',
);
const AUTO_FIELDS = listed(
  'resolvedArtifact|artifact|installTarget.repo|modelRepo|pipelineClass|dtype|offloadMode|quantizedComponents|attentionBackend|regionalCompile|denoiserCache|layerwiseCasting|channelsLast',
);
function invalid(): never {
  throw new Error('Invalid Studio execution specification.');
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function unique<T>(items: T[]) {
  return new Set(items).size === items.length;
}

export function exactStudioExecutionSpecForForm(
  capabilities: readonly StudioModelProfile[],
  invalid: boolean,
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
): StudioExecutionSpec | null | undefined {
  if (invalid) return null;
  const capability = capabilities.find((item) => item.modelType === form.modelType);
  if (capability?.studioExecutionSpecSchemaVersion !== 1) return undefined;
  if (!capability.studioExecutionSpecModes?.includes(form.mode)) return undefined;
  const matches = capability.studioExecutionSpecs?.filter((item) => item.mode === form.mode) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function exactStudioExecutionProfileForForm(
  capabilities: readonly StudioModelProfile[],
  invalid: boolean,
  form: Pick<StudioFormState, 'modelType' | 'mode'>,
): StudioExecutionProfile | null | undefined {
  const spec = exactStudioExecutionSpecForForm(capabilities, invalid, form);
  if (!spec) return spec;
  const matches =
    capabilities
      .find((item) => item.modelType === form.modelType)
      ?.executionProfiles?.filter(
        (profile) => profile.id === spec.executionProfileId && profile.modes.includes(form.mode),
      ) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function parseStudioExecutionSpecs(
  value: unknown,
  modelType: StudioModelType,
  modes: readonly StudioMode[],
  profiles: readonly StudioExecutionProfile[] | undefined,
): StudioExecutionSpec[] {
  if (!Array.isArray(value) || value.length > 16) invalid();
  const specs = value.map((raw) => {
    if (!record(raw)) invalid();
    if (Object.keys(raw).sort().join() !== SPEC_KEYS) invalid();
    const profile = profiles?.find((item) => item.id === raw.executionProfileId);
    if (
      raw.schemaVersion !== 1 ||
      raw.canonicalizationVersion !== 1 ||
      typeof raw.id !== 'string' ||
      !SPEC_ID.test(raw.id) ||
      raw.modelType !== modelType ||
      !modes.includes(raw.mode as StudioMode) ||
      !profile ||
      !profile.modes.includes(raw.mode as StudioMode) ||
      raw.loaderModule !== profile.loader_module ||
      raw.loaderAction !== profile.loader_action ||
      raw.executionPath !== profile.execution_path ||
      raw.pipelineClass !== profile.pipeline_class ||
      raw.defaultRepo !== profile.default_repo ||
      typeof raw.executionPath !== 'string' ||
      !SPEC_ID.test(raw.executionPath) ||
      typeof raw.pipelineClass !== 'string' ||
      !PIPELINE_CLASS.test(raw.pipelineClass) ||
      typeof raw.defaultRepo !== 'string' ||
      raw.defaultRepo.length > 512 ||
      !REPO_ID.test(raw.defaultRepo)
    )
      invalid();

    const roles = raw.roles;
    if (
      !Array.isArray(roles) ||
      roles.length < 2 ||
      roles.length > 32 ||
      roles.some(
        (item) =>
          !Array.isArray(item) ||
          item.length !== 4 ||
          !SPEC_ROLES.has(item[0] as StudioGraphRole) ||
          typeof item[1] !== 'string' ||
          !NODE_KEY.test(item[1]) ||
          !Number.isSafeInteger(item[2]) ||
          !Number.isSafeInteger(item[3]) ||
          Math.abs(item[2]) > 10_000 ||
          Math.abs(item[3]) > 10_000,
      )
    )
      invalid();
    const typedRoles = roles as StudioExecutionSpec['roles'];
    const roleIds = typedRoles.map(([role]) => role);
    if (!unique(roleIds) || !typedRoles.some((item) => item[1] === `${raw.loaderModule}.${raw.loaderAction}`))
      invalid();
    const roleSet = new Set(roleIds);

    const edgeList = raw.edges;
    if (
      !Array.isArray(edgeList) ||
      edgeList.length < 1 ||
      edgeList.length > 64 ||
      edgeList.some(
        (item) =>
          !Array.isArray(item) ||
          item.length !== 4 ||
          !roleSet.has(item[0] as StudioGraphRole) ||
          typeof item[1] !== 'string' ||
          !FIELD_ID.test(item[1]) ||
          !roleSet.has(item[2] as StudioGraphRole) ||
          typeof item[3] !== 'string' ||
          !FIELD_ID.test(item[3]),
      )
    )
      invalid();
    const edges = edgeList as StudioExecutionSpec['edges'];
    if (!unique(edges.map((item) => item.join('\0')))) invalid();
    const connected = new Set<StudioGraphRole>();
    const pending = [roleIds[0]];
    while (pending.length) {
      const role = pending.pop()!;
      if (connected.has(role)) continue;
      connected.add(role);
      for (const [sourceRole, , targetRole] of edges) {
        if (sourceRole === role && !connected.has(targetRole)) pending.push(targetRole);
        if (targetRole === role && !connected.has(sourceRole)) pending.push(sourceRole);
      }
    }
    if (connected.size !== roleSet.size) invalid();

    const bindingList = raw.bindings;
    if (
      !Array.isArray(bindingList) ||
      bindingList.length < 1 ||
      bindingList.length > 128 ||
      bindingList.some(
        (item) =>
          !Array.isArray(item) ||
          item.length !== 3 ||
          !roleSet.has(item[0] as StudioGraphRole) ||
          typeof item[1] !== 'string' ||
          !FIELD_ID.test(item[1]) ||
          !BINDING_SOURCES.has(item[2] as string),
      )
    )
      invalid();
    const bindings = bindingList as StudioExecutionSpec['bindings'];
    if (!unique(bindings.map(([role, param]) => `${role}\0${param}`))) invalid();
    const autoFields = raw.autoFields;
    if (
      !Array.isArray(autoFields) ||
      autoFields.length > 32 ||
      !autoFields.every((item) => AUTO_FIELDS.has(item)) ||
      !unique(autoFields) ||
      !Array.isArray(raw.actions) ||
      raw.actions.length !== 0
    )
      invalid();
    const { contentHash, ...semantic } = raw;
    if (contentHash !== `studio-spec-v1-${hashString(stableStringify(semantic))}`) {
      invalid();
    }
    return raw as unknown as StudioExecutionSpec;
  });
  if (!unique(specs.map(({ id }) => id)) || !unique(specs.map(({ mode }) => mode))) invalid();
  return specs;
}

export function studioExecutionSpecRuntimeReceipt(
  binding: StudioGraphBinding | null,
  capabilities: readonly StudioModelProfile[],
) {
  if (!binding?.executionSpec) return undefined;
  const spec = capabilities
    .find((item) => item.modelType === binding.modelType)
    ?.studioExecutionSpecs?.find(
      (item) => item.id === binding.executionSpec?.id && item.contentHash === binding.executionSpec.contentHash,
    );
  if (!spec || spec.mode !== binding.mode) throw new Error('The Studio execution specification receipt is stale.');
  const nodes = Object.fromEntries(
    spec.roles.map(([role]) => {
      const nodeId = binding.nodes[role];
      if (!nodeId) throw new Error('The Studio execution specification node receipt is incomplete.');
      return [role, nodeId];
    }),
  );
  return {
    schemaVersion: binding.executionSpec.schemaVersion,
    id: binding.executionSpec.id,
    contentHash: binding.executionSpec.contentHash,
    nodes,
  };
}
