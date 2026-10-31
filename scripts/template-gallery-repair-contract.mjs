import { readdirSync } from 'node:fs';
import { extname } from 'node:path';
import { canonicalGraphIdentity, stableStringify } from './live-proof-provenance.mjs';

const MEDIA_EXTENSIONS = new Set([
  '.png',
  '.webp',
  '.jpg',
  '.jpeg',
  '.wav',
  '.flac',
  '.mp3',
  '.m4a',
  '.ogg',
  '.mp4',
  '.webm',
  '.mov',
  '.mkv',
]);

export function retainedGalleryMediaFiles(mediaDir, base) {
  return readdirSync(mediaDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(`${base}.`) &&
        !entry.name.includes('.before.') &&
        !entry.name.includes('.recomposed.') &&
        !entry.name.includes('.before-repair-') &&
        MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort((left, right) => {
      const itemIndex = (name) => {
        const match = name.match(/\.item(\d+)\./);
        return match ? Number(match[1]) : 1;
      };
      return itemIndex(left) - itemIndex(right) || left.localeCompare(right);
    });
}

const MEDIA_FIELDS = new Map([
  ['sourceVideo', 'source_video'],
  ['maskVideo', 'mask_video'],
  ['controlVideo', 'control_video'],
  ['sourceAudio', 'source_audio'],
  ['referenceAudio', 'reference_audio'],
]);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function inputIdentities(items = []) {
  // The capture contract names references reference_image_1, _2, etc. Their
  // indexed role preserves order even though provenance sorts records by role.
  return items
    .map(({ role, contentHash, sha256, byteSize }) => ({ role, contentHash: contentHash ?? sha256, byteSize }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
}

export function assertRetainedExecutionIdentity(original, repaired) {
  for (const field of [
    'taskId',
    'capturedAt',
    'backendSourceFingerprint',
    'backendContractFingerprint',
    'runtimeFingerprint',
    'graphHash',
    'modelRevision',
    'modelCommit',
    'inputArtifactsHash',
  ]) {
    if (!original?.[field] || original[field] !== repaired?.[field]) {
      throw new Error(`Retained proof repair would change original execution identity ${field}.`);
    }
  }
  if (
    !original?.runtime?.backendSource ||
    stableStringify(original.runtime.backendSource) !== stableStringify(repaired?.runtime?.backendSource)
  ) {
    throw new Error('Retained proof repair would replace the original backend source inventory.');
  }
  if (!original?.model || stableStringify(original.model) !== stableStringify(repaired?.model)) {
    throw new Error('Retained proof repair would change the original model artifact identity.');
  }
  if (
    !Array.isArray(original?.models?.items) ||
    stableStringify(original.models.items) !== stableStringify(repaired?.models?.items)
  ) {
    throw new Error('Retained proof repair would replace the original complete model set.');
  }
  const items = original?.output?.items;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    original.output.count !== items.length ||
    !original.output.collectionHash ||
    items.some(
      (item, index) => item?.index !== index || !item?.mediaType || !item?.encodedSha256 || !item?.decodedSha256,
    )
  ) {
    throw new Error('Retained proof repair requires the original ordered output identities.');
  }
  if (stableStringify(original.output) !== stableStringify(repaired?.output)) {
    throw new Error('Retained proof repair would change the original ordered output identities.');
  }
}

// Repair may recover metadata from the original execution. It cannot confer the
// current template's authority on a historical graph or changed creator recipe.
export function retainedTemplateBinding({ runtime, template, original, output, run, events, inputArtifacts }) {
  const blockers = [];
  const retained = record(original?.template);
  const currentSettings = runtime.lockedSettingsForTemplate(template);
  const retainedSettings = record(retained?.lockedSettings);
  const form = record(output?.formSnapshot);
  if (!retainedSettings) blockers.push('original template locked settings are missing');
  if (!form) blockers.push('the original executed form snapshot is missing');
  if (retained?.id !== template.id || output?.templateId !== template.id) {
    blockers.push('original template identity does not match the selected template');
  }
  if (!run?.taskId || original?.taskId !== run.taskId || output?.taskId !== run.taskId) {
    blockers.push('original provenance and output do not identify the retained task');
  }
  if (!Number.isFinite(Date.parse(original?.capturedAt))) blockers.push('original capture timestamp is missing');

  for (const [field, expected] of Object.entries(currentSettings)) {
    if (!retainedSettings || !Object.hasOwn(retainedSettings, field)) {
      blockers.push(`original template setting ${field} is missing`);
    } else if (stableStringify(retainedSettings[field]) !== stableStringify(expected)) {
      blockers.push(`creator setting ${field} changed since the original run`);
    }
    const mediaRole = MEDIA_FIELDS.get(field);
    const boundMedia = mediaRole && !expected && inputArtifacts?.some((item) => item.role === mediaRole);
    if (!form || !Object.hasOwn(form, field)) {
      blockers.push(`consumed form setting ${field} is missing`);
    } else if (!boundMedia && stableStringify(form[field]) !== stableStringify(expected)) {
      blockers.push(`consumed form setting ${field} differs from the creator recipe`);
    }
  }
  if (stableStringify(retainedSettings) !== stableStringify(currentSettings)) {
    blockers.push('the complete original locked settings differ from the current template');
  }
  const revision = original?.models?.revisionLock ?? original?.modelRevision;
  for (const [field, expected] of [
    ['promptSettingsHash', runtime.promptSettingsHash(template)],
    ['catalogTemplateLockHash', runtime.templateLockHash(template)],
    ['resolvedTemplateLockHash', runtime.templateLockHash(template, revision)],
  ]) {
    if (!retained?.[field] || retained[field] !== expected) {
      blockers.push(`original ${field} differs from the current template; retain it as historical evidence`);
    }
  }

  const graph = canonicalGraphIdentity(output?.apiGraphSnapshot);
  if (
    graph.canonicalGraph.nodes.length === 0 ||
    original?.graph?.hash !== graph.hash ||
    original?.graphHash !== graph.hash ||
    stableStringify(original?.graph?.canonicalGraph) !== stableStringify(graph.canonicalGraph)
  ) {
    blockers.push('the retained executed graph does not match the original provenance graph');
  }
  for (const type of ['graph_completed', 'task_completed']) {
    if (!events?.some((event) => event?.type === type && event?.task_id === run?.taskId)) {
      blockers.push(`the original ${type} receipt is missing for the retained task`);
    }
  }
  for (const nodeId of new Set(output?.apiGraphSnapshot?.paths?.flat() ?? [])) {
    if (
      !events?.some(
        (event) =>
          event?.type === 'executed' &&
          event?.task_id === run?.taskId &&
          event?.node === nodeId &&
          !['failed', 'cancelled', 'running'].includes(event?.status),
      )
    ) {
      blockers.push(`original execution receipt is missing for graph node ${nodeId}`);
    }
  }
  if (
    !Array.isArray(original?.inputs?.items) ||
    stableStringify(inputIdentities(original.inputs.items)) !== stableStringify(inputIdentities(inputArtifacts))
  ) {
    blockers.push('retained input media does not match the original pinned input identities');
  }
  if (blockers.length > 0) {
    throw new Error(`Retained proof repair cannot bind the current recipe: ${blockers.join('; ')}.`);
  }
  return { ...retained, capturedAt: original.capturedAt };
}
