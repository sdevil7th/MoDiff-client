import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindMediaInputs,
  bindComponentInputs,
  clientSourceIdentity,
  imageCapturePath,
  imageCaptureIndices,
  modifyGraph,
  parseArgs,
  selectTask,
  serviceSessionId,
  unsettledTaskId,
  reviewedDownloadFiles,
  outputKindForTask,
  validateTextOutput,
  artifactNeedsDownload,
  routeDownloadSelections,
  campaignServiceInputs,
  fixedSeed,
  requestJson,
  CAMPAIGN_CASES,
} from './image-prototyping-campaign.mjs';

test('focused campaigns declare their exact case scope without changing the full default matrix', () => {
  assert.equal(parseArgs(['node', 'runner', 'plan']).cases, undefined);
  assert.equal(CAMPAIGN_CASES.length, 12);
  assert.deepEqual(parseArgs(['node', 'runner', 'plan', '--cases', 'baseline,seed']).cases, ['baseline', 'seed']);
  for (const cases of ['seed', 'baseline,unknown', 'baseline,seed,seed', 'baseline,'])
    assert.throws(() => parseArgs(['node', 'runner', 'plan', '--cases', cases]), /Cases must/);
});

test('JSON transport honors one deadline for delayed headers and stalled bodies', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/headers') {
      const timer = setTimeout(() => res.end(JSON.stringify({ ok: true })), 80);
      res.on('close', () => clearTimeout(timer));
    } else if (req.url === '/body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
    } else if (req.url === '/echo') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () =>
        res.end(
          JSON.stringify({
            method: req.method,
            length: req.headers['content-length'],
            body: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        ),
      );
    } else if (req.url === '/error') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'review required' }));
    } else res.end('invalid JSON');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await requestJson(`${base}/headers`, undefined, 2000), { ok: true });
  const body = { nodes: ['channel-µ'], scope: 'outputs' };
  for (const method of ['POST', 'DELETE'])
    assert.deepEqual(await requestJson(`${base}/echo`, body, 2000, method), {
      method,
      length: String(Buffer.byteLength(JSON.stringify(body))),
      body,
    });
  for (const path of ['/headers', '/body'])
    await assert.rejects(requestJson(`${base}${path}`, undefined, 20), /abort/i);
  await assert.rejects(requestJson(`${base}/error`), /review required/);
  await assert.rejects(requestJson(`${base}/invalid`), SyntaxError);
  for (const deadline of [0, -1, NaN, 1.5]) assert.throws(() => requestJson(base, undefined, deadline), /deadline/);
});

test('utility variations skip deterministic filter seeds and change the default red channel', () => {
  const graph = {
    nodes: [
      {
        id: 'utility',
        data: {
          params: {
            filter_operation: { value: 'gaussian_blur' },
            seed: { value: 1 },
            channel: { value: 'red', options: ['red', 'green', 'blue'] },
          },
        },
      },
    ],
    edges: [],
  };
  assert.equal(modifyGraph(graph, 'seed', { task: 'image_filter' }), null);
  graph.nodes[0].data.params.filter_operation.value = 'film_grain';
  assert.equal(modifyGraph(graph, 'seed', { task: 'image_filter' }).graph.nodes[0].data.params.seed.value, 271829);
  assert.equal(
    modifyGraph(graph, 'task-setting', { task: 'image_channels' }).graph.nodes[0].data.params.channel.value,
    'green',
  );
  assert.equal(graph.nodes[0].data.params.channel.value, 'red');
  graph.nodes[0].data.params.channel = {
    default: 'luminance',
    options: ['red', 'green', 'blue', 'luminance'].map((value) => ({
      schemaVersion: 1,
      value,
      label: value,
      compatibility: 'compatible',
    })),
  };
  assert.equal(
    modifyGraph(graph, 'task-setting', { task: 'image_channels' }).graph.nodes[0].data.params.channel.value,
    'red',
  );
  graph.nodes[0].data.params.channel.options[0].compatibility = 'incompatible';
  assert.equal(modifyGraph(graph, 'task-setting', { task: 'image_channels' }), null);
});

test('non-square changes at the minimum use the next declared grid point within bounds', () => {
  const graph = {
    nodes: [{ id: 'denoise', data: { params: { width: { value: 512, min: 512, max: 1536, step: 16 } } } }],
    edges: [],
  };
  assert.equal(modifyGraph(graph, 'non-square').graph.nodes[0].data.params.width.value, 528);
  graph.nodes[0].data.params.width.max = 512;
  assert.equal(modifyGraph(graph, 'non-square'), null);
});

