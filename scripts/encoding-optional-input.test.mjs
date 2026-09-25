import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
let server, surface;
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, watch: null },
  });
  surface = await server.ssrLoadModule('/src/workflow/encodingOptionalInput.ts');
  const resolver = await server.ssrLoadModule('/src/workflow/encodingImageRoute.ts');
  surface.bindEncodingRouteResolver(resolver.optionalEncodingRoute);
});

test('encoder route extends existing stages, excludes extra required media, and exposes input/output ports', () => {
  const port = (name, direction, type, required = false) => ({
    name,
    semanticName: name,
    direction,
    roles: [name === 'vae' ? 'component' : 'value'],
    types: [type],
    required,
    hidden: false,
  });
  const op = (task, id, nodeType, ports = []) => ({ pipelineClass: 'Example', task, operationId: id, nodeType, ports });
  const baseline = (task) => [
    op(task, 'load', 'loader'),
    op(task, 'prompt', 'text_encoder'),
    op(task, 'denoise', 'denoise'),
  ];
  const encoder = (task, mask = false) =>
    op(task, 'encode', 'vae_encoder', [
      port('image', 'input', 'image', true),
      port('vae', 'input', 'diffusers_auto_model', true),
      port('image_latents', 'output', 'latents'),
      ...(mask ? [port('mask_image', 'input', 'image', true)] : []),
    ]);
  const operations = [
    ...baseline('text_to_image'),
    ...baseline('control_image'),
    op('control_image', 'control', 'controlnet'),
    ...baseline('image_to_image'),
    encoder('image_to_image'),
    ...baseline('inpaint'),
    encoder('inpaint', true),
    ...baseline('controlnet_image2image'),
    encoder('controlnet_image2image'),
    op('controlnet_image2image', 'control', 'controlnet'),
  ];
  const support = [
    {
      pipelineClass: 'Example',
      tasks: [...new Set(operations.map((o) => o.task))].map((task) => ({
        task,
        execution: 'adapter',
        operationIds: operations.filter((o) => o.task === task).map((o) => o.operationId),
      })),
    },
  ];
  const instance = (task) => ({
    definitionSnapshot: { source: { provider: 'modiff.visual-stages.v1/inputs' } },
    effectiveGraph: { nodes: [{ data: { operationAuthoring: { operation: op(task, 'prompt', 'text_encoder') } } }] },
    effectiveInterface: { boundary: { inputs: [] } },
  });
  assert.equal(surface.optionalEncodingRoute(instance('text_to_image'), operations, support).task, 'image_to_image');
  assert.equal(
    surface.optionalEncodingRoute(instance('control_image'), operations, support).task,
    'controlnet_image2image',
  );
  const ports = surface.optionalEncodingPorts(instance('text_to_image'), operations, support);
  assert.equal(ports['modiff-encoding-input:image'].display, 'input');
  assert.equal(ports['modiff-encoding-input:vae'].signalCompatibility.role, 'vae');
  assert.equal(ports['modiff-encoding-output:image_latents'].display, 'output');
  assert.equal(ports['modiff-encoding-output:image_latents'].type, 'latents');
  assert.equal(ports['modiff-encoding-input:mask_image'], undefined);
  const ambiguous = [...operations, ...baseline('alternative'), encoder('alternative')];
  const admitted = [
    {
      ...support[0],
      tasks: [
        ...support[0].tasks,
        { task: 'alternative', execution: 'adapter', operationIds: ['load', 'prompt', 'denoise', 'encode'] },
      ],
    },
  ];
  assert.equal(surface.optionalEncodingRoute(instance('text_to_image'), ambiguous, admitted), null);
});
after(async () => server?.close());
test('optional Image socket comes only from an admitted image route and does not mutate the graph', () => {
  const instance = {
    definitionSnapshot: { source: { provider: 'modiff.visual-stages.v1/inputs' } },
    effectiveGraph: {
      nodes: [
        {
          data: {
            operationAuthoring: {
              operation: { pipelineClass: 'Example', task: 'text_to_image', nodeType: 'text_encoder' },
            },
          },
        },
      ],
    },
    effectiveInterface: { boundary: { inputs: [] } },
  };
  const operation = {
    pipelineClass: 'Example',
    task: 'image_to_image',
    operationId: 'encode',
    nodeType: 'vae_encoder',
    ports: [
      {
        direction: 'input',
        hidden: false,
        roles: ['value'],
        types: ['image'],
        semanticName: 'image',
        semantics: { owner: 'none' },
      },
    ],
  };
  const support = [
    { pipelineClass: 'Example', tasks: [{ task: 'image_to_image', execution: 'adapter', operationIds: ['encode'] }] },
  ];
  const before = structuredClone(instance);
  assert.equal(surface.optionalEncodingImageInput(instance, [operation], support)?.type, 'image');
  assert.equal(surface.optionalEncodingImageInput(instance, [operation], []), null);
  assert.equal(surface.optionalEncodingImageInput(instance, [], support), null);
  assert.deepEqual(instance, before);
  const active = structuredClone(instance);
  active.effectiveInterface.boundary.inputs.push({ valueType: 'image', binding: { fieldOrPortId: 'image' } });
  assert.equal(surface.optionalEncodingImageInput(active, [operation], support), null);
  assert.equal(
    surface.optionalEncodingImageInput(instance, [{ ...operation, nodeType: 'controlnet' }], support),
    null,
    'A ControlNet image input is not an image encoding input',
  );
});
