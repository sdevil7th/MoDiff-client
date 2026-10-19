import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, add;
before(async () => {
  server = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null } });
  ({ addReviewedValuePortsV2: add } = await server.ssrLoadModule('/src/studio/reviewedValuePortsV2.ts'));
});
after(async () => {
  await server?.close();
});

const registry = {
  width: { type: 'int', default: 1024, value: 1024 },
  prompt_embeds: { type: 'latent', display: 'input' },
  state_output__width: { type: 'int', display: 'output' },
  state_output__prompt_embeds: { type: 'latent', display: 'output' },
  state_output__images: { type: 'image', display: 'output' },
};

test('typed intermediate sockets preserve caller controls and inherited state defaults', () => {
  const params = { width: { type: 'int', value: 1328 }, images: { type: 'image', display: 'output' } };
  const before = JSON.stringify(registry);
  add(
    params,
    registry,
    [{ name: 'width' }, { name: 'prompt_embeds' }],
    [{ name: 'width' }, { name: 'prompt_embeds' }, { name: 'images' }, { name: 'private' }],
    'step',
  );
  assert.deepEqual(params.width, { type: 'int', value: 1328 });
  assert.equal(params.state_output__width.type, 'int');
  assert.equal(params.state_output__prompt_embeds.type, params.prompt_embeds.type);
  assert.equal(params.prompt_embeds.required, false);
  assert.equal('value' in params.prompt_embeds, false);
  assert.equal('state_output__images' in params, false);
  assert.equal('state_output__private' in params, false);
  assert.equal(JSON.stringify(registry), before);
});

test('a newly exposed input never overwrites Pipeline State with a union-registry default', () => {
  const params = {};
  add(params, registry, [{ name: 'width' }], [], 'step');
  assert.equal(params.width.display, 'input');
  assert.equal('default' in params.width, false);
  assert.equal('value' in params.width, false);
});

test('loop members do not masquerade as one-shot value producers', () => {
  const params = {};
  add(params, registry, [{ name: 'prompt_embeds' }], [{ name: 'prompt_embeds' }], 'loop_member');
  assert.deepEqual(params, {});
});

test('loop ports expose exact iteration inputs and explicit current/previous outputs only', () => {
  const params = {};
  const loopRegistry = {
    ...registry,
    iteration_input__prompt_embeds: { type: ['latent', 'modular_loop_value'], display: 'input' },
    iteration_output__prompt_embeds: { type: 'modular_loop_value', display: 'output' },
    iteration_previous__prompt_embeds: { type: 'modular_loop_value', display: 'output' },
  };
  add(params, loopRegistry, [{ name: 'prompt_embeds' }], [{ name: 'prompt_embeds' }], 'loop_member');
  assert.deepEqual(Object.keys(params).sort(), [
    'iteration_input__prompt_embeds',
    'iteration_output__prompt_embeds',
    'iteration_previous__prompt_embeds',
  ]);
  assert.equal(params.iteration_input__prompt_embeds.required, false);
  assert.equal(params.iteration_input__prompt_embeds.value, undefined);
  assert.equal(params.iteration_output__prompt_embeds.type, 'modular_loop_value');
  assert.equal(params.state_output__prompt_embeds, undefined);
});

test('an input with the same upstream name as a media output gets a distinct socket', () => {
  const params = { images: { type: 'image', display: 'output' } };
  add(
    params,
    { ...registry, images: params.images, state_input__images: { type: 'image', display: 'input' } },
    [{ name: 'images' }],
    [{ name: 'images' }],
    'step',
  );
  assert.equal(params.images.display, 'output');
  assert.equal(params.state_input__images.display, 'input');
  assert.equal('value' in params.state_input__images, false);
});

const oldBlock = {
  id: `diffusers.modular-block:Original:sha256:${'a'.repeat(64)}`,
  contentHash: `sha256:${'a'.repeat(64)}`,
};
const newBlock = {
  id: `diffusers.modular-block:Added:sha256:${'b'.repeat(64)}`,
  contentHash: `sha256:${'b'.repeat(64)}`,
};

