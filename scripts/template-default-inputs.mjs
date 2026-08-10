import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';
import ts from 'typescript';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const PROJECT_ROOT = resolve(SCRIPT_PATH, '..', '..');

const PUBLIC_ROOT = 'public';
const GALLERY_ROOT = join(PUBLIC_ROOT, 'template-gallery');
const MANIFEST_PATH = join(GALLERY_ROOT, 'manifest.json');
const INPUT_OVERRIDES_PATH = join('scripts', 'template-default-input-overrides.json');
const RUNTIME_INPUT_ROOT = join(GALLERY_ROOT, 'runtime-inputs');
const RUNTIME_ASSET_ROOT = join(RUNTIME_INPUT_ROOT, 'assets');
const RUNTIME_JSON_PATH = join(RUNTIME_INPUT_ROOT, 'default-input-bindings.json');
const GENERATED_TYPESCRIPT_PATH = join('src', 'studio', 'generated', 'templateDefaultInputBindings.ts');
const STUDIO_TEMPLATES_PATH = join('src', 'studio', 'templates.ts');
const RUNTIME_PUBLIC_PREFIX = '/template-gallery/runtime-inputs';
const APPROVED_REVIEW_STATUSES = new Set(['approved_exact', 'approved_reviewed']);

const FIELD_ORDER = [
  'referenceImages',
  'maskImage',
  'controlImage',
  'sourceVideo',
  'maskVideo',
  'controlVideo',
  'sourceAudio',
  'referenceAudio',
];

const PACKED_FIELD_ORDER = [
  'controlImage',
  'referenceImages',
  'maskImage',
  'sourceVideo',
  'maskVideo',
  'controlVideo',
  'sourceAudio',
  'referenceAudio',
];

const FIELD_METADATA = {
  referenceImages: {
    mediaType: 'image',
    singularLabel: 'Reviewed reference image',
    pluralLabel: 'Reviewed reference images',
  },
  maskImage: {
    mediaType: 'image',
    singularLabel: 'Reviewed mask image',
    pluralLabel: 'Reviewed mask images',
  },
  controlImage: {
    mediaType: 'image',
    singularLabel: 'Reviewed control image',
    pluralLabel: 'Reviewed control images',
  },
  sourceVideo: {
    mediaType: 'video',
    singularLabel: 'Reviewed source video',
    pluralLabel: 'Reviewed source videos',
  },
  maskVideo: {
    mediaType: 'video',
    singularLabel: 'Reviewed mask video',
    pluralLabel: 'Reviewed mask videos',
  },
  controlVideo: {
    mediaType: 'video',
    singularLabel: 'Reviewed control video',
    pluralLabel: 'Reviewed control videos',
  },
  sourceAudio: {
    mediaType: 'audio',
    singularLabel: 'Reviewed source audio',
    pluralLabel: 'Reviewed source audio files',
  },
  referenceAudio: {
    mediaType: 'audio',
    singularLabel: 'Reviewed reference audio',
    pluralLabel: 'Reviewed reference audio files',
  },
};

const ROLE_METADATA = {
  source_image: {
    field: 'referenceImages',
    mediaType: 'image',
    label: 'Reviewed source image',
    order: 0,
  },
  mask_image: {
    field: 'maskImage',
    mediaType: 'image',
    label: 'Reviewed mask image',
    order: 0,
  },
  control_image: {
    field: 'controlImage',
    mediaType: 'image',
    label: 'Reviewed control image',
    order: 0,
  },
  source_video: {
    field: 'sourceVideo',
    mediaType: 'video',
    label: 'Reviewed source video',
    order: 0,
  },
  mask_video: {
    field: 'maskVideo',
    mediaType: 'video',
    label: 'Reviewed mask video',
    order: 0,
  },
  control_video: {
    field: 'controlVideo',
    mediaType: 'video',
    label: 'Reviewed control video',
    order: 0,
  },
  source_audio: {
    field: 'sourceAudio',
    mediaType: 'audio',
    label: 'Reviewed source audio',
    order: 0,
  },
  reference_audio: {
    field: 'referenceAudio',
    mediaType: 'audio',
    label: 'Reviewed reference audio',
    order: 0,
  },
};