test('capture includes every task-bound output image without probing clamped cache indexes', () => {
  const output = {
    nodeId: 'preview',
    fieldKey: 'preview',
    taskId: 'task',
    mediaItems: [0, 1, 2].map((index) => ({ index, displayType: 'image', taskId: 'task' })),
  };
  assert.deepEqual(imageCaptureIndices({ outputs: [output] }, 'preview', 'task'), [0, 1, 2]);
  assert.equal(imageCapturePath('preview', 2), '/cache/preview/output/2?format=PNG');
  for (const index of [-1, 64, 0.5, '1']) assert.throws(() => imageCapturePath('preview', index));
  for (const outputs of [[], [output, output], [{ ...output, taskId: 'old' }]])
    assert.throws(() => imageCaptureIndices({ outputs }, 'preview', 'task'), /task-bound/);
  for (const mediaItems of [
    [],
    Array(65).fill(output.mediaItems[0]),
    [{ index: 1, displayType: 'image', taskId: 'task' }],
    [{ index: 0, displayType: 'video', taskId: 'task' }],
    [{ index: 0, displayType: 'image', taskId: 'old' }],
  ])
    assert.throws(() => imageCaptureIndices({ outputs: [{ ...output, mediaItems }] }, 'preview', 'task'));
});

test('ordinary integer seeds stay integers and inactive media sockets stay unwired', () => {
  assert.equal(fixedSeed({ type: 'int' }, 42), 42);
  assert.deepEqual(fixedSeed({ type: 'int', display: 'random' }, 42), { value: 42, isRandom: false });
  const graph = {
    nodes: [{ id: 'operation', data: { params: { mask: { type: 'image', display: 'input', hidden: true } } } }],
    edges: [],
  };
  bindMediaInputs(graph, { mask: { sourceFile: '@data/images/mask.png' } }, () => {
    throw new Error('Inactive socket must not construct a loader');
  });
  assert.equal(graph.edges.length, 0);
});

test('guidance and task-setting cases edit consumed controls rather than connected fallbacks', () => {
  const graph = {
    nodes: [
      { id: 'denoise', data: { params: { guidance_scale: { value: 5, step: 0.5, max: 20 } } } },
      { id: 'guider', data: { params: { guidance_scale: { value: 5, step: 0.5, max: 20 } } } },
    ],
    edges: [{ source: 'guider', target: 'denoise', targetHandle: 'guider' }],
  };
  const changed = modifyGraph(graph, 'guidance');
  assert.deepEqual(changed.changed, ['guider.guidance_scale']);
  assert.equal(changed.graph.nodes[0].data.params.guidance_scale.value, 5);
  assert.equal(changed.graph.nodes[1].data.params.guidance_scale.value, 5.5);
  const utility = {
    nodes: [
      {
        id: 'image',
        data: { params: { brightness: { value: 1, min: 0, max: 4 }, width: { value: 512, hidden: true } } },
      },
    ],
    edges: [],
  };
  assert.equal(
    modifyGraph(utility, 'task-setting', { task: 'image_adjustment' }).graph.nodes[0].data.params.brightness.value,
    1.25,
  );
  assert.equal(modifyGraph(utility, 'task-setting', { task: 'text_to_image' }), null);
  utility.edges.push({ target: 'image', targetHandle: 'brightness' });
  assert.equal(modifyGraph(utility, 'task-setting', { task: 'image_adjustment' }), null);
});

test('explicit multi-reference fixtures retain order and have bounded cardinality', () => {
  const makeGraph = () => ({
    nodes: [{ id: 'edit', data: { params: { images: { type: 'image', display: 'input' } } } }],
    edges: [],
  });
  const files = ['@data/images/a.png', '@data/images/b.png'];
  const graph = makeGraph();
  const alternatives = bindMediaInputs(
    graph,
    { images: { sourceFile: files, alternateSourceFile: [...files].reverse() } },
    () => ({ id: 'load', data: { params: { file: {} } } }),
  );
  assert.deepEqual(graph.nodes[1].data.params.file.value, files);
  assert.notEqual(graph.nodes[1].data.params.file.value, files);
  assert.deepEqual(alternatives[0].sourceFile, [...files].reverse());
  for (const sourceFile of [[], [''], Array(17).fill('a')])
    assert.throws(() => bindMediaInputs(makeGraph(), { images: { sourceFile } }, () => null), /at most 16/);
});

