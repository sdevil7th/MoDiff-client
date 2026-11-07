import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let server, contracts, bundle, required, fixer;
const fixture = JSON.parse(
  readFileSync(new URL('../tests/fixtures/qwen-component-bundle-contract.v1.json', import.meta.url)),
);
before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  bundle = await server.ssrLoadModule('/src/workflow/componentBundleInputs.ts');
  required = await server.ssrLoadModule('/src/studio/requiredGraphInputs.ts');
  fixer = await server.ssrLoadModule('/src/studio/graphFixer.ts');
});
after(async () => {
  await server?.close();
});

function graphFor(action = 'EncodePrompt') {
  const node = (operation, id) => {
    const params = Object.fromEntries(
      operation.ports.map((port) => [
        port.name,
        {
          type: port.types.length === 1 ? port.types[0] : port.types,
          display: port.direction === 'output' ? 'output' : 'input',
          required: port.required,
          ...(port.required && port.semantics.kind !== 'component' ? { value: 'supplied' } : {}),
        },
      ]),
    );
    const parts = operation.nodeKey.split('.');
    return {
      id,
      type: 'custom',
      position: { x: 0, y: 0 },
      data: {
        module: parts.slice(0, -1).join('.'),
        action: parts.at(-1),
        label: parts.at(-1),
        params,
        operationAuthoring: { schemaVersion: 1, operation: structuredClone(operation), defaults: {}, retained: [] },
      },
    };
  };
  const source = node(
    fixture.contracts.find((c) => c.decomposition === 'loader'),
    'loader',
  );
  const target = node(
    fixture.contracts.find((c) => c.nodeKey.endsWith(`.${action}`)),
    'stage',
  );
  return {
    nodes: [source, target],
    edges: [
      {
        id: 'bundle',
        source: 'loader',
        sourceHandle: 'pipeline_components',
        target: 'stage',
        targetHandle: 'pipeline_components',
      },
    ],
  };
}

test('the actual backend facade fixture preserves required fields and round-trips typed member alternatives', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.contracts.length, 4);
  assert.deepEqual(contracts.parseOperationContracts(fixture.contracts, 3), fixture.contracts);
  for (const action of ['EncodePrompt', 'Denoise', 'DecodeLatents']) {
    const graph = graphFor(action),
      target = graph.nodes[1];
    for (const port of target.data.operationAuthoring.operation.ports.filter((p) => p.semantics.suppliedBy)) {
      assert.equal(port.required, true);
      assert.equal(bundle.operationInputIsSuppliedByBundle(target, port.name, graph), true);
    }
    assert.deepEqual(required.inspectRequiredGraphInputs(graph.nodes, graph, {}), []);
    const plan = fixer.buildGraphFixPlan({ ...graph, registry: {} });
    assert.ok(
      !plan.issues.some((i) => i.kind === 'missing_input' && i.targetNodeId === target.id),
      'Graph Fix agrees that the declared connected bundle supplies the required members.',
    );
  }
});

for (const [name, mutate] of [
  [
    'disabled source',
    (g) => {
      g.nodes[0].data.uiState = { disabled: true };
    },
  ],
  [
    'disabled bundle socket',
    (g) => {
      g.nodes[1].data.params.pipeline_components.disabled = true;
    },
  ],
  [
    'missing member',
    (g) => {
      const port = g.nodes[0].data.operationAuthoring.operation.ports.find((p) => p.name === 'pipeline_components');
      port.semantics.members = port.semantics.members.filter((m) => m.name !== 'text_encoder');
    },
  ],
  [
    'wrong member type',
    (g) => {
      g.nodes[0].data.operationAuthoring.operation.ports
        .find((p) => p.name === 'pipeline_components')
        .semantics.members.forEach((m) => {
          m.type = 'WrongComponent';
        });
    },
  ],
  [
    'wrong source scope',
    (g) => {
      g.nodes[0].data.operationAuthoring.operation.ports.find((p) => p.name === 'pipeline_components').semantics.scope =
        'OtherPipeline';
    },
  ],
  [
    'wrong role',
    (g) => {
      g.nodes[0].data.operationAuthoring.operation.ports.find((p) => p.name === 'pipeline_components').roles = [
        'value',
      ];
    },
  ],
  [
    'wildcard socket',
    (g) => {
      g.nodes[0].data.params.pipeline_components.type = 'any';
    },
  ],
  [
    'missing wire',
    (g) => {
      g.edges = [];
    },
  ],
  [
    'duplicate supplier',
    (g) => {
      g.edges.push({ ...g.edges[0], id: 'second' });
    },
  ],
]) {
  test(`${name} does not satisfy required components or suppress their readiness finding`, () => {
    const graph = graphFor();
    mutate(graph);
    assert.equal(bundle.operationInputIsSuppliedByBundle(graph.nodes[1], 'text_encoders', graph), false);
    assert.ok(required.inspectRequiredGraphInputs(graph.nodes, graph, {}).some((i) => i.fieldId === 'text_encoders'));
  });
}

test('hiding a connected declared bundle is presentation; inspection preserves the graph', () => {
  const graph = graphFor();
  graph.nodes[1].data.params.pipeline_components.hidden = true;
  const before = structuredClone(graph);
  assert.equal(bundle.operationInputIsSuppliedByBundle(graph.nodes[1], 'text_encoders', graph), true);
  assert.deepEqual(graph, before);
});

test('malformed alternatives never acquire supply authority from a saved hint', () => {
  for (const mutate of [
    (a) => {
      a.input = 'absent';
    },
    (a) => {
      a.members = [];
    },
    (a) => {
      a.members = ['text_encoder', 'text_encoder'];
    },
    (a) => {
      a.members = ['missing_component'];
    },
    (a) => {
      a.members = ['scheduler'];
    },
    (a) => {
      a.members = ['tokenizer'];
    },
    (a) => {
      a.extra = true;
    },
  ]) {
    const graph = graphFor();
    const operation = graph.nodes[1].data.operationAuthoring.operation;
    mutate(operation.ports.find((p) => p.name === 'text_encoders').semantics.suppliedBy);
    assert.throws(() => contracts.parseOperationContracts([operation], 3), /operation contract/i);
    assert.equal(bundle.operationInputIsSuppliedByBundle(graph.nodes[1], 'text_encoders', graph), false);
  }
});
