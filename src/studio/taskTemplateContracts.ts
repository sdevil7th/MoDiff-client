import { REPO_ID } from './executionSpecs';
import { hashString, stableStringify } from './stableHash';
import type {
  StudioExecutionSpec,
  StudioGraphRole,
  StudioModelProfile,
  StudioTaskTemplateContract,
  StudioTaskTemplateRequiredMedia,
} from './types';

const CONTRACT_ID = /^task-template:[a-z\d][a-z\d._:-]{0,160}$/;
const CONTENT_HASH = /^task-template-v1-[0-9a-f]{8}$/;
const NODE_KEY = /^modules\.[A-Za-z\d_]+\.[A-Za-z\d_]+$/;
const FIELD_ID = /^[A-Za-z_][A-Za-z\d_]{0,63}$/;
const CONTRACT_KEYS =
  'canonicalizationVersion,contentHash,defaultRepo,executionProfileId,executionSpecContentHash,executionSpecId,galleryEligible,id,loaderAction,loaderModule,loaderRepositories,loaderRole,mediaKind,mode,modelType,output,pipelineClass,qualificationStatus,requiredMedia,schemaVersion';
const OUTPUT_KEYS = 'inputHandle,mediaKind,nodeKey,role';
const REQUIRED_MEDIA_KEYS = 'field,kind,minimumCount';
const MEDIA_FIELDS = {
  referenceImages: 'image',
  lastImage: 'image',
  maskImage: 'image',
  controlImage: 'image',
  sourceVideo: 'video',
  maskVideo: 'video',
  controlVideo: 'video',
  poseVideo: 'video',
  faceVideo: 'video',
  backgroundVideo: 'video',
  sourceAudio: 'audio',
  referenceAudio: 'audio',
} as const;
const OUTPUT_NODE_KEYS = {
  image: 'modules.Image.Preview',
  video: 'modules.Video.Export',
  audio: 'modules.Audio.Export',
  json: 'modules.Primitive.DataViewer',
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, keys: string) {
  return Object.keys(value).sort().join() === keys;
}

function invalid(): never {
  throw new Error('Invalid Studio task-template contract.');
}

function parseRequiredMedia(value: unknown): StudioTaskTemplateRequiredMedia[] {
  if (!Array.isArray(value) || value.length > 8) invalid();
  const fields = new Set<string>();
  return value.map((item) => {
    if (!record(item) || !exactKeys(item, REQUIRED_MEDIA_KEYS)) invalid();
    const expectedKind = typeof item.field === 'string' ? MEDIA_FIELDS[item.field as keyof typeof MEDIA_FIELDS] : null;
    if (!expectedKind || item.kind !== expectedKind || item.minimumCount !== 1 || fields.has(item.field as string)) {
      invalid();
    }
    fields.add(item.field as string);
    return item as StudioTaskTemplateRequiredMedia;
  });
}