function conflictingSchema(display = 'output', oldType = 'int', newType = 'latent') {
  return {
    type: newType,
    display,
    label: 'Positions',
    description: 'new union description',
    fieldOptions: {
      unrelated: 'retained',
      reviewedBlockFieldSchemasV1: {
        schemaVersion: 1,
        alternatives: [
          {
            blockDefinitionId: oldBlock.id,
            blockContractHash: oldBlock.contentHash,
            params: { type: oldType, display, label: 'Positions', description: 'original description' },
          },
          {
            blockDefinitionId: newBlock.id,
            blockContractHash: newBlock.contentHash,
            params: { type: newType, display, label: 'Positions', description: 'new description' },
          },
        ],
      },
    },
  };
}

test('adding another block cannot change an existing immutable output socket type', () => {
  const published = { state_output__positions: conflictingSchema() };
  const before = JSON.stringify(published);
  const original = {},
    added = {};
  add(original, published, [], [{ name: 'positions' }], 'step', oldBlock);
  add(added, published, [], [{ name: 'positions' }], 'step', newBlock);
  assert.equal(original.state_output__positions.type, 'int');
  assert.equal(original.state_output__positions.description, 'original description');
  assert.equal(added.state_output__positions.type, 'latent');
  assert.deepEqual(original.state_output__positions.fieldOptions, { unrelated: 'retained' });
  assert.equal(JSON.stringify(published), before);
});

test('exact conditional input types preserve unconnected Pipeline State semantics', () => {
  const published = { positions: { ...conflictingSchema('input'), default: 77, value: 77 } };
  const params = {};
  add(params, published, [{ name: 'positions', description: 'selected upstream field' }], [], 'step', oldBlock);
  assert.equal(params.positions.type, 'int');
  assert.equal(params.positions.display, 'input');
  assert.equal('default' in params.positions, false);
  assert.equal('value' in params.positions, false);
  assert.equal(params.positions.required, false);
  assert.equal(
    params.positions.description,
    'selected upstream field Unconnected: use the upstream Pipeline State value.',
  );
  assert.deepEqual(params.positions.fieldOptions, { unrelated: 'retained' });
});

test('exact loop aliases preserve iteration wrappers rather than raw output types', () => {
  const published = {
    iteration_input__positions: conflictingSchema(
      'input',
      ['int', 'modular_loop_value'],
      ['latent', 'modular_loop_value'],
    ),
    iteration_output__positions: conflictingSchema('output', 'modular_loop_value', 'modular_loop_value'),
    iteration_previous__positions: conflictingSchema('output', 'modular_loop_value', 'modular_loop_value'),
  };
  const params = {};
  add(params, published, [{ name: 'positions' }], [{ name: 'positions' }], 'loop_member', oldBlock);
  assert.deepEqual(params.iteration_input__positions.type, ['int', 'modular_loop_value']);
  assert.equal(params.iteration_output__positions.type, 'modular_loop_value');
  assert.equal(params.iteration_previous__positions.type, 'modular_loop_value');
  assert.ok(Object.values(params).every((param) => !('reviewedBlockFieldSchemasV1' in param.fieldOptions)));
});

for (const [name, mutate, selection] of [
  ['missing selected block', () => {}, undefined],
  ['foreign selected block', () => {}, { id: 'foreign', contentHash: oldBlock.contentHash }],
  ['mismatched selected hash', () => {}, { ...oldBlock, contentHash: newBlock.contentHash }],
  ['duplicate block identity', (value) => value.alternatives.push(structuredClone(value.alternatives[0])), oldBlock],
  [
    'mismatched published hash',
    (value) => {
      value.alternatives[0].blockContractHash = newBlock.contentHash;
    },
    oldBlock,
  ],
  [
    'unknown metadata version',
    (value) => {
      value.schemaVersion = 2;
    },
    oldBlock,
  ],
  [
    'executable field payload',
    (value) => {
      value.alternatives[0].params.onChange = 'foreign';
    },
    oldBlock,
  ],
  [
    'invalid socket type',
    (value) => {
      value.alternatives[0].params.type = 77;
    },
    oldBlock,
  ],
  [
    'unbounded alternatives',
    (value) => {
      value.alternatives = Array(4097).fill(value.alternatives[0]);
    },
    oldBlock,
  ],
]) {
  test(`exact field alternatives refuse ${name}`, () => {
    const output = conflictingSchema();
    mutate(output.fieldOptions.reviewedBlockFieldSchemasV1);
    assert.throws(
      () => add({}, { state_output__positions: output }, [], [{ name: 'positions' }], 'step', selection),
      /exact reviewed block field schema/u,
    );
  });
}
