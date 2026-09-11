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
