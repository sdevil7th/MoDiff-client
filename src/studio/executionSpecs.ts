import { hashString, stableStringify } from './stableHash';
import type {
  StudioExecutionProfile,
  StudioExecutionSpec,
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
const REPO_ID = /^[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+$/;
const SPEC_KEYS =
  'actions,autoFields,bindings,canonicalizationVersion,contentHash,defaultRepo,edges,executionPath,executionProfileId,id,loaderAction,loaderModule,mode,modelType,pipelineClass,roles,schemaVersion';
const SPEC_ROLES = new Set<StudioGraphRole>(
  'diffusersQuantization|diffusersRecipe|diffusersImagePipeline|diffusersImageGenerate|loadImage|loadMask|diffusersImageControl|diffusersImageEdit|diffusersImageInpaint|preview|wanPipeline|wanGenerate|videoExport|loadVideo|normalizeVideo|audioPipeline|audioGenerate|audioExport'.split(
    '|',
  ) as StudioGraphRole[],
);
const BINDING_SOURCES = new Set(
  'quantizationMode|quantizedComponents|dualQuantizedComponents|pipelineQuantizedComponents|dtype|deviceMapNone|offloadMode|device|attentionBackend|nativeFlashAttention|nativeMath|empty|true|false|transformer|dualTransformer|videoVaeTiling|regionalCompile|denoiserCache|layerwiseCasting|channelsLast|artifact|pipelineClass|mode|autoOffload|prompt|negativePrompt|width|height|seed|steps|guidanceScale|strength|outputType|maxSequenceLength|controlImage|referenceImages|maskImage|sourceVideo|conditioningScale|alphaMode|removeAlpha|numFrames|shift|fps|guidanceScale2|useGuidanceScale2|attentionKwargsJson|text2music|lyrics|audioDuration|extensionDuration|vocalLanguage|bpmNormalized|keyscale|timesignature|repaintingStart|repaintingEnd|audioCoverStrength|sampleRate48000'.split(
    '|',
  ),
);
const AUTO_FIELDS = new Set(
  'resolvedArtifact|artifact|installTarget.repo|modelRepo|pipelineClass|dtype|offloadMode|quantizedComponents|attentionBackend|regionalCompile|denoiserCache|layerwiseCasting|channelsLast'.split(
    '|',
  ),
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

export function parseStudioExecutionSpecs(
  value: unknown,
  modelType: StudioModelType,
  modes: readonly StudioMode[],
  profiles: readonly StudioExecutionProfile[] | undefined,
): StudioExecutionSpec[] {
  if (!Array.isArray(value)) invalid();
  if (value.length > 16) invalid();
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
      typeof raw.mode !== 'string' ||
      !modes.includes(raw.mode as StudioMode) ||
      !profile ||
      !profile.modes.includes(raw.mode as StudioMode) ||
      raw.loaderModule !== profile.loader_module ||
      raw.loaderAction !== profile.loader_action ||
      raw.executionPath !== profile.execution_path ||
      raw.pipelineClass !== profile.pipeline_class ||
      raw.defaultRepo !== profile.default_repo ||
      typeof raw.executionPath !== 'string' ||
      raw.executionPath.length > 128 ||
      !SPEC_ID.test(raw.executionPath) ||
      typeof raw.pipelineClass !== 'string' ||
      !PIPELINE_CLASS.test(raw.pipelineClass) ||
      typeof raw.defaultRepo !== 'string' ||
      raw.defaultRepo.length > 512 ||
      raw.defaultRepo !== raw.defaultRepo.trim() ||
      !REPO_ID.test(raw.defaultRepo) ||
      typeof raw.contentHash !== 'string' ||
      !/^studio-spec-v1-[0-9a-f]{8}$/.test(raw.contentHash)
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
      !autoFields.every((item) => typeof item === 'string' && AUTO_FIELDS.has(item)) ||
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
