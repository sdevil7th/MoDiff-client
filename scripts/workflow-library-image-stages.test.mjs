import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { verifyCanonicalImagePipelineStages } from './workflow-library-contract.mjs';

const backend = path.resolve(process.env.MODIFF_BACKEND_DIR || '../MoDiff');
const manifest = JSON.parse(readFileSync(path.join(backend, 'data/workflow-library-manifest.json'), 'utf8'));
const selected = new Set([
  'FluxCannyPipeline:control_image',
  'FluxDepthPipeline:control_image',
  'FluxFillPipeline:inpaint',
  'FluxFillPipeline:outpaint',
  'FluxReduxPipeline:edit_image',
  'FluxReduxPipeline:multi_image_reference_edit',
]);
const rows = manifest.workflows.filter((row) => selected.has(row.id));
assert.equal(rows.length, 6);
let server, contracts;

before(async () => {
  server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  contracts = {
    ...(await server.ssrLoadModule('/src/workflow/imagePipelineStageContracts.ts')),
    ...(await server.ssrLoadModule('/src/workflow/operationContracts.ts')),
  };
});
after(async () => server?.close());

function graphFor(row) {
  return JSON.parse(readFileSync(path.join(backend, 'data/graphs', row.graphPath), 'utf8'));
}

function stageNodes(graph) {
  return Object.fromEntries(
    graph.nodes.filter((node) => node.data.module === 'modules.DiffusersImage').map((node) => [node.data.action, node]),
  );
}

/** A local mutation fixture supplies the complete required route solely to
 * exercise refusal controls. It is never written back as a canonical graph. */
function completeMutationFixture(graph) {
  const result = structuredClone(graph);
  const nodes = stageNodes(result);
  for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents']) {
    if (
      !result.edges.some(
        (edge) =>
          edge.source === nodes.LoadPipeline.id &&
          edge.sourceHandle === 'pipeline' &&
          edge.target === nodes[action].id &&
          edge.targetHandle === 'pipeline',
      )
    )
      result.edges.push({
        id: `fixture-owner-${action}`,
        source: nodes.LoadPipeline.id,
        sourceHandle: 'pipeline',
        target: nodes[action].id,
        targetHandle: 'pipeline',
      });
  }
  return result;
}

for (const row of rows) {
  test(`current canonical ${row.id} preserves all required owned image-stage links`, () => {
    const graph = graphFor(row);
    assert.doesNotThrow(() => verifyCanonicalImagePipelineStages(row, graph, contracts));
  });

  test(`${row.id} stage verifier accepts complete local topology and rejects omitted, foreign and duplicate suppliers`, () => {
    const graph = completeMutationFixture(graphFor(row));
    const pristine = structuredClone(graph);
    const nodes = stageNodes(graph);
    assert.doesNotThrow(() => verifyCanonicalImagePipelineStages(row, graph, contracts));
    assert.deepEqual(graph, pristine, 'Verification does not modify authoring or persisted graph data.');
    const required = [
      ...['EncodeInputs', 'Denoise', 'DecodeLatents'].map((action) => [
        nodes.LoadPipeline.id,
        'pipeline',
        nodes[action].id,
        'pipeline',
      ]),
      [nodes.EncodeInputs.id, 'encoded_inputs', nodes.Denoise.id, 'encoded_inputs'],
      [nodes.Denoise.id, 'latents_out', nodes.DecodeLatents.id, 'latents'],
      [nodes.Denoise.id, 'latent_binding', nodes.DecodeLatents.id, 'latent_binding'],
      [nodes.Denoise.id, 'width_out', nodes.DecodeLatents.id, 'width'],
      [nodes.Denoise.id, 'height_out', nodes.DecodeLatents.id, 'height'],
    ];
    for (const expected of required) {
      const index = graph.edges.findIndex(
        (edge) =>
          edge.source === expected[0] &&
          edge.sourceHandle === expected[1] &&
          edge.target === expected[2] &&
          edge.targetHandle === expected[3],
      );
      assert.ok(index >= 0);
      const missing = structuredClone(graph);
      missing.edges.splice(index, 1);
      assert.throws(
        () => verifyCanonicalImagePipelineStages(row, missing, contracts),
        /owned image pipeline stage route/,
      );
      const duplicate = structuredClone(graph);
      duplicate.edges.push({ ...duplicate.edges[index], id: `duplicate-${index}` });
      assert.throws(
        () => verifyCanonicalImagePipelineStages(row, duplicate, contracts),
        /owned image pipeline stage route/,
      );
    }
    const undeclared = structuredClone(graph);
    for (const node of Object.values(stageNodes(undeclared))) delete node.data.operationAuthoring;
    assert.throws(
      () => verifyCanonicalImagePipelineStages(row, undeclared, contracts),
      /owned image pipeline stage route/,
    );
    for (const action of ['EncodeInputs', 'Denoise', 'DecodeLatents']) {
      const missingDeclaration = structuredClone(graph);
      delete stageNodes(missingDeclaration)[action].data.operationAuthoring;
      assert.throws(
        () => verifyCanonicalImagePipelineStages(row, missingDeclaration, contracts),
        /owned image pipeline stage route/,
      );
      const forgedDeclaration = structuredClone(graph);
      stageNodes(forgedDeclaration)[action].data.operationAuthoring.operation.nodeKey =
        'modules.DiffusersImage.Generate';
      assert.throws(
        () => verifyCanonicalImagePipelineStages(row, forgedDeclaration, contracts),
        /owned image pipeline stage route/,
      );
      for (const field of ['module', 'action']) {
        const wrongExecutable = structuredClone(graph);
        stageNodes(wrongExecutable)[action].data[field] = field === 'module' ? 'modules.ForeignImage' : 'Generate';
        assert.throws(
          () => verifyCanonicalImagePipelineStages(row, wrongExecutable, contracts),
          /owned image pipeline stage route/,
        );
      }
    }
    const wrongTask = structuredClone(graph);
    for (const node of Object.values(stageNodes(wrongTask)))
      node.data.operationAuthoring.operation.task = 'foreign_task';
    assert.throws(
      () => verifyCanonicalImagePipelineStages(row, wrongTask, contracts),
      /owned image pipeline stage route/,
    );
    const foreign = structuredClone(graph);
    const another = structuredClone(nodes.LoadPipeline);
    another.id = 'foreign-loader';
    foreign.nodes.push(another);
    foreign.edges.find((edge) => edge.target === nodes.EncodeInputs.id && edge.targetHandle === 'pipeline').source =
      another.id;
    assert.throws(
      () => verifyCanonicalImagePipelineStages(row, foreign, contracts),
      /owned image pipeline stage route/,
    );
    const foreignScope = structuredClone(graph);
    stageNodes(foreignScope).DecodeLatents.data.operationAuthoring.operation.pipelineClass = 'ForeignPipeline';
    assert.throws(
      () => verifyCanonicalImagePipelineStages(row, foreignScope, contracts),
      /owned image pipeline stage route/,
    );
  });
}

test('unrelated current canonical image, audio and video routes retain ordinary verifier behavior', () => {
  for (const row of manifest.workflows.filter((item) => !selected.has(item.id)))
    assert.doesNotThrow(() => verifyCanonicalImagePipelineStages(row, graphFor(row), contracts));
});
