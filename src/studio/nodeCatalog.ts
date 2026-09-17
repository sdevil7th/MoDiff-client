import { runtimeNodeIdentityV2 } from './nodeLibraryAuditV2';
import type { NodeData } from '../stores/useNodeStore';
import { matchesSearchKeywords } from '../utils/searchKeywords';

export type NodeCatalogVisibility = 'essential' | 'advanced' | 'experimental' | 'internal';
export type NodeCatalogView = 'essential' | 'stages' | 'advanced' | 'experimental';

export function defaultNodeCatalogView(mode: 'auto' | 'expert'): NodeCatalogView {
  return mode === 'expert' ? 'stages' : 'essential';
}

export type NodeSurfaceCategory =
  | 'Load'
  | 'Generate'
  | 'Edit'
  | 'Condition'
  | 'Adapters'
  | 'Preview'
  | 'Export'
  | 'Audio'
  | 'Image'
  | 'Video'
  | 'Text'
  | 'Utility';

export type NodeRuntimeKind = 'diffusers' | 'diffusers_accelerated' | 'experimental_diffusers' | 'unsupported';

export type NodeCatalogEntry = {
  key: string;
  dragKey: string;
  label: string;
  description?: string;
  surfaceCategory: NodeSurfaceCategory;
  visibility: NodeCatalogVisibility;
  runtimeKind: NodeRuntimeKind;
  isDiffusersBacked: boolean;
  acceleratorStrategy?: string;
  specializedReason?: string;
  node: NodeData;
  groupPath: string[];
  aliases?: string[];
};

const SURFACE_CATEGORY_ORDER: NodeSurfaceCategory[] = [
  'Load',
  'Generate',
  'Edit',
  'Condition',
  'Adapters',
  'Preview',
  'Export',
  'Audio',
  'Image',
  'Video',
  'Text',
  'Utility',
];

const MODEL_SPECIFIC_MODULES = new Set<string>();

// Discovery only: these existing generic operations keep their backend schemas
// and execution identities. Inclusion does not add model/task support.
const GENERIC_STAGE_NODE_KEYS = new Set([
  'modules.ModularDiffusers.ModelsLoader',
  'modules.ModularDiffusers.AutoModelLoader',
  'modules.ModularDiffusers.EncodePrompt',
  'modules.ModularDiffusers.ImageEncode',
  'modules.ModularDiffusers.ImageEmbeddings',
  'modules.ModularDiffusers.Denoise',
  'modules.ModularDiffusers.DecodeLatents',
  'modules.ModularDiffusers.LatentsPreview',
  'modules.ModularDiffusers.Lora',
  'modules.ModularDiffusers.Controlnet',
  'modules.ModularDiffusers.IPAdapter',
  'modules.ModularDiffusers.Scheduler',
  'modules.ModularDiffusers.Guider',
  'modules.ModularDiffusers.QuantizationConfigNode',
]);

export function nodeCatalogEntryMatchesView(entry: NodeCatalogEntry, view: NodeCatalogView) {
  if (entry.visibility === 'internal') return false;
  if (view === 'essential') return entry.visibility === 'essential';
  if (view === 'stages') {
    return (
      entry.visibility !== 'experimental' &&
      (entry.visibility === 'essential' ||
        GENERIC_STAGE_NODE_KEYS.has(nodeKey(entry.node)) ||
        entry.node.module.startsWith('custom.'))
    );
  }
  if (view === 'advanced') return entry.visibility === 'essential' || entry.visibility === 'advanced';
  return entry.visibility === 'experimental';
}

const ESSENTIAL_NODE_KEYS = new Set([
  'modules.DiffusersImage.LoadPipeline',
  'modules.DiffusersAudio.LoadPipeline',
  'modules.DiffusersImage.Generate',
  'modules.DiffusersImage.UnconditionalGenerate',
  'modules.DiffusersImage.Edit',
  'modules.DiffusersImage.Inpaint',
  'modules.DiffusersImage.ControlGenerate',
  'modules.DiffusersImage.LoadAdapter',
  'modules.DiffusersAudio.LoadAdapter',
  'modules.DiffusersAudio.SetAdapters',
  'modules.DiffusersAudio.FuseAdapters',
  'modules.DiffusersAudio.Generate',
  'modules.DiffusersVideo.LoadPipeline',
  'modules.DiffusersVideo.Generate',
  'modules.DiffusersVideo.GenerateVideoAudio',
  'modules.DiffusersVideo.GenerateSequence',
  'modules.DiffusersThreeD.LoadPipeline',
  'modules.DiffusersThreeD.GenerateRenderedArtifact',
  'modules.VideoConditioning.ReferenceImages',
  'modules.Audio.Load',
  'modules.Audio.FitDuration',
  'modules.Audio.Export',
  'modules.Image.Load',
  'modules.Image.Preview',
  'modules.Video.Load',
  'modules.Video.Export',
  'modules.Video.Compose',
  'modules.Video.LyricOverlay',
  'modules.Video.ExportWithAudio',
  'modules.Text.Display',
]);

