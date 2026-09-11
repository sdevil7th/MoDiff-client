import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { captureWorkflowOperationContext, workflowOperationContextIsCurrent } from '../stores/useStudioStore';
import fieldAction, { buildFieldActionProps } from '../utils/fieldAction';
import { attachHuggingFaceClusterExecutionSkeleton } from './huggingFaceClusterGraph';
import type { HuggingFaceClusterInstance } from './huggingFaceClusterInstance';
import {
  huggingFaceClusterStudioExecutionSpecRuntimeReceipt,
  reconcileHuggingFaceClusterExecutionSkeleton,
  resolveHuggingFaceClusterBindingValues,
  type HuggingFaceClusterExecutionSkeleton,
  type HuggingFaceClusterStudioExecutionSpecRuntimeReceipt,
} from './huggingFaceClusterMaterializer';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import type { StudioExecutionSpec, StudioGraphRole } from './types';

export type HuggingFaceClusterDynamicFieldAction = {
  role: StudioGraphRole;
  nodeId: string;
  field: string;
  event: 'onChange' | 'onSignal';
  valueSource: string;
  value: unknown;
};

export type HuggingFaceClusterDynamicFieldActionPlan = {
  schemaVersion: 1;
  definitionId: string;
  instanceId: string;
  admissionId: string;
  studioExecutionSpecId: string;
  claim: 'dynamic_field_action_plan';
  executable: false;
  actions: HuggingFaceClusterDynamicFieldAction[];
};

export type HuggingFaceClusterDynamicFieldActionPlanInput = {
  definition: HuggingFaceNodeLibraryDefinition;
  instance: HuggingFaceClusterInstance;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  executionSpec: StudioExecutionSpec;
  skeleton: HuggingFaceClusterExecutionSkeleton;
  nodes: readonly CustomNodeType[];
  bindingValues?: Readonly<Record<string, unknown>>;
};

export type HuggingFaceClusterDynamicFieldActionReceipt = {
  schemaVersion: 1;
  definitionId: string;
  instanceId: string;
  admissionId: string;
  studioExecutionSpecId: string;
  claim: 'dynamic_field_actions_applied';
  executable: false;
  applied: Array<Pick<HuggingFaceClusterDynamicFieldAction, 'role' | 'nodeId' | 'field' | 'event' | 'valueSource'>>;
};

export type ApplyHuggingFaceClusterDynamicFieldAction = (
  action: HuggingFaceClusterDynamicFieldAction,
  plan: HuggingFaceClusterDynamicFieldActionPlan,
  options?: { timeoutMs?: number },
) => Promise<void>;

export type HuggingFaceClusterFlowFinalizationProgress =
  | { stage: 'skeleton_attached' }
  | {
      stage: 'field_action_started' | 'field_action_completed';
      action: Pick<HuggingFaceClusterDynamicFieldAction, 'role' | 'field' | 'event' | 'valueSource'>;
    }
  | { stage: 'reconciling'; pendingFields: string[] }
  | { stage: 'completed'; bindingsComplete: boolean; pendingFields: string[] };

export type HuggingFaceClusterFlowFinalizationResult = {
  schemaVersion: 1;
  claim: 'dynamic_fields_reconciled';
  executable: false;
  fieldActions: HuggingFaceClusterDynamicFieldActionReceipt;
  skeleton: HuggingFaceClusterExecutionSkeleton;
  studioExecutionSpec: HuggingFaceClusterStudioExecutionSpecRuntimeReceipt | null;
};

function invalid(message: string): never {
  throw new Error(`Cannot plan Diffusers Cluster Node field finalization: ${message}`);
}

/**
 * Resolve the backend-declared dynamic schema actions for an attached skeleton.
 *
 * The plan is deliberately not an execution claim. Running these actions can
 * republish node definitions, after which bindings, handles, component/resource
 * receipts, and runtime proof still need to be reconciled and verified.
 */
