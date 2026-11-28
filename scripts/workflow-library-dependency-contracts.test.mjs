import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { before, test } from 'node:test';
import {
  canonicalWorkflowRequiredArtifacts,
  hasMachineSpecificWorkflowState,
  workflowVideoAttentionRecipeError,
} from './workflow-library-contract.mjs';

test('portable video attention accepts Auto without claiming Flash availability', () => {
  const recipe = (backend, components) => ({
    attention_backend: { value: backend },
    attention_components: { value: components },
  });
  for (const pipeline of ['WanPipeline', 'Wan22Pipeline', 'WanTI2VPipeline']) {
    assert.equal(workflowVideoAttentionRecipeError(pipeline, recipe('auto', '')), null);
    assert.equal(workflowVideoAttentionRecipeError(pipeline, recipe('_native_flash', 'transformer')), null);
    assert.match(workflowVideoAttentionRecipeError(pipeline, recipe('_native_flash', '')), /transformer/);
    assert.match(workflowVideoAttentionRecipeError(pipeline, recipe('arbitrary_backend', 'transformer')), /attention/);
    assert.match(workflowVideoAttentionRecipeError(pipeline, {}), /attention/);
  }
});

test('portable workflow provenance links are not Windows drive paths', () => {
  for (const link of [
    'https://huggingface.co/black-forest-labs/FLUX.2-klein-4B',
    'https://huggingface.co/black-forest-labs/FLUX.1-schnell',
    'https://huggingface.co/Tongyi-MAI/Z-Image-Turbo',
    'http://example.org/model-guidance',
  ])
    assert.equal(hasMachineSpecificWorkflowState(JSON.stringify({ exampleSource: link })), false, link);
  for (const reference of [
    'C:/Users/operator/model',
    'D:\\weights\\model',
    'file:///weights/model',
    '/home/operator/model',
    '/Users/operator/model',
    '/tmp/model',
    '/mnt/models',
    '\\\\server\\models',
    'https://localhost/model',
    'http://127.0.0.1:8088/model',
    'path /cache/models',
    'model path: E:/weights/model',
  ])
    assert.equal(hasMachineSpecificWorkflowState(JSON.stringify({ value: reference })), true, reference);
});

const hub = (repository) => ({ value: { source: 'hub', value: repository } });
const graph = (repositories) => ({
  nodes: repositories.map((repository) => ({ data: { params: { model: hub(repository) } } })),
});
let capabilities;

before(() => {
  assert.ok(process.env.MODIFF_BACKEND_PYTHON, 'Use the declared ordinary native CPU schema-fixture environment.');
  const fixture = JSON.parse(
    execFileSync(process.env.MODIFF_BACKEND_PYTHON, [path.resolve('scripts/template-operation-fixtures.py')], {
      cwd: path.resolve('../MoDiff'),
      encoding: 'utf8',
      input: '[]',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    }),
  );
  capabilities = fixture.capabilities;
});

test('visible owner and adapter artifacts retain their order and suppress a same-family default fallback', () => {
  const input = graph(['publisher/selected-model', 'publisher/adapter', 'publisher/selected-model']);
  assert.deepEqual(
    canonicalWorkflowRequiredArtifacts(input, { defaultRepo: 'publisher/family-default' }, 'edit_image'),
    ['publisher/selected-model', 'publisher/adapter'],
  );
  assert.deepEqual(
    canonicalWorkflowRequiredArtifacts({ nodes: [] }, { defaultRepo: 'publisher/default' }, 'text_to_image'),
    ['publisher/default'],
  );
});

test('canonical Cosmos Super metadata retains both exact backend-required safety dependencies', () => {
  const capability = capabilities.find((item) => item.modelType === 'Cosmos3OmniModularPipeline');
  const requirements = capability.inputContracts.text_to_image.modelRequirements;
  assert.equal(requirements.length, 2);
  assert.ok(requirements.every((item) => /^[a-f0-9]{40}$/u.test(item.revision)));
  assert.deepEqual(
    canonicalWorkflowRequiredArtifacts(graph(['nvidia/Cosmos3-Super-Text2Image']), capability, 'text_to_image'),
    ['nvidia/Cosmos3-Super-Text2Image', ...requirements.map((item) => item.repo)],
  );
  assert.equal(capability.autoEligible, false);
  assert.equal(capability.galleryEligible, false);
  assert.equal(capability.liveProof, false);
  assert.deepEqual(capability.qualifiedModes, []);
});

test('declarations for other tasks are excluded and missing dependency identities fail closed', () => {
  const capability = {
    inputContracts: {
      edit_image: { modelRequirements: [{ repo: 'publisher/edit-required' }] },
      text_to_image: { modelRequirements: [{ repo: 'publisher/text-required' }] },
    },
    modeRequirements: {
      edit_image: {
        modelRequirements: [{ repo: 'publisher/edit-required' }, { repo: 'publisher/legacy-edit-required' }],
      },
      text_to_image: { modelRequirements: [{ repo: 'publisher/legacy-text-required' }] },
    },
    additionalRequirements: [
      { repo: 'publisher/shared' },
      { repo: 'publisher/edit-only', requiredForModes: ['edit_image'] },
      { repo: 'publisher/not-required', requiredForModes: [] },
      { repo: 'publisher/shared', requiredForModes: ['edit_image'] },
    ],
  };
  assert.deepEqual(canonicalWorkflowRequiredArtifacts(graph(['publisher/selected']), capability, 'edit_image'), [
    'publisher/selected',
    'publisher/edit-required',
    'publisher/legacy-edit-required',
    'publisher/shared',
    'publisher/edit-only',
  ]);
  assert.throws(
    () =>
      canonicalWorkflowRequiredArtifacts(
        graph(['publisher/selected']),
        { additionalRequirements: [{}] },
        'text_to_image',
      ),
    /dependency has no repository/,
  );
});
