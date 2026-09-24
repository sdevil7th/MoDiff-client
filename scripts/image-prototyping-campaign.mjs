#!/usr/bin/env node
/** Serial API qualification using the real operation starter, client exporter,
 * and backend graph executor. This is NOT browser-gesture or visual approval.
 * Each route owns a fresh backend process; only its process tree is stopped.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { runCli, writeJsonAtomic } from './example-generation-queue.mjs';
import { backendSourceIdentity } from './live-proof-provenance.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND = resolve(process.env.MODIFF_BACKEND_DIR || join(ROOT, '..', 'MoDiff'));
const SCRIPT = fileURLToPath(import.meta.url);
const SERVER = 'http://127.0.0.1:8088';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const safe = (id) => id.replace(/[^a-z0-9_.-]+/gi, '-');
export const CAMPAIGN_CASES = [
  'baseline',
  'repeat',
  'prompt',
  'seed',
  'steps',
  'guidance',
  'task-setting',
  'non-square',
  'reference',
  'service',
  'recompute',
  'release-models',
];
// Service package names deliberately have a narrower grammar than route IDs.
// Hashing keeps long artifact variants bounded and avoids sanitization aliases.
export const serviceSessionId = (routeId) => `image_service_${hash(routeId).slice(0, 40)}`;
export const unsettledTaskId = (taskId, status) =>
  ['completed', 'error', 'failed', 'cancelled'].includes(status) ? null : taskId;
export const fixedSeed = (field, value) =>
  field.display === 'random' || typeof field.value?.isRandom === 'boolean' ? { value, isRandom: false } : value;

export function campaignServiceInputs(candidates, graph) {
  const inputs = {};
  const values = {};
  const prompts = candidates.inputs.filter((item) => item.field === 'prompt');
  const promptValues = prompts.map((item) => graph.nodes[item.nodeId].params[item.field].value);
  if (promptValues.some((value) => typeof value !== 'string' || value !== promptValues[0]))
    throw new Error('Service prompt bindings are not one shared string; refusing implicit coalescing.');
  if (prompts.length) {
    inputs.prompt = prompts.map(({ nodeId, field }) => ({ nodeId, field }));
    values.prompt = promptValues[0];
  }
  for (const { nodeId, field } of candidates.inputs) {
    const node = graph.nodes[nodeId];
    if (node.module !== 'modules.Image' || node.action !== 'Load' || field !== 'file') continue;
    const name = `source_${Object.keys(inputs).length}`;
    inputs[name] = [{ nodeId, field }];
    values[name] = structuredClone(node.params[field].value);
  }
  return { inputs, values };
}

export function reviewedDownloadFiles(route, plan) {
  if (
    plan.repoId !== route.artifact.repository ||
    plan.revision !== route.artifact.revision ||
    plan.snapshotCommit !== route.artifact.revision ||
    !plan.selectionLimited ||
    !plan.sizeKnown ||
    !Array.isArray(plan.requestedFiles) ||
    !plan.requestedFiles.length ||
    plan.requestedFiles.some((file) => typeof file !== 'string' || !file.trim())
  )
    throw new Error('No exact reviewed download file selection for this artifact; not guessing weight files.');
  return plan.requestedFiles;
}
// Dynamic native outputs are intentionally not HTTP cache-servable. Preview's
// static image output is the public media boundary used by the actual UI.
export const imageCapturePath = (previewId, index = 0) => {
  if (!Number.isInteger(index) || index < 0 || index >= 64) throw new Error('Invalid bounded image index.');
  return `/cache/${encodeURIComponent(previewId)}/output/${index}?format=PNG`;
};
export function imageCaptureIndices(run, previewId, taskId) {
  const outputs = (run.outputs ?? []).filter(
    (item) => item.nodeId === previewId && item.fieldKey === 'preview' && item.taskId === taskId,
  );
  if (outputs.length !== 1) throw new Error('Expected one task-bound Preview output receipt.');
  const items = outputs[0].mediaItems;
  if (!Array.isArray(items) || !items.length || items.length > 64)
    throw new Error('Expected between 1 and 64 declared output images.');
  return items.map((item, index) => {
    if (item.index !== index || item.displayType !== 'image' || item.taskId !== taskId)
      throw new Error('Output image cardinality/order/task identity is inconsistent.');
    return index;
  });
}
export const outputKindForTask = (task) => (task === 'image_to_text' ? 'text' : 'image');
export const artifactNeedsDownload = (route) =>
  Boolean(route.artifact.repository && !route.artifact.repository.startsWith('builtin://'));
export function routeDownloadSelections(route, capability) {
  const selections = artifactNeedsDownload(route)
    ? [
        {
          repository: route.artifact.repository,
          revision: route.artifact.revision,
          files: capability?.defaultRepo === route.artifact.repository ? capability.downloadFiles : undefined,
        },
      ]
    : [];
  const requirements =
    capability?.modeRequirements?.[route.task]?.modelRequirements ??
    capability?.modeRequirements?.[route.canonicalTask]?.modelRequirements ??
    [];
  for (const item of requirements) {
    if (
      typeof item.repo !== 'string' ||
      !item.repo.includes('/') ||
      !/^[a-f0-9]{40}$/.test(item.revision ?? '') ||
      !Array.isArray(item.downloadFiles) ||
      !item.downloadFiles.length ||
      item.downloadFiles.some((file) => typeof file !== 'string' || !file.trim())
    )
      throw new Error('A task component lacks its exact reviewed download selection.');
    selections.push({ repository: item.repo, revision: item.revision, files: item.downloadFiles });
  }
  return [
    ...new Map(selections.map((item) => [JSON.stringify([item.repository, item.revision, item.files]), item])).values(),
  ];
}
export function validateTextOutput(bytes) {
  if (bytes.length > 1024 * 1024) throw new Error('Text output exceeds the bounded 1 MiB review limit.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.trim() || ['null', 'undefined', 'None'].includes(text.trim()))
    throw new Error('The image-to-text route returned no meaningful text.');
  return { characters: text.length, utf8Bytes: bytes.length, preview: text.slice(0, 500) };
}

// Reuse the backend's source inventory contract. The paired client inventory
// includes the actual exporter, authoring code, runner and built bundle. A
// ledger-only hash would miss fixes made without changing advertised routes.
export function clientSourceIdentity(root) {
  const files = [];
  const walk = (relative) => {
    const path = join(root, relative);
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push({ path: child, sha256: hash(readFileSync(join(root, child))) });
    }
  };
  for (const directory of ['src', 'scripts', 'dist']) walk(directory);
  for (const name of [
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'tests/e2e/live-backend/imageProofStatistics.ts',
  ])
    if (existsSync(join(root, name))) files.push({ path: name, sha256: hash(readFileSync(join(root, name))) });
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { fingerprint: hash(JSON.stringify(files)), files };
}

function sourceIdentity() {
  return { backend: backendSourceIdentity(BACKEND), client: clientSourceIdentity(ROOT) };
}

function assertFrozenSources(output) {
  const frozen = read(join(output, 'source-snapshot.json'));
  const current = sourceIdentity();
  for (const side of ['backend', 'client'])
    if (current[side].fingerprint !== frozen[side].fingerprint)
      throw new Error(`${side} source or bundle changed; start a new campaign. Previous evidence is preserved.`);
  return frozen;
}

export function parseArgs(argv) {
  const args = { command: argv[2] ?? 'help', output: join(ROOT, 'artifacts', 'image-prototyping'), download: false };
  for (let i = 3; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--download') {
      args.download = true;
      continue;
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} needs a value.`);
    if (key === '--output') args.output = resolve(value);
    else if (key === '--route') args.route = value;
    else if (key === '--budget-ms') args.budgetMs = Number(value);
    else if (key === '--inputs') args.inputs = resolve(value);
    else if (key === '--prioritize') args.prioritize = value.split(',');
    else if (key === '--cases') {
      args.cases = value.split(',');
      if (
        args.cases[0] !== 'baseline' ||
        new Set(args.cases).size !== args.cases.length ||
        args.cases.some((name) => !CAMPAIGN_CASES.includes(name))
      )
        throw new Error('Cases must start with baseline and contain unique declared case names.');
    } else throw new Error(`Unknown option ${key}`);
  }
  return args;
}

// Core HTTP avoids fetch's independent five-minute header deadline during
// synchronous Hub downloads. One absolute deadline covers headers AND body.
export function requestJson(url, body, timeoutMs = 30_000, method = body === undefined ? 'GET' : 'POST') {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid HTTP deadline.');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        ...(payload === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }),
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('error', reject);
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 64 * 1024 * 1024) req.destroy(new Error('JSON response exceeds 64 MiB limit.'));
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (res.statusCode < 200 || res.statusCode >= 300 || value?.error)
              throw new Error(
                `${method} ${new URL(url).pathname}: ${value?.message || value?.error || res.statusCode}`,
              );
            resolve(value);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const request = (path, body, timeoutMs, method) => requestJson(new URL(path, SERVER), body, timeoutMs, method);

export function selectTask(route, contracts) {
  const choices = contracts.filter((c) => c.pipelineClass === route.implementation.pipelineClass);
  for (const task of [route.task, route.canonicalTask]) if (choices.some((c) => c.task === task)) return task;
  const tasks = [
    ...new Set(choices.filter((c) => c.workflowId === route.upstream.nativeWorkflowId).map((c) => c.task)),
  ];
  if (tasks.length === 1) return tasks[0];
  throw new Error('No unambiguous operation starter for this exact advertised profile/task.');
}

export function modifyGraph(graph, variant, { task, alternateInputs = [] } = {}) {
  const result = structuredClone(graph);
  const changed = [];
  for (const node of result.nodes) {
    for (const [name, field] of Object.entries(node.data.params)) {
      if (field.display === 'output' || field.hidden) continue;
      if (graph.edges.some((edge) => edge.target === node.id && edge.targetHandle === name)) continue;
      let value;
      if (variant === 'reference' && name === 'file')
        value = alternateInputs.find((input) => input.nodeId === node.id)?.sourceFile;
      if (variant === 'prompt' && name === 'prompt')
        value =
          task === 'image_to_text'
            ? 'Describe the visible colors, shapes and their relative positions in this image.'
            : 'A ceramic teapot beside three ripe oranges on blue linen, soft morning light.';
      if (variant === 'seed' && name === 'seed') {
        const operation = node.data.params.filter_operation ?? node.data.params.operation;
        if (task !== 'image_filter' || (operation?.value ?? operation?.default) === 'film_grain')
          value = fixedSeed(field, 271829);
      }
      if (variant === 'steps' && ['steps', 'num_inference_steps'].includes(name)) {
        const old = Number(field.value ?? field.default);
        const next = old > Number(field.min ?? 1) ? old - 1 : old + 1;
        if (Number.isFinite(next) && next >= Number(field.min ?? 1) && next <= Number(field.max ?? old)) value = next;
      }
      if (variant === 'guidance' && ['guidance_scale', 'guidance_scale_2', 'true_cfg_scale'].includes(name)) {
        const connectedGuider = graph.edges.some((edge) => edge.target === node.id && edge.targetHandle === 'guider');
        const disabledSecondary = name === 'guidance_scale_2' && node.data.params.use_guidance_scale_2?.value === false;
        const old = Number(field.value ?? field.default);
        const next = old + Number(field.step ?? 0.5);
        if (!connectedGuider && !disabledSecondary && Number.isFinite(next) && next <= Number(field.max ?? 100))
          value = next;
      }
      if (variant === 'task-setting') {
        const settings = {
          image_adjustment: { brightness: 1.25 },
          image_filter: { amount: 2 },
          image_crop: { x: 16 },
          image_upscale: { downscale: 0.75, resize_width: 768 },
          image_channels: { channel: (field.value ?? field.default) === 'red' ? 'green' : 'red' },
          image_tile: { rows: 3 },
          image_stitch: { stitch_spacing: 8 },
          mask_composite: { composite_invert_mask: true },
          depth_estimation: { processing_resolution: 392 },
          image_to_text: { max_new_tokens: 80 },
          image_to_image: { strength: 0.6 },
          edit_image: { strength: 0.6 },
          inpaint: { strength: 0.6 },
        };
        const next = settings[task]?.[name];
        if (
          next !== undefined &&
          next !== (field.value ?? field.default) &&
          (typeof next !== 'number' ||
            (next >= Number(field.min ?? -Infinity) && next <= Number(field.max ?? Infinity))) &&
          (!Array.isArray(field.options) ||
            field.options.some((option) =>
              option !== null && typeof option === 'object'
                ? option.value === next && option.compatibility !== 'incompatible'
                : option === next,
            ))
        )
          value = next;
      }
      if (variant === 'non-square' && name === 'width') {
        const old = Number(field.value ?? field.default);
        const step = Number(field.step ?? 64);
        const minimum = Number(field.min ?? 64);
        const next = old - step >= minimum ? old - step : old + step;
        if (Number.isFinite(next) && next >= minimum && next <= Number(field.max ?? Infinity)) value = next;
      }
      if (value !== undefined) {
        field.value = value;
        changed.push(`${node.id}.${name}`);
      }
    }
  }
  if (!['baseline', 'repeat', 'service', 'recompute', 'release-models'].includes(variant) && !changed.length)
    return null;
  return { graph: result, changed };
}

export function bindMediaInputs(graph, inputs, createNode) {
  const validFiles = (value) => {
    const files = Array.isArray(value) ? value : [value];
    return files.length > 0 && files.length <= 16 && files.every((file) => typeof file === 'string' && file.trim());
  };
  const alternateInputs = [];
  const original = [...graph.nodes];
  for (const node of original) {
    for (const [field, param] of Object.entries(node.data.params)) {
      const value = inputs[field];
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'sourceFile')) continue;
      const types = Array.isArray(param.type) ? param.type : [param.type];
      if (param.display === 'output' || param.hidden || !types.includes('image')) continue;
      if (!validFiles(value.sourceFile))
        throw new Error(`Explicit media binding ${field} needs a nonempty sourceFile or at most 16 source files.`);
      if (
        value.alternateSourceFile !== undefined &&
        (!validFiles(value.alternateSourceFile) ||
          JSON.stringify(value.alternateSourceFile) === JSON.stringify(value.sourceFile))
      )
        throw new Error(`Explicit media binding ${field} needs a distinct nonempty alternateSourceFile.`);
      if (graph.edges.some((edge) => edge.target === node.id && edge.targetHandle === field))
        throw new Error(`Explicit media binding ${field} would overwrite a connected stage.`);
      const load = createNode('modules.Image.Load');
      if (!load) throw new Error('The registered Load Image node is unavailable.');
      load.data.params.file.value = structuredClone(value.sourceFile);
      if (value.alternateSourceFile) alternateInputs.push({ nodeId: load.id, sourceFile: value.alternateSourceFile });
      graph.nodes.push(load);
      graph.edges.push({
        id: `fixture-${load.id}-${field}`,
        source: load.id,
        sourceHandle: 'image',
        target: node.id,
        targetHandle: field,
      });
    }
  }
  return alternateInputs;
}

/** Explicit ordinary component loaders, never inferred from a model-family name. */
export function bindComponentInputs(graph, bindings, createNode, compatible) {
  if (bindings === undefined) return;
  if (!Array.isArray(bindings) || bindings.length > 16)
    throw new Error('componentSources must be a bounded list of explicit component bindings.');
  const nodes = [],
    edges = [];
  for (const binding of bindings) {
    if (
      !binding ||
      !['modules.ModularDiffusers.AutoModelLoader', 'modules.ModularDiffusers.Guider'].includes(binding.nodeKey) ||
      !binding.values ||
      typeof binding.values !== 'object' ||
      Array.isArray(binding.values) ||
      binding.values.trust_remote_code === true
    )
      throw new Error('Only explicit reviewed ordinary component loaders are supported.');
    const destinations = binding.targets ?? [{ operationId: binding.operationId, field: binding.field }];
    if (!Array.isArray(destinations) || !destinations.length || destinations.length > 8)
      throw new Error('A component requires one to eight explicit destinations.');
    const guider = binding.nodeKey === 'modules.ModularDiffusers.Guider';
    if (guider && binding.values.guider !== 'ClassifierFreeGuidance')
      throw new Error('This fixture helper only admits explicitly selected basic ClassifierFreeGuidance.');
    const output = guider ? 'guider_out' : 'model';
    const source = createNode(binding.nodeKey);
    if (!source?.data.params[output]) throw new Error('The explicit component source has no registered output.');
    for (const [field, value] of Object.entries(binding.values)) {
      if (!source.data.params[field] || source.data.params[field].display === 'output')
        throw new Error(`Component input ${field} is not declared by its registered loader.`);
      source.data.params[field].value = structuredClone(value);
    }
    if (!guider && !/^[a-f0-9]{40}$/.test(source.data.params.revision?.value ?? ''))
      throw new Error('Component loading requires an exact immutable revision.');
    nodes.push(source);
    let pipeline;
    for (const destination of destinations) {
      const targets = graph.nodes.filter(
        (node) => node.data.operationAuthoring?.operation.operationId === destination.operationId,
      );
      const target = targets[0];
      const input = target?.data.params[destination.field];
      if (
        targets.length !== 1 ||
        !input ||
        input.hidden ||
        input.display !== 'input' ||
        [...graph.edges, ...edges].some((edge) => edge.target === target.id && edge.targetHandle === destination.field)
      )
        throw new Error('An explicit component destination is missing, ambiguous, hidden or already connected.');
      if (!compatible(source.data.params[output].type, input.type))
        throw new Error('The explicit component source does not match the destination type.');
      if (guider) {
        const owner = target.data.operationAuthoring.operation.pipelineClass;
        if (!owner || (pipeline && pipeline !== owner))
          throw new Error('A guider cannot span different pipeline contracts.');
        pipeline = owner;
        // This is the same reverse pipeline signal carried by the canvas wire;
        // it does not grant a class outside the backend's Guider allowlist.
        source.data.params[output].signal = { direction: 'input', value: owner };
        if (!source.data.params.model_type) throw new Error('Guider lacks its replayable pipeline identity field.');
        source.data.params.model_type.value = owner;
      }
      edges.push({
        id: `component-${source.id}-${target.id}-${destination.field}`,
        source: source.id,
        sourceHandle: output,
        target: target.id,
        targetHandle: destination.field,
      });
    }
  }
  graph.nodes.push(...nodes);
  graph.edges.push(...edges);
}

