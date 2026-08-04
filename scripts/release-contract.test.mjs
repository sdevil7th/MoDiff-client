import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonicalJsonHash } from './canonical-json.mjs';
import {
  assessHistoricalEvidence,
  canonicalWorkflowContract,
  findCanonicalWorkflowRecord,
} from './release-contract-core.mjs';

function graphHash(graph) {
  return canonicalJsonHash(graph);
}

test('canonical workflow identity comes from current graph bytes and historical evidence must match it', () => {
  const graph = {
    nodes: [
      { data: { module: 'modules.DiffusersImage', action: 'LoadPipeline' } },
      { data: { module: 'modules.DiffusersImage', action: 'Generate' } },
    ],
    edges: [],
  };
  const manifest = { id: 'Current:text_to_image', graphHash: graphHash(graph) };
  const current = canonicalWorkflowContract(manifest, graph);
  const registry = new Set(current.backendNodes);
  assert.equal(current.graphHash, `sha256:workflow-graph-v1:${manifest.graphHash}`);
  assert.deepEqual(current.backendNodes, ['modules.DiffusersImage.Generate', 'modules.DiffusersImage.LoadPipeline']);
  assert.equal(
    assessHistoricalEvidence(
      { canonicalWorkflowHash: current.graphHash, backendNodes: current.backendNodes },
      current,
      registry,
    ).matches,
    true,
  );
  const stale = assessHistoricalEvidence(
    {
      canonicalWorkflowHash: 'sha256:workflow-graph-v1:stale',
      backendNodes: ['modules.QwenImage.Generate'],
    },
    current,
    registry,
  );
  assert.equal(stale.matches, false);
  assert.deepEqual(stale.reasons, [
    'canonical_workflow_hash_mismatch',
    'canonical_workflow_node_contract_mismatch',
    'historical_backend_nodes_missing',
  ]);
  assert.throws(
    () => canonicalWorkflowContract({ ...manifest, graphHash: 'stale' }, graph),
    /graph hash does not match its manifest/,
  );
});

test('canonical workflow identity is insensitive to object-key order', () => {
  const graph = {
    nodes: [{ data: { module: 'modules.DiffusersImage', action: 'Generate' }, id: 'generate' }],
    edges: [],
  };
  const reorderedGraph = {
    edges: [],
    nodes: [{ id: 'generate', data: { action: 'Generate', module: 'modules.DiffusersImage' } }],
  };
  const manifest = { id: 'Current:text_to_image', graphHash: graphHash(graph) };
  assert.equal(
    canonicalWorkflowContract(manifest, reorderedGraph).graphHash,
    `sha256:workflow-graph-v1:${manifest.graphHash}`,
  );
});

test('base workflow lookup cannot be replaced by a later same-mode variant', () => {
  const base = { manifest: { id: 'Model:text_to_image', modelType: 'Model', mode: 'text_to_image' } };
  const variant = {
    manifest: {
      id: 'Model:text_to_image:variant',
      modelType: 'Model',
      mode: 'text_to_image',
      sourceTemplateId: 'variant-template',
    },
  };
  assert.equal(
    findCanonicalWorkflowRecord([base, variant], {
      id: 'base-template',
      modelType: 'Model',
      mode: 'text_to_image',
    }),
    base,
  );
  assert.equal(
    findCanonicalWorkflowRecord([base, variant], {
      id: 'variant-template',
      modelType: 'Model',
      mode: 'text_to_image',
    }),
    variant,
  );
});

test('legacy Qwen evidence cannot restore a deleted backend driver into a current modular contract', () => {
  const staleCases = [
    'high_quality',
    'qwen_low_vram_poster_layout',
    'qwen_low_vram_product_concept',
    'qwen_low_vram_text_rendering',
    'qwen_outpaint_aspect_template',
    'qwen_outpaint_draft',
    'qwen_poster_logo_text',
    'qwen_product_mockup',
    'qwen_text_rendering',
  ];
  const outpaint = new Set(['qwen_outpaint_aspect_template', 'qwen_outpaint_draft']);
  for (const templateId of staleCases) {
    const mode = outpaint.has(templateId) ? 'outpaint' : 'text_to_image';
    const modelType = outpaint.has(templateId) ? 'QwenImageEditModularPipeline' : 'QwenImageModularPipeline';
    const currentBackendNodes = outpaint.has(templateId)
      ? [
          'modules.DiffusersImage.Inpaint',
          'modules.DiffusersImage.LoadPipeline',
          'modules.DiffusersImage.OutpaintCanvas',
          'modules.Image.Load',
          'modules.Image.Preview',
        ]
      : ['modules.DiffusersImage.Generate', 'modules.DiffusersImage.LoadPipeline', 'modules.Image.Preview'];
    const graph = {
      nodes: currentBackendNodes.map((nodeKey, index) => {
        const separator = nodeKey.lastIndexOf('.');
        return {
          id: `node-${index}`,
          data: { module: nodeKey.slice(0, separator), action: nodeKey.slice(separator + 1) },
        };
      }),
      edges: [],
    };
    const manifest = {
      id: `${modelType}:${mode}:${templateId}`,
      modelType,
      mode,
      sourceTemplateId: templateId,
      graphHash: graphHash(graph),
    };
    const workflowRecords = [{ manifest, graph, contract: canonicalWorkflowContract(manifest, graph) }];
    const workflow = findCanonicalWorkflowRecord(workflowRecords, { id: templateId, mode, modelType });
    assert.ok(workflow, `${templateId} must resolve a canonical workflow`);
    assert.equal(
      workflow.contract.backendNodes.some((nodeKey) => nodeKey.startsWith('modules.QwenImage.')),
      false,
    );
    assert.equal(
      workflow.contract.backendNodes.every((nodeKey) => new Set(currentBackendNodes).has(nodeKey)),
      true,
    );
    const legacyBackendNodes = outpaint.has(templateId)
      ? [
          'modules.Image.Load',
          'modules.Image.Preview',
          'modules.QwenImage.Inpaint',
          'modules.QwenImage.LoadInpaintPipeline',
          'modules.QwenImage.OutpaintCanvas',
        ]
      : ['modules.Image.Preview', 'modules.QwenImage.Generate', 'modules.QwenImage.LoadPipeline'];
    const assessment = assessHistoricalEvidence(
      { graphHash: `sha256:canonical-graph-v1:${templateId}`, backendNodes: legacyBackendNodes },
      workflow.contract,
      new Set(currentBackendNodes),
    );
    assert.equal(assessment.matches, false, `${templateId} legacy evidence must be stale`);
    assert.ok(assessment.reasons.includes('canonical_workflow_node_contract_mismatch'));
    assert.ok(assessment.reasons.includes('historical_backend_nodes_missing'));
    assert.ok(assessment.missingBackendNodes.some((nodeKey) => nodeKey.startsWith('modules.QwenImage.')));
  }
});
