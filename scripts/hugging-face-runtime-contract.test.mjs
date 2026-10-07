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

test('core Hugging Face runtimes are installed in the backend and discovery never installs packages', () => {
  const packageManifest = JSON.parse(source('package.json'));
  const browserDependencies = {
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.devDependencies ?? {}),
  };
  assert.equal(browserDependencies['@huggingface/transformers'], undefined);
  assert.equal(browserDependencies['@xenova/transformers'], undefined);

  const agentPolicy = source('AGENTS.md');
  assert.match(agentPolicy, /official libraries maintained and published by Hugging Face/);
  assert.match(agentPolicy, /Transformers and PEFT are required backend dependencies/);
  assert.match(agentPolicy, /Browsing templates, discovery, and Auto planning must\s+never install packages/);
  assert.match(agentPolicy, /base runtime without a separate install\/activate flow/);
});

test('optional runtime actions stay generic, explicit, and backend-qualified', () => {
  const contract = source('src/studio/optionalRuntimes.ts');
  const e2eHooks = source('src/utils/e2eHooks.ts');
  const setup = source('src/components/RuntimeOptimizationsCard.tsx');
  const store = source('src/stores/useNodeStore.ts');
  assert.match(store, /\/runtime\/optional-runtimes/);
  assert.match(setup, /\/runtime\/optional-runtimes\/install/);
  assert.match(setup, /\/runtime\/optional-runtimes\/activate/);
  assert.match(setup, /\/runtime\/optional-runtimes\/rollback/);
  assert.match(setup, /consent: true/);
  assert.match(setup, /profile\.installActionAvailable/);
  assert.match(setup, /profile\.activationAvailable/);
  assert.match(setup, /method: 'POST'/);
  assert.doesNotMatch(setup, /\/runtime\/optimizations\/(?:install|activate|rollback|jobs)/);
  assert.doesNotMatch(`${contract}\n${setup}`, /Qwen|Flux|Wan|ZImage|AceStep/);
  assert.match(setup, /contractState/);
  assert.match(e2eHooks, /if \(!validation\.canRun\) \{/);
  assert.doesNotMatch(e2eHooks, /e2eOptionalRuntime(?:OverlayIsActive|IsSatisfied)/);
});

test('frontend workflow generation has no library-specific model driver', async () => {
  const controlledWorkflows = source('src/studio/controlledWorkflows.ts');
  const controlledContracts = source('src/studio/controlledWorkflowContracts.ts');
  const operationWorkflows = source('src/studio/templateOperationWorkflow.ts');
  assert.match(controlledContracts, /qualityVideoShots: 'modules\.WorkflowControl\.AuthorShotList'/);
  assert.match(controlledWorkflows, /loraWorkflowFieldValues\(adapter, index\)/);
  assert.match(operationWorkflows, /loraWorkflowFieldValues\(adapter, index\)/);

  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  try {
    const { loraWorkflowFieldValues } = await server.ssrLoadModule('/src/studio/controlledWorkflowValues.ts');
    const model = { source: 'hub', value: 'owner/adapter', revision: 'a'.repeat(40), sha256: 'b'.repeat(64) };
    const fields = (adapter) =>
      Object.fromEntries(loraWorkflowFieldValues({ model: adapter }, 0).map(({ fields, value }) => [fields[0], value]));
    const pinned = fields(model);
    assert.equal(pinned.revision, model.revision);
    assert.equal(pinned.expected_sha256, model.sha256);
    const unpinned = fields({ source: 'hub', value: 'owner/replacement' });
    assert.equal(unpinned.revision, '', 'replacement must clear the previous immutable revision');
    assert.equal(unpinned.expected_sha256, '', 'replacement must clear the previous content digest');
  } finally {
    await server.close();
  }

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
