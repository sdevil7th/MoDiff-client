import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function source(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function managedPolicyKeys(contents, role, nextRole) {
  const match = new RegExp(`\\n  ${role}: \\{([\\s\\S]*?)\\n  ${nextRole}:`).exec(contents);
  assert.ok(match, `Managed-control policy block is missing: ${role}`);
  return [...match[1].matchAll(/^    ([a-z0-9_]+):/gm)].map((entry) => entry[1]);
}

test('compatibility UI keeps local actions and has no hosted inference path', () => {
  const compatibilityPanel = source('src/components/CompatibilityPanel.tsx');

  assert.match(compatibilityPanel, /installHfModel\(repo, sid,/);
  assert.match(compatibilityPanel, />\s*Open setup\s*</);
  assert.match(compatibilityPanel, />\s*Create optimized copy\s*</);
  assert.doesNotMatch(compatibilityPanel, /\/inference\//);
  assert.doesNotMatch(compatibilityPanel, /RemoteProvider|Run remotely|remote-inference-consent/);

  const websocketHandler = source('src/stores/websocketMessageHandler.ts');
  assert.doesNotMatch(websocketHandler, /Hugging Face remote inference/);
});

test('frontend catalogs and workflow generation expose no direct Transformers model driver', () => {
  const controlledWorkflows = source('src/studio/controlledWorkflows.ts');
  assert.match(controlledWorkflows, /qualityVideoShots: 'modules\.WorkflowControl\.AuthorShotList'/);

  for (const path of [
    'src/studio/controlledWorkflows.ts',
    'src/studio/modelSelection.ts',
    'src/studio/nodeCatalog.ts',
    'scripts/workflow-library-generator.mjs',
  ]) {
    const contents = source(path);
    assert.doesNotMatch(contents, /TransformersMultimodal|DiffusionGemma|diffusion-gemma/, path);
  }
});

test('gallery input tooling has no direct Transformers depth-estimation command', () => {
  const inputTool = source('scripts/template-gallery-input-tools.py');
  assert.doesNotMatch(inputTool, /depth-control-image|AutoModelForDepthEstimation|AutoImageProcessor/);
  assert.doesNotMatch(inputTool, /\bfrom transformers\b|\bimport transformers\b/);
});

test('quality-video loop policy keys match the published WorkflowControl v1 schemas', () => {
  const policy = source('src/studio/managedControlPolicy.ts');

  assert.deepEqual(managedPolicyKeys(policy, 'qualityVideoLoopItems', 'qualityVideoGenerate'), [
    'collection',
    'item_index',
    'item',
    'index',
    'count',
  ]);
  assert.deepEqual(managedPolicyKeys(policy, 'qualityVideoLoopResult', 'qualityVideoJoin'), [
    'value_input',
    'stop_input',
    'value',
    'collection',
    'stopped',
  ]);
});