const CONTENT_HASH_PATTERN = /^sha256:bytes:([a-f0-9]{64})$/;
const GENERATED_INPUT_PREFIX = 'generated:';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function templateInputContractHash(bindings = []) {
  const defaults = bindings
    .filter((binding) => binding.origin === 'template')
    .map((binding) => ({
      id: binding.id,
      field: binding.field,
      mediaType: binding.mediaType,
      assets: binding.defaultAssets.map((asset) => ({
        id: asset.id,
        mediaType: asset.mediaType,
        runtimeSha256: asset.runtimeSha256,
      })),
    }));
  return defaults.length > 0 ? `tic_${fnv1a(stableJson(defaults))}` : undefined;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function kebabCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function roleMetadata(role) {
  const referenceMatch = /^reference_image_(\d+)$/.exec(role);
  if (referenceMatch) {
    const index = Number(referenceMatch[1]);
    return {
      field: 'referenceImages',
      mediaType: 'image',
      label: `Reviewed reference image ${index}`,
      order: index,
    };
  }
  return ROLE_METADATA[role] ?? null;
}

function isWithin(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..');
}

function declaredFilePath(projectRoot, provenancePath) {
  if (!provenancePath || provenancePath.startsWith(GENERATED_INPUT_PREFIX) || provenancePath.includes('<local-path>')) {
    return null;
  }
  const candidate = isAbsolute(provenancePath) ? resolve(provenancePath) : resolve(projectRoot, provenancePath);
  return isWithin(projectRoot, candidate) ? candidate : null;
}

function publicFilePath(projectRoot, publicPath) {
  if (!publicPath || !publicPath.startsWith('/')) return null;
  const candidate = resolve(projectRoot, PUBLIC_ROOT, publicPath.replace(/^\/+/, ''));
  const publicRoot = resolve(projectRoot, PUBLIC_ROOT);
  return isWithin(publicRoot, candidate) ? candidate : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function readStudioTemplateIds(projectRoot) {
  const path = resolve(projectRoot, STUDIO_TEMPLATES_PATH);
  const source = await readFile(path, 'utf8');
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let templateIds;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'BASE_STUDIO_TEMPLATES' &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      templateIds = node.initializer.elements.map((element, index) => {
        if (!ts.isObjectLiteralExpression(element)) {
          throw new Error(`BASE_STUDIO_TEMPLATES item ${index} is not an object literal.`);
        }
        const idProperty = element.properties.find(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ((ts.isIdentifier(property.name) && property.name.text === 'id') ||
              (ts.isStringLiteral(property.name) && property.name.text === 'id')),
        );
        if (!idProperty || !ts.isStringLiteral(idProperty.initializer)) {
          throw new Error(`BASE_STUDIO_TEMPLATES item ${index} has no literal id.`);
        }
        return idProperty.initializer.text;
      });
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (!templateIds) throw new Error(`Could not find BASE_STUDIO_TEMPLATES in ${STUDIO_TEMPLATES_PATH}.`);
  if (new Set(templateIds).size !== templateIds.length) {
    throw new Error(`${STUDIO_TEMPLATES_PATH} contains duplicate base template ids.`);
  }
  return templateIds;
}

async function fileSha256(path) {
  return `sha256:bytes:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`;
}

async function fileMatches(path, artifact) {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile() || metadata.size !== artifact.byteSize) return false;
    return (await fileSha256(path)) === artifact.contentHash;
  } catch {
    return false;
  }
}

async function walkFiles(root, excludedRoot = null) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (excludedRoot && (path === excludedRoot || isWithin(excludedRoot, path))) continue;
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  try {
    await visit(root);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return files;
}

function provenanceRuns(provenance) {
  if (provenance.run) return [provenance.run];
  return [provenance.run1, provenance.run2].filter(Boolean);
}

function inputItems(run) {
  return run?.inputs?.items ?? [];
}

function inputExtension(artifact, sourcePath) {
  const declaredExtension = extname(artifact.path).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(declaredExtension)) return declaredExtension;
  const sourceExtension = extname(sourcePath).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(sourceExtension)) return sourceExtension;
  throw new Error(
    `${artifact.templateId} ${artifact.role} has no safe file extension in ${artifact.path} or ${sourcePath}.`,
  );
}

function approvedManifestEntries(manifest) {
  return (manifest.examples ?? [])
    .filter((entry) => APPROVED_REVIEW_STATUSES.has(entry.qualityReviewStatus))
    .sort((left, right) => left.templateId.localeCompare(right.templateId));
}

