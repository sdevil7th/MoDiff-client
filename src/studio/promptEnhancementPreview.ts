import { useFlowStore, expandFlowExecutionGraph, flowExecutionScopeSourceKey } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { isTerminalTaskStatus, useTaskStore } from '../stores/useTaskStore';
import {
  captureWorkflowOperationContext,
  assertWorkflowOperationContext,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import { operationGraphSignature, commitOperationGraph } from '../workflow/operationGraphTransaction';
import { requestOperationStarter } from '../workflow/operationStarterRequest';
import { prepareExecutionScope } from '../workflow/prepareExecutionScope';
import { invalidAncillary, type AncillaryOperation } from './ancillaryOperations';
import type { OperationAuthoringRecipe } from './operationAuthoringRecipe';
import {
  promptEnhancementParentFromHint,
  planEnablePromptEnhancement,
  planDisablePromptEnhancement,
  planDetachUnavailablePromptEnhancement,
  planRefreshPromptEnhancementRequest,
  planSelectPromptEnhancementParent,
} from './promptEnhancementAuthoring';
import { coordinateGraphRun, type CoordinatedGraphRunResult } from './runCoordinator';
import { validateCurrentRun } from './runReadiness';
import { recomputeNodeOutputs } from '../utils/serverActions';
import { RequestError, requestJson, requestWithResponse } from '../utils/requestJson';
import config from '../../app.config';
import {
  MAX_ENHANCEMENT_ENVELOPE_BYTES,
  parsePromptEnhancementEnvelopeJson,
  parsePromptEnhancementSummary,
  parsePromptEnhancementProducerObservation,
  verifyPromptEnhancementSummaryBindings,
  type PromptEnhancementSummary,
  type NativeEnhancementModelReceipt,
  type PromptEnhancementControls,
  type EnhancementReference,
  type PromptEnhancementMode,
} from './promptEnhancementSummary';
import { parseLayoutConditioning } from './layoutConditioning';
import { planApplyPromptEnhancement, promptEnhancementPairHash } from './promptEnhancementAuthoring';
import { AUTHORED_CONSTRAINT_OPERATION, AUTHORED_CONSTRAINT_POLICY } from './promptEnhancementConstraints';

function currentSourceKey() {
  const { nodes, edges } = useFlowStore.getState();
  return flowExecutionScopeSourceKey(nodes, edges);
}

export function promptEnhancementOwner(
  ownerId: string,
  flow: Pick<ReturnType<typeof useFlowStore.getState>, 'nodes' | 'edges'> = useFlowStore.getState(),
) {
  const native = expandFlowExecutionGraph(flow.nodes, flow.edges);
  const owner = native.nodes.find((node) => node.id === ownerId);
  const selection = promptEnhancementParentFromHint(owner?.data.operationAuthoring);
  if (!owner || !selection) invalidAncillary('the selected Prompt/Inputs stage is no longer current.');
  return { owner, selection, native };
}

/** A normal metadata request can refuse private/unavailable profiles. Nothing
 * mutates or prepares until both exact selected responses have validated. */
async function resolveSelection(
  ownerId: string,
  signal?: AbortSignal,
  chooseForAuthoredLayout = false,
  rawAuthoringRecipeId?: string,
  layoutAuthoringRecipeId?: string,
) {
  const context = { ...captureWorkflowOperationContext() };
  const sourceKey = currentSourceKey();
  let graph = useFlowStore.getState().toObject();
  const signature = operationGraphSignature(graph);
  let { selection, native } = promptEnhancementOwner(ownerId);
  const identity = selection.parent;
  const operations = useNodesStore.getState().operationContracts;
  const descriptors = () =>
    useNodesStore
      .getState()
      .workflowModelDescriptors.filter(
        (descriptor) =>
          descriptor.profileId === identity.executionProfileId && descriptor.pipeline === identity.pipelineClass,
      );
  const descriptorsKey = canonicalBlockStringifyV2(descriptors());
  const operationsKey = canonicalBlockStringifyV2(
    operations.filter(
      (operation) => operation.pipelineClass === identity.pipelineClass && operation.task === identity.task,
    ),
  );
  const check = () => {
    signal?.throwIfAborted();
    assertWorkflowOperationContext(context);
    if (
      currentSourceKey() !== sourceKey ||
      canonicalBlockStringifyV2(descriptors()) !== descriptorsKey ||
      operationsKey !==
        canonicalBlockStringifyV2(
          useNodesStore
            .getState()
            .operationContracts.filter(
              (operation) => operation.pipelineClass === identity.pipelineClass && operation.task === identity.task,
            ),
        )
    )
      invalidAncillary('the workflow or selected metadata changed; request a fresh enhancement.');
  };
  const first = await requestOperationStarter(
    identity.pipelineClass,
    identity.task,
    operations,
    signal,
    identity.executionProfileId,
    identity.authoringRecipeId,
  );
  check();
  let recipe = first.authoring;
  if (
    !recipe ||
    recipe.contentHash !== identity.authoringContentHash ||
    recipe.baseSpecId !== identity.baseSpecId ||
    recipe.baseSpecContentHash !== identity.baseSpecContentHash ||
    recipe.roles.length !== Object.keys(selection.parentRoleNodes).length
  )
    invalidAncillary('the saved enhancement selection is stale; refresh the declared workflow.');
  for (const [role, key] of recipe.roles) {
    const node = native.nodes.find((node) => node.id === selection.parentRoleNodes[role]);
    if (!node || `${node.data.module}.${node.data.action}` !== key)
      invalidAncillary('the current parent roles differ from the selected declaration.');
  }
  const literal = (role: string, field: string) => {
    const id = selection.parentRoleNodes[role];
    const node = native.nodes.find((node) => node.id === id);
    const parameter = node?.data.params[field];
    if (!parameter || native.edges.some((edge) => edge.target === id && edge.targetHandle === field))
      invalidAncillary('selected model identity must remain an authored literal.');
    return parameter.value ?? parameter.default;
  };
  const repositories = recipe.bindings.filter(([, , source]) => source === 'artifact');
  if (repositories.length !== 1) invalidAncillary('the parent has no unique selected model artifact.');
  const [role, field] = repositories[0]!;
  const artifact = literal(role, field);
  if (
    !artifact ||
    typeof artifact !== 'object' ||
    Array.isArray(artifact) ||
    !('source' in artifact) ||
    artifact.source !== 'hub' ||
    !('value' in artifact) ||
    typeof artifact.value !== 'string'
  )
    invalidAncillary('the selected parent requires its immutable Hub artifact.');
  let selected = await requestOperationStarter(
    identity.pipelineClass,
    identity.task,
    operations,
    signal,
    identity.executionProfileId,
    identity.authoringRecipeId,
    artifact.value,
  );
  check();
  if (!selected.authoring || canonicalBlockStringifyV2(selected.authoring) !== canonicalBlockStringifyV2(recipe))
    invalidAncillary('the selected repository resolved a different enhancement declaration.');
  if (chooseForAuthoredLayout) {
    const choices = descriptors();
    const normalId = choices.length === 1 ? choices[0]!.authoringRecipes?.[identity.task] : undefined;
    const rawId = choices.length === 1 ? choices[0]!.rawPromptAuthoringRecipes?.[identity.task] : undefined;
    const declared = choices.length === 1 ? (choices[0]!.rawPromptAuthoringChoices?.[identity.task] ?? []) : [];
    const layoutDeclared =
      choices.length === 1 ? (choices[0]!.layoutPromptAuthoringChoices?.[identity.task] ?? []) : [];
    const rawIds = new Set([...(rawId ? [rawId] : []), ...declared.map((choice) => choice.authoringRecipeId)]);
    const layoutIds = new Set([
      ...(normalId ? [normalId] : []),
      ...layoutDeclared.map((choice) => choice.authoringRecipeId),
    ]);
    if (rawAuthoringRecipeId !== undefined && (!normalId || !rawId || !rawIds.has(rawAuthoringRecipeId)))
      invalidAncillary('the selected raw enhancement recipe is no longer declared. Refresh the current choices.');
    if (layoutAuthoringRecipeId !== undefined && (!normalId || !layoutIds.has(layoutAuthoringRecipeId)))
      invalidAncillary('the selected layout enhancement recipe is no longer declared. Refresh the current choices.');
    // Only exact backend-declared alternatives opt into selection. Unrelated
    // saved recipes retain their identity; an explicit layout choice is never
    // inferred from a model name or substituted for the normal append default.
    if (normalId && (rawId || layoutDeclared.length) && (layoutIds.has(recipe.id) || rawIds.has(recipe.id))) {
      const owner = native.nodes.find((node) => node.id === ownerId);
      const child = recipe.ancillaryOperations?.length === 1 ? recipe.ancillaryOperations[0] : undefined;
      if (!owner || !child || owner.data.operationAuthoring?.ancillaryBindings?.length)
        invalidAncillary('disable the current enhancement before selecting another one.');
      const field = child.bindings.owner.layoutField;
      if (native.edges.some((edge) => edge.target === ownerId && edge.targetHandle === field))
        invalidAncillary('enhancement needs authored inline prompt and layout controls.');
      const parameter = owner.data.params[field];
      if (!parameter) invalidAncillary('the authored layout control is unavailable.');
      const layout = parseLayoutConditioning(parameter.value ?? parameter.default ?? null);
      if (layout && !layout.regions.length)
        invalidAncillary('add authored regions or select Raw layout before enabling enhancement.');
      if (rawAuthoringRecipeId !== undefined && layout !== null)
        invalidAncillary(
          'the selected raw enhancement recipe requires Raw prompt mode. Your authored layout is unchanged.',
        );
      if (
        layout === null &&
        (layoutAuthoringRecipeId !== undefined ||
          (layoutIds.has(recipe.id) && recipe.id !== normalId && rawAuthoringRecipeId === undefined))
      )
        invalidAncillary('the selected layout enhancement requires authored regions. Your prompt is unchanged.');
      const desired =
        layout === null
          ? (rawAuthoringRecipeId ?? (rawIds.has(recipe.id) ? recipe.id : rawId) ?? normalId)
          : (layoutAuthoringRecipeId ?? (layoutIds.has(recipe.id) ? recipe.id : normalId));
      if (desired !== recipe.id) {
        const alternative = await requestOperationStarter(
          identity.pipelineClass,
          identity.task,
          operations,
          signal,
          identity.executionProfileId,
          desired,
          artifact.value,
        );
        check();
        if (!alternative.authoring) invalidAncillary('the declared alternative is unavailable.');
        graph = {
          ...graph,
          ...(await planSelectPromptEnhancementParent(graph, ownerId, recipe, alternative.authoring)),
        };
        ({ selection, native } = promptEnhancementOwner(ownerId, graph));
        recipe = alternative.authoring;
        selected = alternative;
      }
    } else if (rawAuthoringRecipeId !== undefined || layoutAuthoringRecipeId !== undefined)
      invalidAncillary('the current parent does not declare the selected enhancement alternative.');
  }
  for (const [role, field, source] of recipe.bindings) {
    if (source !== 'pipelineClass' && source !== 'defaultRevision' && source !== 'executionProfileId') continue;
    const expected =
      source === 'pipelineClass'
        ? identity.pipelineClass
        : source === 'executionProfileId'
          ? identity.executionProfileId
          : selected.nodes
              .filter(({ operation }) => operation.nodeKey === recipe.roles.find(([name]) => name === role)?.[1])
              .map(({ node }) => node.params[field]?.value ?? node.params[field]?.default);
    if (
      source === 'defaultRevision'
        ? !Array.isArray(expected) || expected.length !== 1 || literal(role, field) !== expected[0]
        : literal(role, field) !== expected
    )
      invalidAncillary('the selected parent model or immutable revision changed.');
  }
  const keys = new Set([
    ...recipe.roles.map(([, key]) => key),
    ...(recipe.ancillaryOperations ?? []).flatMap((child) => child.roles.map(([, key]) => key)),
  ]);
  const registry = Object.fromEntries(
    [...keys].map((key) => {
      const node = useNodesStore.getState().nodesRegistry[key];
      if (!node) invalidAncillary('refresh the current node registry before enabling enhancement.');
      return [key, structuredClone(node)];
    }),
  );
  const registryKey = canonicalBlockStringifyV2(registry);
  const assertCurrent = () => {
    check();
    if (
      registryKey !==
      canonicalBlockStringifyV2(
        Object.fromEntries([...keys].map((key) => [key, useNodesStore.getState().nodesRegistry[key] ?? null])),
      )
    )
      invalidAncillary('the current enhancement controls changed; refresh metadata.');
  };
  const { captureCurrentAncillaryParentDefinition } = await import('../workflow/ancillaryExecutionScope');
  assertCurrent();
  const definition = captureCurrentAncillaryParentDefinition(selected, selection, assertCurrent);
  return { graph, signature, context, ownerId, selection, recipe, registry, definition, assertCurrent };
}

function chooseChild(recipe: OperationAuthoringRecipe, childId?: string): AncillaryOperation {
  const children = recipe.ancillaryOperations ?? [];
  const child = childId
    ? children.find((child) => child.id === childId)
    : children.length === 1
      ? children[0]
      : undefined;
  if (!child) invalidAncillary('select one current backend-declared enhancement.');
  return child;
}

export async function enablePromptEnhancement(
  ownerId: string,
  childId?: string,
  signal?: AbortSignal,
  rawAuthoringRecipeId?: string,
  layoutAuthoringRecipeId?: string,
) {
  if (
    (childId !== undefined && (rawAuthoringRecipeId !== undefined || layoutAuthoringRecipeId !== undefined)) ||
    (rawAuthoringRecipeId !== undefined && layoutAuthoringRecipeId !== undefined)
  )
    invalidAncillary('choose one enhancement mode or a current child, not both.');
  const selected = await resolveSelection(
    ownerId,
    signal,
    childId === undefined,
    rawAuthoringRecipeId,
    layoutAuthoringRecipeId,
  );
  const child = chooseChild(selected.recipe, childId);
  const graph = await planEnablePromptEnhancement(
    selected.graph,
    ownerId,
    selected.recipe,
    child.id,
    selected.registry,
    selected.definition,
  );
  selected.assertCurrent();
  commitOperationGraph(graph, selected.context, selected.signature, 'Enable prompt enhancement', {
    preserveSelection: true,
  });
  return structuredClone(child);
}

/** Presentation metadata only; actions always resolve it again before use. */
export async function currentPromptEnhancementDeclaration(ownerId: string, childId: string, signal?: AbortSignal) {
  const selected = await resolveSelection(ownerId, signal);
  const child = chooseChild(selected.recipe, childId);
  selected.assertCurrent();
  return structuredClone(child);
}

export async function disablePromptEnhancement(ownerId: string, childId: string, signal?: AbortSignal) {
  const context = captureWorkflowOperationContext();
  const snapshot = useFlowStore.getState().toObject();
  const signature = operationGraphSignature(snapshot);
  const check = () => {
    signal?.throwIfAborted();
    assertWorkflowOperationContext(context);
    if (operationGraphSignature(useFlowStore.getState().toObject()) !== signature)
      invalidAncillary('the workflow changed before disabling enhancement.');
  };
  let selected: Awaited<ReturnType<typeof resolveSelection>>;
  try {
    selected = await resolveSelection(ownerId, signal);
  } catch {
    check();
    const graph = await planDetachUnavailablePromptEnhancement(snapshot, ownerId, childId);
    check();
    commitOperationGraph(graph, context, signature, 'Disable unavailable prompt enhancement', {
      preserveSelection: true,
    });
    return { preservedUnavailablePair: true };
  }
  const child = chooseChild(selected.recipe, childId);
  const graph = await planDisablePromptEnhancement(selected.graph, ownerId, selected.recipe, child.id);
  selected.assertCurrent();
  commitOperationGraph(graph, selected.context, selected.signature, 'Disable prompt enhancement', {
    preserveSelection: true,
  });
  return { preservedUnavailablePair: false };
}

/** Local task handle only; server dispatch/owner policy still decides admission. */
export type PromptEnhancementPreviewRun = {
  taskId: string;
  ownerId: string;
  childId: string;
  target: { nodeId: string; outputField: string };
};
type PreviewRunState = {
  context: WorkflowOperationContext;
  sourceKey: string;
  result: CoordinatedGraphRunResult;
  declaration: AncillaryOperation;
  runtime: { instance: string; source: string };
};
const previewRuns = new WeakMap<PromptEnhancementPreviewRun, PreviewRunState>();

export async function startPromptEnhancementPreview(ownerId: string, childId: string, regenerate = false) {
  const socket = useWebsocketStore.getState();
  if (!socket.isConnected || !socket.sid) invalidAncillary('connect to the local worker before Preview.');
  const assertIdleSession = () => {
    const current = useWebsocketStore.getState();
    if (!current.isConnected || current.sid !== socket.sid)
      invalidAncillary('the local worker connection changed; request a new Preview.');
    const task = useTaskStore.getState().currentTask;
    if (task && !isTerminalTaskStatus(task.status)) invalidAncillary('wait for the current run before Preview.');
  };
  assertIdleSession();
  const selected = await resolveSelection(ownerId);
  const child = chooseChild(selected.recipe, childId);
  const runtime = await currentRuntime();
  selected.assertCurrent();
  assertIdleSession();
  const graph = await planRefreshPromptEnhancementRequest(selected.graph, ownerId, selected.recipe, childId);
  selected.assertCurrent();
  assertIdleSession();
  if (operationGraphSignature(graph) !== selected.signature)
    commitOperationGraph(graph, selected.context, selected.signature, 'Prepare prompt enhancement request', {
      preserveSelection: true,
    });
  const { owner } = promptEnhancementOwner(ownerId);
  const bindings = owner.data.operationAuthoring?.ancillaryBindings;
  const binding = bindings?.length === 1 ? bindings[0] : undefined;
  if (!binding || binding.contractId !== child.id || binding.contentHash !== child.contentHash)
    invalidAncillary('enable the current enhancement before Preview.');
  const target = { nodeId: binding.roleNodes[child.bindings.output.role]!, outputField: child.bindings.output.field };
  const context = { ...captureWorkflowOperationContext() };
  const scope = await prepareExecutionScope({ previewTarget: target, workflowContext: context });
  if (!scope) invalidAncillary('Preview requires a current declared execution scope.');
  assertIdleSession();
  const validation = validateCurrentRun({
    sid: socket.sid,
    isConnected: true,
    includeStudio: false,
    executionScope: scope,
  });
  if (!validation.canRun)
    throw new Error(validation.blocking[0]?.message ?? 'This enhancement is not ready for Preview.');
  if (regenerate) {
    const source = currentSourceKey();
    await recomputeNodeOutputs([target.nodeId]);
    assertWorkflowOperationContext(context);
    if (source !== currentSourceKey()) invalidAncillary('the workflow changed while preparing Regenerate.');
    assertIdleSession();
  }
  const result = await coordinateGraphRun({
    sid: socket.sid,
    previewTarget: target,
    workflowContext: context,
    executionScope: scope,
  });
  if (typeof result.response.task_id !== 'string' || !result.response.task_id)
    invalidAncillary('Preview returned no owned task identity.');
  const run = Object.freeze({ taskId: result.response.task_id, ownerId, childId, target });
  previewRuns.set(run, {
    context: { ...captureWorkflowOperationContext() },
    sourceKey: currentSourceKey(),
    result,
    declaration: structuredClone(child),
    runtime,
  });
  return run;
}

function record(value: unknown, keys?: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAncillary('invalid Preview observation.');
  const item = value as Record<string, unknown>;
  if (
    keys &&
    (Object.keys(item).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(item, key)))
  )
    invalidAncillary('unknown or missing Preview observation fields.');
  return item;
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (canonicalBlockStringifyV2(actual) !== canonicalBlockStringifyV2(expected))
    invalidAncillary(`${label} changed; request a fresh Preview.`);
}

