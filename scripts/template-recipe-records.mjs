import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalJsonHash, loadTemplateRuntime, validateSingleProvenance } from './template-gallery-harness.mjs';

function publicJson(root, path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/template-gallery/') ||
    path.includes('\\') ||
    path.includes('..')
  ) {
    throw new Error('Recipe record requires a contained canonical Gallery sidecar.');
  }
  const publicRoot = realpathSync(join(root, 'public'));
  const filename = realpathSync(join(publicRoot, path.slice(1)));
  const within = relative(publicRoot, filename);
  if (isAbsolute(within) || within === '..' || within.startsWith('../') || within.startsWith('..\\')) {
    throw new Error('Recipe record sidecar escapes the public root.');
  }
  return JSON.parse(readFileSync(filename, 'utf8'));
}

/** Reconcile historical metadata only. The returned declaration is for
 * verification of existing media, never for dispatch or current qualification. */
export function verifyTemplateRecipeRecords(history, { root, runtime, manifest }) {
  const { recordsHash, ...body } = history;
  if (
    history.schemaVersion !== 1 ||
    history.format !== 'modiff.gallery.recipe-history.v1' ||
    recordsHash !== canonicalJsonHash(body) ||
    !/^[a-f0-9]{40}$/u.test(history.source?.revision ?? '') ||
    !Array.isArray(history.records)
  ) {
    throw new Error('Recipe history schema, immutable source or content hash is invalid.');
  }
  const seen = new Set();
  return history.records.map((record) => {
    const fail = (reason) => {
      throw new Error(`${record.templateId}: ${reason}`);
    };
    if (seen.has(record.templateId)) fail('duplicate historical recipe');
    seen.add(record.templateId);
    if (record.currentGraphExecutionProved !== false || record.evidenceScope !== 'approved_historical_recipe') {
      fail('historical evidence cannot qualify the current graph');
    }
    const current = runtime.templates.find((template) => template.id === record.templateId);
    const entry = manifest.examples.find((candidate) => candidate.templateId === record.templateId);
    if (!current || !entry || !Object.entries(record.bindings).every(([key, value]) => entry[key] === value)) {
      fail('published media, recipe, provenance or review binding changed');
    }
    if (runtime.templateLockHash(current, entry.modelRevision) !== record.currentTemplateLockHash) {
      fail('current template declaration changed after reconciliation');
    }
    const historical = runtime.findHistoricalTemplateRecipe(current, { ...manifest, examples: [entry] });
    if (!historical || runtime.findManifestEntry(current, { ...manifest, examples: [entry] })) {
      fail('the original historical creator declaration did not reproduce');
    }
    if (
      JSON.stringify(historical.template.executionSelection ?? null) !==
        JSON.stringify(record.creator.executionSelection) ||
      JSON.stringify(historical.template.workflowBlockSettings ?? {}) !==
        JSON.stringify(record.creator.workflowBlockSettings)
    ) {
      fail('historical declaration differs from the recorded creator');
    }
    const bundle = publicJson(root, entry.provenancePath);
    const proof = bundle.run;
    const expected = {
      templateId: entry.templateId,
      templateLockHash: entry.templateLockHash,
      promptSettingsHash: entry.promptSettingsHash,
      modelRevision: entry.modelRevision,
      decodedMediaHash: entry.mediaHash,
      ...(entry.decodedAudioHash ? { decodedAudioHash: entry.decodedAudioHash } : {}),
      ...(entry.audiovisualMediaHash ? { audiovisualMediaHash: entry.audiovisualMediaHash } : {}),
      ...(entry.modelSetHash ? { modelSetHash: entry.modelSetHash } : {}),
      ...(entry.inputArtifactsHash ? { inputArtifactsHash: entry.inputArtifactsHash } : {}),
    };
    // The public run's local runtime metadata is redacted. Verify the sealed
    // runtime binding without trying to derive it from that redacted payload.
    const publicBindings = { ...expected, runtimeFingerprint: entry.runtimeFingerprint };
    if (
      canonicalJsonHash(bundle) !== entry.provenanceHash ||
      bundle.schemaVersion !== 1 ||
      bundle.format !== 'modiff.gallery.reviewed-provenance.v1' ||
      bundle.templateId !== record.templateId ||
      !proof ||
      (bundle.bindings && Object.entries(publicBindings).some(([key, value]) => bundle.bindings[key] !== value)) ||
      proof.template?.promptSettingsHash !== runtime.promptSettingsHash(historical.template) ||
      proof.graphHash !== entry.graphHash ||
      proof.proofLockHash !== entry.proofLockHash ||
      proof.backendSourceFingerprint !== entry.backendSourceFingerprint ||
      proof.backendContractFingerprint !== entry.backendContractFingerprint ||
      proof.modelCommit !== entry.modelCommit ||
      proof.templateRevisionHash !== entry.templateRevisionHash ||
      proof.models?.hash !== entry.modelSetHash ||
      proof.models?.revisionLock !== entry.modelRevision ||
      !Array.isArray(proof.models?.items) ||
      !proof.models.items.length ||
      proof.models.count !== proof.models.items.length ||
      validateSingleProvenance(proof, expected, bundle.derivative).length
    ) {
      fail('the unchanged original creator, graph or complete model-set proof did not match');
    }
    if (canonicalJsonHash(publicJson(root, entry.qualityReviewPath)) !== entry.qualityReviewHash) {
      fail('original quality review changed');
    }
    return {
      templateId: record.templateId,
      entry,
      template: historical.template,
      evidenceScope: record.evidenceScope,
      currentGraphExecutionProved: false,
    };
  });
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const history = JSON.parse(readFileSync(join(root, 'config/template-recipe-history.v1.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'public/template-gallery/manifest.json'), 'utf8'));
  const records = verifyTemplateRecipeRecords(history, { root, manifest, runtime: await loadTemplateRuntime(root) });
  console.log(
    JSON.stringify({ verifiedHistoricalRecipes: records.length, currentGraphProofsAdded: 0, approvedMediaRerun: 0 }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
