import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-python.mjs <script> [arguments...]');
  process.exit(2);
}

const managedPython =
  process.platform === 'win32'
    ? resolve('..', 'MoDiff', '.venv', 'Scripts', 'python.exe')
    : resolve('..', 'MoDiff', '.venv', 'bin', 'python');
const candidates = [
  ...(process.env.MODIFF_PYTHON ? [[process.env.MODIFF_PYTHON]] : []),
  ...(existsSync(managedPython) ? [[managedPython]] : []),
  ['python3'],
  ['python'],
  ...(process.platform === 'win32' ? [['py', '-3']] : []),
];

for (const [command, ...prefix] of candidates) {
  const result = spawnSync(command, [...prefix, ...args], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') continue;
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

console.error('No Python interpreter was found. Install MoDiff or set MODIFF_PYTHON to an explicit interpreter.');
process.exit(1);
