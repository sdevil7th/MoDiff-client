import type { StudioTemplateWorkflowBlockSettings } from './types';

/** Retained published shorter recipe; saved graphs keep their own values. */
export const MOONFLOWER_LEGACY_RECIPE: NonNullable<StudioTemplateWorkflowBlockSettings['lyricVideo']> = {
  visualModel: {
    source: 'hub',
    value: 'Lightricks/LTX-Video-0.9.8-13B-distilled',
    revision: '7c64400e1861cc0d7b98d570a1926d5408ec60cd',
  },
  transitionSeconds: 0.35,
  ['fontSize']: 58,
  bottomMargin: 70,
  audio: {
    prompt:
      "Dream-pop at 100 BPM in C-sharp minor and 4/4. A clear English lead vocal starts on the first beat and sings each of the six supplied lines exactly once, in order, one line every two bars. Finish the final words 'the dawn' by bar 12, then leave a short instrumental tail. Soft electronic drums, warm bass, glassy arpeggiator, polished spacious stereo. No intro, interlude, ad-libs, repeated lines, omitted words, or fade.",
    lyrics:
      '[Verse]\nDaylight leaves the garden wall\nSilver buds begin to call\nWhite petals turn into the night\nEvery vine unfolds its light\nStars grow pale above the lawn\nMoonflowers hold until the dawn',
    durationSeconds: 30,
    steps: 8,
    guidanceScale: 1,
    shift: 3,
    seed: 1201047366,
    bpm: 100,
    keyscale: 'C# minor',
    timesignature: '4',
    vocalLanguage: 'en',
  },
  audioFit: {
    sourceStartSeconds: 0,
    sourceDurationSeconds: 30,
    targetDurationSeconds: 381 / 16,
    delaySeconds: 0,
    targetSampleRate: 48000,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  },
  lrc: '[00:00.00]Daylight leaves the garden wall\n[00:03.26]Silver buds begin to call\n[00:07.44]White petals turn into the night\n[00:11.38]Every vine unfolds its light\n[00:15.08]Stars grow pale above the lawn\n[00:18.90]Moonflowers hold until the dawn',
  promptsJson: JSON.stringify([
    'Photoreal music-video opening without visible text. At blue dusk, a stabilized camera glides low beside a real garden wall as closed white moonflower buds and heart-shaped leaves stream past in foreground parallax. Wind moves every vine from frame one while the last warm daylight visibly fades. Natural plant anatomy and restrained color; no people, fantasy glow, illustration, duplicate stems or static hold.',
    'Photoreal macro time-lapse in the same garden. One healthy white moonflower bud opens continuously into a complete trumpet-shaped bloom while nearby leaves sway in an evening breeze. The camera makes a slow curved move, keeping the flower center sharp and the stone wall softly behind it. Preserve realistic petals and stem attachment; no hands, insects, melting, extra petals, text or frozen interval.',
    'Photoreal moonlit tracking shot along a mature trellis covered in fully opened white moonflowers. The camera travels steadily between foreground leaves while several blooms turn gently in the wind and soft cloud shadows cross the wall. Clear depth and natural silver-blue light; no people, fantasy particles, artificial neon, warped vines, lettering or static frame.',
    'Photoreal close passage through the moonflower canopy after a brief shower. The camera pushes forward continuously as round droplets roll down broad leaves, flexible stems rebound in the breeze and white blossoms pass close to both edges. Keep flowers crisp, attached and naturally wet; no flood, impossible water, insects, people, text, synthetic render or sudden jump.',
    'Photoreal dawn finale in the same garden. A wide camera cranes slowly upward from open white moonflowers toward a pale gold horizon while vines ripple, clouds travel and the first sunlight moves across the wall. The flowers remain stable and recognizable through the closing frame. No people, fantasy glow, melting petals, duplicate blooms, text, illustration or static hold.',
  ]),
};

/** Ordered scene authoring recovered from the accepted photographic film.
 * Source paths and private execution records stay outside the public catalog. */
