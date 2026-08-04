import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildBackendInstallerPackageSet } from './backend-installer-contract.mjs';

function fixture({ managed = false, requirements = 'torch==2.8.0\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'modiff-installer-contract-'));
  mkdirSync(join(root, 'modiff', 'compatibility'), { recursive: true });
  mkdirSync(join(root, 'requirements', 'profiles'), { recursive: true });
  writeFileSync(join(root, 'pyproject.toml'), `[project]\nname = "modiff"\n\n[tool.uv]\nmanaged = ${managed}\n`);
  writeFileSync(
    join(root, 'modiff', 'compatibility', 'accelerators.v1.json'),
    `${JSON.stringify({
      schema_version: 1,
      revision: 'test-runtime-contract',
      python: '3.12.*',
      profiles: {
        cpu: {
          tier: 'supported',
          requirements: 'requirements/profiles/cpu.txt',
          torch: '2.8.0',
          torchvision: '0.23.0',
          torchaudio: '2.8.0',
          prohibited: ['bitsandbytes'],
        },
      },
    })}\n`,
  );
  writeFileSync(join(root, 'requirements', 'profiles', 'cpu.txt'), requirements);
  return root;
}

test('package identity follows the installer-owned manifest and profile requirements without uv.lock', () => {
  const root = fixture();
  try {
    const first = buildBackendInstallerPackageSet(root);
    assert.equal(first.id, 'backend-installer-profiles');
    assert.equal(first.uvProjectManaged, false);
    assert.equal(first.runtimeManifestRevision, 'test-runtime-contract');
    assert.match(first.runtimeManifestSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.runtimeProfiles.cpu.requirementsSha256, /^sha256:[a-f0-9]{64}$/);

    writeFileSync(join(root, 'requirements', 'profiles', 'cpu.txt'), 'torch==2.8.1\n');
    const changed = buildBackendInstallerPackageSet(root);
    assert.notEqual(changed.runtimeProfiles.cpu.requirementsSha256, first.runtimeProfiles.cpu.requirementsSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('package contract rejects uv project management and missing profile inputs', () => {
  const managedRoot = fixture({ managed: true });
  const missingRoot = fixture();
  try {
    assert.throws(() => buildBackendInstallerPackageSet(managedRoot), /managed = false/);
    rmSync(join(missingRoot, 'requirements', 'profiles', 'cpu.txt'));
    assert.throws(() => buildBackendInstallerPackageSet(missingRoot), /requirements is missing/);
  } finally {
    rmSync(managedRoot, { recursive: true, force: true });
    rmSync(missingRoot, { recursive: true, force: true });
  }
});

test('development installers avoid duplicate client builds and install backend test requirements', () => {
  const root = new URL('..', import.meta.url);
  const shell = readFileSync(new URL('install-dev.sh', root), 'utf8');
  const powershell = readFileSync(new URL('install-dev.ps1', root), 'utf8');

  assert.match(shell, /install\.sh" "\$@" --backend-only/);
  assert.match(shell, /uv" pip install|UV_BIN" pip install/);
  assert.match(shell, /requirements\/test\.txt/);
  assert.match(powershell, /-BackendOnly/);
  assert.match(powershell, /pip install --python \$python -r \$testRequirements/);
  assert.match(powershell, /requirements\\test\.txt/);
  assert.match(powershell, /& npm\.cmd ci\s+if \(\$LASTEXITCODE -ne 0\)/);
});

test('development launchers fail closed and keep live E2E shell-neutral', () => {
  const root = new URL('..', import.meta.url);
  const shell = readFileSync(new URL('run-dev.sh', root), 'utf8');
  const powershell = readFileSync(new URL('run-dev.ps1', root), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const playwrightConfig = readFileSync(new URL('playwright.config.ts', root), 'utf8');

  assert.match(shell, /HOST="127\.0\.0\.1"/);
  assert.doesNotMatch(shell, /SSH_(?:CONNECTION|CLIENT)/);
  assert.match(shell, /Backend did not become ready[\s\S]+exit 1/);
  assert.match(powershell, /runtime\/status/);
  assert.match(powershell, /SupervisorHealthUrl/);
  assert.match(powershell, /Backend did not become ready/);
  assert.equal(
    packageJson.scripts['e2e:studio:live-backend'],
    'playwright test tests/e2e/live-backend/live-backend.spec.ts',
  );
  assert.match(playwrightConfig, /process\.env\.MODIFF_SERVER/);
  assert.match(playwrightConfig, /isLiveBackendRun \? 'http:\/\/127\.0\.0\.1:8088'/);
  assert.match(playwrightConfig, /baseURL: `http:\/\/127\.0\.0\.1:\$\{mockFrontendPort\}`/);
});

test('README follows the paired install and development launcher contract', () => {
  const root = new URL('..', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const developmentStart = readme.indexOf('## Development quick start');
  const developmentEnd = readme.indexOf('## Your First Workflow');

  assert.notEqual(developmentStart, -1);
  assert.ok(developmentEnd > developmentStart);
  const development = readme.slice(developmentStart, developmentEnd);

  assert.match(readme, /git clone https:\/\/github\.com\/sdevil7th\/MoDiff\.git MoDiff/);
  assert.match(readme, /git clone https:\/\/github\.com\/sdevil7th\/MoDiff-client\.git MoDiff-client/);
  assert.match(readme, /https:\/\/github\.com\/sdevil7th\/MoDiff#install-and-run/);
  assert.match(development, /\.\/install-dev\.sh --accelerator auto/);
  assert.match(development, /\.\/run-dev\.sh/);
  assert.match(development, /\.\\install-dev\.ps1 -BackendPath \.\.\\MoDiff -Accelerator auto/);
  assert.match(development, /\.\\run-dev\.ps1/);
  assert.ok(development.indexOf('./install-dev.sh') < development.indexOf('./run-dev.sh'));
  assert.ok(development.indexOf('.\\install-dev.ps1') < development.indexOf('.\\run-dev.ps1'));

  for (const match of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const path = target.split('#', 1)[0];
    if (!path) continue;
    assert.doesNotThrow(() => readFileSync(new URL(path, root)), `README link target does not exist: ${target}`);
  }
});
