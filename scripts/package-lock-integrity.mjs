import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

if (lock.lockfileVersion !== 3 || typeof lock.packages !== 'object' || lock.packages === null) {
  throw new Error('package-lock.json must use npm lockfileVersion 3 with a packages map.');
}

const failures = [];
let checked = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path.includes('node_modules/') || entry?.link === true || entry?.inBundle === true) continue;
  checked += 1;
  if (typeof entry?.version !== 'string' || !entry.version) {
    failures.push(`${path}: missing exact version`);
  }
  if (typeof entry?.resolved !== 'string' || !entry.resolved.startsWith('https://registry.npmjs.org/')) {
    failures.push(`${path}: missing canonical npm registry tarball URL`);
  }
  if (typeof entry?.integrity !== 'string' || !/^sha(?:256|384|512)-/.test(entry.integrity)) {
    failures.push(`${path}: missing strong subresource integrity`);
  }
}

if (failures.length > 0) {
  throw new Error(`package-lock artifact identity check failed:\n${failures.join('\n')}`);
}

process.stdout.write(`Verified artifact identity for ${checked} non-bundled package records.\n`);
