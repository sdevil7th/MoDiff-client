import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH_ROOT = path.resolve(ROOT, '../MoDiff/data/graphs/studio');
const SERVER = process.env.MODIFF_SERVER || 'http://127.0.0.1:8088';

async function graphFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await graphFiles(target)));
    else if (entry.name.endsWith('.json')) files.push(target);
  }
  return files;
}

const response = await fetch(`${SERVER}/nodes`);
if (!response.ok) throw new Error(`MoDiff node registry returned HTTP ${response.status}.`);
const payload = await response.json();
if (!payload?.nodes || typeof payload.nodes !== 'object') throw new Error('MoDiff returned an invalid node registry.');

const vite = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  optimizeDeps: { entries: [], noDiscovery: true },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});

try {
  const { buildGraphFixPlan } = await vite.ssrLoadModule('/src/studio/graphFixer.ts');
  const files = await graphFiles(GRAPH_ROOT);
  const failures = [];
  for (const file of files) {
    const graph = JSON.parse(await fs.readFile(file, 'utf8'));
    const plan = buildGraphFixPlan({
      nodes: graph.nodes ?? [],
      edges: graph.edges ?? [],
      registry: payload.nodes,
    });
    if (plan.canFix) {
      failures.push({
        file: path.relative(GRAPH_ROOT, file),
        issues: plan.issues.map((issue) => ({ kind: issue.kind, title: issue.title })),
      });
    }
  }

  const report = {
    schemaVersion: 1,
    server: SERVER,
    graphCount: files.length,
    falsePositiveCount: failures.length,
    failures,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
} finally {
  await vite.close();
}
