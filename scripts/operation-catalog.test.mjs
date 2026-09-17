import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let server, contracts, catalog;
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  catalog = await server.ssrLoadModule('/src/workflow/operationCatalog.ts');
});
after(async () => server?.close());

function operation() {
  return {
    pipelineClass: 'FutureModularPipeline',
    task: 'text_to_image',
    operationId: 'diffusion.denoise',
    nodeKey: 'modules.ModularDiffusers.WorkflowImageDenoise',
    nodeType: 'denoise',
    blockName: 'denoise',
    decomposition: 'block',
    support: 'declared',
    workflowId: 'text2image',
    binding: {
      pipelineClass: 'FutureModularPipeline',
      values: { pipeline_class: 'FutureModularPipeline', workflow_id: 'text2image', block_path: 'denoise' },
    },
    ports: [
      {
        name: 'state_in',
        semanticName: 'state_in',
        direction: 'input',
        roles: ['value'],
        types: ['modular_workflow_state'],
        required: true,
        hidden: false,
        semantics: {
          kind: 'state',
          scope: 'FutureModularPipeline:text2image',
          state: 'text_encoder',
          owner: 'same_loader',
          members: [{ name: 'prompt_embeds', type: 'torch.Tensor' }],
        },
      },
    ],
  };
}
function support() {
  return [
    {
      pipelineClass: 'FutureModularPipeline',
      coverage: 'local-adapter',
      reason: 'Existing adapter',
      equivalentTo: [],
      upstreamTasks: [{ task: 'text_to_image', source: 'modular', workflowId: 'text2image' }],
      tasks: [
        {
          task: 'text_to_image',
          execution: 'declared',
          decomposition: 'stages',
          operationIds: ['diffusion.denoise'],
          executionProfileIds: [],
          dependencies: 'unknown',
          runtimeRequirements: [],
        },
      ],
    },
  ];
}

test('v3 accepts scoped state and exact existing bindings without a family union', () => {
  const value = operation();
  assert.deepEqual(contracts.parseOperationContracts([value], 3), [value]);
  assert.deepEqual(catalog.parsePipelineSupport(support(), 1, [value]), support());
  const output = { ...structuredClone(value.ports[0]), direction: 'output', required: false };
  assert.equal(catalog.operationPortCompatibility(output, value.ports[0]), 'runtime_validation');
  output.semantics.state = 'denoise';
  assert.equal(catalog.operationPortCompatibility(output, value.ports[0]), 'incompatible');
});

test('v3 rejects ambiguous bindings, unsafe selectors and malformed semantics', () => {
  for (const mutate of [
    (c) => {
      c.binding.extra = true;
    },
    (c) => {
      c.binding.values = { constructor: 'bad' };
    },
    (c) => {
      c.binding.values.workflow_id = { arbitrary: true };
    },
    (c) => {
      c.binding.pipelineClass = 'bad/class';
    },
    (c) => {
      c.ports[0].semantics.kind = 'interchangeable';
    },
    (c) => {
      c.ports[0].semantics.owner = 'any';
    },
    (c) => {
      c.ports[0].semantics.scope = 'OtherPipeline';
    },
    (c) => {
      c.ports[0].semantics.members.push({ ...c.ports[0].semantics.members[0] });
    },
    (c) => {
      delete c.workflowId;
    },
    (c) => {
      c.ports[0].semantics.state = 'constructor';
    },
  ]) {
    const c = operation();
    mutate(c);
    assert.throws(() => contracts.parseOperationContracts([c], 3), /operation contract/i);
  }
});

test('support cross-checks operation references and does not convert unknown dependencies into readiness', () => {
  for (const mutate of [
    (s) => {
      s[0].tasks[0].operationIds = ['diffusion.nonexistent'];
    },
    (s) => {
      s[0].tasks[0].execution = 'adapter';
    },
    (s) => {
      s[0].tasks[0].dependencies = 'ready';
    },
    (s) => {
      s[0].tasks.push(structuredClone(s[0].tasks[0]));
    },
    (s) => {
      s[0].unknown = 'extra';
    },
    (s) => {
      s[0].tasks[0].runtimeRequirements = [{}];
    },
  ]) {
    const s = support();
    mutate(s);
    assert.throws(() => catalog.parsePipelineSupport(s, 1, [operation()]));
  }
});

test('operation grouping retains specialized stages and separates whole calls from editable stages', () => {
  const c = operation();
  const load = { ...c, operationId: 'diffusion.load_models', decomposition: 'loader' };
  const rewrite = { ...c, operationId: 'diffusion.rewrite_prompt' };
  assert.deepEqual(
    catalog.operationsForTask([c, rewrite, load], c.pipelineClass, c.task).map((c) => c.operationId),
    ['diffusion.load_models', 'diffusion.rewrite_prompt', 'diffusion.denoise'],
  );
  assert.deepEqual(catalog.operationsForTask([c], 'OtherPipeline', c.task), []);
});

test('semantic advisory matching preserves directional scalar compatibility', () => {
  const input = {
    ...operation().ports[0],
    types: ['float'],
    semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
  };
  const output = { ...input, direction: 'output', required: false, types: ['int'] };
  assert.equal(catalog.operationPortCompatibility(output, input), 'compatible');
  assert.equal(
    catalog.operationPortCompatibility({ ...output, types: ['float'] }, { ...input, types: ['int'] }),
    'incompatible',
  );
});
