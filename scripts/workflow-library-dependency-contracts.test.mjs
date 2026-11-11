import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { before, test } from 'node:test';
import { canonicalWorkflowRequiredArtifacts } from './workflow-library-contract.mjs';

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
