import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildBackendInstallerPackageSet } from './backend-installer-contract.mjs';
import './development-installer-launchers.test.mjs';

function fixture({ managed = true, requirements = 'torch==2.8.0\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'modiff-installer-contract-'));
  mkdirSync(join(root, 'modiff', 'compatibility'), { recursive: true });
  mkdirSync(join(root, 'requirements', 'profiles'), { recursive: true });
  writeFileSync(join(root, 'pyproject.toml'), `[project]\nname = "modiff"\n\n[tool.uv]\nmanaged = ${managed}\n`);
  writeFileSync(join(root, 'uv.lock'), 'version = 1\nrevision = 1\n');
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

function reviewedSetupSourceContract(readme, workflow) {
  const sections = Array.from(
    readme.matchAll(/^application source pair is:\r?\n\r?\n([\s\S]*?)\r?\n\r?\nCI backend contract:/gmu),
    (match) => match[1],
  );
  assert.equal(sections.length, 1, 'README must declare one reviewed application source table');
  const [header, separator, ...rows] = sections[0].split(/\r?\n/u);
  assert.match(header, /^\|\s*Repository\s*\|\s*Application source before final packaging\s*\|$/u);
  assert.match(separator, /^\|[ :\-]+\|[ :\-]+\|$/u);
  assert.equal(rows.length, 2, 'Reviewed application source table must contain exactly two rows');
  const pairs = rows.map((row) => {
    const match = /^\|\s*(MoDiff(?:-client)?)\s*\|\s*`([a-f0-9]{40})`\s*\|$/u.exec(row);
    assert.ok(match, 'Each application source row must name its repository and a full immutable commit');
    return [match[1], match[2]];
  });
  assert.deepEqual(
    pairs.map(([repository]) => repository).sort(),
    ['MoDiff', 'MoDiff-client'],
    'Reviewed application source repositories must be unique and complete',
  );
  const ciPins = Array.from(readme.matchAll(/^CI backend contract: `([^`\r\n]+)`\.[ \t]*\r?$/gmu), (match) => match[1]);
  assert.equal(ciPins.length, 1, 'README must declare exactly one CI backend contract pin');
  assert.match(ciPins[0], /^[a-f0-9]{40}$/u, 'The declared CI backend contract must be an immutable commit');
  const checkouts = Array.from(workflow.matchAll(/^([ \t]+)repository: sdevil7th\/MoDiff[ \t]*\r?$/gmu));
  assert.equal(checkouts.length, 2, 'Both CI jobs must check out the reviewed backend repository');
  const backendRefs = checkouts.map((checkout) => {
    const fields = [];
    const followingLines = workflow
      .slice(checkout.index + checkout[0].length)
      .split(/\r?\n/u)
      .slice(1);
    for (const line of followingLines) {
      if (!line.trim()) continue;
      const indentation = /^[ \t]*/u.exec(line)[0].length;
      if (indentation < checkout[1].length) break;
      if (line.trimStart().startsWith('ref:')) fields.push(line.trim());
    }
    assert.equal(fields.length, 1, 'Each backend checkout must declare exactly one ref');
    const match = /^ref: ([a-f0-9]{40})$/u.exec(fields[0]);
    assert.ok(match, 'Each CI backend ref must be a full immutable commit');
    return match[1];
  });
  assert.deepEqual(backendRefs, [ciPins[0], ciPins[0]], 'Both CI jobs must match the documented CI backend contract');
  return { applicationSource: Object.fromEntries(pairs), ciBackendCommit: ciPins[0] };
}

test('package identity binds the native uv lock and specialized profile requirements', () => {
  const root = fixture();
  try {
    const first = buildBackendInstallerPackageSet(root);
    assert.equal(first.id, 'backend-installer-profiles');
    assert.equal(first.uvProjectManaged, true);
    assert.match(first.uvLockSha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.runtimeManifestRevision, 'test-runtime-contract');
    assert.match(first.runtimeManifestSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.runtimeProfiles.cpu.requirementsSha256, /^sha256:[a-f0-9]{64}$/);

    writeFileSync(join(root, 'requirements', 'profiles', 'cpu.txt'), 'torch==2.8.1\n');
    const changed = buildBackendInstallerPackageSet(root);
    assert.notEqual(changed.runtimeProfiles.cpu.requirementsSha256, first.runtimeProfiles.cpu.requirementsSha256);
    writeFileSync(join(root, 'uv.lock'), 'version = 1\nrevision = 2\n');
    assert.notEqual(buildBackendInstallerPackageSet(root).uvLockSha256, first.uvLockSha256);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('package contract rejects unmanaged projects and missing profile or lock inputs', () => {
  const managedRoot = fixture({ managed: false });
  const missingRoot = fixture();
  const missingLockRoot = fixture();
  try {
    assert.throws(() => buildBackendInstallerPackageSet(managedRoot), /native uv project management/);
    rmSync(join(missingRoot, 'requirements', 'profiles', 'cpu.txt'));
    assert.throws(() => buildBackendInstallerPackageSet(missingRoot), /requirements is missing/);
    rmSync(join(missingLockRoot, 'uv.lock'));
    assert.throws(() => buildBackendInstallerPackageSet(missingLockRoot), /uv lock is missing/);
  } finally {
    rmSync(managedRoot, { recursive: true, force: true });
    rmSync(missingRoot, { recursive: true, force: true });
    rmSync(missingLockRoot, { recursive: true, force: true });
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
  const quickStart = readme.indexOf('## Developer setup with uv and npm');
  const installStart = readme.indexOf('## Install and run MoDiff');
  const developmentStart = readme.indexOf('## Optional development launchers');
  const developmentEnd = readme.indexOf('## Your First Workflow');

  assert.notEqual(quickStart, -1, 'README must expose the uv/npm quick start');
  assert.ok(installStart > quickStart, 'Developer quick start must precede launcher installation');
  const quick = readme.slice(quickStart, installStart);
  for (const command of [
    'git clone --branch fix-ui-ux-issues https://github.com/sdevil7th/MoDiff.git MoDiff',
    'git clone --branch fix-ui-ux-issues https://github.com/sdevil7th/MoDiff-client.git MoDiff-client',
    'cd MoDiff',
    'uv sync --extra cpu',
    'uv run --extra cpu python -m modiff.preflight --json --check-port 8088 --fail-on-error',
    'uv run --extra cpu python main.py',
    'cd MoDiff-client',
    'npm ci',
    'npm run dev',
  ]) {
    assert.ok(quick.split('\n').includes(command), `Quick start is missing command: ${command}`);
  }
  assert.match(quick, /docs\/developer-setup\.md/);
  assert.match(quick, /CPU profile is for API\/UI development/);
  assert.ok(developmentStart > installStart, 'Optional launchers must remain separate from the uv/npm quick start');
  assert.notEqual(developmentStart, -1);
  assert.ok(developmentEnd > developmentStart);
  const development = readme.slice(developmentStart, developmentEnd);

  assert.match(readme, /git clone --branch fix-ui-ux-issues https:\/\/github\.com\/sdevil7th\/MoDiff\.git MoDiff/);
  assert.match(
    readme,
    /git clone --branch fix-ui-ux-issues https:\/\/github\.com\/sdevil7th\/MoDiff-client\.git MoDiff-client/,
  );
  assert.match(readme, /https:\/\/github\.com\/sdevil7th\/MoDiff\/tree\/fix-ui-ux-issues#install-and-run/);
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

test('current setup guides select the published candidate and identify its reviewed application pair', () => {
  const clientRoot = new URL('..', import.meta.url);
  const guides = [
    new URL('README.md', clientRoot),
    new URL('CONTRIBUTING.md', clientRoot),
    new URL('docs/windows-support.md', clientRoot),
  ];
  for (const guide of guides) {
    const text = readFileSync(guide, 'utf8');
    assert.doesNotMatch(
      text,
      /codex\/windows-delivery-20261026/,
      `${guide.pathname} still advertises the superseded setup branch`,
    );
    assert.match(text, /fix-ui-ux-issues/, `${guide.pathname} must identify the current candidate`);
  }
  const readme = readFileSync(guides[0], 'utf8');
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', clientRoot), 'utf8');
  reviewedSetupSourceContract(readme, workflow);
  assert.match(readme, /interim Windows candidate/i);
  assert.match(readme, /not.*(?:release|released).*`main`/);
});

test('reviewed setup source contract keeps application revisions separate from the exact CI backend pin', () => {
  const root = new URL('..', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const first = reviewedSetupSourceContract(readme, workflow);
  const nextBackend = 'a'.repeat(40);
  const nextClient = 'b'.repeat(40);
  const changed = readme
    .replace(first.applicationSource.MoDiff, nextBackend)
    .replace(first.applicationSource['MoDiff-client'], nextClient);
  assert.deepEqual(reviewedSetupSourceContract(changed, workflow), {
    applicationSource: { MoDiff: nextBackend, 'MoDiff-client': nextClient },
    ciBackendCommit: first.ciBackendCommit,
  });
});

test('reviewed setup source contract rejects missing duplicate mutable and drifting source declarations', () => {
  const root = new URL('..', import.meta.url);
  const readme = readFileSync(new URL('README.md', root), 'utf8');
  const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');
  const contract = reviewedSetupSourceContract(readme, workflow);
  const backendRow = readme.split('\n').find((line) => /^\| MoDiff\s+\|/u.test(line));
  const clientRow = readme.split('\n').find((line) => /^\| MoDiff-client\s+\|/u.test(line));
  const ciLine = `CI backend contract: \`${contract.ciBackendCommit}\`.`;
  const mutations = {
    'missing backend row': [readme.replace(`${backendRow}\n`, ''), workflow],
    'missing client row': [readme.replace(`${clientRow}\n`, ''), workflow],
    'duplicate backend row': [readme.replace(clientRow, backendRow), workflow],
    'duplicate client row': [readme.replace(backendRow, clientRow), workflow],
    'unknown application repository': [readme.replace(backendRow, backendRow.replace('MoDiff', 'Other')), workflow],
    'mutable backend source': [readme.replace(contract.applicationSource.MoDiff, 'fix-ui-ux-issues'), workflow],
    'short client source': [readme.replace(contract.applicationSource['MoDiff-client'], '1234567'), workflow],
    'hash prefix with suffix': [
      readme.replace(contract.applicationSource.MoDiff, `${contract.applicationSource.MoDiff}0`),
      workflow,
    ],
    'missing CI declaration': [readme.replace(ciLine, ''), workflow],
    'duplicate CI declaration': [readme.replace(ciLine, `${ciLine}\n${ciLine}`), workflow],
    'mutable CI declaration': [readme.replace(ciLine, 'CI backend contract: `fix-ui-ux-issues`.'), workflow],
    'one drifting CI job': [readme, workflow.replace(`ref: ${contract.ciBackendCommit}`, `ref: ${'c'.repeat(40)}`)],
    'both drifting CI jobs': [
      readme,
      workflow.replaceAll(`ref: ${contract.ciBackendCommit}`, `ref: ${'c'.repeat(40)}`),
    ],
    'mutable CI job': [readme, workflow.replace(`ref: ${contract.ciBackendCommit}`, 'ref: fix-ui-ux-issues')],
    'missing CI ref': [readme, workflow.replace(`ref: ${contract.ciBackendCommit}`, '# removed backend ref')],
    'duplicate CI ref': [
      readme,
      workflow.replace(
        `ref: ${contract.ciBackendCommit}`,
        `ref: ${contract.ciBackendCommit}\n          ref: ${contract.ciBackendCommit}`,
      ),
    ],
    'missing backend checkout': [readme, workflow.replace('repository: sdevil7th/MoDiff', 'repository: other/MoDiff')],
  };
  for (const [label, [changedReadme, changedWorkflow]] of Object.entries(mutations))
    assert.throws(() => reviewedSetupSourceContract(changedReadme, changedWorkflow), undefined, label);
});