async function collectRequirements(projectRoot) {
  const manifest = await readJson(resolve(projectRoot, MANIFEST_PATH));
  const approvedEntries = approvedManifestEntries(manifest);
  const requirements = [];
  const excludedGenerated = [];
  const issues = [];

  for (const entry of approvedEntries) {
    const provenancePath = publicFilePath(projectRoot, entry.provenancePath);
    if (!provenancePath) {
      issues.push({
        templateId: entry.templateId,
        reason: `Invalid public provenance path: ${entry.provenancePath}`,
      });
      continue;
    }

    let provenance;
    try {
      provenance = await readJson(provenancePath);
    } catch (error) {
      issues.push({
        templateId: entry.templateId,
        reason: `Could not read ${entry.provenancePath}: ${error.message}`,
      });
      continue;
    }

    if (provenance.templateId !== entry.templateId) {
      issues.push({
        templateId: entry.templateId,
        reason: `Provenance declares template ${provenance.templateId ?? '(missing)'}.`,
      });
      continue;
    }

    const runs = provenanceRuns(provenance);
    if (runs.length === 0) {
      issues.push({ templateId: entry.templateId, reason: 'Provenance has no reviewed run.' });
      continue;
    }
    if (runs.some((run) => (run.blockers ?? []).length > 0)) {
      issues.push({
        templateId: entry.templateId,
        reason: 'Approved provenance still contains run blockers.',
      });
      continue;
    }

    const firstInputs = inputItems(runs[0]);
    if (runs.length > 1) {
      const secondInputs = inputItems(runs[1]);
      if (stableJson(firstInputs) !== stableJson(secondInputs)) {
        issues.push({
          templateId: entry.templateId,
          reason: 'Duplicate exact runs do not declare identical root inputs.',
        });
        continue;
      }
    }

    const previewSourceHash = entry.beforeSourceMediaHash ?? entry.beforeMediaHash;
    const previewInputCandidates =
      entry.beforePath && previewSourceHash
        ? firstInputs.filter(
            (item) => !String(item.path).startsWith(GENERATED_INPUT_PREFIX) && item.contentHash === previewSourceHash,
          )
        : [];
    if (previewInputCandidates.length > 1) {
      issues.push({
        templateId: entry.templateId,
        reason: `Manifest Before media hash matches ${previewInputCandidates.length} root inputs.`,
      });
      continue;
    }
    if (previewInputCandidates.length === 1) {
      const previewPath = publicFilePath(projectRoot, entry.beforePath);
      try {
        if (!previewPath || !(await stat(previewPath)).isFile()) {
          throw new Error('path does not resolve to a public file');
        }
      } catch (error) {
        issues.push({
          templateId: entry.templateId,
          reason: `Manifest Before preview ${entry.beforePath} is unavailable: ${error.message}.`,
        });
        continue;
      }
    }

    for (const item of firstInputs) {
      const artifact = {
        ...item,
        templateId: entry.templateId,
        ...(item === previewInputCandidates[0] ? { previewPath: entry.beforePath } : {}),
      };
      if (String(item.path).startsWith(GENERATED_INPUT_PREFIX)) {
        excludedGenerated.push(artifact);
        continue;
      }
      if (!roleMetadata(item.role)) {
        issues.push({
          templateId: entry.templateId,
          role: item.role,
          reason: 'Root input role has no Studio form-field mapping.',
        });
        continue;
      }
      if (!CONTENT_HASH_PATTERN.test(item.contentHash ?? '')) {
        issues.push({
          templateId: entry.templateId,
          role: item.role,
          reason: `Invalid byte hash: ${item.contentHash ?? '(missing)'}`,
        });
        continue;
      }
      if (!Number.isSafeInteger(item.byteSize) || item.byteSize < 0) {
        issues.push({
          templateId: entry.templateId,
          role: item.role,
          reason: `Invalid byte size: ${item.byteSize ?? '(missing)'}`,
        });
        continue;
      }
      requirements.push(artifact);
    }
  }

  let overrideConfig = { schemaVersion: 1, overrides: [] };
  try {
    overrideConfig = await readJson(resolve(projectRoot, INPUT_OVERRIDES_PATH));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (overrideConfig.schemaVersion !== 1 || !Array.isArray(overrideConfig.overrides)) {
    throw new Error(`${INPUT_OVERRIDES_PATH} must use schemaVersion 1 and an overrides array.`);
  }
  const approvedTemplateIds = new Set(approvedEntries.map((entry) => entry.templateId));
  const overrideKeys = new Set();
  for (const override of overrideConfig.overrides) {
    const key = `${override.templateId}:${override.role}`;
    if (overrideKeys.has(key)) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: 'Duplicate selected-input override.',
      });
      continue;
    }
    overrideKeys.add(key);
    if (!approvedTemplateIds.has(override.templateId)) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: 'Selected-input override targets a template without an approved gallery entry.',
      });
      continue;
    }
    if (!roleMetadata(override.role)) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: 'Selected-input override role has no Studio form-field mapping.',
      });
      continue;
    }
    if (!override.sourceTaskId || !override.selectionReason) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: 'Selected-input override requires sourceTaskId and selectionReason provenance.',
      });
      continue;
    }
    if (!CONTENT_HASH_PATTERN.test(override.contentHash ?? '') || !Number.isSafeInteger(override.byteSize)) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: 'Selected-input override has an invalid content hash or byte size.',
      });
      continue;
    }
    const sourcePath = declaredFilePath(projectRoot, override.path);
    if (!sourcePath || !(await fileMatches(sourcePath, override))) {
      issues.push({
        templateId: override.templateId,
        role: override.role,
        reason: `Selected-input override does not match ${override.path}.`,
      });
      continue;
    }
    const artifact = {
      templateId: override.templateId,
      role: override.role,
      bindingLabel: override.bindingLabel,
      assetLabel: override.assetLabel,
      path: override.path,
      previewPath: override.previewPath,
      contentHash: override.contentHash,
      byteSize: override.byteSize,
      sourceTaskId: override.sourceTaskId,
      selectionReason: override.selectionReason,
    };
    const existingIndex = requirements.findIndex(
      (requirement) => requirement.templateId === override.templateId && requirement.role === override.role,
    );
    if (existingIndex >= 0) requirements.splice(existingIndex, 1, artifact);
    else requirements.push(artifact);
  }

  requirements.sort(
    (left, right) =>
      left.templateId.localeCompare(right.templateId) ||
      roleMetadata(left.role).order - roleMetadata(right.role).order ||
      left.role.localeCompare(right.role) ||
      left.contentHash.localeCompare(right.contentHash),
  );
  excludedGenerated.sort(
    (left, right) => left.templateId.localeCompare(right.templateId) || left.role.localeCompare(right.role),
  );

  return { manifest, approvedEntries, requirements, excludedGenerated, issues };
}