async function currentRuntime() {
  return requestJson(`${config.serverAddress}/runtime/status`, {
    cache: 'no-store',
    parse: (value) => {
      const item = record(value),
        source = record(item.backend_source);
      if (
        typeof item.instance !== 'string' ||
        !item.instance ||
        item.instance.length > 128 ||
        typeof source.fingerprint !== 'string' ||
        !/^sha256:backend-source-v1:[0-9a-f]{64}$/u.test(source.fingerprint)
      )
        invalidAncillary('current worker/source observations are unavailable.');
      return { instance: item.instance, source: source.fingerprint };
    },
  });
}

function assertRunCurrent(run: PromptEnhancementPreviewRun): PreviewRunState {
  const state = previewRuns.get(run);
  if (!state) invalidAncillary('request a new Preview in this document.');
  assertWorkflowOperationContext(state.context);
  if (state.sourceKey !== currentSourceKey()) invalidAncillary('the workflow changed after Preview.');
  return state;
}

async function terminalTask(taskId: string) {
  return requestJson(`${config.serverAddress}/runs/${encodeURIComponent(taskId)}`, {
    parse: (value) => {
      const item = record(value),
        task = record(item.task);
      if (
        task.task_id !== taskId ||
        task.status !== 'completed' ||
        !Number.isSafeInteger(task.attempt_index) ||
        (task.attempt_index as number) < 0 ||
        (task.attempt_index as number) > 1000
      )
        invalidAncillary('the exact Preview task has not completed successfully.');
      return task;
    },
  });
}

