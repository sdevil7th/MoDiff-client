import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server;
let packages;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  packages = await server.ssrLoadModule('/src/studio/workflowPackage.ts');
});

after(async () => {
  await server?.close();
});

function parse({ prompt = '', templateLabel } = {}) {
  const graph = {
    nodes: [{ id: 'retained-text', data: { params: { text: { value: prompt } } } }],
    edges: [],
    viewport: { x: 12, y: -8, zoom: 0.75 },
  };
  const input = {
    graph,
    metadata: { studio: { prompt } },
    intent: 'draft',
    ...(templateLabel !== undefined
      ? {
          latestOutput: {
            id: 'retained-output',
            url: '/retained-output.png',
            prompt,
            templateLabel,
            graphSnapshot: graph,
          },
        }
      : {}),
  };
  const before = structuredClone(input);
  const parsed = packages.parseWorkflowPackage(input);
  assert.ok(parsed);
  assert.deepEqual(input, before, 'Title normalization must not rewrite the imported package or its intent.');
  assert.equal(parsed.packageData, input);
  assert.deepEqual(parsed.snapshot.nodes, graph.nodes);
  assert.deepEqual(parsed.snapshot.edges, graph.edges);
  assert.deepEqual(parsed.snapshot.viewport, graph.viewport);
  return parsed;
}

test('prompt-derived import titles trim a truncated boundary without changing the authored prompt or graph', () => {
  const prompt =
    'Give the <fox> a vivid blue knitted scarf while retaining the fox, mossy rock, forest, lighting, and composition from the reference image.';
  assert.equal(prompt.slice(0, 28), 'Give the <fox> a vivid blue ');
  const parsed = parse({ prompt });
  assert.equal(parsed.title, 'Give the <fox> a vivid blue');
  assert.equal(parsed.snapshot.studioForm.prompt, prompt);
});

test('template import labels retain their full text and interior spaces while trimming their boundaries', () => {
  const templateLabel = ' \nA full  template title longer than twenty-eight characters\t ';
  const parsed = parse({ prompt: 'A different prompt', templateLabel });
  assert.equal(parsed.title, 'A full  template title longer than twenty-eight characters');
  assert.equal(parsed.output.templateLabel, templateLabel, 'The retained output receipt remains unchanged.');
  assert.notEqual(parsed.title, parse({ templateLabel: 'Another genuine title' }).title);
});

test('blank imported title candidates use the existing Imported workflow fallback', () => {
  assert.equal(parse({ prompt: ' \n\t ' }).title, 'Imported workflow');
  assert.equal(parse({ prompt: 'Other wording', templateLabel: ' \t ' }).title, 'Imported workflow');
  assert.equal(parse().title, 'Imported workflow');
});

test('prompt titles retain the existing prefix limit and distinct authored wording', () => {
  const prompt = '  A  distinct caption that continues beyond the title boundary';
  const parsed = parse({ prompt });
  assert.equal(parsed.title, 'A  distinct caption that c');
  assert.equal(parsed.snapshot.studioForm.prompt, prompt);
  assert.notEqual(parsed.title, parse({ prompt: 'A genuinely different caption' }).title);
  assert.equal(parse({ prompt: 'Prompt fallback', templateLabel: '' }).title, 'Prompt fallback');
});
