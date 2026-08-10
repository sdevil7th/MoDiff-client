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

test('official Hugging Face runtimes remain backend-only and explicitly optional', () => {
  const packageManifest = JSON.parse(source('package.json'));
  const browserDependencies = {
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.devDependencies ?? {}),
  };
  assert.equal(browserDependencies['@huggingface/transformers'], undefined);
  assert.equal(browserDependencies['@xenova/transformers'], undefined);

  const agentPolicy = source('AGENTS.md');
  assert.match(agentPolicy, /official libraries maintained and published by Hugging Face/);
  assert.match(agentPolicy, /Transformers is an optional backend runtime/);
  assert.match(agentPolicy, /Browsing or opening a\s+template[\s\S]*must never install it/);
});

test('optional runtime status stays generic and has no mutation transport', () => {
  const contract = source('src/studio/optionalRuntimes.ts');
  const setup = source('src/components/RuntimeOptimizationsCard.tsx');
  const store = source('src/stores/useNodeStore.ts');
  assert.match(store, /\/runtime\/optional-runtimes/);
  assert.doesNotMatch(`${contract}\n${setup}\n${store}`, /\/runtime\/optional-runtimes\/(?:install|activate|rollback)/);
  assert.doesNotMatch(setup, /\/runtime\/optimizations\/(?:install|activate|rollback|jobs)/);
  assert.doesNotMatch(`${contract}\n${setup}`, /Qwen|Flux|Wan|ZImage|AceStep/);
  assert.match(setup, /contractState/);
});

test('frontend workflow generation has no library-specific model driver', () => {
  const controlledWorkflows = source('src/studio/controlledWorkflows.ts');
  assert.match(controlledWorkflows, /qualityVideoShots: 'modules\.WorkflowControl\.AuthorShotList'/);
  assert.match(
    controlledWorkflows,
    /setParamIfPresent\(nodeId, \['revision'\], adapter\.model\.revision \?\? ''\)/,
    'generic adapter graph construction must forward and clear the backend-owned immutable revision field',
  );
  assert.match(
    controlledWorkflows,
    /setParamIfPresent\(nodeId, \['expected_sha256'\], adapter\.model\.sha256 \?\? ''\)/,
    'generic adapter graph construction must forward and clear the backend-owned content digest field',
  );

  for (const path of [
    'src/studio/controlledWorkflows.ts',
    'src/studio/modelSelection.ts',
    'src/studio/nodeCatalog.ts',
    'scripts/workflow-library-generator.mjs',
  ]) {
    const contents = source(path);
    assert.doesNotMatch(contents, /TransformersMultimodal/, path);
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
