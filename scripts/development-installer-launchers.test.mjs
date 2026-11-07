import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = resolve(clientRoot, '../MoDiff');
const windows = process.platform === 'win32';
const backendPython =
  process.env.MODIFF_BACKEND_PYTHON || join(backendRoot, windows ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const powershell = join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 30_000, ...options });
  assert.ifError(result.error);
  return result;
}

function successful(executable, args, options) {
  const result = command(executable, args, options);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function executable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function fixture(shell, scenario) {
  const root = mkdtempSync(join(tmpdir(), 'modiff dev launcher '));
  const client = join(root, 'client checkout with spaces');
  const backend = join(root, 'backend checkout with spaces');
  const tools = join(root, 'operator tools with spaces');
  const calls = join(root, 'calls.txt');
  for (const path of [client, backend, tools, join(backend, 'modiff'), join(backend, 'requirements')])
    mkdirSync(path, { recursive: true });
  copyFileSync(join(clientRoot, `install-dev.${shell}`), join(client, `install-dev.${shell}`));
  copyFileSync(join(backendRoot, 'modiff/tool_locks.py'), join(backend, 'modiff/tool_locks.py'));
  writeFileSync(join(backend, 'modiff/__init__.py'), '');
  writeFileSync(join(backend, 'requirements/test.txt'), '');
  writeFileSync(
    join(backend, 'modiff/preflight.py'),
    'import os\nfrom pathlib import Path\nwith Path(os.environ["MODIFF_DEV_CALLS"]).open("a") as stream: stream.write("preflight\\n")\nprint("{\\"ready\\": true}")\n',
  );
  successful(backendPython, ['-m', 'venv', '--without-pip', join(backend, '.venv')]);
  const python = join(backend, windows ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const sitePackages = successful(python, ['-c', 'import site; print(site.getsitepackages()[0])']);
  writeFileSync(join(sitePackages, 'modiff-fixture.pth'), backend + '\n');
  const env = {
    ...process.env,
    PATH: tools,
    MODIFF_DEV_CALLS: calls,
    MODIFF_BACKEND_DIR: relative(root, backend),
    UV_FIXTURE_EXIT: scenario === 'pip-error' ? '7' : '0',
    UV_FIXTURE_VERSION: scenario === 'broken' ? 'broken' : '0.12.23',
  };
  const installerExit = scenario === 'installer-error' ? 9 : 0;
  const fallback = join(backend, '.modiff/tools/uv', windows ? 'uv.exe' : 'uv');
  mkdirSync(dirname(fallback), { recursive: true });
  if (shell === 'ps1') {
    writeFileSync(
      join(backend, 'install.ps1'),
      `param([string]$Accelerator, [switch]$AllowExperimental, [switch]$Resume, [switch]$Repair, [switch]$BackendOnly)\nif (!$BackendOnly) { throw 'Expected backend-only installation.' }\nAdd-Content -LiteralPath $env:MODIFF_DEV_CALLS -Value installer\nSet-Location -LiteralPath $PSScriptRoot\nexit ${installerExit}\n`,
    );
    writeFileSync(join(tools, 'npm.cmd'), '@echo off\necho npm>>"%MODIFF_DEV_CALLS%"\nexit /b 0\n');
    const uvSource = join(root, 'uv-fixture.cs');
    writeFileSync(
      uvSource,
      `using System; using System.IO; using System.Reflection;\npublic class UvFixture { public static int Main(string[] args) {\nstring executable = Assembly.GetEntryAssembly().Location;\nstring log = Environment.GetEnvironmentVariable("MODIFF_DEV_CALLS");\nif(args.Length == 1 && args[0] == "--version") { File.AppendAllText(log, "probe:" + executable + "\\n"); Console.WriteLine("uv " + Environment.GetEnvironmentVariable("UV_FIXTURE_VERSION")); return 0; }\nFile.AppendAllText(log, "uv:" + executable + "\\n" + String.Join("\\n", args) + "\\n");\nConsole.Error.WriteLine("native uv fixture progress"); return Int32.Parse(Environment.GetEnvironmentVariable("UV_FIXTURE_EXIT")); } }\n`,
    );
    const compiled = join(root, 'uv.exe');
    const compileScript = join(root, 'compile-fixture.ps1');
    writeFileSync(
      compileScript,
      'param([string]$Source, [string]$Output)\n$ErrorActionPreference = "Stop"\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\n',
    );
    successful(powershell, ['-NoProfile', '-File', compileScript, '-Source', uvSource, '-Output', compiled]);
    if (scenario !== 'missing' && scenario !== 'fallback') copyFileSync(compiled, join(tools, 'uv.exe'));
    if (scenario === 'fallback' || scenario === 'broken') copyFileSync(compiled, fallback);
  } else {
    executable(
      join(backend, 'install.sh'),
      `#!/usr/bin/env bash\n[[ "$*" == *--backend-only* ]] || exit 4\nprintf 'installer\\n' >> "$MODIFF_DEV_CALLS"\nexit ${installerExit}\n`,
    );
    executable(join(tools, 'npm'), '#!/bin/sh\nprintf "npm\\n" >> "$MODIFF_DEV_CALLS"\n');
    const uv =
      '#!/bin/sh\nif [ "$1" = --version ]; then printf "probe:%s\\n" "$0" >> "$MODIFF_DEV_CALLS"; printf "uv %s\\n" "$UV_FIXTURE_VERSION"; exit 0; fi\nprintf "uv:%s\\n" "$0" >> "$MODIFF_DEV_CALLS"\nprintf "%s\\n" "$@" >> "$MODIFF_DEV_CALLS"\nprintf "native uv fixture progress\\n" >&2\nexit "$UV_FIXTURE_EXIT"\n';
    if (scenario !== 'missing' && scenario !== 'fallback') executable(join(tools, 'uv'), uv);
    if (scenario === 'fallback' || scenario === 'broken') executable(fallback, uv);
    // Keep PATH isolated from any real uv/npm, including in missing-tool cases.
    for (const tool of ['bash', 'dirname', 'mkdir']) {
      const source = ['/bin', '/usr/bin'].map((dir) => join(dir, tool)).find(existsSync);
      assert.ok(source, `Required shell tool is unavailable: ${tool}`);
      symlinkSync(source, join(tools, tool));
    }
  }
  return { root, client, backend, python, tools, calls, fallback, env };
}

for (const shell of ['ps1', 'sh']) {
  for (const scenario of ['path', 'fallback', 'missing', 'broken', 'pip-error', 'installer-error']) {
    test(
      `${shell} development installer: ${scenario} uv respects the backend resolver and failure boundary`,
      { skip: (shell === 'ps1') !== windows || !existsSync(backendPython) },
      () => {
        const f = fixture(shell, scenario);
        try {
          const result =
            shell === 'ps1'
              ? command(
                  powershell,
                  [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-File',
                    join(f.client, 'install-dev.ps1'),
                    '-BackendPath',
                    relative(f.root, f.backend),
                    '-Accelerator',
                    'cpu',
                  ],
                  { cwd: f.root, env: f.env },
                )
              : command('/bin/bash', [join(f.client, 'install-dev.sh'), '--accelerator', 'cpu'], {
                  cwd: f.root,
                  env: f.env,
                });
          const calls = readFileSync(f.calls, 'utf8');
          const output = result.stdout + result.stderr;
          if (scenario === 'missing' || scenario === 'broken') {
            assert.notEqual(result.status, 0, output);
            assert.match(output, scenario === 'missing' ? /Install uv.*add it to PATH/ : /did not report a uv version/);
            assert.doesNotMatch(calls, /uv:|npm|preflight/);
            if (scenario === 'broken') assert.doesNotMatch(calls, /probe:.*\.modiff/);
          } else if (scenario === 'installer-error') {
            assert.equal(result.status, 9, output);
            assert.doesNotMatch(calls, /probe:|uv:|npm|preflight/);
          } else {
            const expectedUv = scenario === 'fallback' ? f.fallback : join(f.tools, windows ? 'uv.exe' : 'uv');
            assert.ok(calls.includes(`uv:${expectedUv}\n`), calls);
            assert.ok(
              calls.includes(`pip\ninstall\n--python\n${f.python}\n-r\n${join(f.backend, 'requirements/test.txt')}\n`),
              calls,
            );
            assert.equal(result.status, scenario === 'pip-error' ? 7 : 0, output);
            if (scenario === 'pip-error') assert.doesNotMatch(calls, /npm|preflight/);
            else {
              assert.match(output, /Development environment is ready/);
              assert.match(calls, /npm[\s\S]*preflight/);
              assert.deepEqual(
                JSON.parse(
                  readFileSync(join(f.client, 'artifacts/dev-install-current/backend-preflight.json'), 'utf8').replace(
                    /^\uFEFF/,
                    '',
                  ),
                ),
                { ready: true },
              );
            }
          }
        } finally {
          assert.equal(dirname(f.root), resolve(tmpdir()), 'Cleanup must stay inside the test temporary directory');
          rmSync(f.root, { recursive: true, force: true });
        }
      },
    );
  }
}