test('service reference paths are explicit invocation inputs, never portable embedded defaults', () => {
  const graph = {
    nodes: {
      source: { module: 'modules.Image', action: 'Load', params: { file: { value: '@data/images/source.png' } } },
      mask: { module: 'modules.Image', action: 'Load', params: { file: { value: '@data/images/mask.png' } } },
      generate: { module: 'modules.Example', action: 'Generate', params: { prompt: { value: 'Edited prompt' } } },
    },
  };
  const candidates = {
    inputs: [
      { nodeId: 'source', field: 'file' },
      { nodeId: 'mask', field: 'file' },
      { nodeId: 'generate', field: 'prompt' },
    ],
  };
  const before = structuredClone(graph);
  const result = campaignServiceInputs(candidates, graph);
  assert.deepEqual(result.values, {
    prompt: 'Edited prompt',
    source_1: '@data/images/source.png',
    source_2: '@data/images/mask.png',
  });
  assert.deepEqual(result.inputs.source_1, [{ nodeId: 'source', field: 'file' }]);
  assert.deepEqual(graph, before);
  graph.nodes.second = { params: { prompt: { value: 'Different prompt' } } };
  assert.throws(
    () => campaignServiceInputs({ inputs: [...candidates.inputs, { nodeId: 'second', field: 'prompt' }] }, graph),
    /implicit coalescing/,
  );
});

test('caption routes require bounded meaningful UTF-8 text instead of an unrelated image output', () => {
  assert.equal(outputKindForTask('image_to_text'), 'text');
  assert.equal(outputKindForTask('depth_estimation'), 'image');
  assert.equal(validateTextOutput(Buffer.from('A blue circle.')).characters, 14);
  for (const text of ['', '  ', 'null', 'undefined', 'None'])
    assert.throws(() => validateTextOutput(Buffer.from(text)), /no meaningful text/);
  assert.throws(() => validateTextOutput(Buffer.alloc(1024 * 1024 + 1)), /limit/);
  assert.throws(() => validateTextOutput(Buffer.from([0xff])), /encoded data/);
  const graph = { nodes: [{ id: 'caption', data: { params: { prompt: { value: 'Describe it.' } } } }], edges: [] };
  assert.match(
    modifyGraph(graph, 'prompt', { task: 'image_to_text' }).graph.nodes[0].data.params.prompt.value,
    /visible colors/,
  );
});

test('procedural built-in image operations do not issue Hub downloads', () => {
  assert.equal(artifactNeedsDownload({ artifact: { repository: 'builtin://modiff/image-operations/v1' } }), false);
  assert.equal(artifactNeedsDownload({ artifact: { repository: null } }), false);
  assert.equal(artifactNeedsDownload({ artifact: { repository: 'owner/model' } }), true);
});

test('task downloads include only exact declared component requirements for the selected mode', () => {
  const route = { task: 'control_image', artifact: { repository: 'owner/base', revision: 'a'.repeat(40) } };
  const requirement = {
    repo: 'owner/control',
    revision: 'b'.repeat(40),
    downloadFiles: ['config.json', 'model.safetensors'],
  };
  const capability = {
    defaultRepo: 'owner/base',
    downloadFiles: ['model_index.json'],
    modeRequirements: {
      control_image: { modelRequirements: [requirement, requirement] },
      edit_image: { modelRequirements: [{ ...requirement, repo: 'owner/unrelated' }] },
    },
  };
  const result = routeDownloadSelections(route, capability);
  assert.deepEqual(
    result.map((selection) => selection.repository),
    ['owner/base', 'owner/control'],
  );
  assert.deepEqual(result[1].files, requirement.downloadFiles);
  assert.equal(routeDownloadSelections({ ...route, task: 'text_to_image' }, capability).length, 1);
  requirement.revision = 'main';
  assert.throws(() => routeDownloadSelections(route, capability), /exact reviewed/);
});

test('explicit component fixtures use a real pinned loader and never overwrite an owned wire', () => {
  const graph = {
    nodes: [
      {
        id: 'owner',
        data: {
          operationAuthoring: { operation: { operationId: 'diffusion.load_models' } },
          params: { controlnet: { type: 'diffusers_auto_model', display: 'input' } },
        },
      },
    ],
    edges: [],
  };
  const create = () => ({
    id: 'controlnet',
    data: {
      params: {
        model: { type: 'diffusers_auto_model', display: 'output' },
        revision: { value: '' },
        model_id: {},
        model_type: {},
        trust_remote_code: { value: false },
      },
    },
  });
  const bindings = [
    {
      operationId: 'diffusion.load_models',
      field: 'controlnet',
      nodeKey: 'modules.ModularDiffusers.AutoModelLoader',
      values: {
        model_type: 'controlnet',
        model_id: { source: 'hub', value: 'owner/component' },
        revision: 'a'.repeat(40),
      },
    },
  ];
  const compatible = (a, b) => a === b;
  const before = structuredClone(graph);
  assert.throws(
    () =>
      bindComponentInputs(
        graph,
        [{ ...bindings[0], values: { ...bindings[0].values, revision: 'main' } }],
        create,
        compatible,
      ),
    /immutable/,
  );
  assert.deepEqual(graph, before);
  bindComponentInputs(graph, bindings, create, compatible);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges[0].targetHandle, 'controlnet');
  assert.throws(() => bindComponentInputs(graph, bindings, create, compatible), /already connected/);
  assert.throws(
    () => bindComponentInputs(before, [{ ...bindings[0], values: { trust_remote_code: true } }], create, compatible),
    /reviewed/,
  );
});