async function resolveRequirementSources(projectRoot, requirements) {
  const resolutions = new Map();
  const unresolved = [];

  for (const artifact of requirements) {
    const directPath = declaredFilePath(projectRoot, artifact.path);
    if (directPath && (await fileMatches(directPath, artifact))) {
      resolutions.set(artifact, { sourcePath: directPath, resolution: 'declared-path' });
    } else {
      unresolved.push(artifact);
    }
  }

  if (unresolved.length === 0) return { resolutions, issues: [] };

  const requiredSizes = new Set(unresolved.map((artifact) => artifact.byteSize));
  const requiredHashes = new Set(unresolved.map((artifact) => artifact.contentHash));
  const publicGalleryRoot = resolve(projectRoot, GALLERY_ROOT);
  const runtimeInputRoot = resolve(projectRoot, RUNTIME_INPUT_ROOT);
  const sourceAssetsRoot = resolve(projectRoot, 'artifacts', 'template-gallery', 'source-assets');
  const searchFiles = [
    ...(await walkFiles(publicGalleryRoot, runtimeInputRoot)),
    ...(await walkFiles(sourceAssetsRoot)),
  ];
  const hashMatches = new Map();

  for (const candidate of searchFiles) {
    const metadata = await stat(candidate);
    if (!requiredSizes.has(metadata.size)) continue;
    const hash = await fileSha256(candidate);
    if (!requiredHashes.has(hash)) continue;
    const matches = hashMatches.get(hash) ?? [];
    matches.push(candidate);
    hashMatches.set(hash, matches);
  }

  const issues = [];
  for (const artifact of unresolved) {
    const candidates = hashMatches.get(artifact.contentHash) ?? [];
    candidates.sort((left, right) => {
      const leftPublic = isWithin(publicGalleryRoot, left) ? 0 : 1;
      const rightPublic = isWithin(publicGalleryRoot, right) ? 0 : 1;
      return leftPublic - rightPublic || relative(projectRoot, left).localeCompare(relative(projectRoot, right));
    });
    const sourcePath = candidates[0];
    if (!sourcePath) {
      issues.push({
        templateId: artifact.templateId,
        role: artifact.role,
        contentHash: artifact.contentHash,
        byteSize: artifact.byteSize,
        declaredPath: artifact.path,
        reason: 'No exact byte match exists at the declared path, in public, or in source-assets.',
      });
      continue;
    }
    resolutions.set(artifact, { sourcePath, resolution: 'sha256-match' });
  }

  return { resolutions, issues };
}

