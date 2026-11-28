import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalGraphIdentity } from './live-proof-provenance.mjs';
import { validateNativeVariantOutput } from './native-variant-run-evidence.mjs';
import { readCanonicalEvidenceFile } from './release-contract-core.mjs';
import { decodedMediaHash } from './template-gallery-harness.mjs';

const framepack = 'HunyuanVideoFramepackPipeline:image_to_video';
const routes = new Map([
  [
    'AceStepAudioPipeline:text_to_audio:ace_step_chinese_new_year_lora',
    {
      scope: 'research_academic_only',
      policyId: 'ace-step-chinese-new-year-research-academic-only',
      contentType: 'audio/x-wav',
      loaders: [
        ['LoadPipeline', 'model_id'],
        ['LoadAdapter', 'adapter_path', true],
      ],
    },
  ],
  [
    'FluxDevPipeline:text_to_image:flux_lora_ghibli_story',
    {
      scope: 'personal_noncommercial',
      policyId: 'ghibli-characters-personal-noncommercial',
      contentType: 'image/webp',
      loaders: [
        ['ModelsLoader', 'repo_id'],
        ['Lora', 'model', true],
      ],
    },
  ],
  [
    framepack,
    {
      scope: 'territory_limited_private_evaluation',
      contentType: 'video/mp4',
      loaders: [['LoadPipeline', 'model_id']],
    },
  ],
]);

const parse = ({ bytes }) => JSON.parse(bytes);
const modelKey = ({ repoId, revision }) => `${repoId}@${revision}`;
const modelKeys = (models) => models.map(modelKey).sort();
const exactDigest = /^[a-f0-9]{64}$/u;

function checkLoaderBindings(graph, resolved, review, route) {
  for (const [action, field, adapter] of route.loaders) {
    const matches = Object.entries(graph.nodes).filter(([, node]) => node.action === action);
    assert.equal(matches.length, 1, `Expected one executable ${action}.`);
    const [[nodeId, node]] = matches;
    const selection = node.params[field].value;
    const revision = node.params.revision.value;
    assert.equal(selection.source, 'hub');
    assert.ok(review.modelSet.some(({ repoId, revision: pin }) => repoId === selection.value && pin === revision));
    const native = resolved.find((row) => row.nodeId === nodeId);
    assert.equal(native?.action, action);
    assert.equal(native?.module, node.module);
    assert.equal(native.fields.revision?.value, revision, `The consumed ${action} revision differs.`);
    // The native adapter receipt records the revision. Its repository and
    // bytes are additionally locked by the submitted loader's checksum guard.
    if (adapter) assert.match(node.params.expected_sha256.value, exactDigest);
    const consumed = native.fields[field]?.value;
    if (consumed !== undefined || !adapter) {
      assert.equal(consumed?.value ?? consumed, selection.value, `The consumed ${action} artifact differs.`);
    }
  }
}

function checkFramePackVariant(graph, resolved, references, original, review) {
  assert.equal(original?.proofKind, 'real_backend_input_bound_model_variant');
  assert.equal(original.canonicalWorkflowHash, review.canonicalWorkflowHash);
  assert.deepEqual(modelKeys(original.modelSet), modelKeys(review.modelSet));
  assert.equal(references.length, 2);
  assert.equal(references[0].ref.sha256, original.inputBinding.sha256);
  assert.notEqual(references[1].ref.sha256, references[0].ref.sha256);
  const generator = Object.values(graph.nodes).find(
    ({ module, action }) => module === 'modules.DiffusersVideo' && action === 'Generate',
  );
  assert.equal(generator.params.framepack_sampling.value, 'inverted_anti_drifting');
  for (const [index, field] of ['reference_images', 'last_image'].entries()) {
    const { nodeId, ref } = references[index];
    assert.equal(graph.nodes[nodeId].action, 'Load');
    assert.equal(graph.nodes[nodeId].module, 'modules.Image');
    assert.equal(generator.params[field].sourceId, nodeId);
    assert.equal(generator.params[field].sourceKey, 'image');
    const loaded = resolved.find((row) => row.nodeId === nodeId);
    assert.deepEqual(loaded.fields.source_hashes.value, [ref.sha256]);
  }
}

