import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readCanonicalEvidenceFile, readCanonicalWorkflowEvidence } from './release-contract-core.mjs';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const backendRoot = resolve(process.env.MODIFF_BACKEND_DIR ?? join(clientRoot, '../MoDiff'));
const fixture = process.env.MODIFF_LAYER_DECOMPOSITION_EVIDENCE;
const workflowId = 'QwenImageLayeredPipeline:layer_decomposition';

test(
  'the retained layer run binds the exact source, generation controls and ordered layer stack',
  { skip: !fixture },
  async () => {
    const args = { clientRoot, backendRoot, workflowId, evidencePath: resolve(fixture) };
    const verified = await readCanonicalWorkflowEvidence(args);
    assert.equal(verified.receipt.proofKind, 'real_backend_input_bound_model_variant');
    assert.equal(verified.receipt.observationLimits.orderedLayerStack, true);
    assert.equal(verified.receipt.decodedOutput.items.length, 4);
    assert.equal(new Set(verified.receipt.decodedOutput.items.map((item) => item.encodedSha256)).size, 4);
    const staging = mkdtempSync(join(tmpdir(), 'modiff-layer-evidence-'));
    try {
      for (const ref of verified.retainedFiles) {
        assert.match(ref.path, /^[a-z0-9._-]+$/iu);
        writeFileSync(join(staging, ref.path), readCanonicalEvidenceFile(dirname(fixture), ref).bytes);
      }
      const changedPath = join(staging, 'changed.json');
      for (const [action, mutate, message] of [
        [
          'LayerDecompose',
          (media) => {
            media.controls.cfg_normalize = !media.controls.cfg_normalize;
          },
          /Layer adapter controls differ/u,
        ],
        [
          'Preview',
          (media) => {
            media.inputs.image.reverse();
          },
          /Layer order changed before export/u,
        ],
      ]) {
        const descriptor = structuredClone(verified.evidence);
        const read = (ref) => JSON.parse(readFileSync(join(dirname(fixture), ref.path)));
        const output = read(descriptor.outputPackage);
        const run = read(descriptor.runDetail);
        const fields = output.latestOutput.resolvedExecutionInputs;
        mutate(fields.nodes.find((node) => node.action === action).mediaEvidence);
        run.outputs[0].resolvedExecutionInputs = fields;
        for (const [key, value] of [
          ['outputPackage', output],
          ['runDetail', run],
        ]) {
          const ref = descriptor[key];
          const bytes = Buffer.from(JSON.stringify(value));
          ref.sha256 = createHash('sha256').update(bytes).digest('hex');
          ref.bytes = bytes.length;
          writeFileSync(join(staging, ref.path), bytes);
        }
        writeFileSync(changedPath, JSON.stringify(descriptor));
        await assert.rejects(() => readCanonicalWorkflowEvidence({ ...args, evidencePath: changedPath }), message);
      }
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  },
);
