import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

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

function cfgControl(pipeline = 'FutureModularPipeline') {
  return {
    technique: 'classifier_free',
    parameter: 'scale',
    compatibilityScope: 'diffusers.classifier_free.v1',
    scaleMeaning: 'cfg_prediction_mix',
    enabled: 'boolean_field',
    enabledField: 'enabled',
    formulation: 'boolean_field',
    formulationField: 'use_original_formulation',
    selectorField: 'guider',
    selectorValue: 'ClassifierFreeGuidance',
    negativeConditioning: 'pipeline_scoped_when_enabled',
    negativeConditioningScope: pipeline,
  };
}

function controlledOperation() {
  const value = operation();
  value.ports = [
    {
      name: 'guidance_scale',
      semanticName: 'guidance_scale',
      direction: 'input',
      roles: ['value'],
      types: ['float'],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [], control: cfgControl() },
    },
  ];
  for (const [name, type] of [
    ['guider', 'string'],
    ['enabled', 'boolean'],
    ['use_original_formulation', 'boolean'],
  ]) {
    value.ports.push({
      name,
      semanticName: name,
      direction: 'input',
      roles: ['value'],
      types: [type],
      required: false,
      hidden: false,
      semantics: { kind: 'value', scope: null, state: null, owner: 'none', members: [] },
    });
  }
  return value;
}

test('v3 accepts additive reviewed control semantics without changing legacy contracts', () => {
  const value = controlledOperation();
  assert.deepEqual(contracts.parseOperationContracts([value], 3), [value]);
  const legacy = operation();
  assert.deepEqual(contracts.parseOperationContracts([legacy], 3), [legacy]);
});

test('the actual backend guidance fixture round-trips all published family policies', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../tests/fixtures/guidance-control-contract.v1.json', import.meta.url), 'utf8'),
  );
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.contracts.length, 33);
  assert.deepEqual(contracts.parseOperationContracts(fixture.contracts, 3), fixture.contracts);
  const cfg = fixture.contracts.filter((c) => c.operationId === 'diffusion.guidance');
  assert.equal(cfg.length, 8);
  for (const c of cfg) {
    const controls = c.ports.filter((p) => p.semantics.control);
    assert.equal(controls.length, 7);
    for (const port of controls) {
      assert.equal(port.semantics.control.technique, 'classifier_free');
      assert.equal(port.semantics.control.negativeConditioningScope, c.binding.pipelineClass);
    }
  }
  for (const c of fixture.contracts.filter((c) => c.operationId === 'diffusion.denoise')) {
    const control = c.ports.find((p) => p.name === 'guidance_scale').semantics.control;
    assert.equal(control.technique, 'embedded_distilled');
    assert.equal(control.enabled, 'model_config', 'Discovery cannot infer the connected transformer configuration.');
    assert.equal(control.negativeConditioningScope, null);
  }
  const standard = fixture.contracts.filter((c) => c.decomposition === 'pipeline');
  assert.equal(standard.length, 22);
  for (const contract of standard) {
    for (const port of contract.ports.filter((p) => p.semantics.control?.technique === 'classifier_free')) {
      assert.equal(port.semantics.control.negativePromptField, 'negative_prompt');
      assert.equal(port.semantics.control.negativePromptPolicy, 'empty_string_is_condition');
    }
  }
});

test('v3 rejects malformed guidance control declarations instead of trusting labels', () => {
  for (const mutate of [
    (c) => {
      c.technique = 'anything';
    },
    (c) => {
      c.parameter = 'pipeline';
    },
    (c) => {
      c.compatibilityScope = '';
    },
    (c) => {
      c.enabledField = null;
    },
    (c) => {
      c.formulationField = '__proto__';
    },
    (c) => {
      c.selectorValue = null;
    },
    (c) => {
      c.negativeConditioningScope = 'OtherPipeline';
    },
    (c) => {
      c.scaleMeaning = 'distilled_model_embedding';
    },
    (c) => {
      c.extra = true;
    },
  ]) {
    const value = controlledOperation();
    mutate(value.ports[0].semantics.control);
    assert.throws(() => contracts.parseOperationContracts([value], 3), /operation contract/i);
  }
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

test('component subclasses require runtime validation instead of speculative disconnection', () => {
  const base = {
    direction: 'output',
    types: ['components'],
    semantics: {
      kind: 'component',
      scope: 'ExamplePipeline',
      state: null,
      owner: 'same_loader',
      members: [{ name: 'guider', type: 'BaseGuider' }],
    },
  };
  const derived = { ...structuredClone(base), direction: 'input' };
  derived.semantics.members[0].type = 'SpecializedGuider';
  assert.equal(catalog.operationPortCompatibility(base, derived), 'runtime_validation');
  derived.semantics.members[0].name = 'missing_component';
  assert.equal(catalog.operationPortCompatibility(base, derived), 'incompatible');
});

test('integrated model operations keep whole-call discovery and strict v3 identity', () => {
  const value = {
    ...operation(),
    operationId: 'image.upscale',
    nodeKey: 'modules.Test.Upscale',
    nodeType: 'integrated',
    decomposition: 'integrated',
    blockName: null,
    workflowId: null,
    binding: { pipelineClass: 'FutureModularPipeline', values: {} },
    ports: [],
  };
  const declared = support();
  declared[0].tasks[0].decomposition = 'pipeline';
  declared[0].tasks[0].operationIds = ['image.upscale'];
  assert.deepEqual(contracts.parseOperationContracts([value], 3), [value]);
  assert.deepEqual(catalog.parsePipelineSupport(declared, 1, [value]), declared);
  assert.equal(contracts.operationOwnsModel(value), true);
  assert.equal(contracts.operationOwnsModel({ ...value, decomposition: 'pipeline' }), false);
  assert.equal(contracts.operationOwnsModel(undefined), false);
  assert.throws(() => contracts.parseOperationContracts([{ ...value, nodeType: 'loader' }], 3));
});
