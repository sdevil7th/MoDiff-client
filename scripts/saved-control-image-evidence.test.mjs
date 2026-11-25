import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyConditioningModels } from './control-inpaint-evidence.mjs';
import { selectBackendRuntimeFingerprintEvidence } from './live-proof-provenance.mjs';
import { readCanonicalEvidenceFile, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';
import { verifySavedControlImageInputs } from './saved-control-image-evidence.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '../MoDiff'));
const root = process.env.MODIFF_SAVED_CONTROL_EVIDENCE_DIR;
const cases = [
  ['linux-sd15-control-fixed', 'StableDiffusionPipeline:control_image', 'ControlNetModel', 'qa0wL-hE_WwQ'],
  [
    'linux-hunyuan-control-rgb',
    'HunyuanDiTControlNetPipeline:control_image',
    'HunyuanDiT2DControlNetModel',
    '9FZlS44JVBae',
  ],
  ['linux-qwen-control-cabin', 'QwenImageControlNetPipeline:control_image', 'QwenImageControlNetModel', 'G2OjPY6F4u5L'],
  ['linux-sd15-pag-control-fixed', 'StableDiffusionPAGPipeline:control_image', 'ControlNetModel', 'npMHx5LR2lWq'],
  [
    'linux-sdxl-controlnet-checked',
    'StableDiffusionXLControlNetPipeline:control_image',
    'ControlNetModel',
    'UlftQtP0nIJk',
  ],
  ['linux-canny-adapter-fixed', 'StableDiffusionXLAdapterPipeline:control_image', 'T2IAdapter', 'gWs5V9Dz1NY-'],
];

for (const [slug, workflowId, componentClass, taskId] of cases) {
  test('recovers the historical guide and verified sampler for ' + workflowId, { skip: !root }, async () => {
    const evidencePath = resolve(root, slug, 'exact-native-evidence.json');
    const { receipt, evidence } = await readCanonicalWorkflowEvidence({
      clientRoot,
      backendRoot,
      workflowId,
      evidencePath,
    });
    assert.equal(receipt.proofKind, 'real_backend_input_bound_model_variant');
    assert.equal(receipt.taskId, taskId);
    assert.equal(receipt.observationLimits.processedControlPixelsObserved, false);
    assert.equal(receipt.qualificationClaims.rightsApproved, false);
    assert.equal(receipt.inputBinding.sha256, evidence.inputs[0].file.sha256);
    const read = (ref) => JSON.parse(readCanonicalEvidenceFile(dirname(evidencePath), ref).bytes);
    const graph = read(evidence.graphRequest);
    const { latestOutput: output } = read(evidence.outputPackage);
    const [input] = evidence.inputs;
    const sampler = (api) => Object.values(api.nodes).find(({ action }) => action === 'ControlGenerate');
    const disconnected = structuredClone(graph);
    sampler(disconnected).params.control_image.sourceKey = 'width';
    assert.throws(() => verifySavedControlImageInputs(disconnected, output, input, workflowId), assert.AssertionError);

    const changedGuide = { ...input, file: { ...input.file, sha256: '0'.repeat(64) } };
    assert.throws(() => verifySavedControlImageInputs(graph, output, changedGuide, workflowId), assert.AssertionError);

    const changedSettings = structuredClone(output);
    const fields = changedSettings.resolvedExecutionInputs.nodes.find(
      ({ action }) => action === 'ControlGenerate',
    ).fields;
    const guidance = fields.true_cfg_scale ?? fields.guidance_scale;
    guidance.value += 1;
    assert.throws(
      () => verifySavedControlImageInputs(graph, changedSettings, input, workflowId),
      /Saved control sampler fields differ/u,
    );

    const completed = read(evidence.graphCompleted);
    completed.runtimeHints.controlledArtifacts[0].componentClass = 'OtherComponent';
    const loader = Object.values(graph.nodes).find(({ action }) => action === 'LoadPipeline').params;
    assert.throws(
      () =>
        verifyConditioningModels({
          loader,
          target: receipt,
          pipelineClass: loader.pipeline_class.value,
          componentClass,
          conditioningKind: loader.conditioning_kind.value,
          componentParameter: componentClass === 'T2IAdapter' ? 'adapter' : 'controlnet',
          completed,
          hints: output.apiGraphSnapshot.runtimeHints,
          runtime: selectBackendRuntimeFingerprintEvidence([read(evidence.runDetail).task.runtimeFingerprint]),
          observations: evidence.modelObservations.map(read),
        }),
      /OtherComponent/u,
    );
  });
}
