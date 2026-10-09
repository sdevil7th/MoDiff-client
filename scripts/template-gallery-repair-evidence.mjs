import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { decodedMediaHash, loadTemplateRuntime } from './template-gallery-harness.mjs';
import {
  executionReceiptForProvenance,
  executionReceiptsForRun,
  inputArtifactsForOverrides,
  runtimeFingerprintForProvenance,
} from './template-gallery-runner.mjs';
import {
  backendSourceEvidence,
  createRunProvenance,
  modelSetIdentity,
  resolvedModelReposFromOutput,
  selectInstalledModelIdentity,
} from './live-proof-provenance.mjs';
import {
  assertRetainedExecutionIdentity,
  retainedGalleryMediaFiles,
  retainedTemplateBinding,
} from './template-gallery-repair-contract.mjs';

const ROOT = process.cwd();

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function ffmpegPath(backendDir) {
  const library = join(backendDir, '.venv', 'lib');
  if (!existsSync(library)) return '';
  for (const pythonDir of readdirSync(library).filter((name) => name.startsWith('python'))) {
    const binaries = join(library, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries');
    if (!existsSync(binaries)) continue;
    const executable = readdirSync(binaries).find((name) => name.startsWith('ffmpeg-'));
    if (executable) return join(binaries, executable);
  }
  return '';
}

async function main() {
  const mediaDir = resolve(option('--media-dir'));
  const templateId = option('--template');
  const backendDir = resolve(option('--backend-dir', resolve(ROOT, '..', 'MoDiff')));
  if (!templateId || !existsSync(mediaDir)) throw new Error('Use --media-dir <path> --template <id>.');

  const evidenceDir = join(mediaDir, 'evidence');
  const base = `${templateId}.run1`;
  const outputPath = join(evidenceDir, `${base}.output.json`);
  const eventsPath = join(evidenceDir, `${base}.websocket-events.json`);
  const nodesPath = join(evidenceDir, `${base}.nodes.json`);
  const modelPath = join(evidenceDir, `${base}.model-fingerprint.json`);
  const backendSourceBeforePath = join(dirname(mediaDir), 'backend-source-before.json');
  const backendSourceAfterPath = join(evidenceDir, `${base}.backend-source-after.json`);
  for (const requiredPath of [
    outputPath,
    eventsPath,
    nodesPath,
    modelPath,
    backendSourceBeforePath,
    backendSourceAfterPath,
  ]) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `Retained proof repair is fail-closed because original execution evidence is missing: ${requiredPath}`,
      );
    }
  }
  const provenancePath = join(evidenceDir, `${base}.provenance.json`);
  if (!existsSync(provenancePath)) {
    throw new Error(
      'Retained proof repair requires original run provenance; current template hashes cannot replace missing original template authority.',
    );
  }
  const originalProvenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const outputEvidence = JSON.parse(readFileSync(outputPath, 'utf8'));
  const eventEvidence = JSON.parse(readFileSync(eventsPath, 'utf8'));
  const nodesPayload = JSON.parse(readFileSync(nodesPath, 'utf8'));
  const modelPayload = JSON.parse(readFileSync(modelPath, 'utf8'));
  const backendSourceBefore = JSON.parse(readFileSync(backendSourceBeforePath, 'utf8'));
  const backendSourceAfter = JSON.parse(readFileSync(backendSourceAfterPath, 'utf8'));
  const backendSource = backendSourceBefore?.identity;
  const { output, run, terminalTask } = outputEvidence;
  const retainedMedia = retainedGalleryMediaFiles(mediaDir, base);
  if (retainedMedia.length === 0) throw new Error(`Retained media for ${base} is missing.`);

  const runtime = await loadTemplateRuntime(ROOT);
  const template = runtime.templates.find((item) => item.id === templateId);
  if (!template) throw new Error(`Unknown template ${templateId}.`);
  const mediaType = template.example?.mediaType ?? template.outputKinds?.[0] ?? 'image';
  const events = eventEvidence.events ?? [];
  const executionReceipts = executionReceiptsForRun(template, output, events);
  const repos = resolvedModelReposFromOutput(output);
  const identities = repos.map((repo) => {
    const identity = selectInstalledModelIdentity(modelPayload, repo);
    if (!identity) throw new Error(`No installed commit was resolved for ${repo}.`);
    return identity;
  });
  const modelSet = modelSetIdentity(identities);
  const inputArtifacts = inputArtifactsForOverrides(output.formSnapshot);
  const originalBinding = retainedTemplateBinding({
    runtime,
    template,
    original: originalProvenance,
    output,
    run,
    events,
    inputArtifacts,
  });
  if (modelSet.revisionLock !== originalProvenance.modelRevision) {
    throw new Error('Retained model evidence does not match the original model revision lock.');
  }
  const mediaPaths = retainedMedia.map((mediaFile) => join(mediaDir, mediaFile));
  const analyses = await Promise.all(
    mediaPaths.map(async (mediaPath, index) => {
      const bytes = readFileSync(mediaPath);
      const decoded = await decodedMediaHash(mediaPath, mediaType, { ffmpeg: ffmpegPath(backendDir) });
      return {
        ...decoded,
        mediaType,
        byteSize: bytes.byteLength,
        encodedSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        decodedSha256: decoded.hash,
        collectionIndex: index,
        capturedFileName: basename(mediaPath),
        ok: true,
      };
    }),
  );
  const deterministicEvent = [...events]
    .reverse()
    .find((event) => event?.type === 'deterministic_execution' && event?.task_id === run.taskId);
  const completionEvent = [...events]
    .reverse()
    .find((event) => event?.type === 'graph_completed' && event?.task_id === run.taskId);
  const selectedRuntimeFingerprint = runtimeFingerprintForProvenance({
    deterministicEvent,
    completionEvent,
    terminalTask,
    output,
  });
  const sourceEvidence = backendSourceEvidence({
    before: backendSource,
    after: backendSourceAfter?.identity,
    runtimeFingerprint: selectedRuntimeFingerprint,
  });
  if (backendSourceAfter?.error || sourceEvidence.blockers.length > 0) {
    throw new Error(
      `Retained proof repair cannot establish the original worker-loaded backend source identity: ${[
        ...(backendSourceAfter?.error ? [backendSourceAfter.error] : []),
        ...sourceEvidence.blockers,
      ].join(' ')}`,
    );
  }
  const outputAnalysis = {
    ok: true,
    outputCount: analyses.length,
    analyses,
  };
  const provenance = createRunProvenance({
    templateId,
    lockedSettings: originalBinding.lockedSettings,
    promptSettingsHash: originalBinding.promptSettingsHash,
    catalogTemplateLockHash: originalBinding.catalogTemplateLockHash,
    resolvedTemplateLockHash: originalBinding.resolvedTemplateLockHash,
    apiGraph: output.apiGraphSnapshot,
    nodesPayload,
    modelIdentity: identities[0],
    modelIdentities: identities,
    inputArtifacts,
    runtimeFingerprint: selectedRuntimeFingerprint,
    deterministicMode: deterministicEvent?.deterministicMode ?? output.apiGraphSnapshot?.deterministicMode,
    backendSource: sourceEvidence.identity,
    outputAnalysis,
    executedOutput: output,
    executionReceipt: executionReceiptForProvenance(completionEvent, terminalTask),
    taskId: run.taskId,
    expectedOutput: template.example?.expectedOutput,
    capturedAt: originalBinding.capturedAt,
  });
  if (provenance.blockers.length)
    throw new Error(`Retained provenance is incomplete: ${provenance.blockers.join(' ')}`);
  assertRetainedExecutionIdentity(originalProvenance, provenance);

  for (const sidecar of [eventsPath, provenancePath]) {
    const before = readFileSync(sidecar);
    const digest = createHash('sha256').update(before).digest('hex');
    const backup = `${sidecar}.before-repair-${digest}`;
    if (!existsSync(backup)) writeFileSync(backup, before, { flag: 'wx' });
    if (!readFileSync(backup).equals(before)) throw new Error('An immutable repair backup has different bytes.');
  }
  const originalSidecars = [eventsPath, provenancePath].map((path) => ({ path, bytes: readFileSync(path) }));
  try {
    writeFileSync(eventsPath, `${JSON.stringify({ taskId: run.taskId, executionReceipts, events }, null, 2)}\n`);
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  } catch (error) {
    for (const sidecar of originalSidecars) writeFileSync(sidecar.path, sidecar.bytes);
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        templateId,
        mediaPaths,
        modelRevision: modelSet.revisionLock,
        runtimeFingerprint: provenance.runtimeFingerprint,
        decoded: analyses,
      },
      null,
      2,
    ),
  );
}

await main();
