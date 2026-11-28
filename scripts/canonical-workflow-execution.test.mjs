import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyNoDeadWorkflowNodes } from './workflow-library-dead-nodes.mjs';
import { canonicalExecutableWorkflowGraph } from './canonical-workflow-execution.mjs';

test('a separately saved shot is a real output terminal, while disconnected or disabled branches remain invalid', () => {
  const graph = {
    nodes: [
      { id: 'generate', data: { module: 'modules.DiffusersVideo', action: 'Denoise' } },
      { id: 'save', data: { module: 'modules.Video', action: 'ExportAsset' } },
      { id: 'deliver', data: { module: 'modules.Video', action: 'Export' } },
    ],
    edges: [
      { source: 'generate', target: 'save' },
      { source: 'generate', target: 'deliver' },
    ],
  };
  verifyNoDeadWorkflowNodes({ id: 'saved-shots' }, graph);
  const wrong = structuredClone(graph);
  wrong.nodes[1].data.action = 'UnknownSideEffect';
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'wrong' }, wrong), /outside every output/);
  const disabled = structuredClone(graph);
  disabled.nodes[1].data.uiState = { disabled: true };
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'disabled' }, disabled), /disabled/);
  assert.throws(
    () => verifyNoDeadWorkflowNodes({ id: 'detached' }, { ...graph, edges: graph.edges.slice(1) }),
    /isolated/,
  );
});

test('retained clip assembly is a real final output without permitting unknown or detached terminals', () => {
  const graph = {
    nodes: [
      { id: 'save-1', data: { module: 'modules.Video', action: 'ExportAsset' } },
      { id: 'save-2', data: { module: 'modules.Video', action: 'ExportAsset' } },
      { id: 'ordered', data: { module: 'modules.Primitive', action: 'ToList' } },
      { id: 'assemble', data: { module: 'modules.Video', action: 'ConcatenateAssets' } },
    ],
    edges: [
      { source: 'save-1', target: 'ordered' },
      { source: 'save-2', target: 'ordered' },
      { source: 'ordered', target: 'assemble' },
    ],
  };
  const before = structuredClone(graph);
  assert.doesNotThrow(() => verifyNoDeadWorkflowNodes({ id: 'retained-six-shot-assembly' }, graph));
  assert.deepEqual(graph, before);
  const unknown = structuredClone(graph);
  unknown.nodes[3].data.action = 'UnknownConcatenate';
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'unknown-terminal' }, unknown), /outside every output/);
  const disabled = structuredClone(graph);
  disabled.nodes[3].data.uiState = { disabled: true };
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'disabled-assembly' }, disabled), /disabled/);
  assert.throws(
    () => verifyNoDeadWorkflowNodes({ id: 'detached-assembly' }, { ...graph, edges: graph.edges.slice(0, 2) }),
    /isolated/,
  );
});

test('an explicit image save keeps its compositing branch reachable alongside a raw preview', () => {
  const graph = {
    nodes: [
      { id: 'generate', data: { module: 'modules.DiffusersImage', action: 'Generate' } },
      { id: 'preview', data: { module: 'modules.Image', action: 'Preview' } },
      { id: 'composite', data: { module: 'modules.ImageOperations', action: 'MaskComposite' } },
      { id: 'save', data: { module: 'modules.Image', action: 'Save' } },
    ],
    edges: [
      { source: 'generate', target: 'preview' },
      { source: 'generate', target: 'composite' },
      { source: 'composite', target: 'save' },
    ],
  };
  assert.doesNotThrow(() => verifyNoDeadWorkflowNodes({ id: 'protected-image-delivery' }, graph));
  const unknown = structuredClone(graph);
  unknown.nodes[3].data.module = 'modules.Unreviewed';
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'unreviewed-save' }, unknown), /outside every output/);
  const disabled = structuredClone(graph);
  disabled.nodes[3].data.uiState = { disabled: true };
  assert.throws(() => verifyNoDeadWorkflowNodes({ id: 'disabled-save' }, disabled), /disabled/);
});

test('canonical leaf publication rejects disabled or unresolved container boundaries and preserves ordinary loops', () => {
  const group = { id: 'group', data: { type: 'group', uiState: { disabled: true } } };
  const loop = { id: 'loop', data: { type: 'loop' } };
  const leaf = { id: 'leaf', parentId: 'group', data: { type: 'custom', params: {} } };
  const identity = (g) => g;
  assert.throws(() => canonicalExecutableWorkflowGraph({ nodes: [group, leaf], edges: [] }, identity), /disabled/);
  delete group.data.uiState;
  assert.throws(
    () =>
      canonicalExecutableWorkflowGraph(
        { nodes: [group, leaf], edges: [{ source: 'group', target: 'leaf' }] },
        identity,
      ),
    /unresolved/,
  );
  const graph = { nodes: [group, loop, leaf], edges: [] };
  const before = structuredClone(graph);
  const flat = canonicalExecutableWorkflowGraph(graph, identity);
  assert.deepEqual(
    flat.nodes.map((n) => n.id),
    ['loop', 'leaf'],
  );
  assert.equal(flat.nodes[1].parentId, undefined);
  assert.deepEqual(graph, before);
});