const FACADE_LABELS: Record<string, string> = {
  'modules.DiffusersImage.LoadPipeline': 'Load pipeline',
  'modules.DiffusersAudio.LoadPipeline': 'Load pipeline',
  'modules.DiffusersImage.Generate': 'Generate image',
  'modules.DiffusersImage.UnconditionalGenerate': 'Sample image',
  'modules.DiffusersImage.Edit': 'Edit image',
  'modules.DiffusersImage.Inpaint': 'Inpaint',
  'modules.DiffusersImage.ControlGenerate': 'Generate image',
  'modules.DiffusersImage.LoadAdapter': 'Load adapter',
  'modules.DiffusersAudio.Generate': 'Generate audio',
  'modules.DiffusersVideo.GenerateVideoAudio': 'Generate video + audio',
  'modules.DiffusersVideo.GenerateSequence': 'Generate video sequence',
  'modules.DiffusersThreeD.LoadPipeline': 'Load 3D pipeline',
  'modules.DiffusersThreeD.GenerateRenderedArtifact': 'Render 3D orbit',
  'modules.VideoConditioning.ReferenceImages': 'Reference images',
  'modules.Audio.Load': 'Load audio',
  'modules.Audio.FitDuration': 'Fit audio duration',
  'modules.Audio.Export': 'Export',
  'modules.Image.Load': 'Load image',
  'modules.Image.Preview': 'Preview',
  'modules.Video.Load': 'Load video',
  'modules.Video.Export': 'Export',
  'modules.Video.Compose': 'Compose video',
  'modules.Video.LyricOverlay': 'Add timed lyrics',
  'modules.Video.ExportWithAudio': 'Export video with audio',
  'modules.Text.Display': 'Preview text',
  'modules.ModularDiffusers.ModelsLoader': 'Load model',
};

function nodeKey(node: NodeData) {
  return `${node.module}.${node.action}`;
}

function textIncludesAny(text: string, values: string[]) {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value));
}

function categoryFromNode(node: NodeData, key: string): NodeSurfaceCategory {
  const text = `${key} ${node.category} ${node.label}`.toLowerCase();
  if (textIncludesAny(text, ['adapter', 'lora'])) return 'Adapters';
  if (textIncludesAny(text, ['export', 'save'])) return 'Export';
  if (textIncludesAny(text, ['preview', 'display'])) return 'Preview';
  if (textIncludesAny(text, ['loadpipeline', 'modelsloader', 'loader', 'load model', 'load'])) return 'Load';
  if (textIncludesAny(text, ['generate', 'sampler', 'denoise', 'decode', 'pipeline'])) return 'Generate';
  if (textIncludesAny(text, ['inpaint', 'outpaint', 'edit', 'mask', 'color'])) return 'Edit';
  if (textIncludesAny(text, ['control', 'conditioning', 'encode', 'embedding', 'prompt'])) return 'Condition';
  if (text.includes('audio') || /\bace(?:[-_ ]?step)?\b/u.test(text)) return 'Audio';
  if (textIncludesAny(text, ['video', 'wan'])) return 'Video';
  if (textIncludesAny(text, ['image', 'preview'])) return 'Image';
  if (textIncludesAny(text, ['text'])) return 'Text';
  return 'Utility';
}

function visibilityForNode(node: NodeData, key: string): NodeCatalogVisibility {
  if (node.type === 'group' || node.type === 'loop') return 'internal';
  if (textIncludesAny(`${key} ${node.label}`, ['nunchaku', 'sd3', 'deprecated'])) return 'experimental';
  if (ESSENTIAL_NODE_KEYS.has(key)) return 'essential';
  if (MODEL_SPECIFIC_MODULES.has(node.module)) return 'advanced';
  if (node.module === 'modules.ModularDiffusers') return 'advanced';
  if (node.module === 'modules.ModelArtifact') return 'advanced';
  if (node.module.startsWith('custom.')) return 'advanced';
  return 'advanced';
}

function runtimeKindForNode(node: NodeData, key: string): NodeRuntimeKind {
  const text = `${key} ${node.label}`.toLowerCase();
  if (textIncludesAny(text, ['nunchaku'])) return 'diffusers_accelerated';
  if (textIncludesAny(text, ['sd3'])) return 'experimental_diffusers';
  return 'diffusers';
}

