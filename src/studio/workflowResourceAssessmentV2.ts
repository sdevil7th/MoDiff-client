import type { Edge } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { executableFlowNodes } from '../stores/flowGraphExport';
import {
  canonicalizePersistedBlockGraphV2,
  expandBlockGraphV2ForExecution,
  blockProjectionNodeIdV2,
} from './blockRuntimeV2';
import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import { registeredBlockRunFormV2, userBlockRunFormV2 } from './blockRunFormV2';
import { inspectRegisteredBlockAutoEligibilityV2 } from './blockAutoEligibilityV2';
import { fetchAutoResourcePlans, type StudioAutoResourcePlan } from './autoResource';
import { fetchRuntimeResourceSnapshot, type RuntimeResourceSnapshot } from './runtimeResources';
import type { StudioFormState } from './types';

export type WorkflowResourceItemV2 = {
  id: string;
  label: string;
  form: StudioFormState | null;
  loaderIds: string[];
  consumers: number;
  details: string[];
  currentSettings: string[];
};
export type WorkflowResourceRequestV2 = {
  key: string;
  scopeLabel: string;
  items: WorkflowResourceItemV2[];
  issues: string[];
  autoReason: string;
  autoEligible: boolean;
  nodeCount: number;
  loaderCount: number;
  adapterCount: number;
};

const LOADER_ACTION = /(?:ModelsLoader|LoadPipeline|LoadModel|LoadTokenizer|LoadTextEncoder)$/u;
function value(node: CustomNodeType, field: string): unknown {
  const param = node.data.params[field];
  return param?.value === undefined ? param?.default : param.value;
}
function repository(node: CustomNodeType) {
  const raw = value(node, 'repo_id') ?? value(node, 'model_id');
  if (raw && typeof raw === 'object' && 'value' in raw) return typeof raw.value === 'string' ? raw.value : '';
  return typeof raw === 'string' ? raw : '';
}

function loaderSettings(node: CustomNodeType) {
  const offload =
    value(node, 'offload_mode') ?? (value(node, 'auto_offload') ? 'Auto Offload enabled' : 'Auto Offload disabled');
  return `${repository(node) || node.data.label || node.id} · ${value(node, 'dtype') ?? 'runtime dtype'} · ${value(node, 'device') ?? 'runtime device'} · ${offload}`;
}

/** Same Block expansion/scope as execution, without executing field actions or
 * randomizing seeds. Resource plans are advisory and never issue Auto receipts. */
