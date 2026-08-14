import type { StudioMode, StudioModelType, StudioTemplate } from './types';

export type TemplateQualityKind =
  | 'image_generation'
  | 'image_edit'
  | 'image_inpaint'
  | 'image_outpaint'
  | 'image_control'
  | 'image_layers'
  | 'video'
  | 'audio';

export type TemplateSemanticGroup =
  | 'focal_content'
  | 'spatial_design'
  | 'visual_treatment'
  | 'source_role'
  | 'transformation'
  | 'preservation'
  | 'integration'
  | 'mask_scope'
  | 'canvas_extension'
  | 'continuity'
  | 'control_structure'
  | 'control_adherence'
  | 'layer_structure'
  | 'layer_editability'
  | 'temporal_action'
  | 'camera_or_motion'
  | 'musical_identity'
  | 'arrangement_or_timbre'
  | 'dynamic_structure'
  | 'mix_or_finish';

export type TemplateNegativeCategory = 'artifact' | 'structure' | 'task_fidelity' | 'aesthetic';

export type TemplateQualityIssueCode =
  | 'missing_semantic_group'
  | 'blank_negative_not_allowed'
  | 'too_few_negative_constraints'
  | 'generic_negative_constraints';

export type TemplateQualityIssue = {
  code: TemplateQualityIssueCode;
  message: string;
  semanticGroup?: TemplateSemanticGroup;
};

export type TemplateNegativePolicy = {
  requirement: 'required' | 'allowed_blank';
  declarationId?: string;
  reason: string;
};

export type TemplateNegativeAnalysis = {
  policy: TemplateNegativePolicy;
  constraints: string[];
  categories: TemplateNegativeCategory[];
  issues: TemplateQualityIssue[];
};

export type TemplateQualityAudit = {
  templateId: string;
  kind: TemplateQualityKind;
  requiredSemanticGroups: TemplateSemanticGroup[];
  matchedSemanticGroups: TemplateSemanticGroup[];
  negative: TemplateNegativeAnalysis;
  issues: TemplateQualityIssue[];
  passed: boolean;
};

type SemanticGroupDefinition = {
  label: string;
  patterns: readonly RegExp[];
};

type BlankNegativeDeclaration = {
  id: string;
  modelTypes: readonly StudioModelType[];
  maxGuidanceScale?: number;
  reason: string;
};

const VIDEO_MODES = new Set<StudioMode>([
  'text_to_video',
  'image_to_video',
  'video_to_video',
  'video_inpaint',
  'video_outpaint',
  'reference_to_video',
  'control_to_video',
  'control_video_to_video',
  'video_color_edit',
]);

const AUDIO_MODES = new Set<StudioMode>(['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint']);