export const MOONFLOWER_SCENES = [
  {
    title: 'Garden Wall',
    prompt:
      'Photographic moonflower garden at blue dusk, based on the supplied photograph. A stabilized camera slides slowly right along the real stone wall, with close heart-shaped leaves crossing the foreground and deeper white trumpet flowers shifting in parallax. A light breeze moves leaves and flexible stems from the first frame. Keep the main central flowers crisp, naturally attached, and unchanged in shape through the ending. Preserve the same plant and wall. Soft restrained twilight, natural depth and gentle movement; no new flowers, melting petals, text, people, glow or cuts.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Garden Path',
    prompt:
      'Photographic blue-hour garden with the same stone wall, white moonflowers, wooden support, terracotta pot, curved path and lawn. Make one slow camera push-in and slight pan right from the opening view toward the ending view. Flowers and pot move gently toward the left edge as the path grows larger. Keep attached stems, flower anatomy and garden geometry stable. Steady cool twilight and exposure, gentle leaf motion. Continuous shot; no cut, new objects, melting or text.',
    seed: 1201047366,
    reference_count: 2,
  },
  {
    title: 'Wall Detail',
    prompt:
      'Photographic close garden-wall detail at dusk. The same attached white moonflowers, wooden support, connected climbing stems and heart-shaped leaves remain coherent. Warm evening light slowly leaves the rough pale stone wall as cool twilight gathers. A gentle breeze shifts attached leaves and lightly stirs petal edges. The camera makes a restrained smooth sideways drift along the wall, keeping the main flower visible. Natural white petals, stable exposure and believable plant anatomy. One continuous quiet shot, no duplicate supports, extra flowers, morphing, cuts, captions or fantasy glow.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Silver Bud',
    prompt:
      'Photographic close shot of this same unopened moonflower bud at twilight. Its silver-white petals stay tightly folded; it never blooms. From frame one, a breeze gently sways the attached bud, stem and heart-shaped leaf. The camera slides left with background parallax against the same wall and lawn. Keep the whole bud in frame and the green calyx attached. Natural cool evening light, coherent plant anatomy. One continuous shot; no cut, duplicate bud, melting or text.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Unfolding',
    prompt:
      'Botanical time-lapse of this same moonflower bud. From frame one, its folded white petals steadily unroll into one broad trumpet flower. The green calyx remains attached to the same stem. The camera arcs right with visible background parallax, keeping the whole opening flower in frame. Preserve the heart-shaped leaf, vine, wall and natural twilight. Real petals and coherent anatomy. One continuous shot; no cut, frozen hold, duplicate flower, melting, paper or text.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Vine Motion',
    prompt:
      'Photographic close shot of this same moonflower vine at night. From frame one, a breeze bends the thin attached stem and rocks the heart-shaped leaves. Leaf veins catch soft moonlight. The camera tracks slowly along the vine with background parallax against the same wall and path. Keep the large leaf, connected stems and white flower in frame. Natural botanical anatomy, stable garden geometry. One continuous shot; no cut, glowing leaves, melting, duplicate flowers or text.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Stars Over Lawn',
    prompt:
      'Photographic moonflower garden before dawn, with pale small stars above the lawn. Keep the same single support, attached white flowers, connected leaves, pot, curved path, hedge and stone wall. The camera gently tilts upward from the lawn toward the sky. A light breeze moves attached leaves and petal edges. Stars slowly fade as the natural blue horizon brightens slightly. Keep the garden layout and flower anatomy stable, neutral white petals and realistic shadows. One continuous quiet shot, no duplicates, new objects, morphing, cuts or text.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Moonlit Garden',
    prompt:
      'Photographic close-up of the same open white moonflowers in a quiet night garden. Keep the single wooden support, connected stems, petal folds and leaves coherent. Soft neutral moonlight reveals the flowers against the dark stone wall and garden. A gentle breeze slowly stirs attached leaves and petal edges. The camera eases backward slightly, keeping the main blossom fully visible. Preserve natural plant anatomy, restrained low-light colors and steady exposure. One continuous shot, no duplicated flowers, glow, morphing, cuts or text.',
    seed: 1201047366,
    reference_count: 1,
  },
  {
    title: 'Dawn',
    prompt:
      'Photographic early dawn in the same stone-walled garden. Open white moonflowers remain attached to one wooden support beside the terracotta pot, curved path and green lawn. The pale blue sky carries a soft peach glow at the horizon. A light morning breeze gently moves connected leaves and petal edges. The camera slowly eases backward and slightly right, revealing more lawn while keeping the flowers and single support coherent. Preserve natural flower anatomy and stable neutral colors. One continuous shot, no duplicated objects, morphing, cuts, flicker or text.',
    seed: 1201047366,
    reference_count: 1,
  },
];

export const MOONFLOWER_NINE_SCENE_RECIPE: NonNullable<StudioTemplateWorkflowBlockSettings['lyricVideo']> = {
  ...MOONFLOWER_LEGACY_RECIPE,
  recipeVersion: 'nine-scenes:v2',
  visualExecutionSelection: {
    schemaVersion: 1,
    pipelineClass: 'LTXConditionPipeline',
    task: 'image_to_video',
    executionProfileId: 'ltx-video:direct',
    bindingSpec: { modelType: 'LTXVideoPipeline', mode: 'image_to_video' },
    implementation: 'native_stages',
    authoringRecipeId: 'generic-video-stages:v1',
  },
  promptsJson: JSON.stringify(MOONFLOWER_SCENES),
  transitionSeconds: 0,
  lrc: '',
  audio: {
    ...MOONFLOWER_LEGACY_RECIPE.audio,
    prompt:
      'Acoustic pop ballad, 96 BPM, D major, 4/4. Clear close-miked solo female lead vocal with distinct English diction, a straight syllabic melody and confident mid-register delivery. Vocal-forward dry studio mix, sparse piano, gently strummed acoustic guitar and soft shaker. Warm hopeful night-garden mood, simple verse and chorus, clean resolved ending.',
    lyrics:
      '[verse]\nDaylight leaves the garden wall\nSilver buds begin to call\nWhite petals turn into the night\nEvery vine unfolds its light\nStars grow pale above the lawn\nMoonflowers hold until the dawn',
    durationSeconds: 45,
    seed: 20261106,
    bpm: 96,
    keyscale: 'D major',
    timesignature: '4',
  },
  audioFit: {
    sourceStartSeconds: 0,
    sourceDurationSeconds: 45,
    targetDurationSeconds: 45,
    delaySeconds: 0,
    targetSampleRate: 48000,
    fadeInSeconds: 0,
    fadeOutSeconds: 0,
  },
};
