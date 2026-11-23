import type { NodeData } from '../stores/useNodeStore';
import type { OperationContract } from '../workflow/operationContracts';
import { nodeDisplayLabel, nodeSearchAliases } from '../workflow/nodePresentation';
import { isOptionDescriptor, optionDescriptorIsSelectable } from './runtimeOptions';
import { isRecord } from '../utils/isRecord';
import {
  visualOperationGroupMedia,
  visualOperationStageKind,
  visualStageHasNestedStructure,
  visualStagePresentation,
  type VisualOperationGroup,
} from '../workflow/visualOperationGroupProjection';

export type StageMode = {
  node: string;
  label: string;
  terms?: string[];
  settings?: Record<string, string>;
  guidance?: 'plain' | 'guided';
};
export type VisualStage = {
  id: string;
  label: string;
  tier: 'browse' | 'task' | 'advanced';
  summary: string;
  modes: StageMode[];
  members?: string[];
  modelBound?: boolean;
  memberTasks?: string[];
  memberDecomposition?: 'loader';
};
export type VisualCatalog = { version: 1; stages: VisualStage[] };
export type StageChoice = { mode: StageMode; definition: NodeData; operation?: OperationContract };
export type StageMatch = StageChoice & {
  stage: VisualStage;
  score: number;
  detail: string;
  choices: StageChoice[];
  requiresModel?: boolean;
};

