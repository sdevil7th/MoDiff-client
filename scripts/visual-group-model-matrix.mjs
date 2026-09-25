#!/usr/bin/env node
// Explicit, model-free all-catalog check against an isolated real backend.
// Case files are resume receipts: unchanged failures are not retried automatically.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';

const output = process.argv[2] && resolve(process.argv[2]);
if (!output || process.env.MODIFF_NODE_UX_ISOLATED !== '1')
  throw new Error('Set MODIFF_NODE_UX_ISOLATED=1 and pass a private evidence directory.');
const base = process.env.MODIFF_LIVE_BACKEND_URL || 'http://127.0.0.1:8093';
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
await mkdir(`${output}/cases`, { recursive: true });
async function json(path, body) {
  const response = await fetch(`${base}${path}`, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(`${path} ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
const catalog = await json('/model_capabilities');
const cache = await json('/hf_cache');
const snapshot = { catalog, cache };
const sourceFiles = ['visualOperationGroups', 'operationAuthoring', 'operationScope', 'mediaAttachment'];
const identity = hash({
  catalog,
  source: await Promise.all(sourceFiles.map((name) => readFile(`src/workflow/${name}.ts`, 'utf8'))),
  exporter: await readFile('src/stores/flowGraphExport.ts', 'utf8'),
  runtime: await readFile('src/studio/blockRuntimeV2.ts', 'utf8'),
});
await writeFile(`${output}/catalog.json`, JSON.stringify(snapshot, null, 2));
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
globalThis.window = { location: { origin: base }, localStorage: globalThis.localStorage, dispatchEvent: () => true };
const server = await createServer({
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { entries: [], noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
try {
  const visual = await server.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const author = await server.ssrLoadModule('/src/workflow/operationAuthoring.ts');
  const runtime = await server.ssrLoadModule('/src/studio/blockRuntimeV2.ts');
  const exporter = await server.ssrLoadModule('/src/stores/flowGraphExport.ts');
  const parser = await server.ssrLoadModule('/src/workflow/operationStarterRequest.ts');
  const contracts = await server.ssrLoadModule('/src/workflow/operationContracts.ts');
  const media = await server.ssrLoadModule('/src/workflow/mediaAttachment.ts');
  const factory = await server.ssrLoadModule('/src/workflow/nodeFactory.ts');
  const selections = [];
  const profiles = new Map(catalog.diffusersExecutionProfiles.map((p) => [p.id, p]));
  for (const pipeline of catalog.pipelineSupport) {
    for (const task of pipeline.tasks.filter((t) => t.execution === 'adapter')) {
      // Every advertised exact variant; generic routes without public profiles too.
      for (const id of task.executionProfileIds.length ? task.executionProfileIds : [null]) {
        const profile = profiles.get(id);
        const repos = profile ? [...new Set([profile.default_repo, ...(profile.compatible_repos || [])])] : [null];
        for (const repo of repos)
          selections.push({
            pipelineClass: pipeline.pipelineClass,
            task: task.task,
            ...(id ? { executionProfileId: id, repository: repo } : {}),
          });
      }
    }
  }
  const canonical = (graph) => {
    const api = exporter.buildApiGraphExport({ ...graph, sid: 'matrix', randomizeSeeds: false, setParam: () => {} });
    const id = (key) => graph.nodes.find((n) => n.id === key)?.data.operationAuthoring?.operation.operationId ?? key;
    return Object.fromEntries(
      Object.entries(api.nodes).map(([key, node]) => [
        id(key),
        {
          ...node,
          params: Object.fromEntries(
            Object.entries(node.params).map(([name, field]) => [
              name,
              { ...field, ...(field.sourceId ? { sourceId: id(field.sourceId) } : {}) },
            ]),
          ),
        },
      ]),
    );
  };
  const expanded = (g) => runtime.expandBlockGraphV2ForExecution(g.nodes, g.edges);
  const records = [],
    starters = [];
  for (const [index, selection] of selections.entries()) {
    const key = hash(selection).slice(0, 20);
    const file = `${output}/cases/${key}.json`;
    const prior = await readFile(file, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    if (prior?.identity === identity) {
      records.push(prior);
      if (prior.starter) starters.push({ selection, starter: prior.starter });
      continue;
    }
    const record = {
      identity,
      key,
      selection,
      status: 'pending',
      phase: 'starter',
      checkedAt: new Date().toISOString(),
    };
    try {
      const raw = await json('/operations/starter', selection);
      const starter = parser.parseOperationStarter(
        raw,
        selection.pipelineClass,
        selection.task,
        catalog.operationContracts,
      );
      record.starter = starter;
      starters.push({ selection, starter });
      record.phase = 'grouping';
      const plain = author.createOperationStarter(starter, { x: 0, y: 0 });
      const before = structuredClone(plain);
      const grouped = visual.groupNewOperationGraph(plain);
      assert.deepEqual(plain, before, 'grouping mutated source');
      assert.deepEqual(canonical(expanded(grouped)), canonical(plain), 'grouped API differs');
      const persisted = JSON.parse(JSON.stringify(grouped));
      assert.deepEqual(canonical(expanded(persisted)), canonical(plain), 'persisted API differs');
      assert.deepEqual(
        canonical(visual.unpackVisualOperationGroups(persisted).graph),
        canonical(plain),
        'ungroup API differs',
      );
      const groups = grouped.nodes.filter(visual.visualOperationGroup);
      record.groups = groups.map((n) => ({
        kind: visual.visualOperationGroup(n),
        members: n.data.blockInstanceV2.effectiveGraph.nodes.map((m) => m.data.action),
        controls: n.data.blockInstanceV2.effectiveInterface.controls.length,
      }));
      record.nodes = {
        ordinary: plain.nodes.length,
        visible: grouped.nodes.length,
        executable: expanded(grouped).nodes.length,
      };
      for (const root of groups) {
        const prompt = root.data.blockInstanceV2.effectiveInterface.controls.find(
          (c) => c.binding.fieldId === 'prompt',
        );
        if (prompt) {
          const edited = structuredClone(grouped);
          edited.nodes.find((n) => n.id === root.id).data.blockInstanceV2 = runtime.setBlockInstanceValueV2(
            root.data.blockInstanceV2,
            prompt.controlId,
            'All-model grouped input persistence proof',
          );
          assert.ok(
            expanded(JSON.parse(JSON.stringify(edited))).nodes.some(
              (n) => n.data.params.prompt?.value === 'All-model grouped input persistence proof',
            ),
          );
        }
      }
      const profile = profiles.get(selection.executionProfileId);
      record.weights = cache.find((c) => c.id === (selection.repository || profile?.default_repo))?.complete
        ? 'cache-reports-complete'
        : 'not-complete-or-absent';
      record.status = 'passed';
    } catch (error) {
      record.status = 'failed';
      record.error = String(error.message || error).slice(0, 12000);
      console.log('FAIL', selection.executionProfileId, selection.task, record.phase, record.error.slice(0, 180));
    }
    records.push(record);
    await writeFile(file, JSON.stringify(record, null, 2));
    if ((index + 1) % 25 === 0) console.log(`${index + 1}/${selections.length} cases recorded`);
  }
  // Compare changes to existing planners, not a cross-product of redundant models.
  const transitions = [];
  const baseline = starters.find(
    (s) => s.selection.executionProfileId === 'sdxl-base:modular' && s.selection.task === 'text_to_image',
  );
  for (const target of starters.filter(
    (s) =>
      s.selection.task === 'text_to_image' &&
      profiles.get(s.selection.executionProfileId)?.execution_path === 'modular-diffusers',
  )) {
    const result = { selection: target.selection, kind: 'model-change', status: 'pending' };
    try {
      const graph = visual.groupNewOperationGraph(author.createOperationStarter(baseline.starter, { x: 0, y: 0 }));
      const owner = graph.nodes.find((n) => contracts.operationOwnsModel(n.data.operationAuthoring?.operation));
      const group = graph.nodes.find((n) => visual.visualOperationGroup(n) === 'inputs');
      const control = group.data.blockInstanceV2.effectiveInterface.controls.find(
        (c) => c.binding.fieldId === 'prompt',
      );
      group.data.blockInstanceV2 = runtime.setBlockInstanceValueV2(
        group.data.blockInstanceV2,
        control.controlId,
        'Cross-model retained prompt',
      );
      const plan = author.planOperationChange(graph, owner.id, target.starter, { replaceModel: true });
      const flat = expanded(plan.graph);
      assert.ok(flat.nodes.some((n) => n.data.params.prompt?.value === 'Cross-model retained prompt'));
      canonical(flat);
      result.reviewRequired = plan.review.required;
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed';
      result.error = String(error.message || error);
    }
    transitions.push(result);
  }
  const attachments = [];
  const registry = (await json('/nodes')).nodes;
  for (const target of starters) {
    const draft = author.createOperationStarter(target.starter, { x: 0, y: 0 });
    if (!visual.groupNewOperationGraph(draft).nodes.some(visual.visualOperationGroup)) continue;
    for (const choice of media.mediaAttachmentChoices(
      target.starter.nodes.map((n) => n.operation),
      target.selection.pipelineClass,
    )) {
      for (const mode of ['same-task', 'from-text']) {
        const from =
          mode === 'same-task'
            ? target
            : starters.find(
                (s) =>
                  s.selection.executionProfileId === target.selection.executionProfileId &&
                  s.selection.repository === target.selection.repository &&
                  s.selection.task === 'text_to_image',
              );
        if (!from || (mode === 'from-text' && target.selection.task === 'text_to_image')) continue;
        const result = { selection: target.selection, mode, role: choice.role, status: 'pending' };
        try {
          const graph = author.createOperationStarter(from.starter, { x: 0, y: 0 });
          const owner = graph.nodes.find((n) => contracts.operationOwnsModel(n.data.operationAuthoring?.operation));
          const source = factory.createNodeFromRegistry(
            choice.kind === 'audio' ? 'modules.Audio.Load' : 'modules.Image.Load',
            registry,
            { x: -400, y: 0 },
          );
          assert.ok(source, 'missing ordinary media source');
          graph.nodes.push(source);
          const grouped = visual.groupNewOperationGraph(graph);
          const descriptor = { nodeId: source.id, handleId: choice.kind };
          let expected, originalError;
          try {
            expected = media.planMediaAttachment(graph, owner.id, target.starter, choice, registry, descriptor);
          } catch (error) {
            originalError = error.message;
          }
          let actual, groupedError;
          try {
            actual = media.planMediaAttachment(grouped, owner.id, target.starter, choice, registry, descriptor);
          } catch (error) {
            groupedError = error.message;
          }
          if (originalError) {
            assert.equal(groupedError, originalError, 'grouping changed attachment rejection');
            result.status = 'guarded-same-as-ordinary';
            result.reason = originalError;
          } else {
            assert.equal(groupedError, undefined);
            assert.deepEqual(canonical(expanded(actual)), canonical(expected), 'attachment changed exported API');
            result.status = 'passed';
          }
        } catch (error) {
          result.status = 'failed';
          result.error = String(error.message || error);
        }
        attachments.push(result);
      }
    }
  }
  const tested = new Set(records.map((r) => r.selection.executionProfileId));
  const summary = {
    identity,
    checkedAt: new Date().toISOString(),
    publicProfiles: profiles.size,
    testedProfiles: new Set(records.map((r) => r.selection.executionProfileId).filter(Boolean)).size,
    cases: records.map(({ starter, ...r }) => r),
    transitions,
    attachments,
    profilesWithoutSelectableStarter: [...profiles.values()]
      .filter((p) => !tested.has(p.id))
      .map((p) => ({
        id: p.id,
        pipeline: p.pipeline_class,
        modes: p.modes,
        reason: 'No adapter task advertises this exact profile; no new grouping claim',
      })),
    attachmentChoices: media.mediaAttachmentChoices(catalog.operationContracts, 'StableDiffusionXLModularPipeline'),
  };
  await writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({
      cases: records.length,
      passed: records.filter((r) => r.status === 'passed').length,
      failures: records.filter((r) => r.status !== 'passed').length,
      testedProfiles: summary.testedProfiles,
      modelChanges: transitions.length,
      modelChangeFailures: transitions.filter((r) => r.status !== 'passed').length,
      attachments: attachments.length,
      attachmentFailures: attachments.filter((r) => r.status === 'failed').length,
    }),
  );
  process.exitCode =
    records.some((r) => r.status !== 'passed') ||
    transitions.some((r) => r.status !== 'passed') ||
    attachments.some((r) => r.status === 'failed')
      ? 1
      : 0;
} finally {
  await server.close();
}