/** Bound bytes while reading, before .text()/JSON.parse could allocate an
 * arbitrarily large response. Aborting a read never stops a running model. */
async function readCacheEnvelope(target: PromptEnhancementPreviewRun['target'], signal?: AbortSignal) {
  const url = `${config.serverAddress}/cache/${encodeURIComponent(target.nodeId)}/${encodeURIComponent(target.outputField)}?with_metadata=1`;
  return requestWithResponse(url, { signal, timeoutMs: 120000, cache: 'no-store' }, async (response) => {
    const invalidBody = (message: string, cause?: unknown): never => {
      throw new RequestError(message, { kind: 'invalid_payload', status: response.status, url, cause });
    };
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new RequestError(
        `Could not read Preview metadata (${response.status}). Regenerate after updating the backend.`,
        { kind: 'http', status: response.status, url },
      );
    }
    const length = response.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_ENHANCEMENT_ENVELOPE_BYTES)) {
      await response.body?.cancel().catch(() => undefined);
      invalidBody('Preview metadata response exceeds its byte limit.');
    }
    const reader = response.body?.getReader();
    if (!reader) return invalidBody('Preview metadata response has no readable body.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > MAX_ENHANCEMENT_ENVELOPE_BYTES) invalidBody('Preview metadata response exceeds its byte limit.');
        chunks.push(next.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (error) {
      return invalidBody('Preview metadata response is not valid UTF-8.', error);
    }
  });
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export type VerifiedPromptEnhancementPreview = Readonly<{ readonly verifiedPreview: unique symbol }>;
type VerifiedState = { run: PromptEnhancementPreviewRun; summary: PromptEnhancementSummary; originalPairHash: string };
const verifiedPreviews = new WeakMap<VerifiedPromptEnhancementPreview, VerifiedState>();

