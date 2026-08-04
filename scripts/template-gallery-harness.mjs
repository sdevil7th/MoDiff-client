import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { compareRunProvenance, runtimeLockFromProvenance } from './live-proof-provenance.mjs';
import templateGalleryContract from '../src/studio/templateGalleryContract.json' with { type: 'json' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_GALLERY_DIR = join(ROOT, 'public', 'template-gallery');
const PUBLIC_MANIFEST = join(PUBLIC_GALLERY_DIR, 'manifest.json');
const ARTIFACT_ROOT = join(ROOT, 'artifacts', 'template-gallery');
const EXACT_QUALITY_REVIEW_STATUS = 'approved_exact';
const REVIEWED_QUALITY_REVIEW_STATUS = 'approved_reviewed';
const QUALITY_REVIEW_STATUSES = new Set([EXACT_QUALITY_REVIEW_STATUS, REVIEWED_QUALITY_REVIEW_STATUS]);
// These showcases were explicitly returned for visual rework.  They may only be
// republished with the stricter, evidence-bearing visual review schema.  Keeping
// the gate scoped lets older, unrelated proofs remain readable while preventing
// a rejected asset from being re-approved with the legacy broad scorecard.
const STRICT_VISUAL_REVIEW_TEMPLATES = new Set([
  'flux_depth_control',
  'flux_fill_outpaint',
  'flux_redux_edit',
  'flux_redux_multi_reference',
  'flux_schnell_text_to_image',
  'high_quality',
  'qwen_inpaint_object_replace',
  'qwen_low_vram_poster_layout',
  'qwen_outpaint_aspect_template',
  'flux2_klein_multi_reference',
  'qwen_poster_logo_text',
  'qwen_logo_texture',
  'qwen_multi_reference_product',
  'character_edit',
  'qwen_inpaint_mask_draft',
  'qwen_layered_portrait',
  'qwen_product_ad_composite',
  'wan_vace_cinematic_text_to_video',
  'wan_vace_direct_text_to_video',
  'z_image_lora_style',
  'flux_dev_expert_text_to_image',
  'z_image_poster',
  'z_image_quick_concept',
]);
const DYNAMIC_VIDEO_REVIEW_TEMPLATES = new Set([
  'ltx_video_text_to_video',
  'ltx_video_image_to_video',
  'ltx_video_video_to_video',
  'ltx_video_multi_reference',
  'wan_vace_cinematic_text_to_video',
  'wan_vace_video_color_grade',
  'wan_vace_masked_object_replace',
  'wan_vace_outpaint_reframe',
  'wan_vace_grayscale_control',
  'wan_vace_video_to_video',
  'wan_vace_animate_product_still',
  'wan_vace_reference_motion',
  'ltx_video_long_showcase',
  'wan_video_long_showcase',
  'wan_21_t2v_13b_seed_vault',
  'wan_22_ti2v_5b_seed_vault',
  'wan_22_i2v_seed_vault',
  'ltx_video_animated_story',
  'ace_step_lyric_music_video',
]);
// Five seconds is the native useful floor for the qualified short-video
// families. Longer sequence templates retain their separate 20-35s review
// contract; a single native Wan shot must not be padded or duplicated merely
// to satisfy a gallery-wide ten-second rule.
const MINIMUM_TEMPLATE_VIDEO_SECONDS = templateGalleryContract.video.minimumDurationSeconds;
// Family-specific native dimensions are already locked in each template's
// expected output. This floor only rejects obsolete tiny delivery proofs; it
// must not impose LTX's 1216x704 canvas on native Wan 832x480-class outputs.
const MINIMUM_TEMPLATE_VIDEO_SHORT_EDGE = templateGalleryContract.video.minimumShortEdge;
const MINIMUM_TEMPLATE_VIDEO_LONG_EDGE = templateGalleryContract.video.minimumLongEdge;
export const MOTION_REVIEW_PROFILES = Object.freeze({
  global_camera: Object.freeze({
    activeWindowChangedPixelRatio: 0.08,
    strongWindowChangedPixelRatio: 0.2,
    lowAdjacentChangedPixelRatio: 0.015,
  }),
  localized_subject: Object.freeze({
    activeWindowChangedPixelRatio: 0.001,
    strongWindowChangedPixelRatio: 0.005,
    lowAdjacentChangedPixelRatio: 0.0005,
  }),
});
const DEFAULT_MOTION_REVIEW_PROFILE = 'global_camera';
const LONG_VIDEO_REVIEW_TEMPLATES = new Set([
  'ltx_video_long_showcase',
  'wan_video_long_showcase',
  'wan_21_t2v_13b_seed_vault',
  'ace_step_lyric_music_video',
]);
// Source-conditioned video templates are only useful when the generated clip
// demonstrably preserves the source contract. Motion scores alone cannot catch
// identity redesign, mask spill, changed camera paths, or altered unmasked
// regions (the rejected rally color-grade candidate is a concrete example).
const SOURCE_PRESERVATION_VIDEO_TEMPLATES = new Set([
  'ltx_video_image_to_video',
  'ltx_video_video_to_video',
  'ltx_video_multi_reference',
  'wan_vace_video_color_grade',
  'wan_vace_masked_object_replace',
  'wan_vace_outpaint_reframe',
  'wan_vace_grayscale_control',
  'wan_vace_video_to_video',
  'wan_vace_animate_product_still',
  'wan_vace_reference_motion',
  'wan_22_i2v_seed_vault',
]);
// A still image supplies no source camera trajectory or timing to preserve.
// Keep identity/background preservation mandatory, but record those two video-
// only comparisons as not applicable instead of inventing evidence.
const STILL_SOURCE_VIDEO_TEMPLATES = new Set([
  'ltx_video_image_to_video',
  'ltx_video_multi_reference',
  'wan_vace_animate_product_still',
  'wan_22_i2v_seed_vault',
]);
// A user's explicit rejection supersedes every earlier internal approval. A
// replacement must have a different rejected identity and a later review that
// addresses the reported defect. Audio-only rejections bind the decoded
// picture+sound pair so an accepted picture can be reused with corrected audio.
const USER_REJECTED_OUTPUTS = new Map([
  [
    'ltx_video_text_to_video',
    {
      rejectedAt: '2026-07-17T00:00:00.000Z',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:346b9ca1410359054c090c54f7238914997222f3999d836553cd3921817a07cf',
    },
  ],
  [
    'ltx_video_video_to_video',
    {
      rejectedAt: '2026-07-17T00:00:00.000Z',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:7a8dd1467c1329a2908651182638d2fc26346da92d06c19dbfd97c6e303cd739',
    },
  ],
  [
    'ltx_video_multi_reference',
    {
      rejectedAt: '2026-07-17T00:00:00.000Z',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:e82217fee5a001f021e135d148177e30138b6bb0ba25b83c17fd6612ca0d62c5',
    },
  ],
  [
    'ltx_video_long_showcase',
    {
      rejectedAt: '2026-07-17T00:00:00.000Z',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:d8244ce164360b29b2ce2b425ad8633033d1df2f0a1b953033c8535f3f969c48',
    },
  ],
  [
    'wan_vace_cinematic_text_to_video',
    {
      rejectedAt: '2026-07-17T00:00:00.000Z',
      decodedMediaHash: 'sha256:decoded-video-rgba:1ef12155f87252ecf03a4e345d59bbb8852b1992f80663e03e235a7abed8fa74',
    },
  ],
  [
    'wan_21_t2v_13b_seed_vault',
    {
      rejectedAt: '2026-07-18T05:00:00.000Z',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:4d566283366529f3711f08686f75a4b4fefe54eb021f25cffb5a343acefcf96e',
    },
  ],
  [
    'wan_22_ti2v_5b_seed_vault',
    {
      rejectedAt: '2026-07-24T19:18:56+05:30',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:f46d1387bd5848c62fe9343a800d813a906ea33e0139f43f50926cc822bb1de7',
      decodedAudioHash:
        'sha256:decoded-audio-pcm-s16le-48000-stereo:811cfa5f48a6b84410a861f25488709641f03d208092f60c6dbe6040f2b089aa',
    },
  ],
  [
    'ace_step_lyric_music_video',
    {
      rejectedAt: '2026-07-24T19:18:56+05:30',
      decodedMediaHash:
        'sha256:decoded-video-framemd5:ce8d9c7a4dfdca142c3acdddfc316cc6945b315f3bf3482f0a71885e2ad272b0',
      decodedAudioHash:
        'sha256:decoded-audio-pcm-s16le-48000-stereo:e7b220a396afb0fd2c41037d83378fa097936bbcc1bc1889c6c45f24861f2633',
    },
  ],
]);
// These pending source-conditioned proofs are especially vulnerable to the
// scale failure that invalidated the rejected train/headphone concept. Require
// concrete relative-size anchors rather than accepting a generic visual score.
const SCALE_CONTEXT_REVIEW_TEMPLATES = new Set([
  'qwen_layered_portrait',
  'wan_vace_video_color_grade',
  'wan_vace_masked_object_replace',
  'wan_vace_outpaint_reframe',
  'wan_vace_reference_motion',
  'wan_vace_grayscale_control',
  'wan_vace_video_to_video',
]);
const MEDIA_EXTENSIONS = {
  image: new Set(['.png', '.jpg', '.jpeg', '.webp']),
  video: new Set(['.mp4', '.mov', '.mkv', '.webm']),
  audio: new Set(['.wav', '.mp3', '.flac', '.m4a', '.ogg']),
  json: new Set(['.json']),
};

function bundledFfmpegPath() {
  const sitePackageRoots = [
    resolve(ROOT, '..', 'MoDiff', '.venv', 'Lib', 'site-packages'),
    resolve(ROOT, '..', 'MoDiff', '.venv', 'lib'),
  ];
  for (const sitePackageRoot of sitePackageRoots) {
    if (!existsSync(sitePackageRoot)) continue;
    const candidateRoots = sitePackageRoot.endsWith(`${join('.venv', 'lib')}`)
      ? readdirSync(sitePackageRoot)
          .filter((name) => /^python\d+(?:\.\d+)?$/i.test(name))
          .map((name) => join(sitePackageRoot, name, 'site-packages'))
      : [sitePackageRoot];
    for (const candidateRoot of candidateRoots) {
      const binaries = join(candidateRoot, 'imageio_ffmpeg', 'binaries');
      if (!existsSync(binaries)) continue;
      const executable = readdirSync(binaries).find((name) => /^ffmpeg(?:-|\.exe$)/i.test(name));
      if (executable) return join(binaries, executable);
    }
  }
  return null;
}

const DEFAULT_FFMPEG = process.env.MODIFF_FFMPEG || bundledFfmpegPath() || 'ffmpeg';

function parseArgs(argv) {
  const args = { mode: argv[2] ?? 'verify', publish: false, templates: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const entry = argv[index];
    if (entry === '--publish') {
      args.publish = true;
      continue;
    }
    if (entry.startsWith('--')) {
      const [key, inlineValue] = entry.slice(2).split('=');
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (key === 'template') {
        args.templates.push(
          ...String(value ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        );
      } else {
        args[key] = value;
      }
    }
  }
  return args;
}

function orderedValue(value) {
  if (Array.isArray(value)) return value.map(orderedValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, orderedValue(entryValue)]),
  );
}

function stableStringify(value) {
  return JSON.stringify(orderedValue(value));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJsonHash(value) {
  return `sha256:canonical-json:${sha256(Buffer.from(stableStringify(value)))}`;
}

export function decodedAudiovisualMediaHash(decodedMediaHash, decodedAudioHash) {
  if (!decodedMediaHash || !decodedAudioHash) return null;
  return `sha256:decoded-av-v1:${sha256(
    Buffer.from(
      stableStringify({
        decodedAudioHash,
        decodedMediaHash,
      }),
    ),
  )}`;
}

function redactLocalPath(value) {
  const isWindowsPath = /^[a-z]:[\\/]/i.test(value);
  const isUserScopedPosixPath = /^\/(?:Users|home|tmp|private\/tmp|var\/tmp)\//.test(value);
  if (!isWindowsPath && !isUserScopedPosixPath) return value;
  const fileName = value.split(/[\\/]/).filter(Boolean).at(-1) ?? 'path';
  return `<local-path>/${fileName}`;
}

export function redactPublicProvenance(value, key = '') {
  if (Array.isArray(value)) return value.map((item) => redactPublicProvenance(item));
  if (typeof value === 'string') {
    if (key === 'gitCommit') return '<redacted-source-commit>';
    return redactLocalPath(value);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactPublicProvenance(entryValue, entryKey)]),
  );
}

export function validateBeforeMedia(filePath, provenance) {
  if (!filePath || !existsSync(filePath)) {
    return { errors: [`Before media is missing: ${filePath || 'not supplied'}`] };
  }
  const hash = `sha256:bytes:${sha256(readFileSync(filePath))}`;
  const inputItems = provenance?.inputs?.items ?? [];
  const matchedInput = inputItems.find((item) => item?.contentHash === hash);
  return {
    hash,
    byteSize: readFileSync(filePath).byteLength,
    errors: matchedInput ? [] : [`Before media hash ${hash} does not match any pinned provenance input.`],
  };
}

