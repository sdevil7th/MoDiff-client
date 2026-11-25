import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyControlInpaintMedia } from './control-inpaint-evidence.mjs';
import { readCanonicalEvidenceFile, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '../MoDiff'));
const fixture = process.env.MODIFF_CONTROL_INPAINT_EVIDENCE;
const workflowId = 'StableDiffusionXLControlNetPipeline:control_inpaint';

test(
  'the retained controlled inpaint binds the three distinct image roles and the actual edge map',
  {
    skip: !fixture,
  },
  async () => {
    const { receipt, evidence } = await readCanonicalWorkflowEvidence({
      clientRoot,
      backendRoot,
      workflowId,
      evidencePath: resolve(fixture),
    });
    assert.equal(receipt.proofKind, 'real_backend_input_bound_model_variant');
    assert.equal(receipt.observationLimits.nativeCannyAndComposite, true);
    const inputHashes = [receipt.inputBinding, receipt.maskBinding, receipt.guideBinding].map((input) => input.sha256);
    assert.equal(new Set(inputHashes).size, 3);
    assert.equal(receipt.modelSet.length, 2);
    assert.equal(receipt.conditioningModel.repoId, 'diffusers/controlnet-canny-sdxl-1.0');
    const read = (reference) => JSON.parse(readCanonicalEvidenceFile(dirname(fixture), reference).bytes);
    const graph = read(evidence.graphRequest);
    const output = read(evidence.outputPackage).latestOutput;
    const changed = structuredClone(output);
    const row = (value, action) => value.resolvedExecutionInputs.nodes.find((item) => item.action === action);
    const sampler = row(changed, 'ControlInpaint');
    sampler.mediaEvidence.inputs.control_image = sampler.mediaEvidence.inputs.image;
    assert.throws(() => verifyControlInpaintMedia(graph, changed, evidence.inputs), /did not consume the selected/u);

    const changedPreview = structuredClone(output);
    row(changedPreview, 'Preview').mediaEvidence.inputs.image = row(
      changedPreview,
      'Canny',
    ).mediaEvidence.outputs.output;
    assert.throws(
      () => verifyControlInpaintMedia(graph, changedPreview, evidence.inputs),
      /Preview received a different image/u,
    );

    const changedSettings = structuredClone(output);
    row(changedSettings, 'ControlInpaint').fields.conditioning_scale.value = 0;
    assert.throws(() => verifyControlInpaintMedia(graph, changedSettings, evidence.inputs), /conditioning_scale/u);
  },
);