function buildMapping(requirements, resolutions) {
  const groupedByTemplate = new Map();
  const runtimeAssets = new Map();

  for (const artifact of requirements) {
    const resolved = resolutions.get(artifact);
    if (!resolved) continue;
    const metadata = roleMetadata(artifact.role);
    const extension = inputExtension(artifact, resolved.sourcePath);
    const hashHex = CONTENT_HASH_PATTERN.exec(artifact.contentHash)[1];
    const assetRelativePath = toPosix(join('assets', `${hashHex}${extension}`));
    const runtimePath = `${RUNTIME_PUBLIC_PREFIX}/${assetRelativePath}`;
    const defaultAsset = {
      id: `${artifact.templateId}-${kebabCase(artifact.role)}`,
      label: artifact.assetLabel ?? metadata.label,
      mediaType: metadata.mediaType,
      ...(artifact.previewPath ? { previewPath: artifact.previewPath } : {}),
      runtimePath,
      runtimeSha256: artifact.contentHash,
      fileName: `${artifact.templateId}.${artifact.role}${extension}`,
    };

    const templateFields = groupedByTemplate.get(artifact.templateId) ?? new Map();
    const fieldAssets = templateFields.get(metadata.field) ?? [];
    fieldAssets.push({ artifact, defaultAsset, order: metadata.order });
    templateFields.set(metadata.field, fieldAssets);
    groupedByTemplate.set(artifact.templateId, templateFields);

    const existingRuntimeAsset = runtimeAssets.get(assetRelativePath);
    if (
      existingRuntimeAsset &&
      (existingRuntimeAsset.contentHash !== artifact.contentHash || existingRuntimeAsset.byteSize !== artifact.byteSize)
    ) {
      throw new Error(`Runtime input path collision at ${assetRelativePath}.`);
    }
    if (!existingRuntimeAsset) {
      runtimeAssets.set(assetRelativePath, {
        relativePath: assetRelativePath,
        sourcePath: resolved.sourcePath,
        contentHash: artifact.contentHash,
        byteSize: artifact.byteSize,
      });
    }
  }

  const mapping = {};
  for (const templateId of [...groupedByTemplate.keys()].sort()) {
    const templateFields = groupedByTemplate.get(templateId);
    const bindings = [];
    for (const field of FIELD_ORDER) {
      const assets = templateFields.get(field);
      if (!assets?.length) continue;
      assets.sort(
        (left, right) =>
          left.order - right.order ||
          left.artifact.role.localeCompare(right.artifact.role) ||
          left.artifact.contentHash.localeCompare(right.artifact.contentHash),
      );
      if (field !== 'referenceImages' && assets.length > 1) {
        throw new Error(`${templateId} declares multiple reviewed defaults for singular field ${field}.`);
      }
      const fieldMetadata = FIELD_METADATA[field];
      bindings.push({
        id: `${templateId}-${kebabCase(field)}-defaults`,
        label:
          assets.length === 1 && assets[0].artifact.bindingLabel
            ? assets[0].artifact.bindingLabel
            : assets.length === 1
              ? fieldMetadata.singularLabel
              : fieldMetadata.pluralLabel,
        mediaType: fieldMetadata.mediaType,
        origin: 'template',
        requiredAt: 'workflow_start',
        field,
        defaultAssets: assets.map(({ defaultAsset }) => defaultAsset),
      });
    }
    mapping[templateId] = bindings;
  }

  return {
    mapping,
    runtimeAssets: [...runtimeAssets.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
  };
}

function validateCoverage(requirements, mapping) {
  const mappedAssetIds = new Set();
  let mappedAssetCount = 0;
  for (const bindings of Object.values(mapping)) {
    for (const binding of bindings) {
      for (const asset of binding.defaultAssets) {
        mappedAssetCount += 1;
        if (mappedAssetIds.has(asset.id)) throw new Error(`Duplicate default input asset id: ${asset.id}`);
        mappedAssetIds.add(asset.id);
      }
    }
  }

  if (mappedAssetCount !== requirements.length) {
    throw new Error(
      `Default input coverage mismatch: mapped ${mappedAssetCount} of ${requirements.length} reviewed root inputs.`,
    );
  }
  for (const requirement of requirements) {
    const expectedId = `${requirement.templateId}-${kebabCase(requirement.role)}`;
    if (!mappedAssetIds.has(expectedId)) {
      throw new Error(
        `Default input coverage is missing ${requirement.templateId} ${requirement.role} (${requirement.contentHash}).`,
      );
    }
  }
}

export class TemplateDefaultInputResolutionError extends Error {
  constructor(issues) {
    super(`Could not resolve ${issues.length} approved template default input item(s).`);
    this.name = 'TemplateDefaultInputResolutionError';
    this.issues = issues;
  }
}

export async function buildTemplateDefaultInputPlan(projectRoot = PROJECT_ROOT) {
  const collected = await collectRequirements(projectRoot);
  if (collected.issues.length > 0) {
    throw new TemplateDefaultInputResolutionError(collected.issues);
  }

  const resolved = await resolveRequirementSources(projectRoot, collected.requirements);
  if (resolved.issues.length > 0) {
    throw new TemplateDefaultInputResolutionError(resolved.issues);
  }

  const { mapping, runtimeAssets } = buildMapping(collected.requirements, resolved.resolutions);
  validateCoverage(collected.requirements, mapping);
  const templateIds = await readStudioTemplateIds(projectRoot);
  const templateIdSet = new Set(templateIds);
  const approvedTemplateIds = collected.approvedEntries.map((entry) => entry.templateId);
  const approvedTemplateIdSet = new Set(approvedTemplateIds);
  const unexpectedTemplateIds = Object.keys(mapping).filter((templateId) => !approvedTemplateIdSet.has(templateId));
  if (unexpectedTemplateIds.length > 0) {
    throw new Error(`Runtime input map contains non-approved templates: ${unexpectedTemplateIds.join(', ')}`);
  }
  const unmappedTemplateIds = Object.keys(mapping).filter((templateId) => !templateIdSet.has(templateId));
  if (unmappedTemplateIds.length > 0) {
    throw new Error(`Runtime input map contains unknown Studio templates: ${unmappedTemplateIds.join(', ')}`);
  }

  return {
    projectRoot,
    templateIds,
    approvedTemplateIds,
    requirements: collected.requirements,
    excludedGenerated: collected.excludedGenerated,
    resolutions: resolved.resolutions,
    mapping,
    runtimeAssets,
  };
}

export function renderRuntimeInputJson(plan) {
  return `${JSON.stringify(plan.mapping, null, 2)}\n`;
}

export async function renderRuntimeInputTypescript(plan) {
  const usedFields = new Set(
    Object.values(plan.mapping).flatMap((bindings) => bindings.map((binding) => binding.field)),
  );
  const packedFields = PACKED_FIELD_ORDER.filter((field) => usedFields.has(field));
  if (packedFields.length !== usedFields.size) {
    const unknownFields = [...usedFields].filter((field) => !packedFields.includes(field));
    throw new Error(`Runtime input map contains unpackable fields: ${unknownFields.join(', ')}`);
  }

  const templateIndexes = new Map(plan.templateIds.map((templateId, index) => [templateId, index]));
  const packedByIndex = new Map();
  for (const [templateId, bindings] of Object.entries(plan.mapping)) {
    const templateIndex = templateIndexes.get(templateId);
    if (templateIndex === undefined) throw new Error(`Runtime input map contains unknown template ${templateId}.`);
    packedByIndex.set(
      templateIndex,
      bindings.map((binding) => {
        const fieldIndex = packedFields.indexOf(binding.field);
        const defaultBindingLabel =
          binding.field === 'referenceImages'
            ? `Reviewed reference image${binding.defaultAssets.length > 1 ? 's' : ''}`
            : `Reviewed ${binding.field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`;
        const packedBinding = [
          fieldIndex,
          binding.defaultAssets.map((asset, assetIndex) => {
            const runtimeMatch = /^\/template-gallery\/runtime-inputs\/assets\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(
              asset.runtimePath,
            );
            if (!runtimeMatch) throw new Error(`Default input ${asset.id} has an unpackable runtime path.`);
            const [, digest, extension] = runtimeMatch;
            if (asset.runtimeSha256 !== `sha256:bytes:${digest}`) {
              throw new Error(`Default input ${asset.id} runtime path and hash differ.`);
            }
            const defaultPreviewPath = `/template-gallery/inputs/${templateId}.before.${extension}`;
            const packedPreview = asset.previewPath === defaultPreviewPath ? true : asset.previewPath;
            const defaultAssetLabel =
              binding.field === 'referenceImages'
                ? `Reviewed reference image ${assetIndex + 1}`
                : `Reviewed ${binding.field.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`;
            const packedAsset = [`${Buffer.from(digest, 'hex').toString('base64')}.${extension}`];
            if (packedPreview || asset.label !== defaultAssetLabel) packedAsset.push(packedPreview ?? null);
            if (asset.label !== defaultAssetLabel) packedAsset.push(asset.label);
            return packedAsset;
          }),
        ];
        if (binding.label !== defaultBindingLabel) packedBinding.push(binding.label);
        return packedBinding;
      }),
    );
  }
  const maximumIndex = Math.max(...packedByIndex.keys());
  const packedSource = `[${Array.from({ length: maximumIndex + 1 }, (_, index) =>
    packedByIndex.has(index) ? JSON.stringify(packedByIndex.get(index)) : '',
  ).join(',')}]`;

  const source = `/* eslint-disable no-sparse-arrays -- generated sparse template index */
import type {
  StudioTemplateDefaultInputAsset,
  StudioTemplateId,
  StudioTemplateInputBinding,
  StudioTemplateInputFormField,
} from '../types';

/** Generated by scripts/template-default-inputs.mjs. Do not edit by hand. */
type PackedAsset = readonly [runtimePath: string, previewPath?: string | true | null, label?: string];
type PackedBinding = readonly [fieldIndex: number, assets: readonly PackedAsset[], label?: string];

const PACKED_INPUT_FIELDS = ${JSON.stringify(packedFields)} as const satisfies readonly StudioTemplateInputFormField[];

const PACKED_TEMPLATE_DEFAULT_INPUTS = ${packedSource} as const satisfies readonly (
  | readonly PackedBinding[]
  | undefined
)[];

function camelToDelimited(value: string, delimiter: '-' | '_' | ' ') {
  return value.replace(/[A-Z]/g, (letter) => delimiter + letter.toLowerCase());
}

function mediaTypeForField(field: StudioTemplateInputFormField) {
  return field.endsWith('Audio')
    ? ('audio' as const)
    : field.endsWith('Video')
      ? ('video' as const)
      : ('image' as const);
}

function reviewedLabel(field: StudioTemplateInputFormField) {
  return 'Reviewed ' + camelToDelimited(field, ' ');
}

function unpackAsset(
  templateId: string,
  field: StudioTemplateInputFormField,
  mediaType: 'image' | 'video' | 'audio',
  packed: PackedAsset,
  index: number,
): StudioTemplateDefaultInputAsset {
  const [runtimeFile, preview, label] = packed;
  const separator = runtimeFile.lastIndexOf('.');
  const digest = Array.from(atob(runtimeFile.slice(0, separator)), (byte) =>
    byte.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('');
  const extension = runtimeFile.slice(separator + 1);
  const runtimePath = '/template-gallery/runtime-inputs/assets/' + digest + '.' + extension;
  const previewPath =
    preview === true
      ? '/template-gallery/inputs/' + templateId + '.before.' + extension
      : preview?.startsWith('.')
        ? '/template-gallery/inputs/' + templateId + '.before' + preview
        : preview;
  const referenceImage = field === 'referenceImages';
  const assetField = referenceImage ? 'reference-image' : camelToDelimited(field, '-');
  const fileField = referenceImage ? 'reference_image' : camelToDelimited(field, '_');
  const suffix = referenceImage ? String(index + 1) : '';
  return {
    id: templateId + '-' + assetField + (suffix ? '-' + suffix : ''),
    label: label ?? (referenceImage ? 'Reviewed reference image ' + (index + 1) : reviewedLabel(field)),
    mediaType,
    ...(previewPath ? { previewPath } : {}),
    runtimePath,
    runtimeSha256: \`sha256:bytes:\${digest}\`,
    fileName: templateId + '.' + fileField + (suffix ? '_' + suffix : '') + '.' + extension,
  };
}

export function templateDefaultInputBindings(templateId: StudioTemplateId, index: number) {
  const bindings = PACKED_TEMPLATE_DEFAULT_INPUTS[index];
  return (bindings ?? []).map(([fieldIndex, assets, label]) => {
    const field = PACKED_INPUT_FIELDS[fieldIndex]!;
    const mediaType = mediaTypeForField(field);
    return {
      id: templateId + '-' + camelToDelimited(field, '-') + '-defaults',
      label:
        label ??
        (field === 'referenceImages'
          ? 'Reviewed reference image' + (assets.length > 1 ? 's' : '')
          : reviewedLabel(field)),
      mediaType,
      origin: 'template',
      requiredAt: 'workflow_start',
      field,
      defaultAssets: assets.map((asset, index) => unpackAsset(templateId, field, mediaType, asset, index)),
    };
  }) as Array<Extract<StudioTemplateInputBinding, { origin: 'template' }>>;
}
`;
  return format(source, {
    parser: 'typescript',
    endOfLine: 'lf',
    printWidth: 120,
    singleQuote: true,
    trailingComma: 'all',
  });
}

export async function writeTemplateDefaultInputPlan(plan, destinationRoot = plan.projectRoot) {
  const runtimeRoot = resolve(destinationRoot, RUNTIME_INPUT_ROOT);
  const runtimeAssetRoot = resolve(destinationRoot, RUNTIME_ASSET_ROOT);
  const jsonPath = resolve(destinationRoot, RUNTIME_JSON_PATH);
  const typescriptPath = resolve(destinationRoot, GENERATED_TYPESCRIPT_PATH);

  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(runtimeAssetRoot, { recursive: true });
  for (const asset of plan.runtimeAssets) {
    const destination = resolve(runtimeRoot, asset.relativePath);
    if (!isWithin(runtimeAssetRoot, destination)) {
      throw new Error(`Refusing to write runtime input outside the asset root: ${asset.relativePath}`);
    }
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(asset.sourcePath, destination);
  }
  await writeFile(jsonPath, renderRuntimeInputJson(plan));
  await mkdir(resolve(typescriptPath, '..'), { recursive: true });
  await writeFile(typescriptPath, await renderRuntimeInputTypescript(plan));
  await syncManifestInputContracts(plan, destinationRoot);
}

async function readManifestIfPresent(destinationRoot) {
  try {
    return await readJson(resolve(destinationRoot, MANIFEST_PATH));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function syncManifestInputContracts(plan, destinationRoot = plan.projectRoot) {
  const manifestPath = resolve(destinationRoot, MANIFEST_PATH);
  const manifest = await readManifestIfPresent(destinationRoot);
  if (!manifest) return;

  manifest.examples = (manifest.examples ?? []).map((entry) => {
    const hash = templateInputContractHash(plan.mapping[entry.templateId]);
    if (hash) return { ...entry, templateInputContractHash: hash };
    const rest = { ...entry };
    delete rest.templateInputContractHash;
    return rest;
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function relativeFileInventory(root) {
  return (await walkFiles(root))
    .map((path) => toPosix(relative(root, path)))
    .sort((left, right) => left.localeCompare(right));
}

export async function verifyTemplateDefaultInputPlan(plan, destinationRoot = plan.projectRoot) {
  const issues = [];
  const runtimeRoot = resolve(destinationRoot, RUNTIME_INPUT_ROOT);
  const jsonPath = resolve(destinationRoot, RUNTIME_JSON_PATH);
  const typescriptPath = resolve(destinationRoot, GENERATED_TYPESCRIPT_PATH);
  const expectedFiles = ['default-input-bindings.json', ...plan.runtimeAssets.map((asset) => asset.relativePath)].sort(
    (left, right) => left.localeCompare(right),
  );

  let actualFiles = [];
  try {
    actualFiles = await relativeFileInventory(runtimeRoot);
  } catch (error) {
    issues.push(`Could not inventory ${RUNTIME_INPUT_ROOT}: ${error.message}`);
  }
  if (stableJson(actualFiles) !== stableJson(expectedFiles)) {
    issues.push(`Runtime file inventory differs (expected ${expectedFiles.length}, found ${actualFiles.length}).`);
  }

  for (const asset of plan.runtimeAssets) {
    const destination = resolve(runtimeRoot, asset.relativePath);
    if (!(await fileMatches(destination, asset))) {
      issues.push(`${toPosix(relative(destinationRoot, destination))} does not match ${asset.contentHash}.`);
    }
  }

  try {
    const actualJson = await readFile(jsonPath, 'utf8');
    if (actualJson !== renderRuntimeInputJson(plan)) {
      issues.push(`${RUNTIME_JSON_PATH} is stale or non-deterministically formatted.`);
    }
  } catch (error) {
    issues.push(`Could not read ${RUNTIME_JSON_PATH}: ${error.message}`);
  }

  try {
    const actualTypescript = await readFile(typescriptPath, 'utf8');
    if (actualTypescript !== (await renderRuntimeInputTypescript(plan))) {
      issues.push(`${GENERATED_TYPESCRIPT_PATH} is stale or non-deterministically formatted.`);
    }
  } catch (error) {
    issues.push(`Could not read ${GENERATED_TYPESCRIPT_PATH}: ${error.message}`);
  }

  const manifest = await readManifestIfPresent(destinationRoot);
  if (manifest) {
    for (const entry of manifest.examples ?? []) {
      const expectedHash = templateInputContractHash(plan.mapping[entry.templateId]);
      if (entry.templateInputContractHash !== expectedHash) {
        issues.push(`${entry.templateId} has a stale templateInputContractHash.`);
      }
    }
  }

  if (issues.length > 0) {
    const error = new Error(`Template default input verification failed:\n- ${issues.join('\n- ')}`);
    error.issues = issues;
    throw error;
  }
}

export async function runtimeTreeDigest(destinationRoot) {
  const roots = [resolve(destinationRoot, RUNTIME_INPUT_ROOT), resolve(destinationRoot, GENERATED_TYPESCRIPT_PATH)];
  const entries = [];
  for (const root of roots) {
    const metadata = await stat(root);
    const paths = metadata.isDirectory() ? await walkFiles(root) : [root];
    for (const path of paths) {
      entries.push({
        path: toPosix(relative(destinationRoot, path)),
        sha256: await fileSha256(path),
      });
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return createHash('sha256').update(stableJson(entries)).digest('hex');
}

function bundleSummary(plan, verb) {
  const byteSize = plan.runtimeAssets.reduce((total, asset) => total + asset.byteSize, 0);
  return [
    `${verb} ${plan.requirements.length} approved or explicitly selected root input artifacts`,
    `for ${Object.keys(plan.mapping).length} approved templates`,
    `as ${plan.runtimeAssets.length} unique runtime files (${(byteSize / 1024 / 1024).toFixed(2)} MiB)`,
    `and excluded ${plan.excludedGenerated.length} generated downstream input(s).`,
  ].join(' ');
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const unknownArguments = arguments_.filter((argument) => argument !== '--check');
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(', ')}`);
  }

  const plan = await buildTemplateDefaultInputPlan();
  if (arguments_.includes('--check')) {
    await verifyTemplateDefaultInputPlan(plan);
    console.log(bundleSummary(plan, 'Verified'));
    return;
  }

  await writeTemplateDefaultInputPlan(plan);
  await verifyTemplateDefaultInputPlan(plan);
  console.log(bundleSummary(plan, 'Generated'));
}

if (resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(error.message);
    if (error instanceof TemplateDefaultInputResolutionError) {
      for (const issue of error.issues) console.error(`- ${JSON.stringify(issue)}`);
    }
    process.exitCode = 1;
  });
}