function isVerifiedRuntimeFingerprint(value) {
  return typeof value === 'string' && value.trim() !== '' && !/^unverified(?:-|$)/i.test(value.trim());
}

function qualityReviewFile(args, templateId) {
  if (args['quality-review']) return resolve(ROOT, args['quality-review']);
  if (!args['quality-review-dir']) return null;
  return resolve(ROOT, args['quality-review-dir'], `${templateId}.quality-review.json`);
}

function provenanceFiles(args, templateId) {
  if (args['provenance-run1'] || args['provenance-run2']) {
    if (!args['provenance-run1'] || !args['provenance-run2']) return null;
    return {
      run1: resolve(ROOT, args['provenance-run1']),
      run2: resolve(ROOT, args['provenance-run2']),
    };
  }
  if (!args['provenance-dir']) return null;
  const directory = resolve(ROOT, args['provenance-dir']);
  return {
    run1: join(directory, `${templateId}.run1.provenance.json`),
    run2: join(directory, `${templateId}.run2.provenance.json`),
  };
}

function singleProvenanceFile(args, templateId) {
  if (args['provenance-run1']) return resolve(ROOT, args['provenance-run1']);
  if (!args['provenance-dir']) return null;
  return join(resolve(ROOT, args['provenance-dir']), `${templateId}.run1.provenance.json`);
}

function validateDuplicateProvenance(run1, run2, expected) {
  const errors = [];
  const comparison = compareRunProvenance(run1, run2);
  if (!comparison.candidateExact) {
    errors.push('duplicate provenance comparison did not produce candidateExact=true');
    errors.push(...comparison.mismatches.map((item) => `duplicate provenance mismatch at ${item.field}`));
    errors.push(...comparison.baselineBlockers.map((item) => `run1 provenance blocker: ${item}`));
    errors.push(...comparison.candidateBlockers.map((item) => `run2 provenance blocker: ${item}`));
  }
  for (const [label, provenance] of [
    ['run1', run1],
    ['run2', run2],
  ]) {
    const outputItem = provenance?.output?.items?.[0];
    const bindings = {
      templateId: provenance?.template?.id,
      templateLockHash: provenance?.templateLockHash,
      promptSettingsHash: provenance?.template?.promptSettingsHash,
      modelRevision: provenance?.modelRevision,
      runtimeFingerprint: runtimeLockFromProvenance(provenance),
      decodedMediaHash: provenance?.mediaHash,
      decodedAudioHash: provenance?.decodedAudioHash ?? outputItem?.decodedAudioSha256 ?? null,
      audiovisualMediaHash: provenance?.audiovisualMediaHash ?? outputItem?.audiovisualSha256 ?? null,
      modelSetHash: provenance?.models?.hash,
      inputArtifactsHash: provenance?.inputArtifactsHash,
    };
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (bindings[field] !== expectedValue) {
        errors.push(`${label} provenance ${field} mismatch: expected ${expectedValue}, got ${bindings[field]}`);
      }
    }
    for (const field of [
      'proofLockHash',
      'graphHash',
      'backendSourceFingerprint',
      'backendContractFingerprint',
      'modelCommit',
      'templateRevisionHash',
    ]) {
      if (!provenance?.[field]) errors.push(`${label} provenance missing ${field}`);
    }
  }
  return { errors, comparison };
}

function loadDuplicateProvenance(args, template, expected) {
  const files = provenanceFiles(args, template.id);
  if (!files) {
    return {
      errors: ['No duplicate provenance supplied. Use --provenance-run1 and --provenance-run2, or --provenance-dir.'],
    };
  }
  for (const [label, filePath] of Object.entries(files)) {
    if (!existsSync(filePath)) return { errors: [`${label} provenance file is missing: ${filePath}`] };
  }
  try {
    const run1 = JSON.parse(readFileSync(files.run1, 'utf8'));
    const run2 = JSON.parse(readFileSync(files.run2, 'utf8'));
    const validation = validateDuplicateProvenance(run1, run2, expected);
    const bundle = {
      schemaVersion: 1,
      format: 'modiff.gallery.duplicate-provenance.v1',
      templateId: template.id,
      bindings: expected,
      run1: redactPublicProvenance(run1),
      run2: redactPublicProvenance(run2),
      comparison: validation.comparison,
      redactions: {
        fingerprintsRemainOpaque: true,
        localPaths: true,
        note: 'Hashes attest to the original capture; redacted payloads are not sufficient to recompute them.',
        sourceCommit: true,
      },
    };
    return {
      files,
      run1,
      run2,
      bundle,
      hash: canonicalJsonHash(bundle),
      ...validation,
    };
  } catch (error) {
    return { errors: [`Could not read duplicate provenance: ${error instanceof Error ? error.message : error}`] };
  }
}

export function validateReviewedDerivative(provenance, derivative, expected) {
  const errors = [];
  if (!derivative) return errors;
  const reviewedDerivative = derivative.format === 'modiff.gallery.reviewed-derivative.v1';
  const avReplacementDerivative = derivative.format === 'modiff.gallery.av-replacement-derivative.v1';
  if (derivative.schemaVersion !== 1 || (!reviewedDerivative && !avReplacementDerivative)) {
    errors.push(
      'reviewed derivative must use modiff.gallery.reviewed-derivative.v1 or modiff.gallery.av-replacement-derivative.v1',
    );
  }
  const derivativeKind =
    derivative.kind ?? (avReplacementDerivative ? 'audio_caption_timeline_replacement' : undefined);
  if (derivative.templateId !== expected.templateId) errors.push('reviewed derivative templateId mismatch');
  if (derivative.sourceOutputCollectionHash !== provenance?.output?.collectionHash) {
    errors.push('reviewed derivative sourceOutputCollectionHash mismatch');
  }
  if (derivative.decodedMediaHash !== expected.decodedMediaHash) {
    errors.push('reviewed derivative decodedMediaHash mismatch');
  }
  const validateProcessor = () => {
    const processorPath = derivative.processor?.path ? resolve(ROOT, derivative.processor.path) : null;
    if (!processorPath || !existsSync(processorPath)) {
      errors.push('reviewed derivative processor is missing');
    } else {
      const processorHash = `sha256:bytes:${sha256(readFileSync(processorPath))}`;
      if (derivative.processor?.contentHash !== processorHash) {
        errors.push('reviewed derivative processor contentHash mismatch');
      }
    }
  };

  if (derivativeKind === 'layered_contact_sheet') {
    validateProcessor();
    const expectedItemHashes = (provenance?.output?.items ?? []).map((item) => item.decodedSha256);
    if (stableStringify(derivative.sourceItemHashes ?? []) !== stableStringify(expectedItemHashes)) {
      errors.push('reviewed derivative sourceItemHashes mismatch');
    }
    if (!provenance?.inputs?.items?.some((item) => item.contentHash === derivative.sourceInputHash)) {
      errors.push('reviewed derivative sourceInputHash is not bound to a run input');
    }
    if (derivative.layout !== 'source-recomposition-three-layers-metrics-3x2') {
      errors.push('reviewed derivative layout mismatch');
    }
    if (
      derivative.recomposition?.status !== 'pass' ||
      !Number.isFinite(derivative.recomposition?.maxMeanAbsoluteError) ||
      derivative.recomposition.maxMeanAbsoluteError > 8 ||
      derivative.recomposition?.threshold !== 8
    ) {
      errors.push('reviewed derivative recomposition must pass the 8/255 mean-absolute-error boundary');
    }
    return errors;
  }

  if (!['audio_remux', 'audio_caption_timeline_replacement'].includes(derivativeKind)) {
    errors.push(
      'reviewed derivative kind must be layered_contact_sheet, audio_remux, or audio_caption_timeline_replacement',
    );
    return errors;
  }

  if (derivative.sourceVideoHash !== provenance?.mediaHash) {
    errors.push('reviewed derivative sourceVideoHash mismatch');
  }
  if (derivative.sourceTemplateLockHash !== provenance?.templateLockHash) {
    errors.push('reviewed derivative sourceTemplateLockHash mismatch');
  }
  if (derivative.sourcePromptSettingsHash !== provenance?.template?.promptSettingsHash) {
    errors.push('reviewed derivative sourcePromptSettingsHash mismatch');
  }
  if (derivative.templateLockHash !== expected.templateLockHash) {
    errors.push('reviewed derivative templateLockHash mismatch');
  }
  if (derivative.promptSettingsHash !== expected.promptSettingsHash) {
    errors.push('reviewed derivative promptSettingsHash mismatch');
  }
  if (derivative.decodedAudioHash !== expected.decodedAudioHash) {
    errors.push('reviewed derivative decodedAudioHash mismatch');
  }
  if (derivative.audiovisualMediaHash !== expected.audiovisualMediaHash) {
    errors.push('reviewed derivative audiovisualMediaHash mismatch');
  }
  if (
    derivative.audiovisualMediaHash !==
    decodedAudiovisualMediaHash(derivative.decodedMediaHash, derivative.decodedAudioHash)
  ) {
    errors.push('reviewed derivative audiovisualMediaHash is not derived from its decoded video and audio identities');
  }
  const replacementAudio = derivative.replacementAudio ?? {
    encodedSha256: derivative.audio?.encodedSha256,
    decodedSha256: derivative.audio?.decodedSha256,
    provenanceSha256: derivative.audio?.sourceProvenanceSha256,
  };
  for (const field of ['encodedSha256', 'decodedSha256', 'provenanceSha256']) {
    if (!replacementAudio?.[field]) {
      errors.push(`reviewed derivative replacementAudio.${field} is missing`);
    }
  }
  if (avReplacementDerivative) {
    if (derivative.operation !== 'pinned_visual_rerun_with_audio_derived_caption_timeline') {
      errors.push('AV replacement derivative operation is invalid');
    }
    if (
      !derivative.output?.encodedSha256 ||
      !derivative.visual?.graphRequestSha256 ||
      !derivative.visual?.sourceProvenanceSha256 ||
      !derivative.audio?.sourceProvenanceSha256 ||
      derivative.visual?.regenerated !== true
    ) {
      errors.push('AV replacement derivative is missing its output, graph-request, or source provenance identities');
    }
  } else {
    validateProcessor();
    if (!derivative.operation?.name || !derivative.operation?.parameters) {
      errors.push('reviewed derivative operation must include a name and deterministic parameters');
    } else if (derivative.operationHash !== canonicalJsonHash(derivative.operation)) {
      errors.push('reviewed derivative operationHash mismatch');
    }
  }
  if (derivativeKind === 'audio_caption_timeline_replacement') {
    const cues =
      derivative.captionTimeline?.cues ??
      String(derivative.captions?.lrc ?? '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.+)$/);
          return match
            ? { startSeconds: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }
            : { startSeconds: Number.NaN, text: '' };
        });
    if (!Array.isArray(cues) || cues.length < 6) {
      errors.push('reviewed caption derivative requires at least six caption cues');
    } else {
      let previousStart = -1;
      for (const [index, cue] of cues.entries()) {
        if (
          !Number.isFinite(cue?.startSeconds) ||
          cue.startSeconds < 0 ||
          cue.startSeconds < previousStart ||
          typeof cue?.text !== 'string' ||
          !cue.text.trim()
        ) {
          errors.push(`reviewed caption derivative cue ${index} is invalid or out of order`);
        }
        previousStart = cue?.startSeconds ?? previousStart;
      }
    }
    if (
      avReplacementDerivative &&
      (derivative.captions?.source !== 'delivery_audio_asr_line_intervals' ||
        derivative.captions?.cueCount !== cues.length)
    ) {
      errors.push('AV replacement captions must be derived from the delivery audio and report their exact cue count');
    }
    const maximumCueDriftSeconds =
      derivative.captionTimeline?.maximumCueDriftSeconds ?? derivative.captions?.maxScheduledFrameLatenessSeconds;
    if (!Number.isFinite(maximumCueDriftSeconds) || maximumCueDriftSeconds < 0 || maximumCueDriftSeconds > 0.25) {
      errors.push('reviewed caption derivative maximumCueDriftSeconds must be between 0 and 0.25');
    }
  }
  return errors;
}

function validateSingleProvenance(provenance, expected, derivative = null) {
  const errors = [];
  const audioDerivative =
    ['audio_remux', 'audio_caption_timeline_replacement'].includes(derivative?.kind) ||
    derivative?.format === 'modiff.gallery.av-replacement-derivative.v1';
  const outputItem = provenance?.output?.items?.[0];
  const bindings = {
    templateId: provenance?.template?.id,
    templateLockHash: audioDerivative ? derivative?.templateLockHash : provenance?.templateLockHash,
    promptSettingsHash: audioDerivative ? derivative?.promptSettingsHash : provenance?.template?.promptSettingsHash,
    modelRevision: provenance?.modelRevision,
    runtimeFingerprint: runtimeLockFromProvenance(provenance),
    decodedMediaHash: derivative?.decodedMediaHash ?? provenance?.mediaHash,
    decodedAudioHash:
      derivative?.decodedAudioHash ?? provenance?.decodedAudioHash ?? outputItem?.decodedAudioSha256 ?? null,
    audiovisualMediaHash:
      derivative?.audiovisualMediaHash ?? provenance?.audiovisualMediaHash ?? outputItem?.audiovisualSha256 ?? null,
    modelSetHash: provenance?.models?.hash,
    inputArtifactsHash: provenance?.inputArtifactsHash,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (bindings[field] !== expectedValue) {
      errors.push(`run provenance ${field} mismatch: expected ${expectedValue}, got ${bindings[field]}`);
    }
  }
  errors.push(...validateReviewedDerivative(provenance, derivative, expected));
  for (const field of [
    'proofLockHash',
    'graphHash',
    'backendSourceFingerprint',
    'backendContractFingerprint',
    'modelCommit',
    'templateRevisionHash',
  ]) {
    if (!provenance?.[field]) errors.push(`run provenance missing ${field}`);
  }
  for (const blocker of provenance?.blockers ?? []) errors.push(`run provenance blocker: ${blocker}`);
  return errors;
}

