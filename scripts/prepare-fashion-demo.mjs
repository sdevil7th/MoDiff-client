#!/usr/bin/env node
// Curate local workflow exports without rerunning models. Only output previews
// are rebound to the exact task's durable media; executable inputs stay intact.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output)
  throw new Error('Usage: node scripts/prepare-fashion-demo.mjs <reviewed-chapters.json> <output-directory>');
const chapters = JSON.parse(await readFile(resolve(input), 'utf8'));
if (!Array.isArray(chapters) || chapters.length < 1 || chapters.length > 13)
  throw new Error('Expected one to thirteen reviewed chapters.');
const numbers = new Set();
for (const chapter of chapters) {
  if (
    !/^(0[1-9]|1[0-3])$/u.test(chapter.number) ||
    numbers.has(chapter.number) ||
    typeof chapter.title !== 'string' ||
    chapter.title.length > 200 ||
    typeof chapter.directory !== 'string'
  )
    throw new Error('Expected unique 01–13 chapter numbers, bounded titles and explicit source directories.');
  numbers.add(chapter.number);
}
await mkdir(resolve(output), { recursive: true });
const manifest = [];
const html = [];
const escape = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
for (const chapter of chapters) {
  const directory = resolve(chapter.directory);
  const review = JSON.parse(await readFile(resolve(directory, 'visual-review.json'), 'utf8'));
  const hash = createHash('sha256')
    .update(await readFile(resolve(directory, 'output.png')))
    .digest('hex');
  if (review.status !== 'accepted' || review.sha256 !== hash)
    throw new Error(`Missing exact-image visual review: ${chapter.title}`);
  const workflow = JSON.parse(await readFile(resolve(directory, 'final.workflow.json'), 'utf8'));
  const before = JSON.stringify(
    workflow.nodes.map((node) => [
      node.id,
      Object.entries(node.data.params).filter(
        ([, param]) =>
          param.display !== 'output' && !String(param.display).startsWith('ui_') && param.dataSource !== 'output',
      ),
    ]),
  );
  const run = JSON.parse(await readFile(resolve(directory, 'run.json'), 'utf8'));
  const mediaChecks = [];
  if (run.task.status !== 'completed') throw new Error('Only completed tasks can supply durable previews.');
  for (const node of workflow.nodes.filter(
    (node) => node.data.module === 'modules.Image' && node.data.action === 'Preview',
  )) {
    const artifact = run.outputs.find((item) => item.nodeId === node.id && item.fieldKey === 'preview');
    if (!artifact?.mediaItems?.length || artifact.taskId !== run.task.task_id)
      throw new Error(`Missing exact-task preview ${node.id}`);
    for (const item of artifact.mediaItems)
      if (!item.url?.startsWith('/file?file=') || item.taskId !== run.task.task_id)
        throw new Error('Expected durable same-task media.');
    node.data.params.preview.value = artifact.mediaItems.map((item) => item.url);
    mediaChecks.push({
      nodeId: node.id,
      url: artifact.mediaItems[0].url,
      sha256: artifact.mediaItems[0].mediaHash.replace('sha256:bytes:', ''),
    });
    // Avoid an older transient artifact URL taking precedence over this value.
    delete node.data.params.preview.artifacts;
  }
  const after = JSON.stringify(
    workflow.nodes.map((node) => [
      node.id,
      Object.entries(node.data.params).filter(
        ([, param]) =>
          param.display !== 'output' && !String(param.display).startsWith('ui_') && param.dataSource !== 'output',
      ),
    ]),
  );
  if (before !== after) throw new Error('Curation modified executable inputs.');
  const path = resolve(output, `${chapter.number}.workflow.json`);
  await writeFile(path, JSON.stringify(workflow, null, 2));
  manifest.push({ title: chapter.title, path, mediaChecks });
  const relative = `${directory}/output.png`;
  html.push(
    `<article><h2>${escape(chapter.title)}</h2><a href="${escape(relative)}"><img src="${escape(relative)}" alt="${escape(chapter.title)}"></a><p>${escape(review.findings)}</p></article>`,
  );
}
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(
  resolve(dirname(resolve(output)), 'review.html'),
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>SoHo fashion demo review</title><style>body{margin:24px;background:#13151a;color:#eee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:24px}img{width:100%;height:auto}article{max-width:1024px}h2{font-size:20px}p{line-height:1.5}</style><h1>SoHo fashion editorial — reviewed outputs</h1><p>Actual local MoDiff generations. Visual review by the assistant is not user approval. Click an image for full resolution.</p><main>${html.join('\n')}</main></html>`,
);
console.log(JSON.stringify({ chapters: manifest.length, manifest: resolve(output, 'manifest.json') }));
