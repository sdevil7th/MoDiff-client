import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

const child = spawnSync(python, [join(root, 'scripts', 'template-gallery-input-tools.py'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
if (child.error) throw child.error;
process.exit(child.status ?? 1);
