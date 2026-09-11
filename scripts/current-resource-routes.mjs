import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { normalizeResourceRouteBinding, resourceRouteBindingHash } from './resource-route-binding.mjs';

const CLIENT_ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_BACKEND_ROOT = resolve(process.env.MODIFF_BACKEND_DIR || join(CLIENT_ROOT, '..', 'MoDiff'));
const MANIFEST_HASH_PREFIX = 'sha256:current-resource-routes-v1:';
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])]),
  );
}

export function currentResourceRouteManifestHash(value) {
  const body = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'manifestHash'));
  return `${MANIFEST_HASH_PREFIX}${createHash('sha256')
    .update(JSON.stringify(stable(body)))
    .digest('hex')}`;
}

export function normalizeCurrentResourceRouteManifest(value) {
  if (
    !exactKeys(value, ['schemaVersion', 'format', 'routes', 'manifestHash']) ||
    value.schemaVersion !== 1 ||
    value.format !== 'modiff.current-resource-routes.v1' ||
    value.manifestHash !== currentResourceRouteManifestHash(value) ||
    !Array.isArray(value.routes) ||
    value.routes.length > 256
  ) {
    throw new Error('Current resource-route manifest is malformed or stale.');
  }
  const admissionIds = new Set();
  const routes = value.routes.map((route) => {
    if (
      !exactKeys(route, ['admissionId', 'definition', 'studioMode', 'routeBinding', 'routeBindingHash']) ||
      typeof route.admissionId !== 'string' ||
      !route.admissionId ||
      admissionIds.has(route.admissionId) ||
      typeof route.studioMode !== 'string' ||
      !route.studioMode ||
      !exactKeys(route.definition, ['id', 'contentHash', 'libraryRevision', 'pipelineClass', 'workflowId']) ||
      typeof route.definition.id !== 'string' ||
      !route.definition.id ||
      typeof route.definition.contentHash !== 'string' ||
      !SHA256.test(route.definition.contentHash) ||
      typeof route.definition.libraryRevision !== 'string' ||
      !COMMIT.test(route.definition.libraryRevision) ||
      typeof route.definition.pipelineClass !== 'string' ||
      !route.definition.pipelineClass ||
      typeof route.definition.workflowId !== 'string' ||
      !route.definition.workflowId
    ) {
      throw new Error('Current resource-route manifest contains an invalid or ambiguous registered route.');
    }
    admissionIds.add(route.admissionId);
    const routeBinding = normalizeResourceRouteBinding(route.routeBinding);
    if (
      routeBinding.admissionId !== route.admissionId ||
      route.routeBindingHash !== resourceRouteBindingHash(routeBinding)
    ) {
      throw new Error('Current resource-route manifest binding identity is stale.');
    }
    return {
      admissionId: route.admissionId,
      definition: { ...route.definition },
      studioMode: route.studioMode,
      routeBinding,
      routeBindingHash: route.routeBindingHash,
    };
  });
  if (routes.some((route, index) => index > 0 && routes[index - 1].admissionId >= route.admissionId)) {
    throw new Error('Current resource-route manifest must be uniquely sorted by admissionId.');
  }
  return {
    schemaVersion: 1,
    format: 'modiff.current-resource-routes.v1',
    routes,
    manifestHash: value.manifestHash,
  };
}

function pythonCandidates(backendRoot) {
  const managed =
    process.platform === 'win32'
      ? resolve(backendRoot, '.venv', 'Scripts', 'python.exe')
      : resolve(backendRoot, '.venv', 'bin', 'python');
  return [
    ...(process.env.MODIFF_PYTHON ? [[process.env.MODIFF_PYTHON]] : []),
    ...(existsSync(managed) ? [[managed]] : []),
    ['python3'],
    ['python'],
    ...(process.platform === 'win32' ? [['py', '-3']] : []),
  ];
}

export function loadCurrentResourceRouteManifest({ backendRoot = DEFAULT_BACKEND_ROOT, manifestPath } = {}) {
  const explicitPath = manifestPath ?? process.env.MODIFF_CURRENT_RESOURCE_ROUTES_MANIFEST;
  if (explicitPath)
    return normalizeCurrentResourceRouteManifest(JSON.parse(readFileSync(resolve(explicitPath), 'utf8')));
  for (const [command, ...prefix] of pythonCandidates(backendRoot)) {
    const result = spawnSync(
      command,
      [...prefix, '-m', 'modiff.huggingface_cluster_publication_audit', '--print-current-resource-routes'],
      { cwd: backendRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    if (result.error?.code === 'ENOENT') continue;
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Could not resolve current registered resource routes: ${result.stderr.trim()}`);
    }
    return normalizeCurrentResourceRouteManifest(JSON.parse(result.stdout));
  }
  throw new Error('No Python interpreter is available to resolve current registered resource routes.');
}

export function exactCurrentResourceRouteFromManifest(routeBinding, manifestValue) {
  const binding = normalizeResourceRouteBinding(routeBinding);
  const bindingHash = resourceRouteBindingHash(binding);
  const manifest = normalizeCurrentResourceRouteManifest(manifestValue);
  const matches = manifest.routes.filter(
    (route) =>
      route.admissionId === binding.admissionId &&
      route.routeBindingHash === bindingHash &&
      JSON.stringify(stable(route.routeBinding)) === JSON.stringify(stable(binding)),
  );
  if (matches.length !== 1) {
    const current = manifest.routes.find((route) => route.admissionId === binding.admissionId);
    const currentIdentity = current
      ? `${current.routeBinding.blockDefinition.contentHash} / ${current.routeBinding.blockDefinition.canonicalSha256}; binding ${current.routeBindingHash}`
      : 'no current admission';
    throw new Error(
      `Route resource evidence does not match one exact current registered BlockDefinitionV2 route: ${binding.admissionId}. ` +
        `Retained ${binding.blockDefinition.contentHash} / ${binding.blockDefinition.canonicalSha256}; binding ${bindingHash}. ` +
        `Current ${currentIdentity}. Preserve the retained proofs; generate two new exact-current route proofs instead of rebinding historical evidence.`,
    );
  }
  return matches[0];
}

export function exactCurrentResourceRoute(routeBinding, options = {}) {
  return exactCurrentResourceRouteFromManifest(routeBinding, loadCurrentResourceRouteManifest(options));
}