function literal(state: PreviewRunState, role: string, field: string) {
  const purpose = state.result.submittedGraph.runtimeHints?.executionPurpose;
  const binding = purpose?.kind === 'explicit_preview' && purpose.bindings[0];
  const node = binding ? state.result.submittedGraph.nodes[binding.roleNodes[role]!] : undefined;
  const param = node?.params[field];
  if (!param || param.sourceId || param.sourceKey || !Object.prototype.hasOwnProperty.call(param, 'value'))
    invalidAncillary('Preview controls must be declared authored literals.');
  return param.value;
}

/** Read only an owned terminal task, independently minted cache observations,
 * current declaration and unchanged document. Parsing alone cannot mint this. */
export async function finishPromptEnhancementPreview(run: PromptEnhancementPreviewRun, signal?: AbortSignal) {
  const state = assertRunCurrent(run);
  const selected = await resolveSelection(run.ownerId, signal);
  const child = chooseChild(selected.recipe, run.childId);
  equal(child, state.declaration, 'selected enhancement declaration');
  const verification = child.verification;
  if (!verification) invalidAncillary('this declaration has no independently bound Preview verification metadata.');
  const task = await terminalTask(run.taskId);
  assertRunCurrent(run);
  const wire = await readCacheEnvelope(run.target, signal);
  const envelope = record(parsePromptEnhancementEnvelopeJson(wire), ['value', 'observation']);
  if (typeof envelope.value !== 'string') invalidAncillary('the proposal output is not a declared string.');
  const summary = parsePromptEnhancementSummary(envelope.value);
  if (!verification.supportedPromptModes.includes(summary.proposal.mode))
    invalidAncillary('this declaration does not support the returned prompt mode.');
  const observation = record(envelope.observation, [
    'schemaVersion',
    'summarySha256',
    'producer',
    'dispatch',
    'request',
    'consumedInput',
  ]);
  if (observation.schemaVersion !== 1 || new TextEncoder().encode(JSON.stringify(observation)).byteLength > 32768)
    invalidAncillary('the Preview observation is unsupported or exceeds its byte limit.');
  if (observation.summarySha256 !== (await sha256(envelope.value)))
    invalidAncillary('the cached proposal bytes changed.');
  const producer = parsePromptEnhancementProducerObservation(observation.producer);
  const dispatch = record(observation.dispatch, [
    'taskId',
    'attemptIndex',
    'node',
    'sid',
    'workerInstance',
    'backendSourceFingerprint',
    'graphHash',
    'uiContext',
    'status',
  ]);
  if (dispatch.status !== 'succeeded' && dispatch.status !== 'cached')
    invalidAncillary('the proposal node did not succeed.');
  const { status: dispatchStatus, ...dispatchValues } = dispatch;
  const dispatched = parsePromptEnhancementProducerObservation({ ...dispatchValues, recipe: null });
  const hints = state.result.submittedGraph.runtimeHints;
  equal(
    dispatched.node,
    { id: run.target.nodeId, module: 'modules.HuggingFaceTransformers', action: 'GenerateImageVideoText' },
    'proposal node',
  );
  equal(dispatched.taskId, run.taskId, 'Preview task');
  equal(dispatched.attemptIndex, task.attempt_index, 'Preview attempt');
  equal(dispatched.sid, state.result.submittedGraph.sid, 'Preview session');
  equal(
    dispatched.uiContext,
    {
      clientRunId: hints?.clientRunId ?? null,
      runInputHash: hints?.runInputHash ?? null,
      workflowTabId: hints?.workflowTabId ?? null,
      workflowCanvasEpoch: hints?.workflowCanvasEpoch ?? null,
      workflowFormEpoch: null,
    },
    'Preview document correlation',
  );
  const now = await currentRuntime();
  equal(now, state.runtime, 'worker or backend source');
  for (const actor of [producer, dispatched]) {
    equal(actor.workerInstance, now.instance, 'producer worker');
    equal(actor.backendSourceFingerprint, now.source, 'producer source');
    equal(actor.node, dispatched.node, 'cached native producer');
  }
  equal(producer.graphHash, dispatched.graphHash, 'cached graph semantics');
  if (dispatchStatus === 'succeeded' && producer.taskId !== run.taskId)
    invalidAncillary('a freshly computed proposal cannot claim a different producer task.');
  const originalTask = producer.taskId === run.taskId ? task : await terminalTask(producer.taskId);
  equal(producer.attemptIndex, originalTask.attempt_index, 'original producer attempt');
  equal(producer.sid, originalTask.sid ?? null, 'original producer session');
  equal(
    producer.uiContext,
    {
      clientRunId: originalTask.client_run_id ?? null,
      runInputHash: originalTask.run_input_hash ?? null,
      workflowTabId: originalTask.workflow_tab_id ?? null,
      workflowCanvasEpoch: originalTask.workflow_canvas_epoch ?? null,
      workflowFormEpoch: originalTask.workflow_form_epoch ?? null,
    },
    'original producer correlation',
  );
  equal(producer.uiContext.runInputHash, hints?.runInputHash ?? null, 'cached request semantics');
  equal(producer.uiContext.workflowTabId, hints?.workflowTabId ?? null, 'cached workflow');
  const { authoredPromptSha256, authoredLayoutKind, authoredLayoutSha256, controls } = summary.request;
  equal(
    record(observation.request, ['authoredPromptSha256', 'authoredLayoutKind', 'authoredLayoutSha256', 'controls']),
    { authoredPromptSha256, authoredLayoutKind, authoredLayoutSha256, controls },
    'observed authored request',
  );
  const consumed = record(observation.consumedInput, [
    'schemaVersion',
    'references',
    'processedImageGrid',
    'fingerprints',
  ]);
  equal(
    consumed,
    {
      schemaVersion: 1,
      references: summary.consumedInput.references,
      processedImageGrid: summary.consumedInput.processedImageGrid,
      fingerprints: summary.consumedInput.fingerprints,
    },
    'observed consumed input',
  );
  const runtime = verification.runtimeInputs,
    request = verification.requestInputs;
  const source = literal(state, runtime.role, runtime.modelField);
  equal(source, { source: 'hub', value: verification.modelReceipt.source.repository }, 'selected proposal model');
  equal(
    literal(state, runtime.role, runtime.revisionField),
    verification.modelReceipt.source.revision,
    'selected proposal pin',
  );
  const dtype = literal(state, runtime.role, runtime.dtypeField),
    device = literal(state, runtime.role, runtime.deviceField);
  if ((dtype !== 'float32' && dtype !== 'float16' && dtype !== 'bfloat16') || typeof device !== 'string')
    invalidAncillary('choose explicit proposal dtype/device controls before Preview.');
  const quantization = verification.quantizationRecipes.find(
    (recipe) => recipe.mode === literal(state, runtime.role, runtime.quantizationField),
  );
  if (!quantization) invalidAncillary('the selected proposal quantization recipe is not declared.');
  const modelReceipt: Omit<NativeEnhancementModelReceipt, 'receiptDigest'> = {
    ...verification.modelReceipt,
    runtime: { ...verification.modelReceipt.runtime, dtype, device, quantization },
  };
  const operation =
    child.layoutPolicy === AUTHORED_CONSTRAINT_POLICY
      ? AUTHORED_CONSTRAINT_OPERATION
      : child.layoutPolicy === 'append-details-preserve-layout-v1'
        ? 'enhance_prompt_append_details'
        : 'enhance_prompt';
  equal(literal(state, request.role, request.operationField), operation, 'selected text operation');
  const expectedControls = {
    max_new_tokens: literal(state, request.role, request.maxNewTokensField),
    min_new_tokens: literal(state, request.role, request.minNewTokensField),
    // The closed consumed-input contract fixes this native generation option;
    // it is not an independently authored registry control.
    return_dict_in_generate: false,
    ...Object.fromEntries(
      ['do_sample', 'num_beams', 'repetition_penalty', 'use_chat_template'].map((field) => [
        field,
        literal(state, request.role, field),
      ]),
    ),
  } as PromptEnhancementControls;
  const authoredPrompt = literal(state, child.bindings.request.role, child.bindings.request.promptField);
  if (typeof authoredPrompt !== 'string') invalidAncillary('the actual authored request is no longer text.');
  const authoredLayout = parseLayoutConditioning(
    literal(state, child.bindings.request.role, child.bindings.request.layoutField),
  );
  const references = consumed.references as EnhancementReference[];
  if (!child.bindings.owner.referenceSource && references.length)
    invalidAncillary('text-only enhancement has unexpected references.');
  const mode =
    `${references.length ? 'i2i' : 't2i'}${authoredLayout?.regions.length && child.layoutPolicy !== 'append-details-preserve-layout-v1' ? '_bbox' : ''}` as PromptEnhancementMode;
  const verified = await verifyPromptEnhancementSummaryBindings(envelope.value, {
    producer,
    adapter: verification.adapter,
    modelReceipt,
    authoredPrompt,
    authoredLayout,
    controls: expectedControls,
    systemPromptSha256: verification.systemPromptSha256ByMode[mode],
    references,
    operation,
    ...(child.layoutPolicy ? { layoutPolicy: child.layoutPolicy } : {}),
    ...(child.authoredLayoutConstraint ? { authoredLayoutConstraint: child.authoredLayoutConstraint } : {}),
  });
  selected.assertCurrent();
  assertRunCurrent(run);
  const ticket = Object.freeze({}) as VerifiedPromptEnhancementPreview;
  verifiedPreviews.set(ticket, {
    run,
    summary: verified,
    originalPairHash: await promptEnhancementPairHash({ prompt: authoredPrompt, layout: authoredLayout }),
  });
  return ticket;
}

