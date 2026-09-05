import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.resolve(clientRoot, '..', 'MoDiff');
const sourceDataDir = path.resolve(
  process.env.MODIFF_HISTORICAL_MIGRATION_SOURCE_DATA_DIR || path.join(backendRoot, 'data'),
);
const helper = path.join(backendRoot, 'scripts', 'run_isolated_historical_migration_e2e_backend.py');
const runtimeLauncher = path.join(backendRoot, 'scripts', 'with-runtime-env.sh');
const python = path.join(backendRoot, '.venv', 'bin', 'python');
const playwright = path.join(
  clientRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a loopback test port.');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function waitForFile(file, child, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable backend exited with code ${child.exitCode}.`);
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Disposable backend did not create ${file} within ${timeoutMs}ms.`);
}

async function waitForHealth(url, child, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable backend exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Disposable backend did not become healthy within ${timeoutMs}ms. Last error: ${lastError}`);
}

async function stopChild(child, timeoutMs = 15_000) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
  if (!stopped && child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

async function main() {
  for (const required of [helper, runtimeLauncher, python, playwright, sourceDataDir]) await access(required);
  const testRoot = await mkdtemp(path.join(tmpdir(), 'modiff-historical-migration-e2e-'));
  const dataDir = path.join(testRoot, 'data');
  const metadataPath = path.join(dataDir, 'isolated-fixture.json');
  const backendPort = await freePort();
  const frontendPort = await freePort();
  const backendUrl = `http://127.0.0.1:${backendPort}`;
  let backend;
  try {
    backend = spawn(
      runtimeLauncher,
      [
        python,
        helper,
        '--source-data-dir',
        sourceDataDir,
        '--data-dir',
        dataDir,
        '--metadata',
        metadataPath,
        '--port',
        String(backendPort),
      ],
      {
        cwd: backendRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    backend.stdout.pipe(process.stderr);
    backend.stderr.pipe(process.stderr);
    await waitForFile(metadataPath, backend);
    await waitForHealth(backendUrl, backend);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    process.stderr.write(
      `Isolated migration fixture ready: ${metadata.mappingId} · ${metadata.originalByteLength} bytes · ${metadata.originalSha256}\n`,
    );

    const browser = spawn(
      playwright,
      ['test', 'tests/e2e/live-backend/historical-cluster-migration-lifecycle.spec.ts'],
      {
        cwd: clientRoot,
        env: {
          ...process.env,
          MODIFF_LIVE_BACKEND_URL: backendUrl,
          MODIFF_MOCK_FRONTEND_PORT: String(frontendPort),
          MODIFF_ISOLATED_MIGRATION_DATA_DIR: dataDir,
          MODIFF_ISOLATED_MIGRATION_METADATA: metadataPath,
        },
        stdio: 'inherit',
      },
    );
    const exitCode = await new Promise((resolve, reject) => {
      browser.once('error', reject);
      browser.once('exit', (code, signal) => {
        if (signal) reject(new Error(`Playwright was terminated by ${signal}.`));
        else resolve(code ?? 1);
      });
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  } finally {
    if (backend) await stopChild(backend);
    const normalizedRoot = path.resolve(testRoot);
    const expectedPrefix = `${path.resolve(tmpdir())}${path.sep}modiff-historical-migration-e2e-`;
    if (!normalizedRoot.startsWith(expectedPrefix)) {
      throw new Error(`Refusing to remove unexpected test directory: ${normalizedRoot}`);
    }
    await rm(normalizedRoot, { recursive: true, force: true });
  }
}

await main();
