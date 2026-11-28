import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCanonicalEvidenceFile, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';
import { verifyFirstLastFields } from './wan-first-last-evidence.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '../MoDiff'));
const fixture = process.env.MODIFF_WAN_FIRST_LAST_EVIDENCE;
const workflowId = 'WanImage2VideoModularPipeline:image_to_video';

test(
  'the corrected Wan save retains both frame roles and the original encoder and sampler settings',
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
    assert.equal(receipt.decodedOutput.frames, 81);
    assert.equal(receipt.decodedOutput.fps, 24);
    assert.equal(receipt.observationLimits.independentEncoderPixelSnapshots, false);
    const read = (reference) => JSON.parse(readCanonicalEvidenceFile(dirname(fixture), reference).bytes);
    const graph = read(evidence.graphRequest);
    const output = read(evidence.outputPackage).latestOutput;
    const [first, last] = evidence.inputs;
    const geometry = { width: receipt.decodedOutput.width, height: receipt.decodedOutput.height };
    const inputs = { first: { ...first, geometry }, last: { ...last, geometry } };
    verifyFirstLastFields(output, graph, inputs);
    const exchanged = structuredClone(output);
    const loads = exchanged.resolvedExecutionInputs.nodes.filter((node) => node.action === 'Load');
    [loads[0].fields.source_hashes, loads[1].fields.source_hashes] = [
      loads[1].fields.source_hashes,
      loads[0].fields.source_hashes,
    ];
    assert.throws(() => verifyFirstLastFields(exchanged, graph, inputs), /Observed first frame differs/u);
    const rewired = structuredClone(graph);
    const encoder = Object.values(rewired.nodes).find((node) => node.action === 'ImageEncode');
    encoder.params.last_image.sourceId = receipt.inputBinding.nodeId;
    assert.throws(() => verifyFirstLastFields(output, rewired, inputs), /sourceId/u);
  },
);