/** Revalidate private native task records. This lane claims no authored UI
 * gesture, model-entitlement change, Gallery approval or hardware coverage. */
export async function readPrivateWorkflowQualification({
  backendRoot,
  manifest,
  canonicalHash,
  expectedGraph,
  canonicalReceipt,
  review,
  usagePolicy,
}) {
  const route = routes.get(manifest.id);
  assert.ok(route, `Unreviewed private workflow: ${manifest.id}`);
  assert.equal(review.workflowId, manifest.id);
  assert.equal(review.sourceTemplateId, manifest.sourceTemplateId);
  assert.equal(review.canonicalWorkflowHash, canonicalHash);
  assert.equal(review.scope, route.scope);
  assert.equal(review.preview, 'withheld');
  assert.equal(review.redistributionAuthorized, false);
  assert.deepEqual(review.modelSet.map(({ repoId }) => repoId).sort(), [...new Set(manifest.requiredArtifacts)].sort());
  for (const { revision } of review.modelSet) assert.match(revision, /^[a-f0-9]{40}$/u);
  if (route.policyId) {
    const policy = review.modelSet
      .map(({ repoId }) => usagePolicy(repoId))
      .find((entry) => entry?.id === route.policyId);
    assert.equal(policy?.useScope, route.scope);
    assert.equal(policy.acknowledgementRequired, true);
    assert.ok(
      review.modelSet.some(
        ({ repoId, revision }) => policy.repository === repoId && policy.reviewedRevision === revision,
      ),
    );
  }

  const { sha256, bytes } = review.evidence;
  assert.match(sha256, exactDigest);
  assert.match(review.outputSha256, exactDigest);
  const path = `data/qualification/release/private-workflow-evidence/${sha256}/evidence.json`;
  if (!existsSync(join(backendRoot, path))) return null;
  const descriptor = readCanonicalEvidenceFile(backendRoot, { path, sha256, bytes }, 65536);
  const evidence = parse(descriptor);
  const read = (ref) => readCanonicalEvidenceFile(dirname(descriptor.file), ref);
  assert.equal(evidence.format, 'modiff.private-workflow-execution.v1');
  assert.equal(evidence.workflowId, manifest.id);
  const graph = parse(read(evidence.graph));
  const ack = parse(read(evidence.ack));
  const terminal = parse(read(evidence.terminal));
  const { task, outputs } = parse(read(evidence.run));
  const executedHash = canonicalGraphIdentity(graph).hash;
  assert.equal(executedHash, review.executedGraphHash);
  assert.deepEqual(Object.keys(graph.runtimeHints), ['resourceMode']);
  assert.equal(graph.runtimeHints.resourceMode, 'expert');
  assert.equal(ack.error, false);
  assert.equal(ack.task_id, task.task_id);
  assert.equal(terminal.task_id, task.task_id);
  assert.equal(terminal.type, 'graph_completed');
  assert.equal(task.status, 'completed');
  assert.equal(task.attempt_index, 0);
  assert.equal(graph.sid, task.sid);
  assert.equal(ack.sid, task.sid);
  assert.equal(terminal.sid, task.sid);
  assert.deepEqual(terminal.resourceRetryHistory, []);
  assert.deepEqual(terminal.runtimeFingerprint, task.runtimeFingerprint);
  assert.deepEqual(terminal.runtimeMeasurement, task.runtimeMeasurement);
  assert.match(task.runtimeFingerprint.fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.ok(task.completed_at > task.started_at);
  assert.equal(outputs.length, 1);
  const [output] = outputs;
  assert.equal(output.taskId, task.task_id);
  assert.equal(output.sid, task.sid);
  assert.equal(output.fieldKey, 'preview');
  assert.ok(graph.nodes[output.nodeId]?.params.preview);
  assert.equal(output.resolvedExecutionInputs.source, 'backend-execution');
  assert.equal(output.resolvedExecutionInputs.taskId, task.task_id);
  assert.equal(output.resolvedExecutionInputs.attemptIndex, 0);
  assert.equal(output.resolvedExecutionInputs.truncated, false);
  const resolved = output.resolvedExecutionInputs.nodes;
  checkLoaderBindings(graph, resolved, review, route);
  const snapshots =
    manifest.id === framepack
      ? evidence.downloadRecords.map((ref) => {
          const download = parse(read(ref));
          assert.equal(download.error, false);
          const {
            repo_id: repoId,
            revision: selectedRevision,
            complete,
            repair_required: repairRequired,
          } = download.result;
          return { repoId, selectedRevision, complete, repairRequired };
        })
      : parse(read(evidence.modelFingerprints));
  assert.deepEqual(
    modelKeys(
      snapshots.map(({ repoId, selectedRevision, complete, repairRequired }) => {
        assert.equal(complete, true);
        assert.equal(repairRequired, false);
        return { repoId, revision: selectedRevision };
      }),
    ),
    modelKeys(review.modelSet),
  );
  if (manifest.id === framepack) {
    for (const { ref } of evidence.references) read(ref);
    checkFramePackVariant(graph, resolved, evidence.references, canonicalReceipt, review);
  } else {
    assert.equal(
      executedHash,
      canonicalGraphIdentity(expectedGraph).hash,
      'The private recipe differs from the current export.',
    );
  }
  assert.equal(evidence.media.sha256, review.outputSha256);
  const media = read(evidence.media);
  const item = validateNativeVariantOutput({
    output,
    outputRef: { backendPath: output.backendMediaPath, mediaType: manifest.mediaKind, file: evidence.media },
    task,
    bytes: media.bytes,
    displayType: manifest.mediaKind,
    contentType: route.contentType,
    backendOnly: true,
  });
  const decoded = await decodedMediaHash(media.file, manifest.mediaKind);
  if (manifest.mediaKind === 'audio') {
    assert.ok(decoded.durationSeconds > 25 && decoded.durationSeconds < 35);
    assert.ok(decoded.peakAmplitude > 0.05 && decoded.silenceRatio < 0.75);
    assert.equal(decoded.clippedSampleRatio, 0);
  } else {
    const native = item.mediaMetadata ?? item;
    assert.deepEqual([decoded.width, decoded.height], [native.width, native.height]);
    assert.ok(decoded.width >= 640 && decoded.height >= 640);
    if (manifest.mediaKind === 'video') {
      assert.equal(decoded.frames, native.frame_count);
      assert.equal(decoded.fps, native.fps);
      assert.equal(decoded.codecName, 'h264');
      assert.equal(decoded.hasAudio, false);
      assert.equal(decoded.frames, 109);
      const motion = parse(read(evidence.motion));
      assert.equal(motion.framesDecoded, decoded.frames);
      assert.equal(motion.adjacentFrameMatches, decoded.frames - 1);
      const finish = motion.frameTransformsRelativeToOpening[decoded.frames - 1];
      assert.ok(finish.zoom >= 1.25 && finish.shiftX640 <= -35);
      assert.ok(motion.largestAdjacentZoomDelta < 0.02);
    }
  }
  return {
    scope: review.scope,
    preview: 'withheld',
    modelRevision: modelKeys(review.modelSet).join(' | '),
    graphHash: executedHash,
    outputHash: `sha256:bytes:${review.outputSha256}`,
    evidenceSha256: sha256,
    taskId: task.task_id,
    capturedAt: new Date(task.completed_at * 1000).toISOString(),
    canonicalDefaultsExecuted: manifest.id !== framepack,
    proofKind: 'real_backend_private_workflow',
  };
}