const SEMANTIC_GROUPS: Record<TemplateSemanticGroup, SemanticGroupDefinition> = {
  focal_content: {
    label: 'a concrete subject, scene, or designed artifact',
    patterns: [
      /\b(subject|scene|product|device|object|character|portrait|person|building|architecture|interior|exterior)\b/i,
      /\b(worker|keeper|operator|courier|engineer|mechanic|artisan|veterinarian|musician|driver|researcher|watchman)\b/i,
      /\b(bottle|can|radio|camera|poster|logo|packag\w*|lamp|helmet|chair|headphone|observatory|greenhouse)\b/i,
      /\b(train|harbor|gallery|briefcase|coast|orchid|book\w*|speaker|bowl|mascot|carton|mug|cup)\b/i,
    ],
  },
  spatial_design: {
    label: 'composition, camera, or spatial layout',
    patterns: [
      /\b(composition|layout|frame|crop|camera|lens|eye[- ]level|angle|view|perspective|center\w*|foreground|background|focal)\b/i,
      /\b(negative space|grid|close[- ]?up|wide|full[- ]?body|three[- ]quarter|3\/4|front|profile|hero|tabletop|plinth)\b/i,
      /\b(above|below|beside|horizon|cliffside|entrance|interior|exterior|one subject|minimal props|silhouette)\b/i,
    ],
  },
  visual_treatment: {
    label: 'lighting, color, material, or finish direction',
    patterns: [
      /\b(light\w*|shadow\w*|reflection\w*|palette|color|contrast|glow|mist|exposure)\b/i,
      /\b(material\w*|texture\w*|finish|glass|metal|ceramic|paper|fabric|wood|stone)\b/i,
      /\b(cinematic|realistic|photoreal\w*|editorial|photograph\w*|depth of field|studio|style|graphic[- ]design|print[- ]ready)\b/i,
    ],
  },
  source_role: {
    label: 'the role of each source or reference',
    patterns: [/\b(source|reference|input|uploaded|original|contact sheet|dieline|unmasked|surrounding)\b/i],
  },
  transformation: {
    label: 'the requested transformation',
    patterns: [
      /\b(chang|transform|edit|replace|recreate|apply|insert|remove|fuse|relight|reinterpret|convert|decompose)\w*\b/i,
      /\b(create|render|generate|extend|fill)\w*\b/i,
      /\buse\b.{0,80}\b(reference|source)\b/i,
    ],
  },
  preservation: {
    label: 'what must remain invariant',
    patterns: [/\b(preserv|keep|unchanged|maintain|same|do not|without changing|must remain|retain|respect)\w*\b/i],
  },
  integration: {
    label: 'how the result integrates with its source',
    patterns: [
      /\b(perspective|contact shadow|reflection|occlusion|boundary|seam|blend|scale|geometry|light direction)\b/i,
      /\b(match\w*|coherent|consistent|surrounding|composition|material finish|depth of field|noise level)\b/i,
    ],
  },
  mask_scope: {
    label: 'the editable mask or selected-region scope',
    patterns: [/\b(mask|masked|unmasked|outside the mask|selected (source )?region)\w*\b/i],
  },
  canvas_extension: {
    label: 'the direction and extent of canvas expansion',
    patterns: [
      /\b(extend|outpaint|new canvas|expanded|wider|taller|aspect ratio)\w*\b/i,
      /\b(border|side border|new side|around it|outside the original)\w*\b/i,
    ],
  },
  continuity: {
    label: 'spatial or temporal continuity',
    patterns: [
      /\b(continuous|continuity|consistent|stable|unchanged|same session|match\w*|seam|blend)\b/i,
      /\b(across frames|frame to frame|first frame to last|full shot|temporally)\b/i,
      /\b(preserv|maintain|retain|keep)\w*\b/i,
    ],
  },
  control_structure: {
    label: 'the structural signal supplied by the control input',
    patterns: [/\b(control|dieline|canny|depth|pose|edge|structure|layout|panel|fold|silhouette|timing)\w*\b/i],
  },
  control_adherence: {
    label: 'an explicit instruction to follow the control signal',
    patterns: [
      /\b(preserv\w*|follow\w*|strict\w*|match\w*|align\w*|keep\w*|respect\w*|guided by|without drifting|stay\w*)\b/i,
      /\buse the control (image|input|structure)\b/i,
    ],
  },
  layer_structure: {
    label: 'the intended layer decomposition',
    patterns: [/\b(layer|decompose|separate|foreground|background|alpha)\w*\b/i],
  },
  layer_editability: {
    label: 'clean boundaries suitable for later editing',
    patterns: [/\b(editable|edit later|adjusted later|alpha|boundary|edge detail|hidden|occluded|halo|jagged)\w*\b/i],
  },
  temporal_action: {
    label: 'an action or change that unfolds over time',
    patterns: [
      /\b(video|clip|shot|animate|motion|moving|advance|travel|billow|glide|walk|orbit|track|dolly|push[- ]in|play|hurry|gather|fight|strike|step|rise|fall|sway|flow|across frames|frame to frame)\w*\b/i,
    ],
  },
  camera_or_motion: {
    label: 'camera behavior or subject motion',
    patterns: [
      /\b(camera|POV|travel|dolly|orbit|tracking|push[- ]in|motion|path|glide|walk|turntable|low street[- ]level)\w*\b/i,
    ],
  },
  musical_identity: {
    label: 'genre, melody, rhythm, harmony, key, or tempo',
    patterns: [/\b(music|metal|genre|melody|rhythm|harmony|harmonic|key|tempo|beat|riff|groove|chorus)\w*\b/i],
  },
  arrangement_or_timbre: {
    label: 'instrumentation, vocals, arrangement, or timbre',
    patterns: [
      /\b(instrument|guitar|bass|drum|vocal|voice|synth|piano|strings|percussion|timbre|orchestrat|arrange)\w*\b/i,
    ],
  },
  dynamic_structure: {
    label: 'musical sections, dynamics, or duration behavior',
    patterns: [
      /\b(intro|verse|chorus|bridge|outro|build|dynamic|ending|continue|continuation|selected source region|duration|hard[- ]stop|fade)\w*\b/i,
    ],
  },
  mix_or_finish: {
    label: 'mix, loudness, ambience, or production finish',
    patterns: [/\b(mix|loudness|ambience|production|reverb|stereo|master|clipping|noise|sibilance|fade)\w*\b/i],
  },
};

