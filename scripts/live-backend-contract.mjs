import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(SCRIPT_DIR, '..');
const BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const SERVER = process.env.MODIFF_SERVER || 'http://127.0.0.1:8088';
const OUTPUT = join(BACKEND_ROOT, 'data', 'qualification', 'release', 'live-backend-contract.v1.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, SERVER), {
    ...options,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let value;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON content (${response.status}).`);
  }
  assert(response.ok, `${path} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return value;
}

const health = await request('/health');
assert(record(health), '/health must return an object.');
assert(typeof health.ready === 'boolean', '/health.ready must be boolean.');
assert(record(health.runtime_profile), '/health.runtime_profile is required.');
assert(typeof health.runtime_profile.status === 'string', '/health runtime status is required.');
assert(typeof health.runtime_profile.execution_ready === 'boolean', '/health execution_ready must be boolean.');
assert(record(health.runtime_profile.device_validation), '/health device_validation is required.');

const runtime = await request('/runtime/status');
assert(record(runtime), '/runtime/status must return an object.');
assert(typeof runtime.ready === 'boolean', '/runtime/status.ready must be boolean.');
assert(record(runtime.packages), '/runtime/status.packages is required.');
assert(record(runtime.packages.torch), '/runtime/status.packages.torch is required.');

const nodes = await request('/nodes');
assert(record(nodes) && record(nodes.nodes), '/nodes must return a nodes object.');
assert(Object.keys(nodes.nodes).length > 0, '/nodes returned an empty registry.');

const hfCache = await request('/hf_cache?compact=1');
assert(Array.isArray(hfCache), '/hf_cache?compact=1 must return an array.');

const localModels = await request('/local_models');
assert(Array.isArray(localModels), '/local_models must return an array.');

const diagnostics = await request('/model_cache/diagnostics');
assert(
  record(diagnostics) && Array.isArray(diagnostics.locations),
  '/model_cache/diagnostics.locations must be an array.',
);

const capabilities = await request('/model_capabilities');
assert(
  record(capabilities) && Array.isArray(capabilities.capabilities),
  '/model_capabilities.capabilities must be an array.',
);

const customModules = await request('/custom_modules');
assert(record(customModules) && Array.isArray(customModules.modules), '/custom_modules.modules must be an array.');

const queue = await request('/queue');
assert(record(queue) && Array.isArray(queue.recent), '/queue.recent must be an array.');

const workflows = await request('/workflows');
assert(record(workflows) && Array.isArray(workflows.workflows), '/workflows.workflows must be an array.');

const outputs = await request('/studio_outputs');
assert(record(outputs) && Array.isArray(outputs.outputs), '/studio_outputs.outputs must be an array.');

const autoPlan = await request('/auto_resource/plan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    form: {
      mode: 'text_to_image',
      modelType: 'QwenImageModularPipeline',
      resourceMode: 'auto',
      resourcePreference: 'balanced',
      device: 'cuda:0',
      dtype: 'bfloat16',
      quantizationMode: 'none',
      autoOffload: false,
      offloadMode: 'none',
      width: 1024,
      height: 1024,
      steps: 50,
      guidanceScale: 4,
    },
  }),
});
assert(record(autoPlan), '/auto_resource/plan must return an object.');
assert(typeof autoPlan.status === 'string', '/auto_resource/plan.status is required.');
assert(Array.isArray(autoPlan.candidates), '/auto_resource/plan.candidates must be an array.');
if (autoPlan.status === 'ready') {
  assert(record(autoPlan.selectedCandidate), 'A ready Auto plan requires selectedCandidate.');
  assert(typeof autoPlan.selectedCandidate.id === 'string', 'Auto selectedCandidate.id is required.');
  assert(record(autoPlan.selectedCandidate.proof), 'Auto selectedCandidate.proof is required.');
}

const receipt = {
  schemaVersion: 1,
  format: 'modiff.frontend-live-backend-contract.v1',
  checkedAt: new Date().toISOString(),
  server: SERVER,
  ready: health.ready && runtime.ready,
  runtimeProfile: health.runtime_profile,
  runtimeFingerprint:
    runtime.runtimeFingerprint ?? runtime.runtime_fingerprint ?? autoPlan.hardware?.runtimeFingerprint ?? null,
  counts: {
    nodes: Object.keys(nodes.nodes).length,
    hfCache: hfCache.length,
    localModels: localModels.length,
    capabilities: capabilities.capabilities.length,
    customModules: customModules.modules.length,
    workflows: workflows.workflows.length,
    outputs: outputs.outputs.length,
  },
  autoPlan: {
    status: autoPlan.status,
    selectedCandidateId: autoPlan.selectedCandidate?.id ?? null,
    proofStatus: autoPlan.selectedCandidate?.proof?.status ?? null,
  },
};

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  `Live frontend/backend contract passed: ${receipt.counts.nodes} nodes, Auto ${receipt.autoPlan.status}/${receipt.autoPlan.selectedCandidateId ?? 'none'}.`,
);
