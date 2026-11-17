import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { sha256Value } from './live-proof-provenance.mjs';

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

/** Read the exact retained baseline identified by a release receipt. A public
 * Gallery path names a reviewed bundle, not an absolute operating-system path.
 * Reading its original run does not supply absent native evidence. */
export function readReleaseRunProvenance({ clientRoot, backendRoot, receipt }) {
  const reference = receipt?.provenancePath;
  if (typeof reference !== 'string' || !reference || reference.length > 1024) {
    throw new Error('Locked-template baseline provenance path is missing or invalid.');
  }
  const galleryPath = reference.startsWith('/template-gallery/');
  const candidates = galleryPath
    ? galleryEvidenceCandidates(clientRoot, backendRoot, reference)
    : [resolve(backendRoot, reference)];
  const index = candidates.findIndex((candidate) => existsSync(candidate));
  if (index < 0) throw new Error('Locked-template baseline provenance is missing.');
  const filename = candidates[index];
  const root = galleryPath
    ? resolve(index === 0 ? clientRoot : backendRoot, index === 0 ? 'public' : 'web')
    : resolve(backendRoot);
  const within = relative(root, filename);
  if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`) || !within) {
    throw new Error('Locked-template baseline provenance escapes its managed root.');
  }
  let current = root;
  for (const segment of within.split(sep)) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Locked-template baseline cannot use symbolic links.');
  }
  const actual = relative(realpathSync(root), realpathSync(filename));
  if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) {
    throw new Error('Locked-template baseline provenance escapes its managed root.');
  }
  const info = lstatSync(filename);
  if (!info.isFile() || info.size <= 0 || info.size > 16 * 1024 ** 2) {
    throw new Error('Locked-template baseline must be a bounded JSON file.');
  }
  const bytes = readFileSync(filename);
  const body = JSON.parse(bytes.toString('utf8'));
  const expectedHash = receipt.provenanceHash;
  const observedHash = /^sha256:canonical-json:[a-f0-9]{64}$/u.test(expectedHash ?? '')
    ? sha256Value('canonical-json', body)
    : `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (typeof expectedHash !== 'string' || expectedHash !== observedHash) {
    throw new Error('Locked-template baseline provenance hash differs from the release receipt.');
  }
  const reviewedBundle = body?.schemaVersion === 1 && body?.format === 'modiff.gallery.reviewed-provenance.v1';
  const provenance = reviewedBundle ? body.run : body;
  if (
    provenance?.format !== 'modiff.live-proof.provenance.v2' ||
    Number(provenance.schemaVersion) < 2 ||
    (reviewedBundle && body.templateId !== provenance.template?.id)
  ) {
    throw new Error('Locked-template baseline has no unambiguous original v2 run.');
  }
  const fields = {
    templateId: provenance.template?.id,
    taskId: provenance.taskId,
    graphHash: provenance.graphHash,
    modelRevision: provenance.modelRevision,
    runtimeFingerprint: provenance.runtimeFingerprint,
    resourceCandidateId: provenance.execution?.resourceCandidateId,
    outputHash: provenance.mediaHash,
    executionDurationSeconds: provenance.execution?.elapsedSeconds,
    peakMemoryBytes: provenance.execution?.peakMemoryBytes,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (receipt[key] === undefined || receipt[key] !== value) {
      throw new Error(`Locked-template baseline ${key} differs from the release receipt.`);
    }
  }
  return provenance;
}