test('an explicit CFG fixture shares one guider with matching operation owners', () => {
  const graph = {
    nodes: ['adapter', 'denoise'].map((id) => ({
      id,
      data: {
        operationAuthoring: { operation: { operationId: id, pipelineClass: 'StableDiffusionXLModularPipeline' } },
        params: { guider: { display: 'input', type: 'custom_guider' } },
      },
    })),
    edges: [],
  };
  const bindings = [
    {
      nodeKey: 'modules.ModularDiffusers.Guider',
      values: { guider: 'ClassifierFreeGuidance', guidance_scale: 5 },
      targets: graph.nodes.map((node) => ({ operationId: node.id, field: 'guider' })),
    },
  ];
  bindComponentInputs(
    graph,
    bindings,
    () => ({
      id: 'cfg',
      data: {
        params: {
          guider: {},
          guidance_scale: {},
          model_type: {},
          guider_out: { display: 'output', type: 'custom_guider' },
        },
      },
    }),
    (a, b) => a === b,
  );
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.edges.every((edge) => edge.source === 'cfg'));
  assert.equal(graph.nodes[2].data.params.model_type.value, 'StableDiffusionXLModularPipeline');
  assert.equal(graph.nodes[2].data.params.guider_out.signal.value, 'StableDiffusionXLModularPipeline');
});

test('analysis and upscale routes vary only explicitly supplied reference fixtures', () => {
  const graph = { nodes: [{ id: 'source', data: { params: { file: { value: '@data/images/a.png' } } } }], edges: [] };
  assert.equal(modifyGraph(graph, 'reference'), null);
  const result = modifyGraph(graph, 'reference', {
    alternateInputs: [{ nodeId: 'source', sourceFile: '@data/images/b.png' }],
  });
  assert.equal(result.graph.nodes[0].data.params.file.value, '@data/images/b.png');
  assert.deepEqual(result.changed, ['source.file']);
  assert.equal(graph.nodes[0].data.params.file.value, '@data/images/a.png');
});

test('terminal failure clears active ownership so independent cases can advance', () => {
  for (const status of ['completed', 'error', 'failed', 'cancelled'])
    assert.equal(unsettledTaskId('owned-task', status), null);
  for (const status of ['running', 'queued', undefined])
    assert.equal(unsettledTaskId('owned-task', status), 'owned-task');
});

test('alternate artifact downloads require the backend exact pinned limited selection', () => {
  const revision = 'a'.repeat(40);
  const route = { artifact: { repository: 'owner/alternate', revision } };
  const plan = {
    repoId: 'owner/alternate',
    revision,
    snapshotCommit: revision,
    selectionLimited: true,
    sizeKnown: true,
    requestedFiles: ['model.safetensors'],
  };
  assert.deepEqual(reviewedDownloadFiles(route, plan), ['model.safetensors']);
  for (const patch of [
    { repoId: 'owner/base' },
    { revision: 'main' },
    { snapshotCommit: 'b'.repeat(40) },
    { selectionLimited: false },
    { sizeKnown: false },
    { requestedFiles: [] },
  ])
    assert.throws(() => reviewedDownloadFiles(route, { ...plan, ...patch }), /No exact reviewed/);
});

test('image capture uses the statically declared Preview media boundary', () => {
  assert.equal(imageCapturePath('preview-1'), '/cache/preview-1/output/0?format=PNG');
  assert.equal(imageCapturePath('unsafe/id'), '/cache/unsafe%2Fid/output/0?format=PNG');
});

test('service session IDs obey the real service API grammar for long artifact route names', () => {
  const route = 'ddpm-cifar10:direct/unconditional_image@owner/' + 'variant.'.repeat(40);
  const id = serviceSessionId(route);
  assert.match(id, /^[A-Za-z][A-Za-z0-9_]{0,63}$/);
  assert.equal(serviceSessionId(route), id);
  assert.notEqual(serviceSessionId(route + '-other'), id);
});