export function planHuggingFaceClusterDynamicFieldActions({
  definition,
  instance,
  admission,
  executionSpec,
  skeleton,
  nodes,
  bindingValues = {},
}: HuggingFaceClusterDynamicFieldActionPlanInput): HuggingFaceClusterDynamicFieldActionPlan {
  if (
    skeleton.definitionId !== definition.id ||
    skeleton.instanceId !== instance.instanceId ||
    skeleton.admissionId !== admission.id ||
    skeleton.studioExecutionSpec.id !== executionSpec.id ||
    admission.studioExecutionSpec?.id !== executionSpec.id ||
    admission.studioExecutionSpec.contentHash !== executionSpec.contentHash ||
    admission.studioExecutionSpec.executionProfileId !== executionSpec.executionProfileId ||
    admission.executable !== false ||
    skeleton.executable !== false
  )
    invalid('the definition, instance, admission, specification, and skeleton receipts disagree.');

  const values = resolveHuggingFaceClusterBindingValues(definition, instance, admission, bindingValues);
  const specRoles = new Set(executionSpec.roles.map(([role]) => role));
  const referencedFields = new Set([
    ...executionSpec.bindings.map(([role, field]) => `${role}\0${field}`),
    ...executionSpec.edges.flatMap(([sourceRole, sourceField, targetRole, targetField]) => [
      `${sourceRole}\0${sourceField}`,
      `${targetRole}\0${targetField}`,
    ]),
  ]);
  const graphNodes = new Map(nodes.map((node) => [node.id, node]));
  const actions = admission.dynamicFieldActions.map((declared) => {
    const role = declared.role as StudioGraphRole;
    const nodeId = skeleton.nodeIdsByRole[role];
    const node = nodeId ? graphNodes.get(nodeId) : undefined;
    if (
      !specRoles.has(role) ||
      !referencedFields.has(`${role}\0${declared.field}`) ||
      !nodeId ||
      !node ||
      node.data.huggingFaceClusterRole !== 'execution' ||
      node.data.huggingFaceClusterInstanceId !== instance.instanceId ||
      node.data.huggingFaceClusterExecutionAdmissionId !== admission.id ||
      node.data.uiState?.disabled !== true
    )
      invalid(`dynamic action ${declared.role}.${declared.field} is outside the isolated admitted skeleton.`);
    const param = node.data.params[declared.field];
    if (!param || param[declared.event] === undefined)
      invalid(`dynamic action ${declared.role}.${declared.field} is absent from the live node definition.`);
    if (param.display === 'output' && declared.event === 'onChange')
      invalid(`dynamic action ${declared.role}.${declared.field} cannot change an output handle.`);
    const value = values[declared.valueSource];
    if (value === undefined) invalid(`binding source ${declared.valueSource} is unresolved.`);
    return {
      role,
      nodeId,
      field: declared.field,
      event: declared.event,
      valueSource: declared.valueSource,
      value,
    };
  });

  return {
    schemaVersion: 1,
    definitionId: definition.id,
    instanceId: instance.instanceId,
    admissionId: admission.id,
    studioExecutionSpecId: executionSpec.id,
    claim: 'dynamic_field_action_plan',
    executable: false,
    actions,
  };
}

