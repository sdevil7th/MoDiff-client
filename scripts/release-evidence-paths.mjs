import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';

function containedPath(root, publicPath) {
  const absoluteRoot = resolve(root);
  const relativePath = String(publicPath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const candidate = resolve(absoluteRoot, relativePath);
  const containment = relative(absoluteRoot, candidate);
  if (containment === '..' || containment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Gallery evidence path escapes its managed root: ${String(publicPath)}`);
  }
  return candidate;
}

export function galleryEvidenceCandidates(clientRoot, backendRoot, publicPath) {
  return [
    containedPath(resolve(clientRoot, 'public'), publicPath),
    containedPath(resolve(backendRoot, 'web'), publicPath),
  ];
}

export function findGalleryEvidencePath(clientRoot, backendRoot, publicPath) {
  return (
    galleryEvidenceCandidates(clientRoot, backendRoot, publicPath).find((candidate) => existsSync(candidate)) ?? null
  );
}
