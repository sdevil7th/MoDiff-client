import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = resolve(root, '..', 'MoDiff');
const candidates =
  process.platform === 'win32'
    ? [join(backendRoot, '.venv', 'Scripts', 'python.exe'), 'python']
    : [join(backendRoot, '.venv', 'bin', 'python'), 'python3'];
const python = candidates.find(
  (candidate) => candidate === 'python' || candidate === 'python3' || existsSync(candidate),
);

if (!python) throw new Error(`Could not find the sibling MoDiff Python runtime under ${backendRoot}.`);

const rocmRoot = '/opt/rocm';
const rocmLibraryPaths = [join(rocmRoot, 'lib')];
if (existsSync(rocmRoot)) {
  rocmLibraryPaths.push(
    ...readdirSync(rocmRoot)
      .filter((entry) => entry.startsWith('core-'))
      .map((entry) => join(rocmRoot, entry, 'lib')),
  );
}
const existingRocmLibraryPaths = rocmLibraryPaths.filter((entry) => existsSync(entry));
const childEnv = { ...process.env };
if (existingRocmLibraryPaths.length > 0) {
  childEnv.LD_LIBRARY_PATH = [
    ...existingRocmLibraryPaths,
    ...(process.env.LD_LIBRARY_PATH ? [process.env.LD_LIBRARY_PATH] : []),
  ].join(':');
  childEnv.ROCM_PATH ??= rocmRoot;
  childEnv.HIP_PATH ??= rocmRoot;
}

const child = spawnSync(python, [join(root, 'scripts', 'template-gallery-input-tools.py'), ...process.argv.slice(2)], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
