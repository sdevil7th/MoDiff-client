import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function requiredFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return path;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(requiredFile(path, label), 'utf8'));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${path}`, { cause: error });
  }
}

function assertUvIsInstallerManaged(pyproject, path) {
  const header = /^\[tool\.uv\]\s*$/m.exec(pyproject);
  const afterHeader = header ? pyproject.slice(header.index + header[0].length) : '';
  const nextSection = /^\[[^\]]+\]\s*$/m.exec(afterHeader);
  const section = afterHeader.slice(0, nextSection?.index ?? afterHeader.length);
  if (!section || !/^\s*managed\s*=\s*false\s*(?:#.*)?$/m.test(section)) {
    throw new Error(
      `${path} must declare [tool.uv] managed = false because accelerator profile installers own the environment.`,
    );
  }
}

function safeRequirementsPath(backendRoot, value, profileId) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Runtime profile ${profileId} must declare a requirements path.`);
  }
  const path = resolve(backendRoot, value);
  const relativePath = relative(backendRoot, path);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Runtime profile ${profileId} requirements escape the backend root: ${value}`);
  }
  requiredFile(path, `Runtime profile ${profileId} requirements`);
  return { path, relativePath: relativePath.replaceAll('\\', '/') };
}

export function buildBackendInstallerPackageSet(backendRoot) {
  const pyprojectPath = join(backendRoot, 'pyproject.toml');
  const pyproject = readFileSync(requiredFile(pyprojectPath, 'Backend pyproject'), 'utf8');
  assertUvIsInstallerManaged(pyproject, pyprojectPath);

  const manifestRelativePath = 'modiff/compatibility/accelerators.v1.json';
  const manifestPath = join(backendRoot, manifestRelativePath);
  const manifest = readJson(manifestPath, 'Accelerator compatibility manifest');
  if (manifest.schema_version !== 1 || !manifest.revision || !manifest.profiles) {
    throw new Error(`Accelerator compatibility manifest has an unsupported schema: ${manifestPath}`);
  }

  const profiles = Object.fromEntries(
    Object.entries(manifest.profiles)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, profile]) => {
        const requirements = safeRequirementsPath(backendRoot, profile.requirements, id);
        return [
          id,
          {
            tier: profile.tier,
            requirementsPath: requirements.relativePath,
            requirementsSha256: sha256File(requirements.path),
            torch: profile.torch,
            torchvision: profile.torchvision,
            torchaudio: profile.torchaudio,
            triton: profile.triton ?? null,
            cuda: profile.cuda ?? null,
            rocm: profile.rocm ?? null,
            prohibitedPackages: profile.prohibited ?? [],
          },
        ];
      }),
  );
  if (Object.keys(profiles).length === 0) {
    throw new Error(`Accelerator compatibility manifest declares no runtime profiles: ${manifestPath}`);
  }

  return {
    id: 'backend-installer-profiles',
    installStrategy: 'installer-owned-profile-requirements',
    uvProjectManaged: false,
    pyprojectPath: 'pyproject.toml',
    pyprojectSha256: sha256File(pyprojectPath),
    runtimeManifestPath: manifestRelativePath,
    runtimeManifestSha256: sha256File(manifestPath),
    runtimeManifestRevision: manifest.revision,
    runtimePython: manifest.python ?? null,
    runtimeProfiles: profiles,
  };
}