function plan(args) {
  const ledgerPath = join(BACKEND, 'data', 'image-prototyping-readiness.v1.json');
  const ledger = read(ledgerPath);
  const configPath = join(args.output, 'queue.config.json');
  if (existsSync(configPath))
    throw new Error('Campaign already planned. Resume with run; use a new output directory for changed source.');
  mkdirSync(args.output, { recursive: true });
  const priorities = args.prioritize ?? [];
  if (priorities.some((id) => !ledger.routes.some((route) => route.routeId === id)))
    throw new Error('A prioritized route is not in the frozen denominator.');
  const ordered = [...ledger.routes].sort((a, b) => {
    const position = (id) => (priorities.includes(id) ? priorities.indexOf(id) : priorities.length);
    return position(a.routeId) - position(b.routeId);
  });
  // Keep every denominator row, including blocked/missing routes. Do not let a
  // convenient representative subset masquerade as complete model coverage.
  writeJsonAtomic(join(args.output, 'coverage-snapshot.json'), ledger);
  writeJsonAtomic(join(args.output, 'source-snapshot.json'), sourceIdentity());
  const inputSnapshot = args.inputs ? join(args.output, 'input-snapshot.json') : null;
  if (inputSnapshot) writeJsonAtomic(inputSnapshot, read(args.inputs));
  writeJsonAtomic(configPath, {
    schemaVersion: 1,
    defaults: { maxAttempts: 1, timeoutMs: 30 * 60_000 },
    jobs: ordered.map((route, index) => ({
      id: safe(route.routeId),
      description: route.routeId,
      priority: index,
      workingDirectory: ROOT,
      command: [
        process.execPath,
        SCRIPT,
        'route',
        '--route',
        route.routeId,
        '--output',
        args.output,
        ...(args.download ? ['--download'] : []),
        ...(inputSnapshot ? ['--inputs', inputSnapshot] : []),
        ...(args.cases ? ['--cases', args.cases.join(',')] : []),
      ],
    })),
  });
  console.log(`Planned ${ledger.routes.length} exact routes; ledger ${ledger.contentHash}. No model has run.`);
}

