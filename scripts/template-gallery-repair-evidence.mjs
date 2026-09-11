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
  const outputEvidence = JSON.parse(readFileSync(outputPath, 'utf8'));
  const eventEvidence = JSON.parse(readFileSync(eventsPath, 'utf8'));
  const nodesPayload = JSON.parse(readFileSync(nodesPath, 'utf8'));
  const modelPayload = JSON.parse(readFileSync(modelPath, 'utf8'));
  const backendSourceBefore = JSON.parse(readFileSync(backendSourceBeforePath, 'utf8'));
  const backendSourceAfter = JSON.parse(readFileSync(backendSourceAfterPath, 'utf8'));
  const backendSource = backendSourceBefore?.identity;
  const { output, run, terminalTask } = outputEvidence;
  const retainedMedia = readdirSync(mediaDir)
    .filter(
      (name) =>
        name.startsWith(`${base}.`) &&
        !name.includes('.before.') &&
        !name.includes('.recomposed.') &&
        !name.endsWith('.json'),
    )
    .sort((left, right) => {
      const itemIndex = (name) => {
        const match = name.match(/\.item(\d+)\./);
        return match ? Number(match[1]) : 1;
      };
      return itemIndex(left) - itemIndex(right) || left.localeCompare(right);
    });
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
  const catalogLock = runtime.templateLockHash(template);
  const provenance = createRunProvenance({
    templateId,
    lockedSettings: runtime.lockedSettingsForTemplate(template),
    promptSettingsHash: runtime.promptSettingsHash(template),
    catalogTemplateLockHash: catalogLock,
    resolvedTemplateLockHash: runtime.templateLockHash(template, modelSet.revisionLock),
    apiGraph: output.apiGraphSnapshot,
    nodesPayload,
    modelIdentity: identities[0],
    modelIdentities: identities,
    inputArtifacts: inputArtifactsForOverrides(output.formSnapshot),
    runtimeFingerprint: selectedRuntimeFingerprint,
    deterministicMode: deterministicEvent?.deterministicMode ?? output.apiGraphSnapshot?.deterministicMode,
    backendSource: sourceEvidence.identity,
    outputAnalysis,
    executedOutput: output,
    executionReceipt: executionReceiptForProvenance(completionEvent, terminalTask),
    taskId: run.taskId,
    expectedOutput: template.example?.expectedOutput,
  });
  if (provenance.blockers.length)
    throw new Error(`Retained provenance is incomplete: ${provenance.blockers.join(' ')}`);

  writeFileSync(eventsPath, `${JSON.stringify({ taskId: run.taskId, executionReceipts, events }, null, 2)}\n`);
  writeFileSync(join(evidenceDir, `${base}.provenance.json`), `${JSON.stringify(provenance, null, 2)}\n`);
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