function normalizeCatalogLabel(node: NodeData, key: string) {
  if (FACADE_LABELS[key]) return FACADE_LABELS[key];
  if (node.module === 'modules.HuggingFaceTransformers') return node.label || node.action;
  const text = `${key} ${node.category} ${node.label}`.toLowerCase();
  if (textIncludesAny(text, ['loadpipeline'])) return 'Load pipeline';
  if (textIncludesAny(text, ['export', 'save'])) return 'Export';
  if (textIncludesAny(text, ['preview', 'display']))
    return textIncludesAny(text, ['text']) ? 'Preview text' : 'Preview';
  if (textIncludesAny(text, ['inpaint', 'outpaint', 'edit'])) return 'Edit image';
  if (textIncludesAny(text, ['generate'])) {
    if (text.includes('audio') || /\bace(?:[-_ ]?step)?\b/u.test(text)) return 'Generate audio';
    if (textIncludesAny(text, ['video', 'wan'])) return 'Generate video';
    return 'Generate image';
  }
  return node.label || `${node.module}.${node.action}`;
}

export function getNodeCatalogEntry(node: NodeData, key = nodeKey(node)): NodeCatalogEntry {
  const runtimeKind = runtimeKindForNode(node, key);
  const visibility = visibilityForNode(node, key);
  const isDiffusersBacked =
    runtimeKind === 'diffusers' || runtimeKind === 'diffusers_accelerated' || runtimeKind === 'experimental_diffusers';
  const specializedReason =
    visibility === 'experimental'
      ? 'Experimental Diffusers node. Hidden from Essentials.'
      : MODEL_SPECIFIC_MODULES.has(node.module) || node.module === 'modules.ModularDiffusers'
        ? 'Backend strategy node. Studio routes normal workflows through profiles.'
        : undefined;

  return {
    key,
    dragKey: key,
    label: normalizeCatalogLabel(node, key),
    description: node.description,
    surfaceCategory: categoryFromNode(node, key),
    visibility,
    runtimeKind,
    isDiffusersBacked,
    acceleratorStrategy: runtimeKind === 'diffusers_accelerated' ? 'accelerated Diffusers strategy' : undefined,
    specializedReason,
    node,
    groupPath: nodeBrowsePath(node, categoryFromNode(node, key)),
  };
}

export function nodeCatalogEntries(nodes: Record<string, NodeData>) {
  const unique = new Map<string, NodeCatalogEntry>();
  for (const [key, node] of Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b))) {
    const identity = runtimeNodeIdentityV2(node);
    const previous = unique.get(identity);
    if (previous) previous.aliases = [...(previous.aliases ?? []), key, node.label ?? ''];
    else unique.set(identity, getNodeCatalogEntry(node, key));
  }
  return [...unique.values()];
}

export function nodeCatalogEntryMatchesSearch(entry: NodeCatalogEntry, search: string) {
  return matchesSearchKeywords(search, [
    entry.key,
    entry.label,
    entry.surfaceCategory,
    ...entry.groupPath,
    ...(entry.aliases ?? []),
    entry.node.label,
    entry.node.module,
    entry.node.action,
    entry.node.category,
  ]);
}

export function compareNodeSurfaceCategories(left: NodeSurfaceCategory, right: NodeSurfaceCategory) {
  return SURFACE_CATEGORY_ORDER.indexOf(left) - SURFACE_CATEGORY_ORDER.indexOf(right) || left.localeCompare(right);
}

function nodeBrowsePath(node: NodeData, operation: NodeSurfaceCategory) {
  const module = node.module.toLowerCase();
  const category = (node.category ?? '').toLowerCase();
  let modality = 'Data & Utilities';
  if (/threed|three_d|3d/u.test(`${module} ${category}`)) modality = '3D';
  else if (/audio|speech/u.test(`${module} ${category}`)) modality = 'Audio';
  else if (/video/u.test(`${module} ${category}`)) modality = 'Video';
  else if (/image|color/u.test(`${module} ${category}`)) modality = 'Image';
  else if (/text|token|embedding/u.test(`${module} ${category}`)) modality = 'Text';
  else if (/diffusers|model|loader|adapter|sampler/u.test(`${module} ${category}`)) modality = 'Models & Components';
  else if (/transformers/u.test(module)) modality = 'Transformers';
  const label = `${node.action} ${node.label}`.toLowerCase();
  const role = /quantiz/u.test(label)
    ? 'Quantization'
    : /schedul|timestep/u.test(label)
      ? 'Schedulers & Timesteps'
      : /offload|device|memory|cache/u.test(label)
        ? 'Memory & Execution'
        : /resize|crop|pad|scale/u.test(label)
          ? 'Resize & Crop'
          : /filter|blur|sharpen/u.test(`${label} ${category}`)
            ? 'Filters'
            : /color|contrast|brightness/u.test(label)
              ? 'Color'
              : /mask/u.test(label)
                ? 'Masks'
                : operation === 'Utility' || operation === modality
                  ? 'Operations'
                  : operation;
  return [modality, role];
}

export function nodeGroupForCatalogEntry(entry: NodeCatalogEntry, _expertMode: boolean) {
  void _expertMode;
  return entry.groupPath[0] ?? 'Data & Utilities';
}