test('explicit conditioning files use registered image loader wires, never raw path values as tensors', () => {
  const graph = {
    nodes: [{ id: 'encode', data: { params: { image: { type: 'image', display: 'input' } } } }],
    edges: [],
  };
  const createNode = () => ({ id: 'load', data: { params: { file: {} } } });
  bindMediaInputs(graph, { image: { sourceFile: '@data/images/fixture.png' } }, createNode);
  assert.equal(graph.nodes[1].data.params.file.value, '@data/images/fixture.png');
  assert.equal(graph.nodes[0].data.params.image.value, undefined);
  assert.equal(graph.edges[0].targetHandle, 'image');
  assert.throws(
    () => bindMediaInputs(graph, { image: { sourceFile: '@data/images/other.png' } }, createNode),
    /overwrite/,
  );
});

test('campaign source inventory detects implementation and bundle changes, not output logs', () => {
  const root = mkdtempSync(join(tmpdir(), 'image-campaign-source-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'src', 'authoring.ts'), 'original');
    writeFileSync(join(root, 'dist', 'index.html'), 'original bundle');
    const initial = clientSourceIdentity(root);
    writeFileSync(join(root, 'run.log'), 'new evidence');
    assert.deepEqual(clientSourceIdentity(root), initial);
    writeFileSync(join(root, 'dist', 'index.html'), 'new bundle');
    assert.notEqual(clientSourceIdentity(root).fingerprint, initial.fingerprint);
    const built = clientSourceIdentity(root);
    writeFileSync(join(root, 'src', 'authoring.ts'), 'fixed');
    assert.notEqual(clientSourceIdentity(root).fingerprint, built.fingerprint);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('campaign requires exact operation task or one reviewed workflow match', () => {
  const route = {
    task: 'modular_text_to_image',
    canonicalTask: 'text_to_image',
    implementation: { pipelineClass: 'Example' },
    upstream: { nativeWorkflowId: 'text2image' },
  };
  assert.equal(selectTask(route, [{ pipelineClass: 'Example', task: 'text_to_image' }]), 'text_to_image');
  assert.equal(selectTask(route, [{ pipelineClass: 'Example', task: 'alias', workflowId: 'text2image' }]), 'alias');
  assert.throws(() => selectTask(route, [{ pipelineClass: 'Other', task: 'text_to_image' }]), /No unambiguous/);
  assert.throws(
    () =>
      selectTask(
        route,
        ['a', 'b'].map((task) => ({ pipelineClass: 'Example', task, workflowId: 'text2image' })),
      ),
    /No unambiguous/,
  );
});

test('sequential modifications are pure and respect declared bounds', () => {
  const graph = {
    nodes: [
      {
        id: 'stage',
        data: {
          params: {
            prompt: { type: 'text', value: 'Original' },
            seed: { type: 'int', display: 'random', value: { value: 5, isRandom: false } },
            num_inference_steps: { type: 'int', value: 8, min: 1, max: 8 },
            width: { type: 'int', value: 1024, min: 512, max: 2048, step: 32 },
          },
        },
      },
    ],
    edges: [],
  };
  const before = structuredClone(graph);
  assert.deepEqual(modifyGraph(graph, 'repeat').graph, graph);
  const prompt = modifyGraph(graph, 'prompt').graph;
  const seeded = modifyGraph(prompt, 'seed').graph;
  assert.equal(seeded.nodes[0].data.params.prompt.value, prompt.nodes[0].data.params.prompt.value);
  assert.deepEqual(modifyGraph(graph, 'steps').changed, ['stage.num_inference_steps']);
  assert.equal(modifyGraph(graph, 'steps').graph.nodes[0].data.params.num_inference_steps.value, 7);
  assert.equal(modifyGraph(graph, 'non-square').graph.nodes[0].data.params.width.value, 992);
  assert.deepEqual(graph, before);
  graph.nodes[0].data.params.width.value = 512;
  assert.equal(modifyGraph(graph, 'non-square').graph.nodes[0].data.params.width.value, 544);
});

test('downloads are explicit and unknown arguments do not silently pass', () => {
  assert.equal(parseArgs(['node', 'script', 'plan']).download, false);
  assert.equal(parseArgs(['node', 'script', 'plan', '--download']).download, true);
  assert.throws(() => parseArgs(['node', 'script', 'plan', '--unknown', 'x']), /Unknown option/);
});
