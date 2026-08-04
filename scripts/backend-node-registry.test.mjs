import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  assertBackendNodeKeys,
  missingBackendNodeKeys,
  readBundledBackendNodeRegistry,
} from './backend-node-registry.mjs';

function moduleFixture(root, name, init, files) {
  const moduleRoot = join(root, 'modules', name);
  mkdirSync(moduleRoot, { recursive: true });
  writeFileSync(join(moduleRoot, '__init__.py'), init);
  for (const [filename, source] of Object.entries(files)) writeFileSync(join(moduleRoot, filename), source);
}

test('clean-checkout backend registry follows AST sources and precomputed inherited-node declarations', () => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-backend-registry-'));
  try {
    moduleFixture(root, 'Direct', 'from .main import *\n', {
      'main.py': 'class Load(NodeBase):\n    pass\n\nclass Helper(object):\n    pass\n',
    });
    moduleFixture(
      root,
      'Inherited',
      [
        'from .main import *',
        'MODULE_MAP = {',
        '    node_class.__name__: {}',
        '    for node_class in (Edit, Inpaint)',
        '}',
        'MODULE_MAP["HiddenLegacy"] = {}',
        '',
      ].join('\n'),
      {
        'main.py': 'class Base(NodeBase):\n    pass\n\nclass Edit(Base):\n    pass\n\nclass Inpaint(Edit):\n    pass\n',
      },
    );
    moduleFixture(root, 'Selected', 'MODULE_PARSE = ["nodes"]\n', {
      'main.py': 'class MustNotRegister(NodeBase):\n    pass\n',
      'nodes.py': 'class Generate(NodeBase):\n    pass\n',
    });
    const registry = readBundledBackendNodeRegistry(root);
    assert.deepEqual([...registry].sort(), [
      'modules.Direct.Load',
      'modules.Inherited.Base',
      'modules.Inherited.Edit',
      'modules.Inherited.HiddenLegacy',
      'modules.Inherited.Inpaint',
      'modules.Selected.Generate',
    ]);
    assert.deepEqual(missingBackendNodeKeys(['modules.Direct.Load', 'modules.Removed.Generate'], registry), [
      'modules.Removed.Generate',
    ]);
    assert.throws(
      () => assertBackendNodeKeys(['modules.Removed.Generate'], registry, 'fixture workflow'),
      /not bundled: modules\.Removed\.Generate/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unresolvable precomputed backend registries fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'modiff-backend-registry-'));
  try {
    moduleFixture(root, 'Dynamic', 'MODULE_MAP = build_registry()\n', { 'main.py': '' });
    assert.throws(() => readBundledBackendNodeRegistry(root), /Could not statically resolve/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