const text = (value: unknown, limit: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= limit;
const builtinKey = (x: unknown): x is string => text(x, 250) && /^modules\.[\w]+\.[\w]+$/u.test(x);
function textList(x: unknown, limit: number, check: (item: unknown) => boolean) {
  return Array.isArray(x) && x.length <= limit && x.every(check);
}
function validMode(x: unknown) {
  return (
    isRecord(x) &&
    builtinKey(x.node) &&
    text(x.label, 180) &&
    (x.guidance === undefined || x.guidance === 'plain' || x.guidance === 'guided') &&
    (x.terms === undefined || textList(x.terms, 40, (word) => text(word, 180))) &&
    (x.settings === undefined ||
      (isRecord(x.settings) &&
        Object.keys(x.settings).length <= 8 &&
        Object.entries(x.settings).every(([k, v]) => /^[a-z][a-z0-9_]*$/u.test(k) && text(v, 128))))
  );
}
export function parseVisualCatalog(value: unknown): VisualCatalog | null {
  if (value === undefined) return null;
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.stages) ||
    !value.stages.length ||
    value.stages.length > 100
  )
    throw new Error('Invalid visual node catalog.');
  const ids = new Set<string>();
  for (const stage of value.stages) {
    if (
      !isRecord(stage) ||
      !text(stage.id, 80) ||
      !/^[a-z][a-z0-9-]*$/u.test(stage.id) ||
      ids.has(stage.id) ||
      !text(stage.label, 120) ||
      !text(stage.summary, 500) ||
      !['browse', 'task', 'advanced'].includes(String(stage.tier)) ||
      !Array.isArray(stage.modes) ||
      !stage.modes.length ||
      stage.modes.length > 256 ||
      !stage.modes.every(validMode) ||
      (stage.modelBound !== undefined && typeof stage.modelBound !== 'boolean') ||
      (stage.memberTasks !== undefined && !textList(stage.memberTasks, 80, (key) => text(key, 128))) ||
      (stage.memberDecomposition !== undefined && stage.memberDecomposition !== 'loader') ||
      (stage.members !== undefined && !textList(stage.members, 256, builtinKey))
    )
      throw new Error('Invalid visual node stage.');
    ids.add(stage.id);
  }
  return { version: 1, stages: value.stages as VisualStage[] };
}
function words(s: string) {
  return s
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/gu, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
export function stageDefinition(mode: StageMode, registry: Record<string, NodeData>) {
  const node = registry[mode.node];
  if (!node || mode.node !== `${node.module}.${node.action}`) return null;
  if (!mode.settings) return node;
  const params = { ...node.params };
  for (const [field, value] of Object.entries(mode.settings)) {
    const param = params[field];
    if (
      !param ||
      param.isConnected ||
      !Array.isArray(param.options) ||
      !param.options.some(
        (item) =>
          (typeof item === 'string'
            ? item
            : isOptionDescriptor(item)
              ? optionDescriptorIsSelectable(item)
                ? item.value
                : null
              : isRecord(item) && !item.disabled
                ? item.value
                : null) === value,
      )
    )
      return null;
    params[field] = { ...param, value };
  }
  return { ...node, params };
}

type Index = { names: string[]; terms: string[]; descriptive: string[] };
const indexes = new WeakMap<NodeData, WeakMap<StageMode, Index>>();
const compact = (s: string) => s.replace(/ /gu, '');
function indexMode(stage: VisualStage, mode: StageMode, node: NodeData): Index {
  let modes = indexes.get(node);
  if (!modes) {
    modes = new WeakMap();
    indexes.set(node, modes);
  }
  const cached = modes.get(mode);
  if (cached) return cached;
  const names = [mode.label, ...(mode.terms ?? []), nodeDisplayLabel(node), ...nodeSearchAliases(node)].map(words);
  const roles = Object.entries(node.params)
    .filter(([, p]) => p.display === 'input' || p.isInput || p.display === 'output')
    .flatMap(([key, p]) => [key, p.label ?? '']);
  const terms = words([stage.label, mode.node, ...names].join(' ')).split(' ');
  const descriptive = [...terms, ...words([stage.summary, node.description ?? '', ...roles].join(' ')).split(' ')];
  const result = { names, terms, descriptive };
  modes.set(mode, result);
  return result;
}
function relevance(query: string, stage: VisualStage, mode: StageMode, node: NodeData) {
  if (!query) return 1;
  const equal = (s: string) => s === query || compact(s) === compact(query);
  if (equal(words(stage.label))) return 100;
  if (equal(words(mode.node)) || equal(words(mode.label))) return 95;
  const index = indexMode(stage, mode, node);
  if (index.names.some(equal)) return 90;
  const matches = (fields: string[]) =>
    query
      .split(' ')
      .every((token) => fields.some((word) => word === token || (token.length > 2 && word.startsWith(token))));
  return matches(index.terms) ? 65 : matches(index.descriptive) ? 30 : 0;
}

/** Restrict model execution to a published binding when browsing a specific pipeline.
 * Media and data utilities remain independently insertable. */
function operationMember(stage: VisualStage, op: OperationContract) {
  return Boolean(
    stage.modelBound &&
    stage.members?.includes(op.nodeKey) &&
    (!stage.memberTasks || stage.memberTasks.includes(op.task ?? '')) &&
    (!stage.memberDecomposition || op.decomposition === stage.memberDecomposition),
  );
}
export function visualStageMatches(
  catalog: VisualCatalog,
  registry: Record<string, NodeData>,
  search: string,
  options: {
    all?: boolean;
    targeted?: boolean;
    compatible?: (node: NodeData, operation?: OperationContract) => boolean;
    operations?: OperationContract[];
    showModelHints?: boolean;
  } = {},
): StageMatch[] {
  const query = words(search);
  if (search.trim() && !query) return [];
  const results: StageMatch[] = [];
  const operations = new Map<string, OperationContract[]>();
  for (const op of options.operations ?? []) operations.set(op.nodeKey, [...(operations.get(op.nodeKey) ?? []), op]);
  for (const stage of catalog.stages) {
    if (!query && !options.all && (stage.tier === 'advanced' || (stage.tier === 'task' && !options.targeted))) continue;
    if (
      options.operations &&
      stage.memberTasks &&
      !options.operations.some((op) => stage.memberTasks!.includes(op.task ?? ''))
    )
      continue;
    const choices: StageChoice[] = [];
    let best: StageMatch | undefined;
    const extra = (options.operations ?? []).filter(
      (op) => operationMember(stage, op) && !stage.modes.some((m) => m.node === op.nodeKey),
    );
    const modes: StageMode[] = [
      ...stage.modes,
      ...[...new Map(extra.map((op) => [op.nodeKey, op])).values()].map((op) => ({
        node: op.nodeKey,
        label: registry[op.nodeKey]?.label ?? op.nodeType,
        terms: [
          op.nodeType,
          ...(op.nodeType === 'denoise'
            ? ['KSampler', 'sample latents']
            : op.nodeType === 'decoder'
              ? ['VAE Decode']
              : []),
        ],
      })),
    ];
    for (const mode of modes) {
      const node = stageDefinition(mode, registry);
      if (!node) continue;
      const bound = operations.get(mode.node);
      if (options.operations && stage.modelBound && !bound) continue;
      for (const operation of bound ?? [undefined]) {
        if (options.compatible && !options.compatible(node, operation)) continue;
        const choice = { mode, definition: node, operation };
        choices.push(choice);
        const score =
          query && operation?.operationId && words(operation.operationId) === query
            ? 96
            : relevance(query, stage, mode, registry[mode.node]!);
        if (!score || (best && best.score >= score)) continue;
        const term = query && mode.terms?.find((term) => compact(words(term)) === compact(query));
        const detail = term && words(term) !== words(mode.label) ? mode.label + ' · ' + term : mode.label;
        best = { stage, ...choice, score, detail, choices };
      }
    }
    if (query && !options.operations && options.showModelHints && stage.modelBound) {
      // Historical implementation names can locate their owner before a model is selected.
      // A hint carries no executable binding and is never offered for a typed wire.
      const member = stage.members?.find((key) => {
        const node = registry[key];
        return (
          node &&
          [key, node.action].some((name) => compact(words(name)) === compact(query)) &&
          !catalog.stages.some((s) => s.modes.some((m) => m.node === key))
        );
      });
      if (member) {
        const definition = registry[member]!;
        best = {
          stage,
          definition,
          mode: { node: member, label: definition.label },
          score: 95,
          choices: [],
          detail: definition.label + ' · Select a compatible model and task to add this action.',
          requiresModel: true,
        };
      }
    }
    if (best) results.push(best);
  }
  return results.sort((a, b) => b.score - a.score);
}

export function representedStageOperations(matches: StageMatch[]) {
  return new Set(matches.flatMap((match) => match.choices.flatMap(({ operation }) => (operation ? [operation] : []))));
}

export function visualStageForNode(catalog: VisualCatalog | null, node: NodeData) {
  const key = `${node.module}.${node.action}`;
  const operation = node.operationAuthoring?.operation;
  if (operation?.nodeKey === key) {
    const owner = catalog?.stages.find((stage) => operationMember(stage, operation));
    if (owner)
      return {
        stage: owner,
        mode: owner.modes.find((m) => m.node === key) ?? { node: key, label: node.label || operation.nodeType },
      };
  }
  for (const stage of catalog?.stages ?? []) {
    const modes = stage.modes.filter((m) => m.node === key);
    const mode =
      modes.find(
        (m) =>
          m.settings &&
          Object.entries(m.settings).every(([k, v]) => (node.params[k]?.value ?? node.params[k]?.default) === v),
      ) ?? modes[0];
    if (mode) return { stage, mode };
  }
  return null;
}

const projectedStages: Partial<Record<VisualOperationGroup, string>> = {
  setup: 'model-setup',
  inputs: 'encode-inputs',
  imageInput: 'media-input',
  videoInput: 'media-input',
  output: 'export',
  composite: 'composite',
  references: 'references',
  mask: 'prepare-mask',
  assemble: 'assemble-clips',
};

export function visualNodeTitle(catalog: VisualCatalog | null, node: NodeData, registered?: NodeData) {
  const original = nodeDisplayLabel(node);
  const instance = node.blockInstanceV2;
  if (catalog && instance) {
    const kind = visualOperationStageKind(instance);
    if (!kind || visualStageHasNestedStructure(instance)) return original;
    const media = visualOperationGroupMedia({ data: node });
    if (original !== visualStagePresentation(kind, media).label) return original;
    if (kind === 'generate') {
      for (const member of instance.effectiveGraph.nodes) {
        const hint = member.data.operationAuthoring;
        const op = isRecord(hint) && hint.operation;
        if (!isRecord(op) || typeof op.task !== 'string') continue;
        const task = op.task;
        const owningStage = catalog.stages.find((stage) => stage.memberTasks?.includes(task));
        if (owningStage) return owningStage.label;
      }
      // A whole action can take media and produce text. Use its published
      // action before interpreting input or output media ports as a fallback.
      const [member] = instance.effectiveGraph.nodes;
      if (member && instance.effectiveGraph.nodes.length === 1) {
        const key = `${member.data.module}.${member.data.action}`;
        const owningStage = catalog.stages.find((stage) => stage.modes.some((mode) => mode.node === key));
        if (owningStage) return owningStage.label;
      }
      return catalog.stages.find((stage) => stage.id === 'generate-' + media)?.label ?? original;
    }
    return catalog.stages.find((stage) => stage.id === projectedStages[kind])?.label ?? original;
  }
  const match = visualStageForNode(catalog, node);
  if (!match || !registered || (original !== nodeDisplayLabel(registered) && original !== registered.label))
    return original;
  return match.stage.label;
}

export const STAGE_DRAG_PREFIX = 'modiff-stage:';
export function stageDragKey(stage: VisualStage, mode: StageMode) {
  return STAGE_DRAG_PREFIX + JSON.stringify([stage.id, mode.node, mode.label]);
}
export function stageFromDrag(token: string, catalog: VisualCatalog | null, registry: Record<string, NodeData>) {
  if (!catalog || !token.startsWith(STAGE_DRAG_PREFIX) || token.length > 650) return null;
  const payload = token.slice(STAGE_DRAG_PREFIX.length);
  try {
    const id: unknown = JSON.parse(payload);
    if (!Array.isArray(id) || id.length !== 3) return null;
    const mode = catalog.stages
      .find((stage) => stage.id === id[0])
      ?.modes.find((m) => m.node === id[1] && m.label === id[2]);
    return mode ? stageDefinition(mode, registry) : null;
  } catch {
    return null;
  }
}
