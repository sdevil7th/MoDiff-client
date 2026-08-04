import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let module;
let server;

before(async () => {
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true },
    appType: 'custom',
  });
  module = await server.ssrLoadModule('/src/studio/workflowFileSave.ts');
});

beforeEach(() => {
  globalThis.window = {};
});

after(async () => {
  delete globalThis.window;
  delete globalThis.document;
  await server?.close();
});

test('workflow filenames are portable and retain the JSON suffix', () => {
  assert.equal(module.workflowFilename(' My workflow: v2 '), 'My-workflow-v2.json');
  assert.equal(module.workflowFilename('***'), 'workflow.json');
});

test('native save picker receives the requested name and complete workflow snapshot', async () => {
  let pickerOptions;
  let written;
  let closed = false;
  globalThis.window.showSaveFilePicker = async (options) => {
    pickerOptions = options;
    return {
      createWritable: async () => ({
        write: async (blob) => {
          written = JSON.parse(await blob.text());
        },
        close: async () => {
          closed = true;
        },
      }),
    };
  };

  const snapshot = {
    nodes: [{ id: 'node-one' }],
    edges: [],
    studioForm: { prompt: 'Keep this prompt' },
    studioGraphBinding: null,
    selectedMode: 'text_to_image',
    activeTemplateId: null,
    sourceOutputId: null,
  };
  const result = await module.saveWorkflowSnapshotFile('Named workflow', snapshot);

  assert.equal(result, 'saved');
  assert.equal(pickerOptions.suggestedName, 'Named-workflow.json');
  assert.deepEqual(written, snapshot);
  assert.equal(closed, true);
});

test('picker cancellation leaves the save dialog flow cancellable', async () => {
  globalThis.window.showSaveFilePicker = async () => {
    throw new DOMException('Cancelled', 'AbortError');
  };
  assert.equal(await module.saveWorkflowSnapshotFile('Cancelled workflow', { nodes: [], edges: [] }), 'cancelled');
});