const REQUIRED_SEMANTIC_GROUPS: Record<TemplateQualityKind, readonly TemplateSemanticGroup[]> = {
  image_generation: ['focal_content', 'spatial_design', 'visual_treatment'],
  image_edit: ['source_role', 'transformation', 'preservation', 'integration'],
  image_inpaint: ['source_role', 'mask_scope', 'transformation', 'preservation', 'integration'],
  image_outpaint: ['source_role', 'canvas_extension', 'continuity', 'visual_treatment'],
  image_control: ['control_structure', 'control_adherence', 'transformation', 'visual_treatment'],
  image_layers: ['source_role', 'layer_structure', 'layer_editability', 'preservation'],
  video: ['temporal_action', 'camera_or_motion', 'continuity', 'visual_treatment'],
  audio: ['musical_identity', 'arrangement_or_timbre', 'dynamic_structure', 'mix_or_finish'],
};

export const BLANK_NEGATIVE_DECLARATIONS: readonly BlankNegativeDeclaration[] = [
  {
    id: 'z-image-turbo-no-negative-input',
    modelTypes: ['ZImageModularPipeline'],
    reason: 'Z-Image Turbo has no negative-prompt input; exclusions belong in the positive production brief.',
  },
  {
    id: 'flux-native-conditioning',
    modelTypes: [
      'FluxSchnellPipeline',
      'FluxDevPipeline',
      'FluxKreaPipeline',
      'FluxKontextPipeline',
      'FluxFillPipeline',
      'FluxDepthPipeline',
      'FluxCannyPipeline',
      'FluxReduxPipeline',
      'Flux2KleinPipeline',
    ],
    reason: 'These FLUX recipes may intentionally use native or zeroed negative conditioning.',
  },
  {
    id: 'explicit-cfg-one-image-recipe',
    modelTypes: [
      'QwenImageModularPipeline',
      'QwenImageEditModularPipeline',
      'QwenImageEditPlusModularPipeline',
      'QwenImageLayeredModularPipeline',
    ],
    maxGuidanceScale: 1,
    reason: 'The template explicitly locks CFG to 1, where negative conditioning is inactive for this recipe.',
  },
  {
    id: 'ace-turbo-no-negative-input',
    modelTypes: ['AceStepAudioPipeline'],
    maxGuidanceScale: 1,
    reason:
      'The ACE-Step v1.5 Turbo backend has no negative-prompt input and uses guidance-distilled CFG 1; exclusions belong in the production brief.',
  },
  {
    id: 'ltx-distilled-no-cfg',
    modelTypes: ['LTXVideoPipeline'],
    maxGuidanceScale: 1,
    reason:
      'The qualified LTX 13B distilled artifact uses guidance 1 without CFG; exclusions remain explicit in the positive production brief.',
  },
];

const NEGATIVE_CATEGORY_PATTERNS: Record<TemplateNegativeCategory, readonly RegExp[]> = {
  artifact: [
    /\b(blur|blurry|noise|noisy|artifact|compression|flicker|jitter|tearing|watermark|halo|banding)\w*\b/i,
    /\b(clipping|muddy|soft focus|pixelat|phasey|sibilance|silence|low quality|low detail)\w*\b/i,
    /(模糊|低质量|最差质量|JPEG压缩|静止不动)/i,
  ],
  structure: [
    /\b(warp|deform|extra|duplicate|anatom|geometry|perspective|proportion|shape|limb|hand|face|eye)\w*\b/i,
    /\b(stretch|broken|melt|floating|wrong scale|fold|hinge|silhouette|window count)\w*\b/i,
    /(多余的手指|手指融合|画得不好的手部|画得不好的脸部|畸形|毁容|肢体|三条腿)/i,
  ],
  task_fidelity: [
    /\b(text|letter|word|title|label|logo|mark|identity|source|control|mask|unmasked|boundary|seam|panel|layout)\w*\b/i,
    /\b(composition|style drift|material|reflection|lighting|shadow|camera|motion|frame|tempo|key|splice|fade|vocal|mix)\w*\b/i,
    /\b(background|subject|product|wardrobe|crop|grid|border|layer|alpha|hair|object|original|central)\w*\b/i,
    /(字幕|静态|画作|画面|背景|倒着走)/i,
  ],
  aesthetic: [
    /\b(clutter|contrast|oversaturat|glare|plastic|overprocess|harsh|flat lighting|busy|messy|ugly)\w*\b/i,
    /(色调艳丽|过曝|整体发灰|丑陋|杂乱)/i,
  ],
};

