import type { StudioTemplatePromptGuide } from './types';

export const IMAGE_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  subject: [
    'one unmistakable focal subject',
    'specific pose or product orientation',
    'distinctive silhouette and proportions',
  ],
  environment: [
    'named location, era, weather, and background activity',
    'foreground, midground, and background depth',
    'intentional negative space for supporting copy',
  ],
  composition: [
    'clear visual hierarchy and camera-relative placement',
    'balanced edge spacing with a deliberate focal path',
    'subject scale composed for the target aspect ratio',
  ],
  materials: [
    'named surface materials and finish',
    'microtexture, wear, and edge detail',
    'physically coherent reflections and translucency',
  ],
  style: [
    'editorial realism with restrained art direction',
    'cinematic production design with natural detail',
    'premium commercial finish without stock-photo staging',
  ],
  lighting: [
    'defined key, fill, and rim-light relationship',
    'specific color temperature and shadow softness',
    'motivated light with realistic contact shadows',
  ],
  camera: [
    'named shot size, angle, and focal length',
    'intentional aperture and focus plane',
    'perspective appropriate to the subject scale',
  ],
  textRendering: [
    'short exact copy in quotation marks',
    'defined type placement, scale, and alignment',
    'high-contrast lettering with clear reading order',
  ],
  parameters: [
    'detail density suited to the final resolution',
    'one coherent scene rather than a contact sheet',
    'controlled complexity at the requested aspect ratio',
  ],
  negative: [
    'generic stock-photo composition',
    'flat plastic surfaces',
    'muddy microdetail',
    'warped geometry',
    'unreadable lettering',
    'duplicated objects',
  ],
  modelHints: [
    'Write a compact creative brief: subject, environment, composition, materials, light, and camera.',
    'Use concrete visual relationships instead of stacking quality adjectives.',
  ],
};

export const EDIT_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  ...IMAGE_PROMPT_GUIDE,
  subject: [
    'the named source subject',
    'the selected object or masked region',
    'the original scene as the visual anchor',
  ],
  environment: [
    'retain the source environment',
    'continue nearby texture and scene structure',
    'match local atmosphere and depth',
  ],
  composition: [
    'keep the original crop and subject placement',
    'match the source perspective',
    'integrate the edit at the existing scale',
  ],
  materials: [
    'name the replacement material and finish',
    'match neighboring texture scale',
    'preserve plausible reflections and contact shadows',
  ],
  preservation: [
    'preserve identity, pose, camera, and crop',
    'keep unedited geometry and background unchanged',
    'retain existing brand marks and readable copy',
  ],
  change: [
    'change only the explicitly named region',
    'describe the replacement shape, material, and color',
    'state the intended relighting or cleanup precisely',
  ],
  continuity: [
    'match source illumination and shadow direction',
    'continue edges, grain, and depth of field through the edit',
    'blend boundaries without halos or texture repetition',
  ],
  style: ['match the source visual language', 'photoreal localized retouch', 'production-ready material replacement'],
  lighting: [
    'match source exposure and color temperature',
    'preserve existing light direction',
    'add physically consistent contact shadows',
  ],
  camera: [
    'keep the original focal length',
    'preserve viewpoint and vanishing lines',
    'maintain the source focus plane',
  ],
  textRendering: [
    'leave unrelated copy unchanged',
    'replace only the quoted text',
    'preserve typographic alignment and print texture',
  ],
  parameters: [
    'edit strength proportional to the requested change',
    'enough denoising for integration without identity drift',
  ],
  negative: [
    'identity drift',
    'changed camera angle',
    'unrequested background changes',
    'visible edit seam',
    'halo around the mask',
    'mismatched texture scale',
  ],
  modelHints: [
    'Use three clauses: what must remain, what changes, and how the result must integrate.',
    'Describe a mask target separately from the creative edit; object selection is not an edit prompt.',
  ],
};

export const CONTROL_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  ...IMAGE_PROMPT_GUIDE,
  subject: [
    'the scene or object defined by the control input',
    'appearance details that do not fight the control geometry',
    'one clear controlled focal subject',
  ],
  environment: [
    'materials, weather, era, and atmosphere for the controlled layout',
    'background depth that follows the supplied perspective',
    'scale cues placed only where the control permits them',
  ],
  composition: [
    'treat control edges, depth, pose, or panel layout as authoritative',
    'preserve the supplied camera and vanishing lines',
    'keep major masses aligned to the control signal',
  ],
  preservation: [
    'retain every major controlled line and silhouette',
    'keep object count, pose, and spatial hierarchy stable',
    'do not use the appearance prompt to redesign structure',
  ],
  change: [
    'describe material, color, lighting, and atmosphere',
    'add only secondary detail compatible with the control',
    'state which visual attributes remain free to change',
  ],
  continuity: [
    'align texture and lighting across controlled boundaries',
    'keep perspective and depth internally coherent',
    'avoid edge drift and duplicated structural lines',
  ],
  parameters: [
    'identify whether the input is Canny, depth, pose, mask, or dieline',
    'choose conditioning strength for adherence versus creative latitude',
    'prepare the control deterministically at the target resolution',
  ],
  negative: [
    'ignored control signal',
    'shifted major edges',
    'broken perspective',
    'duplicated structure',
    'appearance that obscures the control',
    'unrequested geometry',
  ],
  modelHints: [
    'Let the control input define structure; use the prompt for appearance, materials, light, and atmosphere.',
    'Name the control type and the structural features that must remain aligned.',
  ],
};

