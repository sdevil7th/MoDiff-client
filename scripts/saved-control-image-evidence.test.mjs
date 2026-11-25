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
  ['linux-sdxl-pag-cabin-verified', 'StableDiffusionXLPAGPipeline:control_image', 'ControlNetModel', 'MVsWymJP8z5O'],
  ['linux-canny-adapter-fixed', 'StableDiffusionXLAdapterPipeline:control_image', 'T2IAdapter', 'gWs5V9Dz1NY-'],
  ['windows-sd15-control-print', 'StableDiffusionPipeline:control_edit_image', 'ControlNetModel', 'jlVMYFMnS--d'],
  ['windows-sd15-control-inpaint-fixed', 'StableDiffusionPipeline:control_inpaint', 'ControlNetModel', '6TOEAhgF-bhi'],
  [
    'windows-sd15-pag-control-inpaint-fixed',
    'StableDiffusionPAGPipeline:control_inpaint',
    'ControlNetModel',
    'Hujzhp32JY-C',
  ],
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
    assert.equal((receipt.guideBinding ?? receipt.inputBinding).sha256, evidence.inputs[0].file.sha256);
    const read = (ref) => JSON.parse(readCanonicalEvidenceFile(dirname(evidencePath), ref).bytes);
    const graph = read(evidence.graphRequest);
    const { latestOutput: output } = read(evidence.outputPackage);
    const inputs = evidence.inputs;
    const [input] = inputs;
    const sampler = (api) =>
      Object.values(api.nodes).find(({ action }) =>
        ['ControlGenerate', 'ControlEdit', 'ControlInpaint'].includes(action),
      );
    const disconnected = structuredClone(graph);
    sampler(disconnected).params.control_image.sourceKey = 'width';
    assert.throws(() => verifySavedControlImageInputs(disconnected, output, inputs, workflowId), assert.AssertionError);

    const changedGuide = { ...input, file: { ...input.file, sha256: '0'.repeat(64) } };
    assert.throws(
      () => verifySavedControlImageInputs(graph, output, [changedGuide, ...inputs.slice(1)], workflowId),
      assert.AssertionError,
    );

    const changedSettings = structuredClone(output);
    const action = sampler(graph).action;
    const fields = changedSettings.resolvedExecutionInputs.nodes.find((row) => row.action === action).fields;
    const guidance = fields.true_cfg_scale ?? fields.guidance_scale;
    guidance.value += 1;
    assert.throws(
      () => verifySavedControlImageInputs(graph, changedSettings, inputs, workflowId),
      /Saved control sampler fields differ/u,
    );
    if (inputs.length > 1) {
      const [guide, source, ...other] = inputs;
      assert.equal(receipt.inputBinding.sha256, source.file.sha256);
      assert.throws(
        () => verifySavedControlImageInputs(graph, output, [source, guide, ...other], workflowId),
        /Saved image bytes differ for guide/u,
      );
    }
    if (inputs.length === 3) {
      assert.equal(receipt.maskBinding.sha256, inputs[2].file.sha256);
      assert.equal(receipt.maskBinding.decodedImage.mode, 'L');
    }

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