async function runRoute(args) {
  const sources = assertFrozenSources(args.output);
  const frozen = read(join(args.output, 'coverage-snapshot.json'));
  const current = read(join(BACKEND, 'data', 'image-prototyping-readiness.v1.json'));
  if (current.contentHash !== frozen.contentHash)
    throw new Error('Coverage changed; use a new campaign, do not relabel old evidence.');
  const route = frozen.routes.find((entry) => entry.routeId === args.route);
  if (!route) throw new Error('Unknown frozen route.');
  const output = join(args.output, 'routes', safe(route.routeId));
  mkdirSync(output, { recursive: true });
  const receipt = {
    schemaVersion: 1,
    routeId: route.routeId,
    ledgerHash: frozen.contentHash,
    sourceFingerprints: { backend: sources.backend.fingerprint, client: sources.client.fingerprint },
    proofLevel: 'api_native_execution',
    requestedCases: args.cases ?? CAMPAIGN_CASES,
    caseScope: args.cases ? 'selected_cases_only' : 'full_modification_matrix',
    browserGestures: 'not_tested',
    visualApproval: 'pending',
    startedAt: new Date().toISOString(),
    cases: [],
  };
  const save = () => writeJsonAtomic(join(output, 'receipt.json'), receipt);
  save();
  let backend, vite, browser;
  let taskId = null;
  const deadline = Date.now() + 28 * 60_000;
  try {
    // Never take over a user's server/queue. Owning the entire process lifetime
    // makes hard timeout recovery safe and avoids killing unrelated GPU tasks.
    let occupied = false;
    try {
      await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) });
      occupied = true;
    } catch {
      /* no listener */
    }
    if (occupied)
      throw new Error('Backend port is already occupied. Stop it explicitly before this isolated campaign.');
    backend = spawn(
      join(BACKEND, 'scripts/with-runtime-env.sh'),
      [join(BACKEND, '.venv/bin/python'), '-B', 'main.py'],
      { cwd: BACKEND, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
    );
    let launchError;
    backend.on('error', (error) => {
      launchError = error;
    });
    const startupDeadline = Date.now() + 90_000;
    while (true) {
      if (launchError || backend.exitCode !== null)
        throw launchError ?? new Error(`Owned backend exited: ${backend.exitCode}`);
      try {
        receipt.runtime = await request('/health', undefined, 5000);
        break;
      } catch (error) {
        if (Date.now() >= startupDeadline) throw error;
        await sleep(1000);
      }
    }
    const queue = await request('/queue');
    if (queue.current || Object.keys(queue.queued ?? {}).length)
      throw new Error('Recovered queue is not idle; refusing to disturb another run.');
    const catalog = await request('/model_capabilities', undefined, 60_000);
    const capability = catalog.capabilities.find((entry) => entry.modelType === route.modelType);
    const task = selectTask(route, catalog.operationContracts);
    const outputKind = outputKindForTask(route.canonicalTask);
    receipt.outputKind = outputKind;
    const starter = await request(
      '/operations/starter',
      {
        pipelineClass: route.implementation.pipelineClass,
        task,
        executionProfileId: route.implementation.profileId,
        ...(route.artifactVariantOf ? { repository: route.artifact.repository } : {}),
      },
      60_000,
    );
    writeJsonAtomic(join(output, 'starter.json'), starter);
    if (args.download) {
      const downloadDeadline = Math.min(deadline, Date.now() + 15 * 60_000);
      let selectionIndex = 0;
      for (const selection of routeDownloadSelections(route, capability)) {
        const query = new URLSearchParams({ repo_id: selection.repository, revision: selection.revision });
        // The backend owns allowlisted alternate-artifact selections too. An
        // omitted file query resolves that reviewed selection, not guessed files.
        for (const file of selection.files ?? []) query.append('file', file);
        const downloadPlan = await request(`/hf_download/plan?${query}`, undefined, 60_000);
        writeJsonAtomic(
          join(output, selectionIndex++ ? `component-download-plan-${selectionIndex}.json` : 'download-plan.json'),
          downloadPlan,
        );
        const files = reviewedDownloadFiles({ artifact: selection }, downloadPlan);
        if (downloadPlan.remainingBytes > 0) {
          if (Date.now() >= downloadDeadline) throw new Error('The shared task-download deadline expired.');
          if (!downloadPlan.fitsWithQueue)
            throw new Error('Insufficient disk headroom for exact download plan. No models deleted automatically.');
          await request(
            '/hf_download',
            { repo_id: selection.repository, revision: selection.revision, files },
            downloadDeadline - Date.now(),
          );
        }
      }
    }
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    globalThis.window = {
      localStorage: globalThis.localStorage,
      location: { origin: SERVER },
      dispatchEvent: () => true,
    };
    vite = await createServer({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      optimizeDeps: { entries: [], noDiscovery: true },
      server: { middlewareMode: true, watch: null },
      appType: 'custom',
    });
    const { createOperationStarter } = await vite.ssrLoadModule('/src/workflow/operationAuthoring.ts');
    const { buildApiGraphExport } = await vite.ssrLoadModule('/src/stores/flowGraphExport.ts');
    const { createNodeFromRegistry } = await vite.ssrLoadModule('/src/workflow/nodeFactory.ts');
    const { connectionTypesAreCompatible } = await vite.ssrLoadModule('/src/theme/connectionTypeCompatibility.ts');
    const registry = (await request('/nodes', undefined, 60_000)).nodes;
    const createNode = (key) => createNodeFromRegistry(key, registry, { x: 0, y: 700 });
    let graph = createOperationStarter(starter, { x: 0, y: 0 });
    const operationIds = new Set(graph.nodes.map((node) => node.id));
    const inputs = args.inputs ? (read(args.inputs)[route.routeId] ?? {}) : {};
    for (const node of graph.nodes)
      for (const [name, field] of Object.entries(node.data.params)) {
        if (Object.hasOwn(inputs, name) && !inputs[name]?.sourceFile) field.value = inputs[name];
        else if (name === 'prompt')
          field.value =
            outputKind === 'text'
              ? 'Describe what is visible in this image.'
              : 'A small brass observatory on a green hill under a clear starry sky.';
        else if (name === 'seed') field.value = fixedSeed(field, 271828);
      }
    const alternateInputs = bindMediaInputs(graph, inputs, createNode);
    bindComponentInputs(graph, inputs.componentSources, createNode, connectionTypesAreCompatible);
    // Required source media/components stay explicit. No hidden synthetic image
    // or unrelated model is substituted to make a route appear runnable.
    for (const required of starter.requiredInputs) {
      const node = graph.nodes.find(
        (entry) => entry.data.operationAuthoring?.operation.operationId === required.operationId,
      );
      const field = node?.data.params[required.field];
      if (
        !graph.edges.some((edge) => edge.target === node?.id && edge.targetHandle === required.field) &&
        (field?.value ?? field?.default) == null
      )
        throw new Error(`Required input is missing: ${required.operationId}.${required.field}`);
    }
    const outputCandidates = graph.nodes
      .filter((node) => operationIds.has(node.id))
      .flatMap((node) =>
        Object.entries(node.data.params)
          .filter(
            ([, field]) =>
              field.display === 'output' &&
              (outputKind === 'text'
                ? ['string', 'str', 'text'].includes(field.type)
                : field.type === 'image' || (Array.isArray(field.type) && field.type.includes('image'))),
          )
          .map(([field]) => ({ node, field })),
      );
    const terminal =
      outputKind === 'text' ? outputCandidates.find(({ field }) => field === 'text') : outputCandidates.at(-1);
    if (!terminal) throw new Error(`No declared ${outputKind} result for this task; refusing an unrelated output.`);
    const preview = createNode(outputKind === 'text' ? 'modules.Primitive.DataViewer' : 'modules.Image.Preview');
    if (!preview) throw new Error('The registered output review node is unavailable.');
    graph.nodes.push(preview);
    graph.edges.push({
      id: `preview-${terminal.node.id}`,
      source: terminal.node.id,
      sourceHandle: terminal.field,
      target: preview.id,
      targetHandle: outputKind === 'text' ? 'value' : 'image',
    });
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    const { decodedImageStatistics } = await vite.ssrLoadModule('/tests/e2e/live-backend/imageProofStatistics.ts');
    const variants = args.cases ?? CAMPAIGN_CASES;
    for (const variant of variants) {
      const modified = modifyGraph(graph, variant, { task: route.canonicalTask, alternateInputs });
      if (!modified) {
        receipt.cases.push({ variant, status: 'not_applicable', reason: 'No declared adjustable control.' });
        save();
        continue;
      }
      const entry = { variant, startedAt: new Date().toISOString(), changed: modified.changed };
      receipt.cases.push(entry);
      save();
      try {
        entry.resourcesBefore = await request('/runtime/resources', undefined, 15_000);
        if (variant === 'recompute' || variant === 'release-models') {
          entry.cacheAction = await request(
            '/cache',
            {
              nodes: graph.nodes.map((node) => node.id),
              ...(variant === 'recompute' ? { scope: 'outputs' } : {}),
            },
            60_000,
            'DELETE',
          );
          if (variant === 'recompute' && !Array.isArray(entry.cacheAction.retainedModelNodes))
            throw new Error('Backend did not attest the recompute/model-retention distinction.');
        }
        let apiGraph = buildApiGraphExport({
          ...modified.graph,
          sid: `image-campaign-${safe(route.routeId)}`,
          randomizeSeeds: false,
          targetNodeId: preview.id,
          setParam: () => {
            throw new Error('Campaign must not randomize saved controls.');
          },
        });
        apiGraph.runtimeHints = {
          source: 'graph',
          resourceMode: 'expert',
          modelType: route.modelType,
          mode: route.task,
          modelRepo: route.artifact.repository,
          workflowTitle: `Image prototyping — ${route.displayName} — ${variant}`,
        };
        if (variant === 'service') {
          const candidates = await request('/service_package', { operation: 'inspect', graph: apiGraph });
          const { inputs: serviceInputs, values: serviceValues } = campaignServiceInputs(candidates, apiGraph);
          const serviceInterface = {
            inputs: serviceInputs,
            outputs: { [outputKind]: [{ nodeId: preview.id, field: 'preview' }] },
          };
          const built = await request('/service_package', {
            operation: 'build',
            graph: apiGraph,
            interface: serviceInterface,
          });
          writeJsonAtomic(join(output, 'edited.service.json'), built.package);
          const prepared = await request('/service_package', {
            operation: 'prepare',
            package: built.package,
            values: serviceValues,
            sid: serviceSessionId(route.routeId),
          });
          apiGraph = prepared.graph;
          entry.servicePackageHash = hash(JSON.stringify(built.package));
        }
        writeJsonAtomic(join(output, `${variant}.api-graph.json`), apiGraph);
        const submitted = await request('/graph', apiGraph, 60_000);
        taskId = submitted.task_id;
        entry.taskId = taskId;
        save();
        if (!taskId) throw new Error('Backend did not return a task identity.');
        const caseDeadline = Math.min(deadline, Date.now() + 12 * 60_000);
        while (true) {
          const status = await request('/queue', undefined, 10_000);
          const taskState = [status.current, ...Object.values(status.queued ?? {}), ...(status.recent ?? [])].find(
            (item) => item?.task_id === taskId,
          );
          if (taskState && ['completed', 'error', 'failed', 'cancelled'].includes(taskState.status)) {
            entry.task = taskState;
            // A known terminal failure cannot still be executing. Clear its
            // active reference so later independent cases use the last valid
            // graph; unknown/running failures still end this route safely.
            taskId = unsettledTaskId(taskId, taskState.status);
            if (taskState.status !== 'completed')
              throw new Error(taskState.error || taskState.message || taskState.status);
            break;
          }
          if (Date.now() >= caseDeadline) throw new Error('Generation exceeded its bounded deadline.');
          await sleep(2000);
        }
        entry.run = await request(`/runs/${entry.taskId}`);
        taskId = null;
        const indices = outputKind === 'text' ? [0] : imageCaptureIndices(entry.run, preview.id, entry.taskId);
        if (outputKind === 'image') entry.images = [];
        for (const index of indices) {
          const capturePath =
            outputKind === 'text'
              ? `/cache/${encodeURIComponent(preview.id)}/output`
              : imageCapturePath(preview.id, index);
          const response = await fetch(`${SERVER}${capturePath}`, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!response.ok)
            throw new Error(`Output capture failed: ${response.status}: ${(await response.text()).slice(0, 1000)}`);
          const bytes = Buffer.from(await response.arrayBuffer());
          const file = `${variant}${index ? `-${index}` : ''}.${outputKind === 'text' ? 'txt' : 'png'}`;
          writeFileSync(join(output, file), bytes);
          const sha256 = hash(bytes);
          if (index === 0) entry.sha256 = sha256;
          if (outputKind === 'text') entry.text = validateTextOutput(bytes);
          else {
            const image = await decodedImageStatistics(page, bytes);
            entry.images.push({ index, file, sha256, image });
            if (index === 0) entry.image = image;
            if (image.maximum <= 1 || image.width < 1 || image.height < 1)
              throw new Error(`Decoded image ${index} is empty or black.`);
          }
        }
        entry.status = 'completed_awaiting_visual_review';
        graph = modified.graph;
      } catch (error) {
        entry.status = 'failed';
        entry.issue = String(error.message ?? error);
        if (taskId) {
          const status = await request('/queue', undefined, 5000).catch(() => null);
          if (status?.current?.task_id === taskId && !Object.keys(status.queued ?? {}).length)
            await request('/stop', {}, 10_000).catch(() => {});
          else if (status?.queued?.[taskId])
            await request(`/queue/${taskId}`, undefined, 5000, 'DELETE').catch(() => {});
        }
      } finally {
        entry.resourcesAfter = await request('/runtime/resources', undefined, 15_000).catch((error) => ({
          issue: String(error),
        }));
        entry.finishedAt = new Date().toISOString();
        save();
      }
      if (entry.status === 'failed' && (variant === 'baseline' || taskId)) break;
      if (Date.now() >= deadline) break;
    }
    if (receipt.cases.some((entry) => entry.status === 'failed'))
      throw new Error('One or more cases failed; see retained per-case receipts.');
    if (receipt.cases.length !== variants.length)
      throw new Error('Route budget ended with unattempted cases; completed outputs remain retained, not qualified.');
    receipt.status = 'completed_awaiting_visual_review';
  } catch (error) {
    receipt.status = 'failed';
    receipt.issue = String(error.message ?? error);
    throw error;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    save();
    await browser?.close();
    await vite?.close();
    if (backend && backend.exitCode === null) {
      backend.kill('SIGTERM');
      await Promise.race([new Promise((done) => backend.once('exit', done)), sleep(5000)]);
      if (backend.exitCode === null) backend.kill('SIGKILL');
    }
  }
}

export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.command === 'plan') return plan(args);
  if (args.command === 'route') return runRoute(args);
  if (args.command === 'run') {
    assertFrozenSources(args.output);
    return runCli([
      process.execPath,
      SCRIPT,
      'run-all',
      '--config',
      join(args.output, 'queue.config.json'),
      '--state',
      join(args.output, 'queue-state.json'),
      '--budget-ms',
      String(args.budgetMs),
      '--stop-file',
      join(args.output, 'STOP_AFTER_CURRENT'),
      '--json',
    ]);
  }
  console.log(
    'Usage: node scripts/image-prototyping-campaign.mjs plan|run --output <private-dir> [--download] [--inputs <route-inputs.json>] [--budget-ms <finite-budget>]',
  );
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main()
    .then((code) => {
      process.exitCode = code ?? 0;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