function loadSingleProvenance(args, template, expected) {
  const filePath = singleProvenanceFile(args, template.id);
  if (!filePath) {
    return { errors: ['No run provenance supplied. Use --provenance-run1 or --provenance-dir.'] };
  }
  if (!existsSync(filePath)) return { errors: [`Run provenance file is missing: ${filePath}`] };
  try {
    const run = JSON.parse(readFileSync(filePath, 'utf8'));
    const derivativePath = args['derivative-provenance']
      ? resolve(ROOT, args['derivative-provenance'])
      : args['provenance-dir']
        ? join(resolve(ROOT, args['provenance-dir']), `${template.id}.run1.derivative.json`)
        : null;
    const derivative =
      derivativePath && existsSync(derivativePath) ? JSON.parse(readFileSync(derivativePath, 'utf8')) : null;
    const errors = validateSingleProvenance(run, expected, derivative);
    const bundle = {
      schemaVersion: 1,
      format: 'modiff.gallery.reviewed-provenance.v1',
      templateId: template.id,
      bindings: expected,
      run: redactPublicProvenance(run),
      ...(derivative ? { derivative: redactPublicProvenance(derivative) } : {}),
      redactions: {
        fingerprintsRemainOpaque: true,
        localPaths: true,
        note: 'Hashes attest to the original capture; redacted payloads are not sufficient to recompute them.',
        sourceCommit: true,
      },
    };
    return { filePath, run, bundle, hash: canonicalJsonHash(bundle), errors };
  } catch (error) {
    return { errors: [`Could not read run provenance: ${error instanceof Error ? error.message : error}`] };
  }
}

export function validateQualityReview(review, expected, requiredStatus = EXACT_QUALITY_REVIEW_STATUS) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return ['Quality review must be a JSON object.'];
  }
  const strictVisualReview =
    requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS &&
    (STRICT_VISUAL_REVIEW_TEMPLATES.has(expected.templateId) ||
      SCALE_CONTEXT_REVIEW_TEMPLATES.has(expected.templateId) ||
      DYNAMIC_VIDEO_REVIEW_TEMPLATES.has(expected.templateId));
  const requiredSchemaVersion =
    requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS && DYNAMIC_VIDEO_REVIEW_TEMPLATES.has(expected.templateId)
      ? 4
      : strictVisualReview
        ? 3
        : requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS
          ? 2
          : 1;
  if (review.schemaVersion !== requiredSchemaVersion) {
    errors.push(`quality review schemaVersion must be ${requiredSchemaVersion}`);
  }
  for (const field of [
    'templateId',
    'templateLockHash',
    'promptSettingsHash',
    'modelRevision',
    'runtimeFingerprint',
    'graphHash',
    'proofLockHash',
    'decodedMediaHash',
    'reviewStatus',
    'reviewer',
    'reviewedAt',
    'rubric',
    'summary',
  ]) {
    if (review[field] === undefined || review[field] === null || review[field] === '') {
      errors.push(`quality review missing ${field}`);
    }
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (review[field] !== expectedValue) {
      errors.push(`quality review ${field} mismatch: expected ${expectedValue}, got ${review[field]}`);
    }
  }
  if (review.reviewStatus !== requiredStatus) {
    errors.push(`quality review status must be ${requiredStatus}`);
  }
  if (!isVerifiedRuntimeFingerprint(review.runtimeFingerprint)) {
    errors.push('quality review runtimeFingerprint must be verified');
  }
  if (Number.isNaN(Date.parse(review.reviewedAt ?? ''))) {
    errors.push('quality review reviewedAt must be an ISO-compatible timestamp');
  }
  if (!review.rubric || typeof review.rubric !== 'object' || Array.isArray(review.rubric)) {
    errors.push('quality review rubric must be an object');
  } else {
    for (const requiredScore of ['taskAdherence', 'artifactControl', 'modalityQuality']) {
      const score = review.rubric[requiredScore];
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        errors.push(`quality review rubric.${requiredScore} must be between 1 and 5`);
      }
    }
  }
  if (typeof review.summary !== 'string' || review.summary.trim().length < 20) {
    errors.push('quality review summary must explain the approval in at least 20 characters');
  }
  if (review.knownLimitations !== undefined && !Array.isArray(review.knownLimitations)) {
    errors.push('quality review knownLimitations must be an array when supplied');
  }
  if (requiredStatus === REVIEWED_QUALITY_REVIEW_STATUS) {
    for (const field of ['promptAdherence', 'composition', 'technicalExecution', 'templateUsefulness']) {
      const score = review.scores?.[field];
      if (!Number.isFinite(score) || score < 4 || score > 5) {
        errors.push(`reviewed quality review scores.${field} must be between 4 and 5`);
      }
    }
    if (!Array.isArray(review.hardFailures) || review.hardFailures.length > 0) {
      errors.push('reviewed quality review hardFailures must be an empty array');
    }
    if (review.objectiveChecks?.status !== 'pass') {
      errors.push('reviewed quality review objectiveChecks.status must be pass');
    }
    if (review.modalityReview?.status !== 'pass') {
      errors.push('reviewed quality review modalityReview.status must be pass');
    }
    if (strictVisualReview) {
      if (review.physicalConsistency?.status !== 'pass') {
        errors.push('strict visual review physicalConsistency.status must be pass');
      }
      if (!Array.isArray(review.physicalConsistency?.checks) || review.physicalConsistency.checks.length < 3) {
        errors.push('strict visual review physicalConsistency.checks requires at least three concrete checks');
      }
      if (review.visualDiversity?.status !== 'pass') {
        errors.push('strict visual review visualDiversity.status must be pass');
      }
      if (!review.visualDiversity?.themeId || !review.visualDiversity?.nearestTemplateId) {
        errors.push('strict visual review visualDiversity requires themeId and nearestTemplateId');
      }
      if (review.visualDiversity?.distinctFromNearest !== true) {
        errors.push('strict visual review visualDiversity.distinctFromNearest must be true');
      }
      if (DYNAMIC_VIDEO_REVIEW_TEMPLATES.has(expected.templateId)) {
        const userRejection = USER_REJECTED_OUTPUTS.get(expected.templateId);
        if (userRejection) {
          const rejectedIdentityMatches =
            expected.decodedMediaHash === userRejection.decodedMediaHash &&
            (!userRejection.decodedAudioHash || expected.decodedAudioHash === userRejection.decodedAudioHash);
          if (rejectedIdentityMatches) {
            errors.push('user-rejected video output cannot be republished');
          }
          if (Date.parse(review.reviewedAt ?? '') <= Date.parse(userRejection.rejectedAt)) {
            errors.push('replacement review must be newer than the explicit user rejection');
          }
          if (
            review.userFeedbackResolution?.status !== 'pass' ||
            review.userFeedbackResolution?.replacementOutput !== true ||
            !Array.isArray(review.userFeedbackResolution?.resolvedIssues) ||
            review.userFeedbackResolution.resolvedIssues.length < 2
          ) {
            errors.push('user-rejected video requires a passing replacement-specific feedback resolution review');
          }
        }
        if (review.motionReview?.status !== 'pass') {
          errors.push('dynamic video review motionReview.status must be pass');
        }
        if (review.motionReview?.fullPlaybackReviewed !== true) {
          errors.push('dynamic video review must confirm full playback review');
        }
        if (!Number.isFinite(review.motionReview?.frameCount) || review.motionReview.frameCount < 81) {
          errors.push('dynamic video review requires at least 81 reviewed frames');
        }
        if (
          !Number.isFinite(review.motionReview?.durationSeconds) ||
          review.motionReview.durationSeconds < MINIMUM_TEMPLATE_VIDEO_SECONDS
        ) {
          errors.push('dynamic video review requires at least five seconds of reviewed output');
        }
        if (
          LONG_VIDEO_REVIEW_TEMPLATES.has(expected.templateId) &&
          (review.motionReview?.durationSeconds < 20 || review.motionReview?.durationSeconds > 35)
        ) {
          errors.push('long-form video review requires a duration between 20 and 35 seconds');
        }
        if (
          !Number.isFinite(review.motionReview?.sceneMotionCoveragePercent) ||
          review.motionReview.sceneMotionCoveragePercent < 50
        ) {
          errors.push('dynamic video review requires visible motion across at least half of the frame');
        }
        if (
          !Array.isArray(review.motionReview?.visibleMotionMilestones) ||
          review.motionReview.visibleMotionMilestones.length < 3
        ) {
          errors.push('dynamic video review requires at least three visible motion milestones');
        }
        if (!Array.isArray(review.motionReview?.temporalDefects) || review.motionReview.temporalDefects.length > 0) {
          errors.push('dynamic video review temporalDefects must be an empty array');
        }
        if (review.cardPreviewReview?.status !== 'pass' || review.cardPreviewReview?.reviewedAtCardSize !== true) {
          errors.push('dynamic video review requires passing playback at actual template-card size');
        }
        if (review.cardPreviewReview?.readsAsMovingVideo !== true) {
          errors.push('dynamic video review must remain unmistakably video at card size');
        }
        if (
          !Array.isArray(review.cardPreviewReview?.foregroundMotionMilestones) ||
          review.cardPreviewReview.foregroundMotionMilestones.length < 3
        ) {
          errors.push('dynamic video review requires three card-visible foreground motion milestones');
        }
        if (review.temporalGeometryReview?.status !== 'pass') {
          errors.push('dynamic video review requires passing temporal geometry review');
        }
        for (const field of ['subjectMorphing', 'scaleDrift', 'contactSliding', 'frameGlitches']) {
          if (review.temporalGeometryReview?.[field] !== 'none') {
            errors.push(`dynamic video temporalGeometryReview.${field} must be none`);
          }
        }
        if (SOURCE_PRESERVATION_VIDEO_TEMPLATES.has(expected.templateId)) {
          if (review.sourcePreservationReview?.status !== 'pass') {
            errors.push('source-conditioned video requires passing source preservation review');
          }
          if (review.sourcePreservationReview?.fullSourceCompared !== true) {
            errors.push('source-conditioned video review must compare the complete source and output');
          }
          for (const field of ['subjectIdentity', 'unmaskedRegions']) {
            if (review.sourcePreservationReview?.[field] !== 'preserved') {
              errors.push(`source-conditioned video sourcePreservationReview.${field} must be preserved`);
            }
          }
          for (const field of ['cameraPath', 'timing']) {
            const expectedValue = STILL_SOURCE_VIDEO_TEMPLATES.has(expected.templateId)
              ? 'not_applicable'
              : 'preserved';
            if (review.sourcePreservationReview?.[field] !== expectedValue) {
              errors.push(`source-conditioned video sourcePreservationReview.${field} must be ${expectedValue}`);
            }
          }
          if (
            !Array.isArray(review.sourcePreservationReview?.comparisonMilestones) ||
            review.sourcePreservationReview.comparisonMilestones.length < 3
          ) {
            errors.push('source-conditioned video review requires three source/output comparison milestones');
          }
        }
        if (review.visualIntent === 'photoreal') {
          if (review.realismReview?.status !== 'pass' || review.realismReview?.looksPhotographic !== true) {
            errors.push('photoreal video requires passing photographic-realism review');
          }
          if (
            review.realismReview?.physicallyPlausibleLighting !== true ||
            review.realismReview?.physicallyPlausibleMaterials !== true ||
            review.realismReview?.physicallyPlausibleDynamics !== true
          ) {
            errors.push('photoreal video requires plausible lighting, materials, and dynamics');
          }
        } else if (review.visualIntent === 'animation') {
          if (review.animationReview?.status !== 'pass' || review.animationReview?.styleConsistent !== true) {
            errors.push('animated video requires passing style-consistency review');
          }
          if (!Array.isArray(review.animationReview?.glitches) || review.animationReview.glitches.length > 0) {
            errors.push('animated video review glitches must be an empty array');
          }
        } else {
          errors.push('dynamic video review visualIntent must be photoreal or animation');
        }
        if (expected.templateId === 'ace_step_lyric_music_video') {
          if (review.lyricSyncReview?.status !== 'pass' || review.lyricSyncReview?.fullPlaybackReviewed !== true) {
            errors.push('lyric music video requires a passing full-playback lyric sync review');
          }
          if (review.lyricSyncReview?.audioAlignmentReviewed !== true) {
            errors.push('lyric music video requires listening-based audio alignment review');
          }
          if (review.lyricSyncReview?.overlayTextExact !== true || review.lyricSyncReview?.cueCount < 6) {
            errors.push('lyric music video requires at least six exact lyric overlay cues');
          }
          if (
            !Number.isFinite(review.lyricSyncReview?.maximumCueDriftSeconds) ||
            review.lyricSyncReview.maximumCueDriftSeconds > 0.25
          ) {
            errors.push('lyric music video cue drift must be measured at no more than 0.25 seconds');
          }
          if (review.lyricSyncReview?.lyricsRemainInSafeArea !== true) {
            errors.push('lyric music video lyrics must remain inside the preview-safe area');
          }
        }
      }
      if (SCALE_CONTEXT_REVIEW_TEMPLATES.has(expected.templateId)) {
        if (review.scaleContextReview?.status !== 'pass') {
          errors.push('strict scale-context review status must be pass');
        }
        if (
          !Array.isArray(review.scaleContextReview?.anchorMeasurements) ||
          review.scaleContextReview.anchorMeasurements.length < 2
        ) {
          errors.push('strict scale-context review requires at least two measured visual anchors');
        } else if (
          review.scaleContextReview.anchorMeasurements.some(
            (measurement) =>
              !measurement?.anchor || !measurement?.observedRelationship || measurement?.verdict !== 'pass',
          )
        ) {
          errors.push('strict scale-context review anchors require a relationship and passing verdict');
        }
        if (review.scaleContextReview?.subjectProportionsPlausible !== true) {
          errors.push('strict scale-context review must confirm plausible subject proportions');
        }
        if (review.scaleContextReview?.perspectiveScaleConsistent !== true) {
          errors.push('strict scale-context review must confirm perspective-consistent scale');
        }
        if (!['pass', 'not_applicable'].includes(review.scaleContextReview?.supportAndContact)) {
          errors.push('strict scale-context review supportAndContact must be pass or not_applicable');
        }
        if (
          typeof review.scaleContextReview?.supportRationale !== 'string' ||
          review.scaleContextReview.supportRationale.trim().length < 20
        ) {
          errors.push('strict scale-context review requires a concrete support rationale');
        }
      }
      if (expected.templateId === 'qwen_multi_reference_product') {
        if (review.scaleConsistency?.status !== 'pass') {
          errors.push('multi-reference product review scaleConsistency.status must be pass');
        }
        const imageWidthPercent = review.scaleConsistency?.bicycleImageWidthPercent;
        const wheelMismatchPercent = review.scaleConsistency?.wheelDiameterMismatchPercent;
        if (!Number.isFinite(imageWidthPercent) || imageWidthPercent < 85 || imageWidthPercent > 96) {
          errors.push('multi-reference product review bicycleImageWidthPercent must be between 85 and 96');
        }
        if (!Number.isFinite(wheelMismatchPercent) || wheelMismatchPercent > 8) {
          errors.push('multi-reference product review wheelDiameterMismatchPercent must be at most 8');
        }
        if (review.scaleConsistency?.fullBicycleVisible !== true) {
          errors.push('multi-reference product review must confirm fullBicycleVisible');
        }
        if (review.scaleConsistency?.completeFrameTriangle !== true) {
          errors.push('multi-reference product review must confirm completeFrameTriangle');
        }
        if (review.scaleConsistency?.exactWordmark !== 'VELA') {
          errors.push('multi-reference product review exactWordmark must be VELA');
        }
      }
      if (expected.templateId === 'wan_vace_cinematic_text_to_video') {
        if (review.motionContinuity?.status !== 'pass' || review.motionContinuity?.fullPlaybackReviewed !== true) {
          errors.push('strict video review requires passing motionContinuity and fullPlaybackReviewed');
        }
        for (const field of ['rigidBodyScaleDrift', 'geometryMorphing', 'temporalGlitches']) {
          if (review.motionContinuity?.[field] !== 'none') {
            errors.push(`strict video review motionContinuity.${field} must be none`);
          }
        }
      }
      if (['qwen_low_vram_poster_layout', 'qwen_poster_logo_text', 'z_image_poster'].includes(expected.templateId)) {
        if (review.typographyReview?.status !== 'pass' || review.typographyReview?.allRequiredTextExact !== true) {
          errors.push('strict poster review requires passing typographyReview with allRequiredTextExact');
        }
      }
    }
  }
  return errors;
}