export function promptEnhancementPreviewDetails(ticket: VerifiedPromptEnhancementPreview) {
  const state = verifiedPreviews.get(ticket);
  if (!state) invalidAncillary('request a new verified Preview.');
  assertRunCurrent(state.run);
  return structuredClone(state.summary);
}

export async function applyPromptEnhancementPreview(ticket: VerifiedPromptEnhancementPreview) {
  const state = verifiedPreviews.get(ticket);
  if (!state) invalidAncillary('request a new verified Preview.');
  assertRunCurrent(state.run);
  const selected = await resolveSelection(state.run.ownerId);
  const child = chooseChild(selected.recipe, state.run.childId);
  equal(child, previewRuns.get(state.run)!.declaration, 'selected enhancement declaration');
  const proposal = state.summary.proposal;
  if (!proposal.applicationAllowed)
    invalidAncillary(proposal.applicationBlockedReason ?? 'this proposal cannot be applied.');
  const request = child.bindings.request;
  const originalLayout = parseLayoutConditioning(
    literal(previewRuns.get(state.run)!, request.role, request.layoutField),
  );
  const pair = proposal.structuredProposal
    ? { prompt: proposal.structuredProposal.caption, layout: proposal.structuredProposal.layoutConditioning }
    : { prompt: proposal.text, layout: originalLayout };
  const graph = await planApplyPromptEnhancement(
    selected.graph,
    state.run.ownerId,
    selected.recipe,
    child.id,
    pair,
    state.originalPairHash,
  );
  // A verified ticket remains owned by the worker/source that produced it, even after model release.
  equal(await currentRuntime(), previewRuns.get(state.run)!.runtime, 'worker or backend source');
  selected.assertCurrent();
  assertRunCurrent(state.run);
  commitOperationGraph(graph, selected.context, selected.signature, 'Apply prompt enhancement', {
    preserveSelection: true,
  });
  verifiedPreviews.delete(ticket);
}