function exactSpec(capability: StudioModelProfile, raw: Record<string, unknown>) {
  const matches =
    capability.studioExecutionSpecs?.filter(
      (specification) =>
        specification.id === raw.executionSpecId &&
        specification.contentHash === raw.executionSpecContentHash &&
        specification.mode === raw.mode,
    ) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function validateOutput(raw: Record<string, unknown>, spec: StudioExecutionSpec) {
  if (!record(raw.output) || !exactKeys(raw.output, OUTPUT_KEYS)) invalid();
  const mediaKind = raw.mediaKind as keyof typeof OUTPUT_NODE_KEYS;
  if (
    raw.output.mediaKind !== mediaKind ||
    (raw.output.nodeKey !== OUTPUT_NODE_KEYS[mediaKind] &&
      !(mediaKind === 'video' && raw.output.nodeKey === 'modules.Video.ExportWithAudio')) ||
    typeof raw.output.role !== 'string' ||
    typeof raw.output.inputHandle !== 'string' ||
    !FIELD_ID.test(raw.output.inputHandle)
  )
    invalid();
  const outputRole = raw.output.role as StudioGraphRole;
  const role = spec.roles.find(([candidate]) => candidate === outputRole);
  const outgoing = spec.edges.some(([sourceRole]) => sourceRole === outputRole);
  const expectedInputHandle = mediaKind === 'json' ? 'data' : mediaKind;
  const incoming = spec.edges.filter(
    ([, , targetRole, targetHandle]) => targetRole === outputRole && targetHandle === expectedInputHandle,
  );
  const inputEdge = incoming.length === 1 ? incoming[0] : undefined;
  if (!role || role[1] !== raw.output.nodeKey || outgoing || !inputEdge || inputEdge[3] !== raw.output.inputHandle) {
    invalid();
  }
}

export function parseTaskTemplateContracts(
  value: unknown,
  schemaVersion: unknown,
  capabilities: readonly StudioModelProfile[],
): StudioTaskTemplateContract[] {
  if (schemaVersion !== 1 || !Array.isArray(value) || value.length > 128) invalid();
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const contracts = value.flatMap((item) => {
    if (!record(item) || typeof item.modelType !== 'string') invalid();
    const capability = capabilities.find((candidate) => candidate.modelType === item.modelType);
    // Capability discovery deliberately ignores model types unknown to this
    // client version. Apply the same forward-compatible boundary here while
    // continuing to validate every known contract fail-closed.
    if (!capability) return [];
    if (!exactKeys(item, CONTRACT_KEYS)) invalid();
    const spec = capability ? exactSpec(capability, item) : null;
    const profile =
      capability?.executionProfiles?.filter((candidate) => candidate.id === item.executionProfileId) ?? [];
    const pair = `${String(item.modelType)}\0${String(item.mode)}`;
    if (
      item.schemaVersion !== 1 ||
      item.canonicalizationVersion !== 1 ||
      typeof item.id !== 'string' ||
      !CONTRACT_ID.test(item.id) ||
      ids.has(item.id) ||
      pairs.has(pair) ||
      !spec ||
      profile.length !== 1 ||
      item.id !== `task-template:${spec.id}` ||
      item.executionProfileId !== spec.executionProfileId ||
      item.loaderModule !== spec.loaderModule ||
      item.loaderAction !== spec.loaderAction ||
      !NODE_KEY.test(`${String(item.loaderModule)}.${String(item.loaderAction)}`) ||
      item.pipelineClass !== spec.pipelineClass ||
      item.defaultRepo !== spec.defaultRepo ||
      typeof item.loaderRole !== 'string' ||
      !spec.roles.some(
        ([role, nodeKey]) => role === item.loaderRole && nodeKey === `${spec.loaderModule}.${spec.loaderAction}`,
      ) ||
      typeof item.mediaKind !== 'string' ||
      !Object.prototype.hasOwnProperty.call(OUTPUT_NODE_KEYS, item.mediaKind) ||
      typeof item.qualificationStatus !== 'string' ||
      !item.qualificationStatus ||
      typeof item.galleryEligible !== 'boolean' ||
      (item.qualificationStatus !== 'qualified' && item.galleryEligible) ||
      typeof item.contentHash !== 'string' ||
      !CONTENT_HASH.test(item.contentHash)
    )
      invalid();
    const executionProfile = profile[0];
    if (!executionProfile) invalid();
    if (
      executionProfile.loader_module !== item.loaderModule ||
      executionProfile.loader_action !== item.loaderAction ||
      executionProfile.pipeline_class !== item.pipelineClass ||
      executionProfile.default_repo !== item.defaultRepo ||
      !Array.isArray(item.loaderRepositories) ||
      item.loaderRepositories.length < 1 ||
      item.loaderRepositories.length > 8 ||
      item.loaderRepositories[0] !== item.defaultRepo ||
      new Set(item.loaderRepositories).size !== item.loaderRepositories.length ||
      item.loaderRepositories.some((repository) => typeof repository !== 'string' || !REPO_ID.test(repository))
    )
      invalid();
    const requiredMedia = parseRequiredMedia(item.requiredMedia);
    validateOutput(item, spec);
    const { contentHash, ...semantic } = item;
    if (contentHash !== `task-template-v1-${hashString(stableStringify(semantic))}`) invalid();
    ids.add(item.id);
    pairs.add(pair);
    return [{ ...item, requiredMedia } as StudioTaskTemplateContract];
  });

  const expectedSpecs = capabilities.flatMap((capability) => capability.studioExecutionSpecs ?? []);
  if (
    contracts.length !== expectedSpecs.length ||
    expectedSpecs.some(
      (specification) =>
        !contracts.some(
          (contract) => contract.executionSpecId === specification.id && contract.modelType === specification.modelType,
        ),
    )
  )
    invalid();
  return contracts;
}

export type StudioTaskTemplateSkeleton = {
  id: string;
  modelType: StudioTaskTemplateContract['modelType'];
  mode: StudioTaskTemplateContract['mode'];
  mediaKind: StudioTaskTemplateContract['mediaKind'];
  executionSpecId: string;
  requiredMedia: StudioTaskTemplateRequiredMedia[];
  output: StudioTaskTemplateContract['output'];
  galleryVisible: boolean;
};

export function buildTaskTemplateSkeleton(contract: StudioTaskTemplateContract): StudioTaskTemplateSkeleton {
  return {
    id: contract.id,
    modelType: contract.modelType,
    mode: contract.mode,
    mediaKind: contract.mediaKind,
    executionSpecId: contract.executionSpecId,
    requiredMedia: contract.requiredMedia.map((item) => ({ ...item })),
    output: { ...contract.output },
    galleryVisible: contract.galleryEligible,
  };
}

export function galleryTaskTemplateSkeletons(contracts: readonly StudioTaskTemplateContract[]) {
  return contracts.filter((contract) => contract.galleryEligible).map(buildTaskTemplateSkeleton);
}
