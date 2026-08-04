import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';

export type ModelFamilyHint = 'ace' | 'flux' | 'ltx' | 'qwen' | 'sdxl' | 'stable-audio' | 'wan' | 'z-image';

export type IndexedHubModel = {
  id?: unknown;
  class_names?: unknown;
  installed?: unknown;
  complete?: unknown;
};

export function indexedHubModelIsInstalled(item: IndexedHubModel) {
  if (typeof item.installed === 'boolean') return item.installed;
  if (typeof item.complete === 'boolean') return item.complete;
  // Older backends returned only cache entries. Preserve compatibility with
  // those responses while current backends explicitly describe completeness.
  return true;
}

function recordValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const nested = (value as { value?: unknown }).value;
    return typeof nested === 'string' ? nested : '';
  }
  return '';
}

function emptyModelFieldValue(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, value: '' };
  }
  return '';
}

/**
 * A generic component loader cannot choose a repository until its connected
 * pipeline family is known. Older backend definitions assigned example SDXL
 * or FLUX repositories as defaults; those defaults subsequently leaked into
 * saved workflows and returned whenever a field definition was refreshed.
 *
 * Keep an explicit value when it differs from the old default, but remove every
 * non-empty implicit default from AutoModelLoader.
 */
export function normalizeGenericModelLoaderParams(module: string, action: string, params: Record<string, NodeParams>) {
  if (module !== 'modules.ModularDiffusers' || action !== 'AutoModelLoader') return params;
  const modelId = params.model_id;
  if (!modelId) return params;
  const implicitId = recordValue(modelId.default).trim();
  if (!implicitId) return params;

  const hasExplicitValue = Object.prototype.hasOwnProperty.call(modelId, 'value');
  const selectedId = recordValue(modelId.value).trim();
  const nextModelId: NodeParams = {
    ...modelId,
    default: emptyModelFieldValue(modelId.default),
  };
  if (!hasExplicitValue || selectedId === implicitId) {
    nextModelId.value = emptyModelFieldValue(modelId.value ?? modelId.default);
  }
  return {
    ...params,
    model_id: nextModelId,
  };
}

function modelReferenceFromNode(node: CustomNodeType) {
  if (!/(?:load|pipeline|model)/i.test(`${node.data.module}.${node.data.action}`)) return '';
  for (const key of ['repo_id', 'model_id', 'repository_id']) {
    const param = node.data.params?.[key];
    const value = recordValue(param?.value ?? param?.default).trim();
    if (value) return value;
  }
  return '';
}

function textList(value: unknown) {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function modelFamilyHint(value: unknown, classNames: unknown = []): ModelFamilyHint | null {
  const text = `${typeof value === 'string' ? value : ''} ${textList(classNames).join(' ')}`.toLowerCase();
  if (!text.trim()) return null;
  if (/qwen/.test(text)) return 'qwen';
  if (/(?:^|[/_.-])flux(?:$|[/_.-])/.test(text)) return 'flux';
  if (/stable[-_. ]?diffusion[-_. ]?xl|sdxl|sd_xl/.test(text)) return 'sdxl';
  if (/(?:^|[/_.-])z[-_. ]?image(?:$|[/_.-])/.test(text)) return 'z-image';
  if (/(?:^|[/_.-])wan(?:2|$|[/_.-])/.test(text)) return 'wan';
  if (/(?:^|[/_.-])ltx(?:$|[/_.-])/.test(text)) return 'ltx';
  if (/ace[-_. ]?step|acestep/.test(text)) return 'ace';
  if (/stable[-_. ]?audio/.test(text)) return 'stable-audio';
  return null;
}

export function connectedModelFamilyHint(
  nodes: CustomNodeType[],
  edges: Edge[],
  nodeId: string,
): ModelFamilyHint | null {
  const neighbors = new Map<string, Set<string>>();
  edges.forEach((edge) => {
    if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set());
    if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set());
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pending = [...(neighbors.get(nodeId) ?? [])];
  const visited = new Set([nodeId]);
  const families = new Set<ModelFamilyHint>();

  while (pending.length > 0) {
    const currentId = pending.shift();
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    const current = nodeById.get(currentId);
    if (current) {
      const reference = modelReferenceFromNode(current);
      const family = modelFamilyHint(reference);
      if (family) families.add(family);
    }
    neighbors.get(currentId)?.forEach((neighborId) => {
      if (!visited.has(neighborId)) pending.push(neighborId);
    });
  }

  return families.size === 1 ? (Array.from(families)[0] ?? null) : null;
}

function matchesClassFilter(item: IndexedHubModel, filter: unknown) {
  const classNames = textList(item.class_names);
  if (typeof filter === 'string' && filter) {
    try {
      const expression = new RegExp(filter);
      return classNames.some((name) => expression.test(name));
    } catch {
      return false;
    }
  }
  if (Array.isArray(filter) && filter.length > 0) {
    const accepted = new Set(filter.filter((value): value is string => typeof value === 'string' && Boolean(value)));
    return accepted.size === 0 || classNames.some((name) => accepted.has(name));
  }
  return true;
}

function matchesIdFilter(id: string, filter: unknown) {
  if (typeof filter !== 'string' || !filter) return true;
  try {
    return new RegExp(filter).test(id);
  } catch {
    return false;
  }
}

export function compatibleInstalledHubModels({
  classNameFilter,
  family,
  idFilter,
  items,
}: {
  classNameFilter?: unknown;
  family?: ModelFamilyHint | null;
  idFilter?: unknown;
  items: unknown[];
}) {
  return items
    .filter((item): item is IndexedHubModel => Boolean(item && typeof item === 'object'))
    .flatMap((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (
        !id ||
        !indexedHubModelIsInstalled(item) ||
        !matchesClassFilter(item, classNameFilter) ||
        !matchesIdFilter(id, idFilter)
      ) {
        return [];
      }
      if (family && modelFamilyHint(id, item.class_names) !== family) return [];
      return [id];
    })
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort((left, right) => left.localeCompare(right));
}

export function compatibleInstalledLocalModels({
  family,
  idFilter,
  items,
}: {
  family?: ModelFamilyHint | null;
  idFilter?: unknown;
  items: unknown[];
}) {
  return items
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .filter((id) => matchesIdFilter(id, idFilter))
    .filter((id) => !family || modelFamilyHint(id) === family)
    .filter((id, index, values) => values.indexOf(id) === index)
    .sort((left, right) => left.localeCompare(right));
}