export async function applyHuggingFaceClusterDynamicFieldActionToFlow(
  action: HuggingFaceClusterDynamicFieldAction,
  plan: HuggingFaceClusterDynamicFieldActionPlan,
  options: { timeoutMs?: number } = {},
) {
  const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === action.nodeId);
  if (
    !node ||
    node.data.huggingFaceClusterRole !== 'execution' ||
    node.data.huggingFaceClusterInstanceId !== plan.instanceId ||
    node.data.huggingFaceClusterExecutionAdmissionId !== plan.admissionId ||
    node.data.huggingFaceClusterExecutionSpecId !== plan.studioExecutionSpecId ||
    node.data.uiState?.disabled !== true
  )
    invalid(`dynamic action ${action.role}.${action.field} lost its isolated skeleton ownership.`);
  const props = buildFieldActionProps(action.nodeId, action.field);
  if (!props || props[action.event] === undefined)
    invalid(`dynamic action ${action.role}.${action.field} is absent from the current node definition.`);

  if (action.event === 'onChange') {
    useFlowStore.getState().setParam(action.nodeId, action.field, action.value);
    await fieldAction(props, action.value, 'onChange', {
      workflowScope: 'canvas',
      propagateErrors: true,
      timeoutMs: options.timeoutMs,
    });
    return;
  }
  if (props.display !== 'input' && props.display !== 'output')
    invalid(`dynamic signal action ${action.role}.${action.field} does not target a graph handle.`);
  useFlowStore
    .getState()
    .setParam(action.nodeId, action.field, { direction: props.display, value: action.value }, 'signal');
  await fieldAction(props, action.value, 'onSignal', {
    workflowScope: 'canvas',
    propagateErrors: true,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Apply the reviewed actions in backend-declared order. The receipt proves only
 * that the requests completed; it does not prove that their asynchronous node
 * definitions, edges, resources, or runtime have been reconciled.
 */
export async function applyHuggingFaceClusterDynamicFieldActionPlan(
  plan: HuggingFaceClusterDynamicFieldActionPlan,
  applyAction: ApplyHuggingFaceClusterDynamicFieldAction = applyHuggingFaceClusterDynamicFieldActionToFlow,
  options: { timeoutMs?: number } = {},
): Promise<HuggingFaceClusterDynamicFieldActionReceipt> {
  if (plan.claim !== 'dynamic_field_action_plan' || plan.executable !== false)
    invalid('the dynamic field-action plan is malformed.');
  const applied: HuggingFaceClusterDynamicFieldActionReceipt['applied'] = [];
  for (const action of plan.actions) {
    await applyAction(action, plan, options);
    applied.push({
      role: action.role,
      nodeId: action.nodeId,
      field: action.field,
      event: action.event,
      valueSource: action.valueSource,
    });
  }
  return {
    schemaVersion: 1,
    definitionId: plan.definitionId,
    instanceId: plan.instanceId,
    admissionId: plan.admissionId,
    studioExecutionSpecId: plan.studioExecutionSpecId,
    claim: 'dynamic_field_actions_applied',
    executable: false,
    applied,
  };
}

function delay(milliseconds: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

/**
 * Attach, finalize, and rebind the isolated skeleton in the visible flow graph.
 * This stops before resource/runtime admission and therefore keeps all child
 * nodes disabled even after every dynamic field and edge is present.
 */
export async function finalizeHuggingFaceClusterDynamicFieldsInFlow(
  input: Omit<HuggingFaceClusterDynamicFieldActionPlanInput, 'nodes'> & {
    timeoutMs?: number;
    onProgress?: (progress: HuggingFaceClusterFlowFinalizationProgress) => void;
  },
  applyAction: ApplyHuggingFaceClusterDynamicFieldAction = applyHuggingFaceClusterDynamicFieldActionToFlow,
): Promise<HuggingFaceClusterFlowFinalizationResult> {
  const context = captureWorkflowOperationContext();
  const attach = (skeleton: HuggingFaceClusterExecutionSkeleton) => {
    if (!workflowOperationContextIsCurrent(context, { includeForm: false }))
      invalid('the workflow changed while dynamic fields were finalizing.');
    const flow = useFlowStore.getState();
    const graph = attachHuggingFaceClusterExecutionSkeleton(
      { nodes: flow.nodes, edges: flow.edges },
      input.instance.instanceId,
      input.definition,
      skeleton,
    );
    useFlowStore.setState({ nodes: graph.nodes, edges: graph.edges });
  };

  attach(input.skeleton);
  input.onProgress?.({ stage: 'skeleton_attached' });
  const plan = planHuggingFaceClusterDynamicFieldActions({
    ...input,
    nodes: useFlowStore.getState().nodes,
  });
  // This action is part of an invisible compiler transaction, not an open-ended
  // interactive field edit. Keep it inside the same bounded compiler envelope
  // so insertion always either produces a root or a concrete error promptly.
  const actionTimeoutMs = Math.max(1, Math.min(input.timeoutMs ?? 20_000, 20_000));
  const fieldActions = await applyHuggingFaceClusterDynamicFieldActionPlan(
    plan,
    async (action, currentPlan, options) => {
      if (!workflowOperationContextIsCurrent(context, { includeForm: false }))
        invalid('the workflow changed while dynamic fields were finalizing.');
      const progressAction = {
        role: action.role,
        field: action.field,
        event: action.event,
        valueSource: action.valueSource,
      };
      input.onProgress?.({ stage: 'field_action_started', action: progressAction });
      await applyAction(action, currentPlan, options);
      input.onProgress?.({ stage: 'field_action_completed', action: progressAction });
    },
    { timeoutMs: actionTimeoutMs },
  );

  const timeoutMs = Math.max(0, Math.min(input.timeoutMs ?? 5_000, 20_000));
  const startedAt = Date.now();
  let skeleton = input.skeleton;
  do {
    if (!workflowOperationContextIsCurrent(context, { includeForm: false }))
      invalid('the workflow changed while dynamic fields were finalizing.');
    skeleton = reconcileHuggingFaceClusterExecutionSkeleton({
      ...input,
      skeleton: input.skeleton,
      currentNodes: useFlowStore.getState().nodes,
      expanded: input.instance.presentation.expanded,
    });
    input.onProgress?.({
      stage: 'reconciling',
      pendingFields: [
        ...skeleton.missingBindingSources,
        ...skeleton.pendingFields.map(({ role, field }) => `${role}.${field}`),
      ],
    });
    if (skeleton.bindingsComplete || skeleton.missingBindingSources.length) break;
    await delay(50);
  } while (Date.now() - startedAt < timeoutMs);
  attach(skeleton);
  useFlowStore.getState().updateHandleConnectionStatus();
  useFlowStore.getState().updateSignalValues(skeleton.edges);
  input.onProgress?.({
    stage: 'completed',
    bindingsComplete: skeleton.bindingsComplete,
    pendingFields: [
      ...skeleton.missingBindingSources,
      ...skeleton.pendingFields.map(({ role, field }) => `${role}.${field}`),
    ],
  });
  return {
    schemaVersion: 1,
    claim: 'dynamic_fields_reconciled',
    executable: false,
    fieldActions,
    skeleton,
    studioExecutionSpec: skeleton.bindingsComplete
      ? huggingFaceClusterStudioExecutionSpecRuntimeReceipt(skeleton)
      : null,
  };
}
