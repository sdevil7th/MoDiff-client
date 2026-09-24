#!/usr/bin/env node
// Local transfer package only: no remote publication, model weights or approvals.
import { readFile, writeFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function exportFashionDemo(manifestPath, dataRoot, output) {
  const chapters = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!Array.isArray(chapters) || !chapters.length || chapters.length > 13)
    throw new Error('Select 1–13 reviewed chapter exports.');
  const root = await realpath(dataRoot);
  output = resolve(output);
  // Never merge a partial/new package into an existing one.
  await mkdir(output);
  const assets = new Map();
  let totalBytes = 0;
  async function media(reference) {
    if (!reference.startsWith('@data/')) throw new Error('Only local @data media can be packaged.');
    if (reference.includes('\\') || reference.split('/').includes('..')) throw new Error('Unsafe media path.');
    const candidate = resolve(root, reference.slice(6));
    const path = await realpath(candidate);
    const inside = relative(root, path);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Media escapes the data root.');
    const extension = extname(path).toLowerCase();
    const info = await stat(path);
    if (!['.png', '.webp', '.jpg', '.jpeg'].includes(extension) || !info.isFile() || info.size > 32 * 1024 * 1024)
      throw new Error('Expected a bounded local image file.');
    const bytes = await readFile(path);
    const sha256 = hash(bytes);
    const name = `data/fashion-demo/${sha256}${extension}`;
    if (!assets.has(name)) {
      totalBytes += bytes.length;
      if (assets.size >= 128 || totalBytes > 256 * 1024 * 1024) throw new Error('Demo package size limit exceeded.');
      await mkdir(dirname(resolve(output, name)), { recursive: true });
      await writeFile(resolve(output, name), bytes, { flag: 'wx' });
      assets.set(name, { path: name, sha256, bytes: bytes.length });
    }
    return `@${name}`;
  }
  async function rewrite(value) {
    if (typeof value === 'string') {
      if (value.startsWith('@data/')) return media(value);
      if (value.startsWith('/file?')) {
        const url = new URL(value, 'http://localhost');
        const file = url.searchParams.get('file');
        if (!file) throw new Error('Missing preview file.');
        return `/file?file=${encodeURIComponent(await media(file))}`;
      }
      if (/^(\/cache\/|\/home\/|\/Users\/|[A-Za-z]:[\\/]|file:\/\/)/.test(value))
        throw new Error('Workflow contains a machine-local or transient reference.');
      return value;
    }
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await rewrite(item));
      return result;
    }
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, item] of Object.entries(value)) result[key] = await rewrite(item);
      return result;
    }
    return value;
  }
  const workflows = [];
  for (const [index, chapter] of chapters.entries()) {
    const path = `workflows/${String(index + 1).padStart(2, '0')}.workflow.json`;
    const document = JSON.parse(await readFile(resolve(dirname(manifestPath), chapter.path), 'utf8'));
    if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Expected a graph export.');
    const bytes = JSON.stringify(await rewrite(document), null, 2) + '\n';
    await mkdir(resolve(output, 'workflows'), { recursive: true });
    await writeFile(resolve(output, path), bytes, { flag: 'wx' });
    workflows.push({ title: chapter.title, path, sha256: hash(bytes) });
  }
  const result = { schemaVersion: 1, workflows, assets: [...assets.values()] };
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 5)
    throw new Error('Usage: node scripts/export-fashion-demo.mjs <manifest> <backend-data> <new-output>');
  const result = await exportFashionDemo(...process.argv.slice(2));
  console.log(JSON.stringify({ workflows: result.workflows.length, images: result.assets.length }));
}