export function buildWorkflowResourceRequestV2(
  nodes: CustomNodeType[],
  edges: Edge[],
  targetNodeId?: string,
): WorkflowResourceRequestV2 {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (targetNodeId && !target?.data.blockInstanceV2 && !target?.data.blockProjectionContainer)
    throw new Error('Select a Block to assess its contained graph.');
  const graph = expandBlockGraphV2ForExecution(nodes, edges, targetNodeId);
  const active = executableFlowNodes(graph.nodes) as CustomNodeType[];
  const activeIds = new Set(active.map((node) => node.id));
  const activeEdges = graph.edges.filter((edge) => activeIds.has(edge.source) && activeIds.has(edge.target));
  const canonical = canonicalizePersistedBlockGraphV2(nodes, edges);
  const owners = canonical.nodes.filter((node) => node.data.blockInstanceV2);
  const loaders = active.filter((node) => LOADER_ACTION.test(node.data.action ?? ''));
  const adapters = active.filter((node) => /lora|adapter/iu.test(`${node.data.action} ${node.data.module}`));
  const assigned = new Set<string>();
  const issues: string[] = [];
  const items: WorkflowResourceItemV2[] = [];
  const downstream = (ids: string[]) => {
    const reached = new Set(ids);
    for (let changed = true; changed;) {
      changed = false;
      for (const edge of activeEdges)
        if (reached.has(edge.source) && !reached.has(edge.target)) {
          reached.add(edge.target);
          changed = true;
        }
    }
    return reached.size - ids.length;
  };
  for (const root of owners) {
    const instance = root.data.blockInstanceV2!;
    const members = new Set(instance.effectiveGraph.nodes.map((node) => blockProjectionNodeIdV2(root.id, node.nodeId)));
    const owned = loaders.filter((node) => members.has(node.id));
    if (!owned.length) continue;
    owned.forEach((node) => assigned.add(node.id));
    const details: string[] = [];
    const projection = registeredBlockRunFormV2(instance, 'auto') ?? userBlockRunFormV2(instance);
    let form = projection ? { ...projection.form, resourceMode: 'auto' as const } : null;
    if (owned.length !== 1) {
      form = null;
      details.push('This Block has multiple model loaders. Its combined recipe needs a workflow resource contract.');
    }
    if (target?.data.blockProjectionContainer) {
      form = null;
      details.push('This nested scope differs from its full source recipe; the full Block estimate cannot be reused.');
    }
    const loader = owned[0]!;
    if (form) {
      const repo = repository(loader);
      const modelType = value(loader, 'model_type');
      if ((repo && repo !== form.modelRepo) || (modelType && modelType !== form.modelType)) {
        form = null;
        details.push(
          'The actual loader differs from the source recipe. Its resource plan must be reviewed separately.',
        );
      }
    }
    if (form) {
      const fields = {
        device: 'device',
        dtype: 'dtype',
        offload_mode: 'offloadMode',
        auto_offload: 'autoOffload',
        quantization_mode: 'quantizationMode',
      } as const;
      for (const [field, key] of Object.entries(fields)) {
        const actual = value(loader, field);
        if (actual !== undefined && typeof actual === typeof form[key as keyof StudioFormState])
          (form as unknown as Record<string, unknown>)[key] = actual;
      }
    }
    const incoming = activeEdges.filter((edge) => members.has(edge.target) && !members.has(edge.source));
    for (const edge of incoming) {
      const source = active.find((node) => node.id === edge.source);
      details.push(
        `Connected input: ${source?.data.label ?? edge.source} → ${edge.targetHandle ?? 'input'}. Its computed value is resolved when the graph runs.`,
      );
    }
    if (instance.customization.state === 'structure_changed')
      details.push('Internal graph edits are present. The source model estimate does not qualify the edited recipe.');
    if (!projection) details.push('No exact resource planning form is available for this saved or custom Block.');
    items.push({
      id: root.id,
      label: root.data.label ?? instance.definitionSnapshot.displayName,
      form,
      loaderIds: owned.map((node) => node.id),
      consumers: downstream(owned.map((node) => node.id)),
      details: [...new Set(details)],
      currentSettings: owned.map(loaderSettings),
    });
  }
  for (const loader of loaders.filter((node) => !assigned.has(node.id))) {
    items.push({
      id: loader.id,
      label: loader.data.label ?? loader.id,
      form: null,
      loaderIds: [loader.id],
      consumers: downstream([loader.id]),
      details: ['Use Check Auto execution plan for this standalone loader.'],
      currentSettings: [loaderSettings(loader)],
    });
  }
  if (loaders.length > 1 || adapters.length)
    issues.push('Check Auto execution plan for the combined model and adapter memory budget.');
  const eligibility = inspectRegisteredBlockAutoEligibilityV2(nodes, edges, targetNodeId);
  const key = canonicalBlockStringifyV2({
    target: targetNodeId ?? null,
    owners: owners.flatMap((root) => {
      const instance = root.data.blockInstanceV2!;
      const members = instance.effectiveGraph.nodes.filter((node) =>
        activeIds.has(blockProjectionNodeIdV2(root.id, node.nodeId)),
      );
      return members.length ? [{ id: root.id, definition: instance.definitionRef, members }] : [];
    }),
    nodes: active.map((node) => ({
      id: node.id,
      module: node.data.module,
      action: node.data.action,
      params: Object.fromEntries(
        Object.entries(node.data.params)
          .filter(([, param]) => param.display !== 'output')
          .map(([field, param]) => [
            field,
            { value: param.value === undefined ? (param.default ?? null) : param.value, type: param.type ?? null },
          ]),
      ),
    })),
    edges: activeEdges.map(({ source, target: to, sourceHandle, targetHandle }) => ({
      source,
      target: to,
      sourceHandle: sourceHandle ?? null,
      targetHandle: targetHandle ?? null,
    })),
  });
  return {
    key,
    scopeLabel: target?.data.label ?? 'Whole workflow',
    items,
    issues,
    autoReason: eligibility.reason,
    autoEligible: eligibility.eligible,
    nodeCount: active.length,
    loaderCount: loaders.length,
    adapterCount: adapters.length,
  };
}

export async function assessWorkflowResourcesV2(
  request: WorkflowResourceRequestV2,
  signal?: AbortSignal,
): Promise<{
  request: WorkflowResourceRequestV2;
  plans: Record<string, StudioAutoResourcePlan>;
  resources: RuntimeResourceSnapshot;
}> {
  const plannable = request.items.filter((item) => item.form);
  const [batch, resources] = await Promise.all([
    plannable.length
      ? fetchAutoResourcePlans(
          plannable.map((item) => item.form!),
          plannable.map((item) => item.id),
          signal,
        )
      : Promise.resolve([]),
    fetchRuntimeResourceSnapshot(signal),
  ]);
  const plans: Record<string, StudioAutoResourcePlan> = {};
  for (const plan of batch) {
    const item = plannable.find((candidate) => candidate.id === plan.planKey);
    if (!item || plans[item.id]) throw new Error('Resource assessment returned an unmatched or duplicate Block plan.');
    plans[item.id] = plan;
  }
  if (Object.keys(plans).length !== plannable.length)
    throw new Error('Resource assessment returned an incomplete set of Block plans.');
  return { request, plans, resources };
}
