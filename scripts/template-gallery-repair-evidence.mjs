import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { decodedMediaHash, loadTemplateRuntime } from './template-gallery-harness.mjs';
import {
  executionReceiptForProvenance,
  executionReceiptsForRun,
  inputArtifactsForOverrides,
} from './template-gallery-runner.mjs';
import {
  backendSourceIdentity,
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
  const server = option('--server', 'http://127.0.0.1:8088');
  const backendDir = resolve(option('--backend-dir', resolve(ROOT, '..', 'MoDiff')));
  if (!templateId || !existsSync(mediaDir)) throw new Error('Use --media-dir <path> --template <id>.');

  const evidenceDir = join(mediaDir, 'evidence');
  const base = `${templateId}.run1`;
  const outputPath = join(evidenceDir, `${base}.output.json`);
  const eventsPath = join(evidenceDir, `${base}.websocket-events.json`);
  const outputEvidence = JSON.parse(readFileSync(outputPath, 'utf8'));
  const eventEvidence = JSON.parse(readFileSync(eventsPath, 'utf8'));
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
  const [nodesResponse, ...modelResponses] = await Promise.all([
    fetch(new URL('/nodes', server)),
    ...repos.map((repo) =>
      fetch(
        new URL(
          `/model_fingerprints?modelType=${encodeURIComponent(template.modelType)}&repo=${encodeURIComponent(repo)}`,
          server,
        ),
      ),
    ),
  ]);
  if (!nodesResponse.ok || modelResponses.some((response) => !response.ok)) {
    throw new Error('Backend nodes or model fingerprints are unavailable for retained evidence repair.');
  }
  const nodesPayload = await nodesResponse.json();
  const modelPayloads = await Promise.all(modelResponses.map((response) => response.json()));
  const modelPayload = {
    error: false,
    count: modelPayloads.reduce((count, payload) => count + Number(payload?.count ?? 0), 0),
    models: modelPayloads.flatMap((payload) => payload?.models ?? []),
    runtimeFingerprint: modelPayloads.find((payload) => payload?.runtimeFingerprint)?.runtimeFingerprint ?? null,
    source: 'modiff-backend-executed-repos',
  };
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
    runtimeFingerprint: deterministicEvent?.runtimeFingerprint ?? terminalTask?.runtimeFingerprint ?? null,
    deterministicMode: deterministicEvent?.deterministicMode ?? output.apiGraphSnapshot?.deterministicMode,
    backendSource: backendSourceIdentity(backendDir),
    outputAnalysis,
    executedOutput: output,
    executionReceipt: executionReceiptForProvenance(completionEvent, terminalTask),
    taskId: run.taskId,
    expectedOutput: template.example?.expectedOutput,
  });
  if (provenance.blockers.length)
    throw new Error(`Retained provenance is incomplete: ${provenance.blockers.join(' ')}`);

  writeFileSync(join(evidenceDir, `${base}.nodes.json`), `${JSON.stringify(nodesPayload, null, 2)}\n`);
  writeFileSync(join(evidenceDir, `${base}.model-fingerprint.json`), `${JSON.stringify(modelPayload, null, 2)}\n`);
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