export function classifyTemplateQualityKind(template: Pick<StudioTemplate, 'mode' | 'modelType'>): TemplateQualityKind {
  if (AUDIO_MODES.has(template.mode) || template.modelType === 'AceStepAudioPipeline') return 'audio';
  if (VIDEO_MODES.has(template.mode) || template.modelType === 'WanVACEPipeline') return 'video';
  if (template.mode === 'inpaint') return 'image_inpaint';
  if (template.mode === 'outpaint') return 'image_outpaint';
  if (template.mode === 'control_image') return 'image_control';
  if (template.mode === 'layer_decomposition') return 'image_layers';
  if (template.mode === 'edit_image' || template.mode === 'multi_image_reference_edit') return 'image_edit';
  return 'image_generation';
}

export function getRequiredTemplateSemanticGroups(
  template: Pick<StudioTemplate, 'mode' | 'modelType'>,
): TemplateSemanticGroup[] {
  return [...REQUIRED_SEMANTIC_GROUPS[classifyTemplateQualityKind(template)]];
}

export function templatePromptMatchesSemanticGroup(prompt: string, group: TemplateSemanticGroup): boolean {
  return SEMANTIC_GROUPS[group].patterns.some((pattern) => pattern.test(prompt));
}

export function getTemplateNegativePolicy(
  template: Pick<StudioTemplate, 'modelType' | 'example'>,
): TemplateNegativePolicy {
  const guidanceScale = template.example?.lockedSettings?.guidanceScale;
  const declaration = BLANK_NEGATIVE_DECLARATIONS.find((candidate) => {
    if (!candidate.modelTypes.includes(template.modelType)) return false;
    if (candidate.maxGuidanceScale === undefined) return true;
    return guidanceScale !== undefined && guidanceScale <= candidate.maxGuidanceScale;
  });

  if (declaration) {
    return {
      requirement: 'allowed_blank',
      declarationId: declaration.id,
      reason: declaration.reason,
    };
  }

  return {
    requirement: 'required',
    reason: 'This model recipe has no declared reason to omit negative constraints.',
  };
}

export function analyzeTemplateNegativePrompt(
  template: Pick<StudioTemplate, 'modelType' | 'example' | 'negativePrompt'>,
): TemplateNegativeAnalysis {
  const policy = getTemplateNegativePolicy(template);
  const negativePrompt = template.negativePrompt?.trim() ?? '';
  if (!negativePrompt) {
    const issues: TemplateQualityIssue[] =
      policy.requirement === 'required'
        ? [
            {
              code: 'blank_negative_not_allowed',
              message: policy.reason,
            },
          ]
        : [];
    return { policy, constraints: [], categories: [], issues };
  }

  const constraints = Array.from(
    new Set(
      negativePrompt
        .split(/[,;\n.，；。]+/)
        .map((constraint) => constraint.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const categories = (Object.keys(NEGATIVE_CATEGORY_PATTERNS) as TemplateNegativeCategory[]).filter((category) =>
    NEGATIVE_CATEGORY_PATTERNS[category].some((pattern) => pattern.test(negativePrompt)),
  );
  const issues: TemplateQualityIssue[] = [];

  if (constraints.length < 4) {
    issues.push({
      code: 'too_few_negative_constraints',
      message: `Negative prompt has ${constraints.length} distinct constraints; expected at least 4.`,
    });
  }

  const hasTaskSpecificCategory = categories.includes('structure') || categories.includes('task_fidelity');
  if (categories.length < 2 || !hasTaskSpecificCategory) {
    issues.push({
      code: 'generic_negative_constraints',
      message: 'Negative constraints must cover at least two failure categories, including structure or task fidelity.',
    });
  }

  return { policy, constraints, categories, issues };
}

export function auditTemplateQuality(template: StudioTemplate): TemplateQualityAudit {
  const kind = classifyTemplateQualityKind(template);
  const requiredSemanticGroups = getRequiredTemplateSemanticGroups(template);
  const matchedSemanticGroups = requiredSemanticGroups.filter((group) =>
    templatePromptMatchesSemanticGroup(template.prompt, group),
  );
  const semanticIssues: TemplateQualityIssue[] =
    template.promptQualityPolicy === 'adapter_reference'
      ? []
      : requiredSemanticGroups
          .filter((group) => !matchedSemanticGroups.includes(group))
          .map((group) => ({
            code: 'missing_semantic_group',
            semanticGroup: group,
            message: `Prompt is missing ${SEMANTIC_GROUPS[group].label}.`,
          }));
  const negative = analyzeTemplateNegativePrompt(template);
  const issues = [...semanticIssues, ...negative.issues];

  return {
    templateId: template.id,
    kind,
    requiredSemanticGroups,
    matchedSemanticGroups,
    negative,
    issues,
    passed: issues.length === 0,
  };
}

export function auditTemplateCatalog(templates: readonly StudioTemplate[]): TemplateQualityAudit[] {
  return templates.map(auditTemplateQuality);
}