export const LAYER_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  ...EDIT_PROMPT_GUIDE,
  subject: ['foreground subject layer', 'background environment layer', 'separate text and graphic elements'],
  environment: ['complete background behind removed foreground objects', 'retain scene depth across layers'],
  composition: [
    'keep layer registration pixel-aligned',
    'preserve the original canvas and placement',
    'maintain foreground-to-background depth order',
  ],
  materials: ['preserve fine hair, fabric, glass, and translucent edges', 'retain material-specific edge softness'],
  preservation: [
    'preserve every visible source element',
    'retain original colors and spatial relationships',
    'keep typography as independent elements',
  ],
  change: ['separate named semantic groups into editable layers', 'reconstruct occluded background where required'],
  continuity: [
    'clean alpha transitions',
    'consistent color at layer boundaries',
    'background completion without repeated patches',
  ],
  style: ['faithful source decomposition', 'production-ready layered asset', 'non-destructive separation'],
  lighting: [],
  camera: [],
  textRendering: ['isolate each text block when possible', 'preserve exact lettering and placement'],
  parameters: ['request a practical layer count', 'prefer semantic groups over arbitrary depth slices'],
  negative: [
    'merged semantic layers',
    'jagged alpha',
    'edge halos',
    'missing foreground detail',
    'broken transparency',
    'misregistered layers',
  ],
  modelHints: [
    'Name the layer groups you need downstream rather than asking for generic decomposition.',
    'Treat alpha quality and reconstructed occluded areas as separate acceptance checks.',
  ],
};

export const VIDEO_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  subject: [
    'one stable subject with defining features',
    'consistent wardrobe or product geometry',
    'a clear action objective',
  ],
  environment: [
    'specific setting with persistent spatial landmarks',
    'weather, atmosphere, and background activity over time',
    'foreground and background elements with distinct motion',
  ],
  composition: [
    'defined opening frame and subject placement',
    'stable screen direction',
    'one intentional shot unless a transition is named',
  ],
  materials: [
    'surface behavior while moving',
    'fabric, hair, liquid, smoke, or debris dynamics',
    'consistent reflections across frames',
  ],
  style: [
    'cinematic live-action continuity',
    'controlled commercial product film',
    'documentary motion with natural imperfections',
  ],
  lighting: [
    'consistent motivated light direction',
    'intentional exposure or color transition',
    'stable shadows without frame-to-frame flicker',
  ],
  camera: [
    'shot size, lens, and camera height',
    'named pan, tilt, dolly, orbit, or locked-off move',
    'camera direction, speed, and stopping point',
  ],
  motion: [
    'action with a clear beginning, development, and end',
    'direction, speed, acceleration, and secondary motion',
    'physically plausible contact, weight, and inertia',
  ],
  continuity: [
    'stable identity, geometry, and scene layout across frames',
    'continuous movement without teleporting or pose resets',
    'preserve source details unless a change is named',
  ],
  textRendering: [
    'avoid long copy during motion',
    'keep short signage fixed and legible',
    'preserve logo shape across frames',
  ],
  parameters: [
    'action paced to resolve within the requested duration',
    'motion cadence suited to the requested frame rate',
    'transition timing stated in seconds or clip phases',
  ],
  negative: [
    'static frame',
    'flicker',
    'camera jitter',
    'identity drift',
    'rubbery motion',
    'warped limbs or product geometry',
    'unrequested cuts',
    'changing text',
  ],
  modelHints: [
    'Describe the shot as a timeline: opening state, motion, camera behavior, and resolved end state.',
    'For image-to-video, prompt the motion and camera—not a conflicting redesign of the source frame.',
  ],
};

export const AUDIO_PROMPT_GUIDE: StudioTemplatePromptGuide = {
  subject: [
    'specific genre or sound source',
    'lead instrument, vocal role, or foreground event',
    'clear emotional or functional intent',
  ],
  environment: [
    'named acoustic space and listening perspective',
    'dry studio, intimate room, hall, exterior, or designed ambience',
  ],
  composition: [
    'defined opening, development, peak, and ending',
    'section lengths that fit the requested duration',
    'intentional contrast between sections',
  ],
  materials: [
    'instrument technique, timbre, and articulation',
    'physical material and texture for sound effects',
    'attack, sustain, decay, and movement',
  ],
  style: [
    'specific era and production language',
    'genre-authentic performance character',
    'cohesive sonic palette rather than adjective stacking',
  ],
  lighting: [],
  camera: [],
  textRendering: [],
  arrangement: [
    'lead, rhythm, bass, percussion, and supporting layers',
    'section-by-section entrances, exits, and development',
    'fills, transitions, breakdowns, and final resolution',
  ],
  mix: [
    'foreground-to-background balance',
    'stereo width, room depth, and low-end weight',
    'controlled dynamics with headroom and a clean tail',
  ],
  motion: [
    'rhythmic pulse and tempo feel',
    'spatial approach, pass-by, or left-to-right movement',
    'temporal build and decay',
  ],
  continuity: [
    'consistent tempo, key, and sonic identity',
    'natural phrase transitions',
    'no premature fade before the intended ending',
  ],
  parameters: [
    'state BPM, meter, key, language, and duration when relevant',
    'match arrangement density to clip length',
    'distinguish full track, loop, stem, ambience, and one-shot',
  ],
  negative: [
    'muddy low end',
    'harsh clipping',
    'abrupt section changes',
    'unintended tempo drift',
    'premature fadeout',
    'crowded arrangement',
    'indistinct sound source',
  ],
  modelHints: [
    'For music, specify genre, instrumentation, arrangement, performance, mix, BPM, key, meter, and duration.',
    'For SFX, specify source, material, space, perspective, temporal envelope, movement, and exact length.',
  ],
};

export const BASE_PROMPT_GUIDE = IMAGE_PROMPT_GUIDE;
