import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function balancedBody(source, openIndex, open, close) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (comment) {
      if (character === '\n') comment = false;
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new Error(`Unbalanced ${open}${close} expression in backend registry source.`);
}

function moduleParseStems(source, path) {
  const declaration = /\bMODULE_PARSE\s*=\s*\[/.exec(source);
  if (!declaration) return ['main'];
  const openIndex = source.indexOf('[', declaration.index);
  const body = balancedBody(source, openIndex, '[', ']');
  const stems = [...body.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']/g)].map((match) => match[1]);
  if (stems.length === 0) throw new Error(`MODULE_PARSE declares no Python sources: ${path}`);
  return stems;
}

function directNodeBaseClasses(source) {
  return [...source.matchAll(/^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/gm)]
    .filter((match) =>
      match[2]
        .split(',')
        .map((base) => base.trim())
        .some((base) => base === 'NodeBase' || base.endsWith('.NodeBase')),
    )
    .map((match) => match[1]);
}

function literalModuleMapKeys(source) {
  const declaration = /\bMODULE_MAP\s*=\s*\{/.exec(source);
  if (!declaration) return [];
  const openIndex = source.indexOf('{', declaration.index);
  const body = balancedBody(source, openIndex, '{', '}');
  const keys = [];
  let depth = 0;
  let comment = false;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (comment) {
      if (character === '\n') comment = false;
      continue;
    }
    if (character === '#') {
      comment = true;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') {
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']' || character === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || (character !== '"' && character !== "'")) continue;
    const quote = character;
    let value = '';
    let escaped = false;
    let cursor = index + 1;
    for (; cursor < body.length; cursor += 1) {
      const candidate = body[cursor];
      if (escaped) {
        value += candidate;
        escaped = false;
      } else if (candidate === '\\') {
        escaped = true;
      } else if (candidate === quote) {
        break;
      } else {
        value += candidate;
      }
    }
    let after = cursor + 1;
    while (/\s/.test(body[after] ?? '')) after += 1;
    if (body[after] === ':') keys.push(value);
    index = cursor;
  }
  return keys;
}

function comprehensionModuleMapKeys(source) {
  const keys = [];
  const pattern = /for\s+node_class\s+in\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const openIndex = source.indexOf('(', match.index);
    const body = balancedBody(source, openIndex, '(', ')').replace(/#.*$/gm, '');
    for (const item of body.split(',')) {
      const name = item.trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) keys.push(name);
    }
  }
  return keys;
}

function assignedModuleMapKeys(source) {
  return [...source.matchAll(/\bMODULE_MAP\s*\[\s*["']([^"']+)["']\s*\]\s*=/g)].map((match) => match[1]);
}

function precomputedModuleMapKeys(source, path) {
  if (!/\bMODULE_MAP\s*=/.test(source)) return [];
  const keys = [
    ...literalModuleMapKeys(source),
    ...comprehensionModuleMapKeys(source),
    ...assignedModuleMapKeys(source),
  ];
  if (keys.length === 0) {
    throw new Error(`Could not statically resolve the bundled MODULE_MAP contract: ${path}`);
  }
  return keys;
}

export function readBundledBackendNodeRegistry(backendRoot) {
  const modulesRoot = join(backendRoot, 'modules');
  if (!existsSync(modulesRoot)) throw new Error(`Bundled backend modules are missing: ${modulesRoot}`);
  const registry = new Set();
  const modules = readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__'))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const moduleEntry of modules) {
    const moduleRoot = join(modulesRoot, moduleEntry.name);
    const initPath = join(moduleRoot, '__init__.py');
    if (!existsSync(initPath)) throw new Error(`Bundled backend module has no __init__.py: ${moduleRoot}`);
    const initSource = readFileSync(initPath, 'utf8');
    const actions = new Set(precomputedModuleMapKeys(initSource, initPath));
    for (const stem of moduleParseStems(initSource, initPath)) {
      const sourcePath = join(moduleRoot, `${stem}.py`);
      if (!existsSync(sourcePath)) throw new Error(`Bundled backend registry source is missing: ${sourcePath}`);
      for (const action of directNodeBaseClasses(readFileSync(sourcePath, 'utf8'))) actions.add(action);
    }
    for (const action of actions) registry.add(`modules.${moduleEntry.name}.${action}`);
  }
  if (registry.size === 0) throw new Error(`Bundled backend node registry is empty: ${modulesRoot}`);
  return registry;
}

export function missingBackendNodeKeys(nodeKeys, registry) {
  return [...new Set(nodeKeys)].filter((nodeKey) => !registry.has(nodeKey)).sort();
}

export function assertBackendNodeKeys(nodeKeys, registry, label) {
  const missing = missingBackendNodeKeys(nodeKeys, registry);
  if (missing.length > 0) {
    throw new Error(`${label} references backend nodes that are not bundled: ${missing.join(', ')}`);
  }
}