function loadQualityReview(args, template, expected, requiredStatus = EXACT_QUALITY_REVIEW_STATUS) {
  const filePath = qualityReviewFile(args, template.id);
  if (!filePath) {
    return {
      errors: [`No quality review supplied. Use --quality-review-dir <dir> with ${template.id}.quality-review.json.`],
    };
  }
  if (!existsSync(filePath)) return { errors: [`Quality review file is missing: ${filePath}`] };
  try {
    const review = JSON.parse(readFileSync(filePath, 'utf8'));
    const errors = validateQualityReview(review, expected, requiredStatus);
    return { filePath, review, errors, hash: canonicalJsonHash(review) };
  } catch (error) {
    return { errors: [`Could not read quality review ${filePath}: ${error instanceof Error ? error.message : error}`] };
  }
}

function runMediaTool(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr?.toString('utf8') || `exit ${result.status}`}`);
  }
  return result.stdout;
}

function mediaProbe(command, mediaPath) {
  const result = spawnSync(command, ['-hide_banner', '-i', mediaPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`ffmpeg media probe failed to start: ${result.error.message}`);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

export function parseMediaProbe(text, mediaType) {
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : 0;
  if (mediaType === 'video') {
    const stream = text.split(/\r?\n/).find((line) => /Stream .*Video:/i.test(line));
    const audioStream = text.split(/\r?\n/).find((line) => /Stream .*Audio:/i.test(line));
    const dimensions = stream?.match(/(?:^|[ ,])(\d{2,5})x(\d{2,5})(?:[ ,]|$)/);
    const fps = Number(stream?.match(/(\d+(?:\.\d+)?)\s+fps\b/i)?.[1] ?? 0);
    const codecName = stream?.match(/\bVideo:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? '';
    const pixelFormat = stream?.match(/\bVideo:[^,]*,\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? '';
    return {
      width: Number(dimensions?.[1] ?? 0),
      height: Number(dimensions?.[2] ?? 0),
      fps,
      durationSeconds,
      hasAudio: Boolean(audioStream),
      codecName,
      pixelFormat,
    };
  }
  const stream = text.split(/\r?\n/).find((line) => /Stream .*Audio:/i.test(line));
  const sourceSampleRate = Number(stream?.match(/(\d+)\s+Hz\b/i)?.[1] ?? 0);
  const channelText = stream ?? '';
  const channels = /\bmono\b/i.test(channelText)
    ? 1
    : /\bstereo\b/i.test(channelText)
      ? 2
      : Number(channelText.match(/(\d+)\s+channels?\b/i)?.[1] ?? 0);
  return { sourceSampleRate, channels, durationSeconds };
}

export async function loadTemplateRuntime(root = ROOT, { includePlanning = false } = {}) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: {
      entries: [],
      noDiscovery: true,
    },
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const [templatesModule, exactnessModule] = await Promise.all([
      server.ssrLoadModule('/src/studio/templates.ts'),
      server.ssrLoadModule('/src/studio/templateExactness.ts'),
    ]);
    const templates = includePlanning
      ? [...templatesModule.STUDIO_TEMPLATES, ...(templatesModule.PLANNING_STUDIO_TEMPLATES ?? [])]
      : templatesModule.STUDIO_TEMPLATES;
    if (!Array.isArray(templates)) {
      throw new Error('Studio template runtime did not export STUDIO_TEMPLATES as an array.');
    }
    if (templates.length === 0) {
      throw new Error('Studio template runtime loaded zero templates; gallery generation cannot continue.');
    }

    return {
      templates,
      lockedSettingsForTemplate: exactnessModule.getTemplateLockedSettings,
      templateLockHash(template, modelRevision = template.example?.modelRevision) {
        return exactnessModule.getTemplateLockHash(template, modelRevision);
      },
      templateInputContractHash(template) {
        return exactnessModule.getTemplateInputContractHash(template);
      },
      promptSettingsHash(template) {
        return exactnessModule.getPromptSettingsHash(exactnessModule.getTemplateLockedSettings(template));
      },
      findManifestEntry: exactnessModule.findManifestEntry,
    };
  } finally {
    await server.close();
  }
}

export function selectTemplates(templates, requestedIds = []) {
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('Gallery template selection received zero runtime templates.');
  }
  const requested = [...new Set(requestedIds.map((id) => String(id).trim()).filter(Boolean))];
  if (requested.length === 0) return templates;

  const availableIds = new Set(templates.map((template) => template.id));
  const missingIds = requested.filter((id) => !availableIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`Requested Studio template id(s) were not found: ${missingIds.join(', ')}.`);
  }
  const selected = templates.filter((template) => requested.includes(template.id));
  if (selected.length === 0) {
    throw new Error(`Requested Studio template selection resolved to zero templates: ${requested.join(', ')}.`);
  }
  return selected;
}

export function galleryExpectedOutput(template) {
  return {
    ...(template?.example?.expectedOutput ?? {}),
    ...(template?.example?.galleryExpectedOutput ?? {}),
  };
}

function mediaTypeForTemplate(template) {
  return template.example?.mediaType ?? 'image';
}

function requiresBeforeMedia(template) {
  const roles = (template.mediaSlots ?? []).map((slot) => slot?.role);
  return (
    ['compareSlider', 'hoverDissolve'].includes(template.thumbnailVariant) ||
    (template.tags ?? []).includes('before/after') ||
    roles.some((role) => role === 'before' || role === 'source')
  );
}

export function buildTemplateCandidate(runtime, template, modelRevision) {
  return {
    templateId: template.id,
    label: template.label,
    mediaType: mediaTypeForTemplate(template),
    lockedSettings: runtime.lockedSettingsForTemplate(template),
    promptSettingsHash: runtime.promptSettingsHash(template),
    templateLockHash: runtime.templateLockHash(template, modelRevision),
    templateInputContractHash: runtime.templateInputContractHash?.(template),
    runtimeEstimate: template.example?.runtimeEstimate ?? 'unknown',
  };
}

function artifactDirFor(mode) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(ARTIFACT_ROOT, `${timestamp}-${mode}`);
  mkdirSync(artifactDir, { recursive: true });
  return artifactDir;
}

function findRunPair(mediaDir, template) {
  if (!mediaDir || !existsSync(mediaDir)) return null;
  const files = readdirSync(mediaDir);
  const extensions = MEDIA_EXTENSIONS[mediaTypeForTemplate(template)] ?? MEDIA_EXTENSIONS.image;
  const run1 = selectPrimaryRunFile(files, template.id, 1, extensions);
  const run2 = selectPrimaryRunFile(files, template.id, 2, extensions);
  if (!run1 || !run2) return null;
  return {
    run1: join(mediaDir, run1),
    run2: join(mediaDir, run2),
    extension: extname(run1).toLowerCase(),
  };
}

function findSingleRun(mediaDir, template) {
  if (!mediaDir || !existsSync(mediaDir)) return null;
  const extensions = MEDIA_EXTENSIONS[mediaTypeForTemplate(template)] ?? MEDIA_EXTENSIONS.image;
  const file = selectPrimaryRunFile(readdirSync(mediaDir), template.id, 1, extensions);
  return file ? { run1: join(mediaDir, file), extension: extname(file).toLowerCase() } : null;
}

export function selectPrimaryRunFile(files, templateId, runIndex, extensions = MEDIA_EXTENSIONS.image) {
  return files.find((name) => {
    const extension = extname(name).toLowerCase();
    return extensions.has(extension) && name === `${templateId}.run${runIndex}${extension}`;
  });
}

async function decodedImageHash(imagePath) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const bytes = readFileSync(imagePath);
    const extension = extname(imagePath).toLowerCase().replace('.', '');
    const mime =
      extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'webp' ? 'image/webp' : 'image/png';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    const result = await page.evaluate(async (src) => {
      const image = new Image();
      image.decoding = 'sync';
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not create canvas context for decoded image hash.');
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      let lumaSum = 0;
      let lumaSquaredSum = 0;
      let nearBlackPixels = 0;
      const pixelCount = imageData.data.length / 4;
      for (let offset = 0; offset < imageData.data.length; offset += 4) {
        const luma =
          0.2126 * imageData.data[offset] + 0.7152 * imageData.data[offset + 1] + 0.0722 * imageData.data[offset + 2];
        lumaSum += luma;
        lumaSquaredSum += luma * luma;
        if (luma < 4) nearBlackPixels += 1;
      }
      const meanLuma = pixelCount > 0 ? lumaSum / pixelCount : 0;
      let binary = '';
      const chunkSize = 32768;
      for (let offset = 0; offset < imageData.data.length; offset += chunkSize) {
        binary += String.fromCharCode(...imageData.data.slice(offset, offset + chunkSize));
      }
      return {
        width: canvas.width,
        height: canvas.height,
        meanLuma,
        lumaStdDev: Math.sqrt(Math.max(0, lumaSquaredSum / pixelCount - meanLuma * meanLuma)),
        nearBlackRatio: pixelCount > 0 ? nearBlackPixels / pixelCount : 1,
        rgbaBase64: btoa(binary),
      };
    }, dataUrl);
    return {
      width: result.width,
      height: result.height,
      meanLuma: result.meanLuma,
      lumaStdDev: result.lumaStdDev,
      nearBlackRatio: result.nearBlackRatio,
      hash: `sha256:decoded-rgba:${sha256(Buffer.from(result.rgbaBase64, 'base64'))}`,
    };
  } finally {
    await browser.close();
  }
}

function decodedVideoHash(videoPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  const probe = mediaProbe(ffmpeg, videoPath);
  const metadata = parseMediaProbe(probe, 'video');
  let embeddedAudio = null;
  if (metadata.hasAudio) {
    const audioMetadata = parseMediaProbe(probe, 'audio');
    const pcm = runMediaTool(
      ffmpeg,
      ['-v', 'error', '-i', videoPath, '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-'],
      'ffmpeg embedded audio analysis',
    );
    let peak = 0;
    let silent = 0;
    let clipped = 0;
    const sampleCount = Math.floor(pcm.byteLength / 2);
    for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
      const absolute = Math.abs(pcm.readInt16LE(offset));
      peak = Math.max(peak, absolute);
      if (absolute <= 32) silent += 1;
      if (absolute >= 32760) clipped += 1;
    }
    embeddedAudio = {
      sourceSampleRate: audioMetadata.sourceSampleRate,
      channels: audioMetadata.channels,
      peakAmplitude: peak / 32768,
      silenceRatio: sampleCount > 0 ? silent / sampleCount : 1,
      clippedSampleRatio: sampleCount > 0 ? clipped / sampleCount : 1,
      hash: `sha256:decoded-audio-pcm-s16le-48000-stereo:${sha256(pcm)}`,
    };
  }
  const frameMd5 = runMediaTool(
    ffmpeg,
    ['-v', 'error', '-i', videoPath, '-map', '0:v:0', '-an', '-f', 'framemd5', '-'],
    'ffmpeg decoded video frame hash',
  );
  const frameMd5Text = frameMd5.toString('utf8');
  const frameHashes = frameMd5Text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim())
    .filter(Boolean);
  const analysisWidth = Math.min(384, metadata.width);
  const analysisHeight = Math.max(2, Math.round((metadata.height * analysisWidth) / metadata.width / 2) * 2);
  const frames = runMediaTool(
    ffmpeg,
    [
      '-v',
      'error',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      `scale=${analysisWidth}:${analysisHeight}:flags=area`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    'ffmpeg scaled video motion analysis',
  );
  const bytesPerFrame = analysisWidth * analysisHeight;
  const frameCount = bytesPerFrame > 0 ? frames.byteLength / bytesPerFrame : 0;
  if (!Number.isInteger(frameCount) || frameCount < 1) {
    throw new Error(
      `Decoded video analysis buffer does not align with ${analysisWidth}x${analysisHeight} grayscale frames (${frames.byteLength} bytes).`,
    );
  }
  if (frameHashes.length !== frameCount) {
    throw new Error(`Video frame hash count ${frameHashes.length} does not match decoded frame count ${frameCount}.`);
  }
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let nearBlack = 0;
  let samples = 0;
  const pixelStride = Math.max(1, Math.floor((analysisWidth * analysisHeight) / 4096));
  const samplesPerFrame = Math.ceil((analysisWidth * analysisHeight) / pixelStride);
  const firstLuma = new Float32Array(samplesPerFrame);
  const previousLuma = new Float32Array(samplesPerFrame);
  const minimumLuma = new Float32Array(samplesPerFrame);
  const maximumLuma = new Float32Array(samplesPerFrame);
  let adjacentChangedSamples = 0;
  let adjacentComparisons = 0;
  const adjacentChangedRatios = [];
  const nearBlackFrameRatios = [];
  const frameMeanLumas = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const frameStart = frameIndex * bytesPerFrame;
    let sampleIndex = 0;
    let frameAdjacentChangedSamples = 0;
    let frameNearBlack = 0;
    for (let pixel = 0; pixel < analysisWidth * analysisHeight; pixel += pixelStride) {
      const luma = frames[frameStart + pixel];
      if (frameIndex === 0) {
        firstLuma[sampleIndex] = luma;
        previousLuma[sampleIndex] = luma;
        minimumLuma[sampleIndex] = luma;
        maximumLuma[sampleIndex] = luma;
      } else {
        if (Math.abs(luma - previousLuma[sampleIndex]) > 10) {
          adjacentChangedSamples += 1;
          frameAdjacentChangedSamples += 1;
        }
        adjacentComparisons += 1;
        previousLuma[sampleIndex] = luma;
        minimumLuma[sampleIndex] = Math.min(minimumLuma[sampleIndex], luma);
        maximumLuma[sampleIndex] = Math.max(maximumLuma[sampleIndex], luma);
      }
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      if (luma < 4) {
        nearBlack += 1;
        frameNearBlack += 1;
      }
      samples += 1;
      sampleIndex += 1;
    }
    nearBlackFrameRatios.push(frameNearBlack / samplesPerFrame);
    let frameLumaSum = 0;
    for (let pixel = 0; pixel < analysisWidth * analysisHeight; pixel += pixelStride) {
      frameLumaSum += frames[frameStart + pixel];
    }
    frameMeanLumas.push(frameLumaSum / samplesPerFrame);
    if (frameIndex > 0) adjacentChangedRatios.push(frameAdjacentChangedSamples / samplesPerFrame);
  }
  const meanLuma = samples > 0 ? lumaSum / samples : 0;
  let cumulativeChangedSamples = 0;
  let endToEndChangedSamples = 0;
  for (let index = 0; index < samplesPerFrame; index += 1) {
    if (maximumLuma[index] - minimumLuma[index] > 10) cumulativeChangedSamples += 1;
    if (Math.abs(previousLuma[index] - firstLuma[index]) > 10) endToEndChangedSamples += 1;
  }
  // A single cut or cross-fade must not allow an otherwise static clip to pass.
  // Measure card-visible change throughout half-second windows and separately
  // count adjacent pairs whose movement is effectively imperceptible.
  const motionWindowFrames = Math.max(2, Math.round((metadata.fps || 16) * 0.5));
  const motionWindowChangedRatios = [];
  for (let endFrame = motionWindowFrames; endFrame < frameCount; endFrame += motionWindowFrames) {
    const startFrame = endFrame - motionWindowFrames;
    const startOffset = startFrame * bytesPerFrame;
    const endOffset = endFrame * bytesPerFrame;
    let changed = 0;
    let compared = 0;
    for (let pixel = 0; pixel < analysisWidth * analysisHeight; pixel += pixelStride) {
      if (Math.abs(frames[endOffset + pixel] - frames[startOffset + pixel]) > 10) changed += 1;
      compared += 1;
    }
    const changedRatio = compared > 0 ? changed / compared : 0;
    motionWindowChangedRatios.push(changedRatio);
  }
  const motionMetricsByProfile = calculateMotionMetricsByProfile(motionWindowChangedRatios, adjacentChangedRatios);
  const globalMotionMetrics = motionMetricsByProfile[DEFAULT_MOTION_REVIEW_PROFILE];
  let isolatedLumaFlashes = 0;
  for (let index = 1; index < frameMeanLumas.length - 1; index += 1) {
    const previous = frameMeanLumas[index - 1];
    const current = frameMeanLumas[index];
    const next = frameMeanLumas[index + 1];
    if (Math.abs(previous - next) <= 8 && Math.min(Math.abs(current - previous), Math.abs(current - next)) >= 20) {
      isolatedLumaFlashes += 1;
    }
  }
  const decodedMediaHash = `sha256:decoded-video-framemd5:${sha256(frameMd5)}`;
  return {
    width: metadata.width,
    height: metadata.height,
    codecName: metadata.codecName,
    pixelFormat: metadata.pixelFormat,
    frames: frameCount,
    durationSeconds: metadata.durationSeconds || (metadata.fps > 0 ? frameCount / metadata.fps : 0),
    hasAudio: metadata.hasAudio,
    embeddedAudio,
    uniqueFrameRatio: new Set(frameHashes).size / frameCount,
    adjacentChangedPixelRatio: adjacentComparisons > 0 ? adjacentChangedSamples / adjacentComparisons : 0,
    cumulativeChangedPixelRatio: samplesPerFrame > 0 ? cumulativeChangedSamples / samplesPerFrame : 0,
    endToEndChangedPixelRatio: samplesPerFrame > 0 ? endToEndChangedSamples / samplesPerFrame : 0,
    // Keep the original top-level fields as global-camera aliases so existing
    // reports and callers retain their strict historical interpretation.
    activeMotionWindowRatio: globalMotionMetrics.activeMotionWindowRatio,
    strongMotionWindowRatio: globalMotionMetrics.strongMotionWindowRatio,
    lowMotionFrameRatio: globalMotionMetrics.lowMotionFrameRatio,
    motionMetricsByProfile,
    meanLuma,
    lumaStdDev: Math.sqrt(Math.max(0, lumaSquaredSum / samples - meanLuma * meanLuma)),
    nearBlackRatio: samples > 0 ? nearBlack / samples : 1,
    maximumNearBlackFrameRatio: Math.max(...nearBlackFrameRatios),
    severeNearBlackFrameRatio:
      nearBlackFrameRatios.filter((ratio) => ratio > 0.35).length / nearBlackFrameRatios.length,
    isolatedLumaFlashRatio: frameCount > 2 ? isolatedLumaFlashes / (frameCount - 2) : 0,
    hash: decodedMediaHash,
    audiovisualMediaHash: decodedAudiovisualMediaHash(decodedMediaHash, embeddedAudio?.hash),
  };
}

export function calculateMotionMetricsByProfile(motionWindowChangedRatios, adjacentChangedRatios) {
  return Object.fromEntries(
    Object.entries(MOTION_REVIEW_PROFILES).map(([profile, thresholds]) => {
      const activeMotionWindows = motionWindowChangedRatios.filter(
        (ratio) => ratio >= thresholds.activeWindowChangedPixelRatio,
      ).length;
      const strongMotionWindows = motionWindowChangedRatios.filter(
        (ratio) => ratio >= thresholds.strongWindowChangedPixelRatio,
      ).length;
      const lowMotionFramePairs = adjacentChangedRatios.filter(
        (ratio) => ratio < thresholds.lowAdjacentChangedPixelRatio,
      ).length;
      return [
        profile,
        {
          activeMotionWindowRatio:
            motionWindowChangedRatios.length > 0 ? activeMotionWindows / motionWindowChangedRatios.length : 0,
          strongMotionWindowRatio:
            motionWindowChangedRatios.length > 0 ? strongMotionWindows / motionWindowChangedRatios.length : 0,
          lowMotionFrameRatio:
            adjacentChangedRatios.length > 0 ? lowMotionFramePairs / adjacentChangedRatios.length : 1,
        },
      ];
    }),
  );
}

function decodedAudioHash(audioPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  const metadata = parseMediaProbe(mediaProbe(ffmpeg, audioPath), 'audio');
  const pcm = runMediaTool(
    ffmpeg,
    ['-v', 'error', '-i', audioPath, '-vn', '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2', '-'],
    'ffmpeg decoded audio hash',
  );
  let peak = 0;
  let clipped = 0;
  let silent = 0;
  const sampleCount = Math.floor(pcm.byteLength / 2);
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const absolute = Math.abs(pcm.readInt16LE(offset));
    peak = Math.max(peak, absolute);
    if (absolute >= 32760) clipped += 1;
    if (absolute <= 32) silent += 1;
  }
  return {
    sampleRate: 48000,
    channels: metadata.channels || 2,
    sourceSampleRate: metadata.sourceSampleRate,
    durationSeconds: pcm.byteLength / (48000 * 2 * 2),
    peakAmplitude: peak / 32768,
    clippedSampleRatio: sampleCount > 0 ? clipped / sampleCount : 1,
    silenceRatio: sampleCount > 0 ? silent / sampleCount : 1,
    hash: `sha256:decoded-audio-pcm-s16le-48000-stereo:${sha256(pcm)}`,
  };
}

function decodedJsonHash(jsonPath) {
  const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return {
    hash: `sha256:canonical-json:${sha256(Buffer.from(stableStringify(parsed)))}`,
  };
}

export async function decodedMediaHash(mediaPath, mediaType, args = {}) {
  if (mediaType === 'video') return decodedVideoHash(mediaPath, args);
  if (mediaType === 'audio') return decodedAudioHash(mediaPath, args);
  if (mediaType === 'json') return decodedJsonHash(mediaPath);
  return decodedImageHash(mediaPath);
}

export async function finalizeReviewedDerivative(recordPath, mediaPath, mediaType = 'image', args = {}) {
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  const decoded = await decodedMediaHash(mediaPath, mediaType, args);
  record.decodedMediaHash = decoded.hash;
  if (mediaType === 'video' && decoded.embeddedAudio?.hash) {
    record.decodedAudioHash = decoded.embeddedAudio.hash;
    record.audiovisualMediaHash = decoded.audiovisualMediaHash;
  }
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { record, decoded };
}

export function cardPreviewContractErrors(decoded, contract = templateGalleryContract.video.cardPreview) {
  const errors = [];
  if (Number(decoded.width ?? 0) !== contract.width) {
    errors.push(`card preview width must be ${contract.width}, got ${decoded.width ?? 0}`);
  }
  if (
    Number(decoded.durationSeconds ?? 0) < contract.minimumDurationSeconds ||
    Number(decoded.durationSeconds ?? 0) > contract.maximumDurationSeconds
  ) {
    errors.push(
      `card preview duration must be ${contract.minimumDurationSeconds}-${contract.maximumDurationSeconds}s, got ${decoded.durationSeconds ?? 0}s`,
    );
  }
  if (contract.muted && decoded.hasAudio) {
    errors.push('card preview must not contain an audio stream');
  }
  if (decoded.codecName !== contract.codecName) {
    errors.push(`card preview codec must be ${contract.codecName}, got ${decoded.codecName || 'unknown'}`);
  }
  if (decoded.pixelFormat !== contract.pixelFormat) {
    errors.push(`card preview pixel format must be ${contract.pixelFormat}, got ${decoded.pixelFormat || 'unknown'}`);
  }
  return errors;
}

export function beforePreviewContractErrors(decoded, contract = templateGalleryContract.video.beforePreview) {
  const errors = [];
  if (contract.muted && decoded.hasAudio) {
    errors.push('before preview must not contain an audio stream');
  }
  if (decoded.codecName !== contract.codecName) {
    errors.push(`before preview codec must be ${contract.codecName}, got ${decoded.codecName || 'unknown'}`);
  }
  if (decoded.pixelFormat !== contract.pixelFormat) {
    errors.push(`before preview pixel format must be ${contract.pixelFormat}, got ${decoded.pixelFormat || 'unknown'}`);
  }
  return errors;
}

export function technicalMediaErrors(decoded, expected = {}, mediaType = 'image') {
  const errors = [];
  for (const field of ['width', 'height', 'frames', 'sampleRate']) {
    if (expected[field] !== undefined && Number(decoded[field]) !== Number(expected[field])) {
      errors.push(`${field} must be ${expected[field]}, got ${decoded[field] ?? 'missing'}`);
    }
  }
  if (expected.durationSeconds !== undefined) {
    const tolerance = mediaType === 'audio' ? 0.75 : 0.2;
    if (Math.abs(Number(decoded.durationSeconds ?? 0) - Number(expected.durationSeconds)) > tolerance) {
      errors.push(
        `duration must be within ${tolerance}s of ${expected.durationSeconds}s, got ${decoded.durationSeconds ?? 0}s`,
      );
    }
  }
  if (mediaType === 'image' || mediaType === 'video') {
    if (Number(decoded.nearBlackRatio ?? 1) > 0.995) errors.push('decoded media is more than 99.5% near-black');
    if (Number(decoded.lumaStdDev ?? 0) < 0.75) errors.push('decoded media has near-zero visual variance');
  }
  if (mediaType === 'video') {
    const requestedMotionProfile = expected.motionReviewProfile ?? DEFAULT_MOTION_REVIEW_PROFILE;
    const hasKnownMotionProfile = Object.hasOwn(MOTION_REVIEW_PROFILES, requestedMotionProfile);
    if (!hasKnownMotionProfile) {
      errors.push(`unsupported video motion review profile: ${requestedMotionProfile}`);
    }
    const motionProfile = hasKnownMotionProfile ? requestedMotionProfile : DEFAULT_MOTION_REVIEW_PROFILE;
    const selectedMotionMetrics = decoded.motionMetricsByProfile?.[motionProfile] ?? {
      activeMotionWindowRatio: decoded.activeMotionWindowRatio,
      strongMotionWindowRatio: decoded.strongMotionWindowRatio,
      lowMotionFrameRatio: decoded.lowMotionFrameRatio,
    };
    if (Number(decoded.frames ?? 0) < 2) errors.push('video contains fewer than two decoded frames');
    if (expected.requiresAudio === true) {
      if (decoded.hasAudio !== true || !decoded.embeddedAudio) {
        errors.push('video must contain an embedded audio stream');
      } else {
        if (!decoded.embeddedAudio.hash) {
          errors.push('embedded video audio is missing its decoded PCM identity');
        }
        if (!decoded.audiovisualMediaHash) {
          errors.push('video is missing its combined audiovisual identity');
        }
        if (Number(decoded.embeddedAudio.peakAmplitude ?? 0) <= 0.001) {
          errors.push('embedded video audio is effectively silent');
        }
        if (Number(decoded.embeddedAudio.silenceRatio ?? 1) > 0.98) {
          errors.push('embedded video audio contains more than 98% near-silence');
        }
        if (Number(decoded.embeddedAudio.clippedSampleRatio ?? 0) > 0.01) {
          errors.push('embedded video audio contains more than 1% clipped samples');
        }
      }
    }
    if (Number(decoded.durationSeconds ?? 0) < MINIMUM_TEMPLATE_VIDEO_SECONDS) {
      errors.push(`video duration must be at least ${MINIMUM_TEMPLATE_VIDEO_SECONDS} seconds`);
    }
    const shortEdge = Math.min(Number(decoded.width ?? 0), Number(decoded.height ?? 0));
    const longEdge = Math.max(Number(decoded.width ?? 0), Number(decoded.height ?? 0));
    if (shortEdge < MINIMUM_TEMPLATE_VIDEO_SHORT_EDGE || longEdge < MINIMUM_TEMPLATE_VIDEO_LONG_EDGE) {
      errors.push(
        `video delivery resolution must be at least ${MINIMUM_TEMPLATE_VIDEO_LONG_EDGE}x${MINIMUM_TEMPLATE_VIDEO_SHORT_EDGE}`,
      );
    }
    if (Number(decoded.uniqueFrameRatio ?? 0) < 0.1) errors.push('video has fewer than 10% unique decoded frames');
    if (Number(decoded.isolatedLumaFlashRatio ?? 0) > 0) {
      errors.push('video contains one or more isolated full-frame luminance flashes');
    }
    if (
      expected.maximumNearBlackFrameRatio !== undefined &&
      Number(decoded.maximumNearBlackFrameRatio ?? 1) > Number(expected.maximumNearBlackFrameRatio)
    ) {
      errors.push(
        `video maximum per-frame near-black area must be at most ${Number(expected.maximumNearBlackFrameRatio) * 100}%, got ${(
          Number(decoded.maximumNearBlackFrameRatio ?? 1) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.minimumMotionCoverage !== undefined &&
      Number(decoded.cumulativeChangedPixelRatio ?? 0) < Number(expected.minimumMotionCoverage)
    ) {
      errors.push(
        `video cumulative motion coverage must be at least ${Number(expected.minimumMotionCoverage) * 100}%, got ${(
          Number(decoded.cumulativeChangedPixelRatio ?? 0) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.minimumAdjacentMotionCoverage !== undefined &&
      Number(decoded.adjacentChangedPixelRatio ?? 0) < Number(expected.minimumAdjacentMotionCoverage)
    ) {
      errors.push(
        `video adjacent-frame motion coverage must be at least ${Number(expected.minimumAdjacentMotionCoverage) * 100}%, got ${(
          Number(decoded.adjacentChangedPixelRatio ?? 0) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.minimumEndToEndMotionCoverage !== undefined &&
      Number(decoded.endToEndChangedPixelRatio ?? 0) < Number(expected.minimumEndToEndMotionCoverage)
    ) {
      errors.push(
        `video end-to-end scene change must be at least ${Number(expected.minimumEndToEndMotionCoverage) * 100}%, got ${(
          Number(decoded.endToEndChangedPixelRatio ?? 0) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.minimumActiveMotionWindowRatio !== undefined &&
      Number(selectedMotionMetrics.activeMotionWindowRatio ?? 0) < Number(expected.minimumActiveMotionWindowRatio)
    ) {
      errors.push(
        `video active half-second motion windows must be at least ${Number(expected.minimumActiveMotionWindowRatio) * 100}%, got ${(
          Number(selectedMotionMetrics.activeMotionWindowRatio ?? 0) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.maximumLowMotionFrameRatio !== undefined &&
      Number(selectedMotionMetrics.lowMotionFrameRatio ?? 1) > Number(expected.maximumLowMotionFrameRatio)
    ) {
      errors.push(
        `video low-motion adjacent frames must be at most ${Number(expected.maximumLowMotionFrameRatio) * 100}%, got ${(
          Number(selectedMotionMetrics.lowMotionFrameRatio ?? 1) * 100
        ).toFixed(1)}%`,
      );
    }
    if (
      expected.minimumStrongMotionWindowRatio !== undefined &&
      Number(selectedMotionMetrics.strongMotionWindowRatio ?? 0) < Number(expected.minimumStrongMotionWindowRatio)
    ) {
      errors.push(
        `video strong half-second motion windows must be at least ${Number(expected.minimumStrongMotionWindowRatio) * 100}%, got ${(
          Number(selectedMotionMetrics.strongMotionWindowRatio ?? 0) * 100
        ).toFixed(1)}%`,
      );
    }
  }
  if (mediaType === 'audio') {
    if (Number(decoded.peakAmplitude ?? 0) <= 0.001) errors.push('audio is effectively silent');
    if (Number(decoded.silenceRatio ?? 1) > 0.98) errors.push('audio contains more than 98% near-silence');
    if (Number(decoded.clippedSampleRatio ?? 0) > 0.01) errors.push('audio contains more than 1% clipped samples');
  }
  return errors;
}

function writeVideoPoster(videoPath, posterPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  runMediaTool(ffmpeg, ['-y', '-v', 'error', '-i', videoPath, '-frames:v', '1', posterPath], 'ffmpeg video poster');
}

function writeBrowserSafeBeforePreview(videoPath, previewPath, args) {
  const ffmpeg = args.ffmpeg ?? DEFAULT_FFMPEG;
  const contract = templateGalleryContract.video.beforePreview;
  runMediaTool(
    ffmpeg,
    [
      '-y',
      '-v',
      'error',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      contract.videoCodec,
      '-preset',
      'medium',
      '-crf',
      String(contract.crf),
      '-pix_fmt',
      contract.pixelFormat,
      '-movflags',
      '+faststart',
      previewPath,
    ],
    'ffmpeg browser-safe before preview',
  );
}

function readManifest() {
  if (!existsSync(PUBLIC_MANIFEST)) {
    return { schemaVersion: 2, generatedAt: new Date(0).toISOString(), runtimeFingerprint: 'unverified', examples: [] };
  }
  return JSON.parse(readFileSync(PUBLIC_MANIFEST, 'utf8'));
}

function validateManifestShape(manifest) {
  const errors = [];
  if (manifest.schemaVersion !== 2) errors.push('manifest.schemaVersion must be 2');
  if (!Array.isArray(manifest.examples)) errors.push('manifest.examples must be an array');
  for (const entry of manifest.examples ?? []) {
    for (const field of [
      'templateId',
      'promptSettingsHash',
      'templateLockHash',
      'modelRevision',
      'runtimeFingerprint',
      'graphHash',
      'proofLockHash',
      'backendSourceFingerprint',
      'backendContractFingerprint',
      'modelCommit',
      'templateRevisionHash',
      'provenancePath',
      'provenanceHash',
      'outputPath',
      'thumbnailPath',
      'mediaHash',
      'mediaType',
      'verificationTimestamp',
      'qualityReviewPath',
      'qualityReviewHash',
      'qualityReviewStatus',
      'reviewer',
      'reviewedAt',
    ]) {
      if (!entry[field]) errors.push(`${entry.templateId ?? 'unknown'} missing ${field}`);
    }
    if (!QUALITY_REVIEW_STATUSES.has(entry.qualityReviewStatus)) {
      errors.push(`${entry.templateId ?? 'unknown'} has invalid qualityReviewStatus`);
    }
    const verificationStatus =
      entry.verificationStatus ?? (entry.qualityReviewStatus === EXACT_QUALITY_REVIEW_STATUS ? 'exact' : 'reviewed');
    if (!['reviewed', 'exact'].includes(verificationStatus)) {
      errors.push(`${entry.templateId ?? 'unknown'} has invalid verificationStatus`);
    }
    if (verificationStatus === 'exact' && entry.qualityReviewStatus !== EXACT_QUALITY_REVIEW_STATUS) {
      errors.push(`${entry.templateId ?? 'unknown'} exact entry requires approved_exact review`);
    }
    if (verificationStatus === 'reviewed' && entry.qualityReviewStatus !== REVIEWED_QUALITY_REVIEW_STATUS) {
      errors.push(`${entry.templateId ?? 'unknown'} reviewed entry requires approved_reviewed review`);
    }
    if (entry.beforePath && !entry.beforeMediaHash) {
      errors.push(`${entry.templateId ?? 'unknown'} beforePath requires beforeMediaHash`);
    }
    if (
      entry.beforePath &&
      MEDIA_EXTENSIONS.video.has(extname(entry.beforePath).toLowerCase()) &&
      !entry.beforeSourceMediaHash
    ) {
      errors.push(`${entry.templateId ?? 'unknown'} video beforePath requires beforeSourceMediaHash`);
    }
    if (Boolean(entry.decodedAudioHash) !== Boolean(entry.audiovisualMediaHash)) {
      errors.push(
        `${entry.templateId ?? 'unknown'} decodedAudioHash and audiovisualMediaHash must be supplied together`,
      );
    }
  }
  return errors;
}

export function mergeManifestEntries(existingEntries = [], verifiedEntries = []) {
  const replacements = new Map(verifiedEntries.map((entry) => [entry.templateId, entry]));
  const retained = existingEntries.filter((entry) => !replacements.has(entry.templateId));
  return [...retained, ...verifiedEntries].sort((left, right) =>
    String(left.templateId).localeCompare(String(right.templateId)),
  );
}

async function generate(args, artifactDir) {
  const runtime = await loadTemplateRuntime();
  const templates = selectTemplates(runtime.templates, args.templates);
  const mediaDir = args['media-dir'] ? resolve(ROOT, args['media-dir']) : null;
  const beforeMediaPath = args['before-media'] ? resolve(ROOT, args['before-media']) : null;
  if (beforeMediaPath && templates.length !== 1) {
    throw new Error('--before-media requires exactly one selected template.');
  }
  const runtimeFingerprint = args['runtime-fingerprint'] ?? 'unverified-local';
  const modelRevision = args['model-revision'];
  const verificationStatus = args.verification === 'reviewed' ? 'reviewed' : 'exact';
  const exactPublication = verificationStatus === 'exact';
  const requiredReviewStatus = exactPublication ? EXACT_QUALITY_REVIEW_STATUS : REVIEWED_QUALITY_REVIEW_STATUS;
  const verified = [];
  const skipped = [];
  const mediaOut = join(artifactDir, 'media');
  mkdirSync(mediaOut, { recursive: true });

  for (const template of templates) {
    const mediaType = mediaTypeForTemplate(template);
    const media = exactPublication ? findRunPair(mediaDir, template) : findSingleRun(mediaDir, template);
    if (!media) {
      skipped.push({
        templateId: template.id,
        reason: exactPublication ? 'No duplicate media pair found.' : 'No reviewed run1 media found.',
      });
      continue;
    }
    const left = await decodedMediaHash(media.run1, mediaType, args);
    const right = exactPublication ? await decodedMediaHash(media.run2, mediaType, args) : left;
    const expectedOutput = galleryExpectedOutput(template);
    const technicalErrors = technicalMediaErrors(left, expectedOutput, mediaType);
    if (exactPublication) technicalErrors.push(...technicalMediaErrors(right, expectedOutput, mediaType));
    if (technicalErrors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: 'Objective technical media gate failed.',
        technicalErrors,
        decoded: left,
      });
      continue;
    }
    if (exactPublication && left.hash !== right.hash) {
      skipped.push({
        templateId: template.id,
        reason: 'Duplicate runs produced different decoded media hashes.',
        left,
        right,
      });
      continue;
    }
    if (
      exactPublication &&
      expectedOutput.requiresAudio === true &&
      left.audiovisualMediaHash !== right.audiovisualMediaHash
    ) {
      skipped.push({
        templateId: template.id,
        reason: 'Duplicate runs produced different decoded audiovisual identities.',
        left,
        right,
      });
      continue;
    }
    if (!modelRevision) {
      skipped.push({
        templateId: template.id,
        reason: `--model-revision is required before publishing ${verificationStatus} examples.`,
        decoded: left,
      });
      continue;
    }
    if (!isVerifiedRuntimeFingerprint(runtimeFingerprint)) {
      skipped.push({
        templateId: template.id,
        reason: `A verified --runtime-fingerprint is required before ${verificationStatus} publication.`,
        decoded: left,
      });
      continue;
    }

    const promptSettingsHash = runtime.promptSettingsHash(template);
    const templateLockHash = runtime.templateLockHash(template, modelRevision);
    const templateInputContractHash = runtime.templateInputContractHash?.(template);
    const provenanceExpected = {
      templateId: template.id,
      templateLockHash,
      promptSettingsHash,
      modelRevision,
      runtimeFingerprint,
      decodedMediaHash: left.hash,
      ...(expectedOutput.requiresAudio === true
        ? {
            decodedAudioHash: left.embeddedAudio.hash,
            audiovisualMediaHash: left.audiovisualMediaHash,
          }
        : {}),
    };
    const provenanceResult = exactPublication
      ? loadDuplicateProvenance(args, template, provenanceExpected)
      : loadSingleProvenance(args, template, provenanceExpected);
    if (provenanceResult.errors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: exactPublication
          ? 'Exact publication requires two matching, complete run provenance records.'
          : 'Reviewed publication requires one complete run provenance record.',
        provenanceErrors: provenanceResult.errors,
      });
      continue;
    }
    const pinnedProvenance = exactPublication ? provenanceResult.run2 : provenanceResult.run;
    // Bind optional multi-model and deterministic-input identities into the
    // public bundle itself. The manifest and quality review already require
    // these values; omitting them made otherwise valid new comparison entries
    // fail public verification after publication.
    provenanceResult.bundle.bindings = {
      ...provenanceResult.bundle.bindings,
      ...(pinnedProvenance.models?.hash ? { modelSetHash: pinnedProvenance.models.hash } : {}),
      ...(pinnedProvenance.inputArtifactsHash ? { inputArtifactsHash: pinnedProvenance.inputArtifactsHash } : {}),
    };
    provenanceResult.hash = canonicalJsonHash(provenanceResult.bundle);
    const comparisonTemplate = requiresBeforeMedia(template);
    let beforeMedia = null;
    if (comparisonTemplate || beforeMediaPath) {
      if (!beforeMediaPath) {
        skipped.push({
          templateId: template.id,
          reason: 'Comparison publication requires --before-media bound to a pinned provenance input.',
        });
        continue;
      }
      beforeMedia = validateBeforeMedia(beforeMediaPath, pinnedProvenance);
      if (beforeMedia.errors.length > 0) {
        skipped.push({
          templateId: template.id,
          reason: 'Before media provenance validation failed.',
          errors: beforeMedia.errors,
        });
        continue;
      }
    }
    const reviewResult = loadQualityReview(
      args,
      template,
      {
        templateId: template.id,
        templateLockHash,
        promptSettingsHash,
        modelRevision,
        runtimeFingerprint,
        graphHash: pinnedProvenance.graphHash,
        proofLockHash: pinnedProvenance.proofLockHash,
        ...(pinnedProvenance.models?.hash ? { modelSetHash: pinnedProvenance.models.hash } : {}),
        ...(pinnedProvenance.inputArtifactsHash ? { inputArtifactsHash: pinnedProvenance.inputArtifactsHash } : {}),
        decodedMediaHash: left.hash,
        ...(expectedOutput.requiresAudio === true
          ? {
              decodedAudioHash: left.embeddedAudio.hash,
              audiovisualMediaHash: left.audiovisualMediaHash,
            }
          : {}),
      },
      requiredReviewStatus,
    );
    if (reviewResult.errors.length > 0) {
      skipped.push({
        templateId: template.id,
        reason: `${verificationStatus === 'exact' ? 'Exact' : 'Reviewed'} publication requires a matching approved quality review.`,
        qualityReviewErrors: reviewResult.errors,
      });
      continue;
    }

    const fileName = `${template.id}${media.extension}`;
    const artifactMediaPath = join(mediaOut, fileName);
    const posterName = mediaType === 'video' ? `${template.id}.poster.png` : fileName;
    const artifactPosterPath = join(mediaOut, posterName);
    const beforeIsVideo = beforeMedia !== null && MEDIA_EXTENSIONS.video.has(extname(beforeMediaPath).toLowerCase());
    const beforeName = beforeMedia
      ? `${template.id}.before${beforeIsVideo ? '.mp4' : extname(beforeMediaPath).toLowerCase()}`
      : null;
    const artifactBeforePath = beforeName ? join(mediaOut, beforeName) : null;
    copyFileSync(media.run1, artifactMediaPath);
    if (artifactBeforePath) {
      if (beforeIsVideo) {
        writeBrowserSafeBeforePreview(beforeMediaPath, artifactBeforePath, args);
      } else {
        copyFileSync(beforeMediaPath, artifactBeforePath);
      }
    }
    if (mediaType === 'video') {
      writeVideoPoster(media.run1, artifactPosterPath, args);
    }
    const publishedBeforeMediaHash = artifactBeforePath
      ? `sha256:bytes:${sha256(readFileSync(artifactBeforePath))}`
      : null;
    const reviewName = `${template.id}.quality-review.json`;
    const provenanceName = exactPublication
      ? `${template.id}.duplicate-provenance.json`
      : `${template.id}.reviewed-provenance.json`;
    const artifactReviewDir = join(artifactDir, 'reviews');
    const artifactReviewPath = join(artifactReviewDir, reviewName);
    const artifactProvenancePath = join(artifactReviewDir, provenanceName);
    mkdirSync(artifactReviewDir, { recursive: true });
    copyFileSync(reviewResult.filePath, artifactReviewPath);
    writeFileSync(artifactProvenancePath, `${JSON.stringify(provenanceResult.bundle, null, 2)}\n`, 'utf8');
    verified.push({
      templateId: template.id,
      verificationStatus,
      promptSettingsHash,
      templateLockHash,
      ...(templateInputContractHash ? { templateInputContractHash } : {}),
      modelRevision,
      runtimeFingerprint,
      graphHash: pinnedProvenance.graphHash,
      proofLockHash: pinnedProvenance.proofLockHash,
      backendSourceFingerprint: pinnedProvenance.backendSourceFingerprint,
      backendContractFingerprint: pinnedProvenance.backendContractFingerprint,
      modelCommit: pinnedProvenance.modelCommit,
      modelSetHash: pinnedProvenance.models?.hash,
      inputArtifactsHash: pinnedProvenance.inputArtifactsHash,
      templateRevisionHash: pinnedProvenance.templateRevisionHash,
      provenancePath: `/template-gallery/reviews/${provenanceName}`,
      provenanceHash: provenanceResult.hash,
      outputPath: `/template-gallery/${fileName}`,
      thumbnailPath: `/template-gallery/${posterName}`,
      ...(beforeName
        ? {
            beforePath: `/template-gallery/inputs/${beforeName}`,
            beforeMediaHash: publishedBeforeMediaHash,
            ...(beforeIsVideo ? { beforeSourceMediaHash: beforeMedia.hash } : {}),
            afterPath: `/template-gallery/${fileName}`,
          }
        : {}),
      mediaHash: left.hash,
      ...(expectedOutput.requiresAudio === true
        ? {
            decodedAudioHash: left.embeddedAudio.hash,
            audiovisualMediaHash: left.audiovisualMediaHash,
          }
        : {}),
      mediaType,
      verificationTimestamp: new Date().toISOString(),
      qualityReviewPath: `/template-gallery/reviews/${reviewName}`,
      qualityReviewHash: reviewResult.hash,
      qualityReviewStatus: reviewResult.review.reviewStatus,
      reviewer: reviewResult.review.reviewer,
      reviewedAt: reviewResult.review.reviewedAt,
      width: left.width,
      height: left.height,
      frames: left.frames,
      durationSeconds: left.durationSeconds,
      sampleRate: left.sampleRate,
      artifactMediaPath,
      artifactPosterPath,
      artifactBeforePath,
      artifactReviewPath,
      artifactProvenancePath,
    });
  }

  const existingManifest = readManifest();
  const generatedEntries = verified.map(
    ({
      artifactMediaPath,
      artifactPosterPath,
      artifactBeforePath,
      artifactReviewPath,
      artifactProvenancePath,
      ...entry
    }) => entry,
  );
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    runtimeFingerprint,
    examples: mergeManifestEntries(existingManifest.examples, generatedEntries),
  };

  writeFileSync(
    join(artifactDir, 'template-candidates.json'),
    JSON.stringify(
      templates.map((template) => buildTemplateCandidate(runtime, template, modelRevision)),
      null,
      2,
    ),
  );
  writeFileSync(join(artifactDir, 'manifest-candidate.json'), JSON.stringify(manifest, null, 2));

  if (args.publish && verified.length > 0) {
    mkdirSync(PUBLIC_GALLERY_DIR, { recursive: true });
    verified.forEach((entry) => {
      copyFileSync(entry.artifactMediaPath, join(PUBLIC_GALLERY_DIR, entry.outputPath.split('/').at(-1)));
      if (entry.artifactPosterPath && entry.artifactPosterPath !== entry.artifactMediaPath) {
        copyFileSync(entry.artifactPosterPath, join(PUBLIC_GALLERY_DIR, entry.thumbnailPath.split('/').at(-1)));
      }
      if (entry.artifactBeforePath && entry.beforePath) {
        const publicBeforePath = join(ROOT, 'public', entry.beforePath.replace(/^\//, ''));
        mkdirSync(dirname(publicBeforePath), { recursive: true });
        copyFileSync(entry.artifactBeforePath, publicBeforePath);
      }
      const publicReviewPath = join(ROOT, 'public', entry.qualityReviewPath.replace(/^\//, ''));
      mkdirSync(dirname(publicReviewPath), { recursive: true });
      copyFileSync(entry.artifactReviewPath, publicReviewPath);
      const publicProvenancePath = join(ROOT, 'public', entry.provenancePath.replace(/^\//, ''));
      mkdirSync(dirname(publicProvenancePath), { recursive: true });
      copyFileSync(entry.artifactProvenancePath, publicProvenancePath);
    });
    writeFileSync(PUBLIC_MANIFEST, JSON.stringify(manifest, null, 2));
  }

  return {
    mode: 'generate',
    artifactDir,
    templates: templates.length,
    verified: verified.length,
    skipped,
    published: Boolean(args.publish && verified.length > 0),
  };
}

async function verify(args, artifactDir) {
  const runtime = await loadTemplateRuntime();
  const templatesById = new Map(runtime.templates.map((template) => [template.id, template]));
  const manifest = readManifest();
  const errors = validateManifestShape(manifest);
  if ((manifest.examples?.length ?? 0) === 0) {
    errors.push('Gallery manifest is vacuous: at least one reviewed or exact runtime-generated example is required.');
  }
  for (const entry of manifest.examples ?? []) {
    const verificationStatus =
      entry.verificationStatus ?? (entry.qualityReviewStatus === EXACT_QUALITY_REVIEW_STATUS ? 'exact' : 'reviewed');
    const exactPublication = verificationStatus === 'exact';
    const requiredReviewStatus = exactPublication ? EXACT_QUALITY_REVIEW_STATUS : REVIEWED_QUALITY_REVIEW_STATUS;
    const outputPath = join(ROOT, 'public', entry.outputPath.replace(/^\//, ''));
    if (!existsSync(outputPath)) {
      errors.push(`${entry.templateId} media file missing: ${entry.outputPath}`);
      continue;
    }
    const thumbnailPath = join(ROOT, 'public', entry.thumbnailPath.replace(/^\//, ''));
    if (!existsSync(thumbnailPath)) {
      errors.push(`${entry.templateId} thumbnail file missing: ${entry.thumbnailPath}`);
    }
    const decoded = await decodedMediaHash(outputPath, entry.mediaType ?? 'image', args);
    if (decoded.hash !== entry.mediaHash) {
      errors.push(`${entry.templateId} decoded hash mismatch: expected ${entry.mediaHash}, got ${decoded.hash}`);
    }
    if (entry.decodedAudioHash && decoded.embeddedAudio?.hash !== entry.decodedAudioHash) {
      errors.push(
        `${entry.templateId} decoded audio hash mismatch: expected ${entry.decodedAudioHash}, got ${decoded.embeddedAudio?.hash ?? 'missing'}`,
      );
    }
    if (entry.audiovisualMediaHash && decoded.audiovisualMediaHash !== entry.audiovisualMediaHash) {
      errors.push(
        `${entry.templateId} audiovisual hash mismatch: expected ${entry.audiovisualMediaHash}, got ${decoded.audiovisualMediaHash ?? 'missing'}`,
      );
    }
    const template = templatesById.get(entry.templateId);
    if (!template) {
      errors.push(`${entry.templateId} is not present in the current template runtime`);
    } else {
      if (
        template.example?.expectedOutput?.requiresAudio === true &&
        (!entry.decodedAudioHash || !entry.audiovisualMediaHash)
      ) {
        errors.push(`${entry.templateId} required-audio video is missing decoded audio and audiovisual identities`);
      }
      const currentVideoEntry =
        entry.mediaType === 'video'
          ? runtime.findManifestEntry(template, { ...manifest, examples: [entry] }, { requireCardPreview: false })
          : undefined;
      if (currentVideoEntry && (!entry.cardPreviewPath || !entry.cardPreviewSha256)) {
        errors.push(`${entry.templateId} current video entry requires cardPreviewPath and cardPreviewSha256`);
      }
      const currentPromptSettingsHash = runtime.promptSettingsHash(template);
      const currentTemplateLockHash = runtime.templateLockHash(template, entry.modelRevision);
      const currentTemplateInputContractHash = runtime.templateInputContractHash?.(template);
      if (entry.promptSettingsHash !== currentPromptSettingsHash) {
        errors.push(`${entry.templateId} manifest promptSettingsHash is stale for the current default prompt`);
      }
      if (entry.templateLockHash !== currentTemplateLockHash) {
        errors.push(`${entry.templateId} manifest templateLockHash is stale for the current template revision`);
      }
      if (entry.templateInputContractHash !== currentTemplateInputContractHash) {
        errors.push(`${entry.templateId} manifest template input contract is stale for the current bundled defaults`);
      }
      errors.push(
        ...technicalMediaErrors(decoded, galleryExpectedOutput(template), entry.mediaType ?? 'image').map(
          (error) => `${entry.templateId} technical media gate: ${error}`,
        ),
      );
      if (requiresBeforeMedia(template) && (!entry.beforePath || !entry.afterPath || !entry.beforeMediaHash)) {
        errors.push(
          `${entry.templateId} comparison publication requires genuine beforePath, afterPath and beforeMediaHash`,
        );
      }
    }
    if (entry.beforePath) {
      const beforePath = join(ROOT, 'public', entry.beforePath.replace(/^\//, ''));
      if (!existsSync(beforePath)) {
        errors.push(`${entry.templateId} before media file missing: ${entry.beforePath}`);
      } else {
        const beforeHash = `sha256:bytes:${sha256(readFileSync(beforePath))}`;
        if (beforeHash !== entry.beforeMediaHash) {
          errors.push(
            `${entry.templateId} before media hash mismatch: expected ${entry.beforeMediaHash}, got ${beforeHash}`,
          );
        }
        if (MEDIA_EXTENSIONS.video.has(extname(entry.beforePath).toLowerCase())) {
          const decodedBeforePreview = await decodedMediaHash(beforePath, 'video', args);
          errors.push(
            ...beforePreviewContractErrors(decodedBeforePreview).map((error) => `${entry.templateId} ${error}`),
          );
        }
      }
    }
    if (entry.mediaType === 'video' && entry.cardPreviewPath) {
      const cardPreviewPath = join(ROOT, 'public', entry.cardPreviewPath.replace(/^\//, ''));
      if (!existsSync(cardPreviewPath)) {
        errors.push(`${entry.templateId} card preview file missing: ${entry.cardPreviewPath}`);
      } else {
        const cardPreviewSha256 = `sha256:bytes:${sha256(readFileSync(cardPreviewPath))}`;
        if (cardPreviewSha256 !== entry.cardPreviewSha256) {
          errors.push(
            `${entry.templateId} card preview hash mismatch: expected ${entry.cardPreviewSha256}, got ${cardPreviewSha256}`,
          );
        }
        const decodedCardPreview = await decodedMediaHash(cardPreviewPath, 'video', args);
        errors.push(...cardPreviewContractErrors(decodedCardPreview).map((error) => `${entry.templateId} ${error}`));
      }
    }
    const provenancePath = join(ROOT, 'public', String(entry.provenancePath ?? '').replace(/^\//, ''));
    if (!existsSync(provenancePath)) {
      errors.push(`${entry.templateId} provenance missing: ${entry.provenancePath}`);
    } else {
      try {
        const bundle = JSON.parse(readFileSync(provenancePath, 'utf8'));
        const provenanceHash = canonicalJsonHash(bundle);
        if (provenanceHash !== entry.provenanceHash) {
          errors.push(
            `${entry.templateId} provenance hash mismatch: expected ${entry.provenanceHash}, got ${provenanceHash}`,
          );
        }
        const expectedFormat = exactPublication
          ? 'modiff.gallery.duplicate-provenance.v1'
          : 'modiff.gallery.reviewed-provenance.v1';
        if (bundle.schemaVersion !== 1 || bundle.format !== expectedFormat) {
          errors.push(`${entry.templateId} provenance bundle schema/format is invalid for ${verificationStatus}`);
        }
        if (bundle.templateId !== entry.templateId) {
          errors.push(`${entry.templateId} provenance bundle templateId mismatch`);
        }
        const expectedBindings = {
          templateId: entry.templateId,
          templateLockHash: entry.templateLockHash,
          promptSettingsHash: entry.promptSettingsHash,
          modelRevision: entry.modelRevision,
          runtimeFingerprint: entry.runtimeFingerprint,
          decodedMediaHash: entry.mediaHash,
          ...(entry.decodedAudioHash ? { decodedAudioHash: entry.decodedAudioHash } : {}),
          ...(entry.audiovisualMediaHash ? { audiovisualMediaHash: entry.audiovisualMediaHash } : {}),
          ...(entry.modelSetHash ? { modelSetHash: entry.modelSetHash } : {}),
          ...(entry.inputArtifactsHash ? { inputArtifactsHash: entry.inputArtifactsHash } : {}),
        };
        // Runtime payload paths are intentionally redacted from public
        // provenance, so its stable runtime hash cannot be recomputed from the
        // published copy. Generation validates the unredacted provenance first
        // and pins those bindings into the hashed public bundle. Older bundles
        // predate `bindings`; their manifest + approved review remain the
        // immutable runtime attestation.
        if (bundle.bindings) {
          for (const [field, expectedValue] of Object.entries(expectedBindings)) {
            if (bundle.bindings[field] !== expectedValue) {
              errors.push(`${entry.templateId} provenance bundle binding ${field} mismatch`);
            }
          }
        }
        const { runtimeFingerprint: _redactedRuntimeFingerprint, ...publiclyRecomputableBindings } = expectedBindings;
        const pinnedRun = exactPublication ? bundle.run2 : bundle.run;
        const provenanceErrors = exactPublication
          ? validateDuplicateProvenance(bundle.run1, bundle.run2, publiclyRecomputableBindings).errors
          : validateSingleProvenance(bundle.run, publiclyRecomputableBindings, bundle.derivative);
        errors.push(...provenanceErrors.map((error) => `${entry.templateId} ${error}`));
        if (entry.beforeMediaHash) {
          const inputHashes = (pinnedRun?.inputs?.items ?? []).map((item) => item?.contentHash);
          const sourceMediaHash = entry.beforeSourceMediaHash ?? entry.beforeMediaHash;
          if (!inputHashes.includes(sourceMediaHash)) {
            errors.push(`${entry.templateId} before source media hash does not match pinned provenance inputs`);
          }
        }
        for (const field of [
          'graphHash',
          'proofLockHash',
          'backendSourceFingerprint',
          'backendContractFingerprint',
          'modelCommit',
          'templateRevisionHash',
          ...(entry.modelSetHash ? ['modelSetHash'] : []),
          ...(entry.inputArtifactsHash ? ['inputArtifactsHash'] : []),
        ]) {
          const provenanceValue =
            field === 'modelSetHash'
              ? pinnedRun?.models?.hash
              : field === 'inputArtifactsHash'
                ? pinnedRun?.inputArtifactsHash
                : pinnedRun?.[field];
          if (provenanceValue !== entry[field]) {
            errors.push(`${entry.templateId} manifest ${field} does not match pinned provenance`);
          }
        }
      } catch (error) {
        errors.push(
          `${entry.templateId} provenance is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const qualityReviewPath = join(ROOT, 'public', String(entry.qualityReviewPath ?? '').replace(/^\//, ''));
    if (!existsSync(qualityReviewPath)) {
      errors.push(`${entry.templateId} quality review missing: ${entry.qualityReviewPath}`);
      continue;
    }
    try {
      const review = JSON.parse(readFileSync(qualityReviewPath, 'utf8'));
      const reviewHash = canonicalJsonHash(review);
      if (reviewHash !== entry.qualityReviewHash) {
        errors.push(
          `${entry.templateId} quality review hash mismatch: expected ${entry.qualityReviewHash}, got ${reviewHash}`,
        );
      }
      const reviewErrors = validateQualityReview(
        review,
        {
          templateId: entry.templateId,
          templateLockHash: entry.templateLockHash,
          promptSettingsHash: entry.promptSettingsHash,
          modelRevision: entry.modelRevision,
          runtimeFingerprint: entry.runtimeFingerprint,
          graphHash: entry.graphHash,
          proofLockHash: entry.proofLockHash,
          ...(entry.modelSetHash ? { modelSetHash: entry.modelSetHash } : {}),
          ...(entry.inputArtifactsHash ? { inputArtifactsHash: entry.inputArtifactsHash } : {}),
          decodedMediaHash: entry.mediaHash,
          ...(entry.decodedAudioHash ? { decodedAudioHash: entry.decodedAudioHash } : {}),
          ...(entry.audiovisualMediaHash ? { audiovisualMediaHash: entry.audiovisualMediaHash } : {}),
        },
        requiredReviewStatus,
      );
      errors.push(...reviewErrors.map((error) => `${entry.templateId} ${error}`));
    } catch (error) {
      errors.push(
        `${entry.templateId} quality review is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    mode: 'verify',
    artifactDir,
    examples: manifest.examples?.length ?? 0,
    errors,
    ok: errors.length === 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const artifactDir = artifactDirFor(args.mode);
  mkdirSync(PUBLIC_GALLERY_DIR, { recursive: true });
  const result = args.mode === 'generate' ? await generate(args, artifactDir) : await verify(args, artifactDir);
  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (result.errors?.length) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
