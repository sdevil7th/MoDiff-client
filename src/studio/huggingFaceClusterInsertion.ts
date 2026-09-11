import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { captureWorkflowOperationContext, workflowOperationContextIsCurrent } from '../stores/useStudioStore';
import { getFormDefaultsForRegisteredRoute, STUDIO_MODEL_PROFILES } from './modelProfiles';
import type { HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';
import { createHuggingFaceClusterNode } from './huggingFaceClusterGraph';
import { huggingFaceClusterOverridesForBindingValues } from './huggingFaceClusterInstance';
import { finalizeHuggingFaceClusterDynamicFieldsInFlow } from './huggingFaceClusterFinalization';
import {
  materializeHuggingFaceClusterExecutionSkeleton,
  reconcileHuggingFaceClusterExecutionSkeleton,
  type HuggingFaceClusterExecutionSkeleton,
} from './huggingFaceClusterMaterializer';
import { provisionalHuggingFaceClusterExecutionParameterValues } from './huggingFaceClusterRuntime';
import { compileRegisteredBlockV2, type CompiledRegisteredBlockV2 } from './registeredBlockAdapterV2';
import { registeredBlockV2Route } from './registeredBlockV2Routes';
import { createBlockRootNodeV2 } from './blockRuntimeV2';
import { setBlockPresentationV2 } from './blockRuntimeV2';
import {
  canonicalBlockDefinitionV2,
  canonicalBlockStringifyV2,
  createBlockInstanceV2,
  type BlockJsonValue,
} from './blockSchemaV2';
import type { StudioFormState, StudioMode, StudioModelType } from './types';
import { createCatalogOnlyModularBlockRootV2 } from './catalogOnlyModularBlockV2';
import { fetchRegisteredBlockV2CompiledCatalogEntry } from './registeredBlockV2CompiledCatalog';
import { compositeChildNodeId } from './compositeNodes';

export { HUGGING_FACE_CLUSTER_DRAG_PREFIX } from './huggingFaceClusterDrag';

export type RegisteredBlockV2CompilerDiagnostic = {
  attemptId: string;
  definitionId: string;
  admissionId: string | null;
  durableInstanceId: string | null;
  transientInstanceId: string | null;
  sessionId: string | null;
  stage: string;
  startedAt: number;
  updatedAt: number;
  elapsedMs: number;
  action: { role: string; field: string; event: string; valueSource: string } | null;
  pendingFields: string[];
  receivedContentHash: string | null;
  receivedCanonicalSha256: string | null;
  error: string | null;
  cleanupCompleted: boolean;
};

const registeredBlockV2CompilerDiagnostics: RegisteredBlockV2CompilerDiagnostic[] = [];

const REVIEWED_INITIAL_HANDLE_VISIBILITY_DEFINITIONS = new Set([
  'diffusers.modular:QwenImageModularPipeline:text2image',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Reproduce the ordinary HandleField mount-time show/hide result for routes
 * whose current exact pin has explicitly qualified it. The transient compiler
 * otherwise depends on whether React mounts a hidden connector before or
 * after the managed finalizer suppresses its initial field action.
 */
export function stabilizeReviewedInitialHandleVisibility(
  definitionId: string,
  value: HuggingFaceClusterExecutionSkeleton,
): HuggingFaceClusterExecutionSkeleton {
  if (!REVIEWED_INITIAL_HANDLE_VISIBILITY_DEFINITIONS.has(definitionId)) return value;
  const skeleton = structuredClone(value);
  const incoming = new Set(
    skeleton.edges
      .filter((edge) => typeof edge.targetHandle === 'string' && edge.targetHandle)
      .map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  skeleton.nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([field, param]) => {
      const onChange = record(param.onChange);
      if (param.display !== 'input' || !onChange || typeof onChange.action === 'string') return;
      const selected = incoming.has(`${node.id}\0${field}`) ? 'true' : 'false';
      const visibility = new Map<string, boolean>();
      Object.entries(onChange).forEach(([key, fields]) => {
        (Array.isArray(fields) ? fields : [fields]).forEach((target) => {
          if (typeof target !== 'string') return;
          visibility.set(target, Boolean(visibility.get(target) || key === selected));
        });
      });
      visibility.forEach((visible, target) => {
        const controlled = node.data.params[target];
        if (!controlled) throw new Error(`The reviewed initial visibility target ${target} is unavailable.`);
        controlled.hidden = !visible;
      });
    });
  });
  return skeleton;
}

/**
 * Bounded, non-sensitive compiler progress for support diagnostics and live
 * browser tests. Values and prompts are deliberately excluded.
 */
export function getRegisteredBlockV2CompilerDiagnostics() {
  return registeredBlockV2CompilerDiagnostics.map((diagnostic) => ({
    ...diagnostic,
    action: diagnostic.action ? { ...diagnostic.action } : null,
    pendingFields: [...diagnostic.pendingFields],
  }));
}

function beginCompilerDiagnostic(
  definitionId: string,
  durableInstanceId: string | null,
): RegisteredBlockV2CompilerDiagnostic {
  const now = Date.now();
  const diagnostic: RegisteredBlockV2CompilerDiagnostic = {
    attemptId: globalThis.crypto.randomUUID(),
    definitionId,
    admissionId: null,
    durableInstanceId,
    transientInstanceId: null,
    sessionId: null,
    stage: 'requested',
    startedAt: now,
    updatedAt: now,
    elapsedMs: 0,
    action: null,
    pendingFields: [],
    receivedContentHash: null,
    receivedCanonicalSha256: null,
    error: null,
    cleanupCompleted: false,
  };
  registeredBlockV2CompilerDiagnostics.push(diagnostic);
  if (registeredBlockV2CompilerDiagnostics.length > 12) registeredBlockV2CompilerDiagnostics.shift();
  console.info(`[registered-block-v2-compiler] ${diagnostic.attemptId} requested ${definitionId}`);
  return diagnostic;
}

function updateCompilerDiagnostic(
  diagnostic: RegisteredBlockV2CompilerDiagnostic,
  patch: Partial<Omit<RegisteredBlockV2CompilerDiagnostic, 'attemptId' | 'definitionId' | 'startedAt'>>,
) {
  Object.assign(diagnostic, patch);
  diagnostic.updatedAt = Date.now();
  diagnostic.elapsedMs = diagnostic.updatedAt - diagnostic.startedAt;
  const suffix = diagnostic.action ? ` ${diagnostic.action.role}.${diagnostic.action.field}` : '';
  const received = diagnostic.receivedContentHash
    ? ` received=${diagnostic.receivedContentHash}/${diagnostic.receivedCanonicalSha256 ?? 'pending'}`
    : '';
  console.info(`[registered-block-v2-compiler] ${diagnostic.attemptId} ${diagnostic.stage}${suffix}${received}`);
}

function cleanupCompilationSession(sessionId: string) {
  useFlowStore.setState((state) => {
    const ownedIds = new Set(
      state.nodes.filter((node) => node.data.blockCompilationTransientV2 === sessionId).map((node) => node.id),
    );
    if (!ownedIds.size) return state;
    return {
      nodes: state.nodes.filter((node) => node.data.blockCompilationTransientV2 !== sessionId),
      edges: state.edges.filter((edge) => !ownedIds.has(edge.source) && !ownedIds.has(edge.target)),
    };
  });
}

function transientCompilationNode(node: CustomNodeType, sessionId: string): CustomNodeType {
  return {
    ...node,
    hidden: true,
    selected: false,
    dragging: false,
    data: {
      ...node.data,
      blockCompilationTransientV2: sessionId,
      uiState: {
        ...node.data.uiState,
        disabled: true,
      },
    },
  };
}

function boundedCompilerTimeout(timeoutMs?: number) {
  return Math.max(0, Math.min(timeoutMs ?? 5_000, 20_000));
}

function bytesHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function canonicalDefinitionSha256(definition: CompiledRegisteredBlockV2['definition']) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('The browser cannot verify the registered Block definition SHA-256.');
  }
  const canonical = canonicalBlockStringifyV2(canonicalBlockDefinitionV2(definition));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256:${bytesHex(digest)}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

async function resolveAdmissionExecutionSpec(
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryDefinition['executionAdmissions'][number],
) {
  if (!admission.studioExecutionSpec) throw new Error('The selected catalog workflow has no execution schema.');
  const resolve = () =>
    useNodesStore
      .getState()
      .studioModelCapabilities.find((capability) => capability.modelType === definition.pipelineClass)
      ?.studioExecutionSpecs?.find(
        (candidate) =>
          candidate.id === admission.studioExecutionSpec?.id &&
          candidate.contentHash === admission.studioExecutionSpec.contentHash &&
          candidate.executionProfileId === admission.studioExecutionSpec.executionProfileId,
      );
  let spec = resolve();
  if (!spec) {
    await useNodesStore.getState().fetchStudioModelCapabilities();
    spec = resolve();
  }
  if (!spec) throw new Error('The backend no longer exposes this exact reviewed catalog graph.');
  return spec;
}

/**
 * Compile one persisted registered Cluster through the same backend-declared
 * dynamic-field finalizer used by catalog insertion.
 *
 * The compiler projection receives a fresh transient instance id. This is
 * important for migration: the legacy root can already be present on the
 * active canvas, and inserting a hidden root with the same id would make field
 * actions and ownership ambiguous. Only the final source-neutral V2 instance
 * receives the durable legacy root id.
 */
export async function compileRegisteredCatalogBlockV2Exact(
  definition: HuggingFaceNodeLibraryDefinition,
  legacyRoot: CustomNodeType,
  options: { timeoutMs?: number } = {},
): Promise<CompiledRegisteredBlockV2> {
  const context = captureWorkflowOperationContext();
  const durableInstance = legacyRoot.data.huggingFaceClusterInstance;
  const diagnostic = beginCompilerDiagnostic(definition.id, durableInstance?.instanceId ?? null);
  const admission = definition.executionAdmissions.find(
    (candidate) => candidate.id === durableInstance?.execution?.admissionId,
  );
  const route = durableInstance && admission ? registeredBlockV2Route(definition, admission) : null;
  if (!durableInstance || !admission || !route) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'failed',
      error: 'The requested catalog definition is not an exact admitted Block V2 route.',
    });
    throw new Error('The requested catalog definition is not an exact admitted Block V2 route.');
  }
  updateCompilerDiagnostic(diagnostic, { stage: 'route_validated', admissionId: admission.id });
  const width = legacyRoot.width;
  const height = legacyRoot.height;
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'failed',
      error: 'The legacy Cluster root does not have an exact positive persisted size.',
    });
    throw new Error('The legacy Cluster root does not have an exact positive persisted size.');
  }

  // The generated catalog is the normal, immutable compiler authority for a
  // registered route. Reusing it here keeps historical migration and fresh
  // insertion on the same exact BlockDefinitionV2 bytes and avoids replaying
  // dynamic node actions merely to rediscover a definition that was already
  // compiled and SHA-256 pinned at build time. The dynamic compiler below is
  // retained as a bounded recovery path for an older deployment that has not
  // published the generated entry yet.
  updateCompilerDiagnostic(diagnostic, { stage: 'generated_definition_resolving' });
  try {
    const generated = await fetchRegisteredBlockV2CompiledCatalogEntry(definition, admission, route);
    if (!workflowOperationContextIsCurrent(context, { includeForm: false })) {
      throw new Error('The workflow changed while the catalog Block was being compiled.');
    }
    const created = createBlockInstanceV2(generated.definition, {
      instanceId: durableInstance.instanceId,
      position: legacyRoot.position,
      size: { width, height },
      values: generated.values,
      internalLayout: generated.internalLayout,
      internalLayoutMode: generated.internalLayoutMode,
      baselineValues: true,
    });
    const instance = setBlockPresentationV2(created, { expanded: durableInstance.presentation.expanded });
    const semanticNodeIdsByMaterializedNodeId = Object.fromEntries(
      instance.effectiveGraph.nodes.flatMap((node) =>
        node.semanticRole
          ? [
              [
                compositeChildNodeId(
                  durableInstance.instanceId,
                  `diffusers.cluster-execution:${encodeURIComponent(node.semanticRole)}`,
                ),
                node.nodeId,
              ],
            ]
          : [],
      ),
    );
    updateCompilerDiagnostic(diagnostic, {
      stage: 'completed',
      receivedContentHash: generated.definition.contentHash,
      receivedCanonicalSha256: generated.compiledDefinitionCanonicalSha256,
      error: null,
      cleanupCompleted: true,
    });
    return { definition: generated.definition, instance, semanticNodeIdsByMaterializedNodeId };
  } catch (error) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'generated_definition_unavailable',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let modularConditionalSnapshot = useHuggingFaceModularConditionalStore.getState().snapshot;
  if (route.exactModularGraph && !useHuggingFaceModularConditionalStore.getState().loaded) {
    updateCompilerDiagnostic(diagnostic, { stage: 'hierarchy_resolving' });
    await useHuggingFaceModularConditionalStore.getState().fetchSnapshot();
    modularConditionalSnapshot = useHuggingFaceModularConditionalStore.getState().snapshot;
  }
  if (route.exactModularGraph && !modularConditionalSnapshot) {
    const reason =
      useHuggingFaceModularConditionalStore.getState().error ||
      'The exact unpruned Modular Diffusers hierarchy is unavailable.';
    updateCompilerDiagnostic(diagnostic, { stage: 'failed', error: reason });
    throw new Error(reason);
  }

  updateCompilerDiagnostic(diagnostic, { stage: 'execution_spec_resolving' });
  let executionSpec: Awaited<ReturnType<typeof resolveAdmissionExecutionSpec>>;
  try {
    executionSpec = await resolveAdmissionExecutionSpec(definition, admission);
  } catch (error) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  updateCompilerDiagnostic(diagnostic, { stage: 'execution_spec_resolved' });
  if (!workflowOperationContextIsCurrent(context, { includeForm: false })) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'failed',
      error: 'The workflow changed while the catalog Block was being compiled.',
    });
    throw new Error('The workflow changed while the catalog Block was being compiled.');
  }

  const sessionId = `registered-block-v2:${globalThis.crypto.randomUUID()}`;
  const transientInstanceId = `registered-block-v2-compiler-${globalThis.crypto.randomUUID()}`;
  updateCompilerDiagnostic(diagnostic, {
    stage: 'skeleton_materializing',
    sessionId,
    transientInstanceId,
  });
  const instance = {
    ...durableInstance,
    instanceId: transientInstanceId,
  };
  const transientRoot = transientCompilationNode(
    {
      ...legacyRoot,
      id: transientInstanceId,
      selected: false,
      data: {
        ...legacyRoot.data,
        huggingFaceClusterInstance: instance,
      },
    },
    sessionId,
  );
  const bindingValues = provisionalHuggingFaceClusterExecutionParameterValues(definition, instance, admission);
  const materialized = materializeHuggingFaceClusterExecutionSkeleton({
    definition,
    instance,
    admission,
    executionSpec,
    nodesRegistry: useNodesStore.getState().nodesRegistry,
    bindingValues,
    expanded: false,
  });
  const skeleton = {
    ...materialized,
    nodes: materialized.nodes.map((node) => transientCompilationNode(node, sessionId)),
    edges: materialized.edges.map((edge) => ({ ...edge, hidden: true })),
  };

  try {
    useFlowStore.setState((state) => ({ nodes: [...state.nodes, transientRoot], edges: state.edges }));
    updateCompilerDiagnostic(diagnostic, { stage: 'transient_root_attached' });
    const finalized = await finalizeHuggingFaceClusterDynamicFieldsInFlow({
      definition,
      instance,
      admission,
      executionSpec,
      skeleton,
      bindingValues,
      timeoutMs: options.timeoutMs,
      onProgress: (progress) => {
        if (progress.stage === 'field_action_started' || progress.stage === 'field_action_completed') {
          updateCompilerDiagnostic(diagnostic, {
            stage: progress.stage,
            action: { ...progress.action },
          });
          return;
        }
        if (progress.stage === 'reconciling' || progress.stage === 'completed') {
          updateCompilerDiagnostic(diagnostic, {
            stage: progress.stage === 'completed' ? 'dynamic_fields_completed' : 'dynamic_fields_reconciling',
            action: null,
            pendingFields: [...progress.pendingFields],
          });
          return;
        }
        updateCompilerDiagnostic(diagnostic, { stage: progress.stage, action: null });
      },
    });
    if (!finalized.studioExecutionSpec) {
      const pending = finalized.skeleton.pendingFields.map(({ role, field }) => `${role}.${field}`).join(', ');
      throw new Error(
        pending
          ? `The reviewed catalog graph did not publish required fields: ${pending}.`
          : 'The reviewed catalog graph did not finish dynamic-field reconciliation.',
      );
    }
    if (!workflowOperationContextIsCurrent(context, { includeForm: false })) {
      throw new Error('The workflow changed while the catalog Block was being compiled.');
    }
    const timeoutMs = boundedCompilerTimeout(options.timeoutMs);
    updateCompilerDiagnostic(diagnostic, { stage: 'definition_pin_reconciling', action: null });
    const startedAt = Date.now();
    let reconciled = finalized.skeleton;
    let receivedContentHash = '';
    let receivedCanonicalSha256 = '';
    let lastIssue = '';
    let keepWaiting = true;
    do {
      if (!workflowOperationContextIsCurrent(context, { includeForm: false })) {
        throw new Error('The workflow changed while the catalog Block was being compiled.');
      }
      reconciled = stabilizeReviewedInitialHandleVisibility(
        definition.id,
        reconcileHuggingFaceClusterExecutionSkeleton({
          definition,
          instance,
          admission,
          executionSpec,
          skeleton: finalized.skeleton,
          currentNodes: useFlowStore.getState().nodes,
          bindingValues,
          expanded: instance.presentation.expanded,
        }),
      );
      if (!reconciled.bindingsComplete || reconciled.pendingFields.length || reconciled.missingBindingSources.length) {
        const pending = [
          ...reconciled.missingBindingSources,
          ...reconciled.pendingFields.map(({ role, field }) => `${role}.${field}`),
        ].join(', ');
        lastIssue = `required fields are still publishing: ${pending || 'unknown fields'}`;
      } else {
        try {
          const compiled = compileRegisteredBlockV2(definition, reconciled, {
            instanceId: durableInstance.instanceId,
            position: legacyRoot.position,
            size: { width, height },
            expanded: durableInstance.presentation.expanded,
            route,
            blockDefinitions: useHuggingFaceNodeLibraryStore.getState().library?.blockDefinitions,
            blockRoleAdapters: useHuggingFaceNodeLibraryStore.getState().library?.blockRoleAdapters,
            reviewedModularStepNodeData:
              useNodesStore.getState().nodesRegistry['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
            modularConditionalSnapshot: modularConditionalSnapshot ?? undefined,
          });
          receivedContentHash = compiled.definition.contentHash;
          receivedCanonicalSha256 = await canonicalDefinitionSha256(compiled.definition);
          updateCompilerDiagnostic(diagnostic, {
            stage: 'definition_pin_reconciling',
            receivedContentHash,
            receivedCanonicalSha256,
          });
          lastIssue =
            `the current definition hash is ${receivedContentHash} and its canonical SHA-256 is ` +
            `${receivedCanonicalSha256}`;
          if (
            receivedContentHash === route.compiledDefinitionContentHash &&
            receivedCanonicalSha256 === route.compiledDefinitionCanonicalSha256
          ) {
            updateCompilerDiagnostic(diagnostic, { stage: 'completed', error: null });
            return compiled;
          }
        } catch (error) {
          lastIssue = error instanceof Error ? error.message : String(error);
        }
      }
      keepWaiting = Date.now() - startedAt < timeoutMs;
      if (!keepWaiting) break;
      // A synchronous field action queues its node-definition publications
      // before the HTTP response, but the WebSocket can deliver them just
      // after that response resolves. Keep the isolated compiler projection
      // alive until those exact reviewed bytes arrive; never persist or
      // execute an earlier partial schema.
      await delay(50);
    } while (keepWaiting);
    throw new Error(
      `The reviewed catalog graph did not finalize to its pinned BlockDefinitionV2 ` +
        `(expected ${route.compiledDefinitionContentHash} / ${route.compiledDefinitionCanonicalSha256}, ` +
        `received ${receivedContentHash || 'none'} / ${receivedCanonicalSha256 || 'not-computed'}). ` +
        `Last observed state: ${lastIssue || 'no finalized compiler state was observed'}.`,
    );
  } catch (error) {
    updateCompilerDiagnostic(diagnostic, {
      stage: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    cleanupCompilationSession(sessionId);
    updateCompilerDiagnostic(diagnostic, { cleanupCompleted: true });
  }
}

async function compileRegisteredCatalogBlockV2(
  definition: HuggingFaceNodeLibraryDefinition,
  legacyRoot: CustomNodeType,
  timeoutMs?: number,
  insert = false,
) {
  const compiled = await compileRegisteredCatalogBlockV2Exact(definition, legacyRoot, { timeoutMs });
  const root = createBlockRootNodeV2(compiled.instance);
  if (insert) useFlowStore.getState().addNode(root);
  return root;
}

export async function createHuggingFaceClusterForGraph(
  definition: HuggingFaceNodeLibraryDefinition,
  position: { x: number; y: number },
  studioForm: StudioFormState,
  options: { compilerTimeoutMs?: number; insert?: boolean } = {},
): Promise<CustomNodeType> {
  const admissions = definition.executionAdmissions.filter(
    (admission) =>
      admission.status === 'admitted' &&
      admission.claim === 'static_graph_contract_compatible' &&
      admission.executable === false &&
      admission.publication.readiness === 'graph_qualified' &&
      admission.publication.insertable &&
      admission.reasons.length === 0,
  );
  const matchingAdmission = admissions.find(
    (admission) => studioForm.modelType === definition.pipelineClass && studioForm.mode === admission.studioMode,
  );
  // A graph-library row must remain insertable on a genuinely empty graph.
  // Multi-mode definitions expose their reviewed admissions in a stable,
  // publisher-owned order; the first exact registered admission is the
  // deterministic default when no task/model selection asks for another.
  // This never infers an admission by family name: the exact route ledger is
  // still checked immediately below and fails closed on missing/stale pins.
  const selectedAdmission = matchingAdmission ?? admissions[0];
  const route = registeredBlockV2Route(definition, selectedAdmission);

  if (definition.provider === 'diffusers' && !useHuggingFaceModularConditionalStore.getState().loaded) {
    await useHuggingFaceModularConditionalStore.getState().fetchSnapshot();
  }
  if (!route) {
    if (definition.provider !== 'diffusers') {
      throw new Error('The selected catalog Cluster is not an exact registered Block V2 route and cannot be inserted.');
    }
    const library = useHuggingFaceNodeLibraryStore.getState().library;
    const snapshot = useHuggingFaceModularConditionalStore.getState().snapshot;
    if (!library || !snapshot) {
      throw new Error('The reviewed Modular Diffusers manifests are unavailable. Reload the node catalog.');
    }
    const root = createCatalogOnlyModularBlockRootV2(
      definition,
      library,
      useNodesStore.getState().nodesRegistry,
      snapshot,
      position,
    );
    if (options.insert) useFlowStore.getState().addNode(root);
    return root;
  }

  // Catalog insertion creates a fresh, deterministic instance. The ambient
  // Studio form can select between multiple admissions, but it carries no
  // provenance proving that its values were chosen for this new Block. In
  // particular, a restored/empty graph can retain another model's 8-step,
  // guidance-1 defaults while its model/mode labels already say Qwen. Seed the
  // selected route from its own profile and let creator starter values win
  // below; users can then edit this independent instance explicitly.
  // Backend-defined routes need no model-specific frontend profile. When that
  // legacy profile is absent, getFormDefaultsForRegisteredRoute falls back to
  // another model's generic values. Do not let those overwrite the exact
  // compiled creator values (e.g. ControlNet 28 steps becomes generic 8 steps).
  const hasDeclaredProfile = Object.prototype.hasOwnProperty.call(STUDIO_MODEL_PROFILES, definition.pipelineClass);
  const bindingForm =
    selectedAdmission && hasDeclaredProfile
      ? getFormDefaultsForRegisteredRoute(
          selectedAdmission.studioMode as StudioMode,
          definition.pipelineClass as StudioModelType,
        )
      : null;
  const { parameterOverrides, executionParameterOverrides } =
    selectedAdmission && bindingForm
      ? huggingFaceClusterOverridesForBindingValues(
          definition,
          selectedAdmission,
          bindingForm as unknown as Record<string, unknown>,
        )
      : { parameterOverrides: {}, executionParameterOverrides: {} };
  const suggestedValues = definition.suggestedInputs?.values ?? {};
  const seededParameterOverrides = Object.fromEntries(
    Object.entries(parameterOverrides).filter(
      ([name, value]) => !(value === '' && Object.prototype.hasOwnProperty.call(suggestedValues, name)),
    ),
  );

  if (selectedAdmission && route) {
    const compiled = await fetchRegisteredBlockV2CompiledCatalogEntry(definition, selectedAdmission, route);
    const acceptedValueIds = new Set([
      ...compiled.definition.controls.map(({ controlId }) => controlId),
      ...compiled.definition.boundary.inputs.map(({ portId }) => portId),
    ]);
    const values = Object.fromEntries(
      Object.entries({
        ...compiled.values,
        ...suggestedValues,
        ...seededParameterOverrides,
        ...executionParameterOverrides,
      }).filter(([valueId]) => acceptedValueIds.has(valueId)),
    ) as Record<string, BlockJsonValue>;
    const instance = createBlockInstanceV2(compiled.definition, {
      instanceId: globalThis.crypto.randomUUID(),
      position,
      size: { width: 360, height: 320 },
      values,
      internalLayout: compiled.internalLayout,
      internalLayoutMode: compiled.internalLayoutMode,
      baselineValues: true,
    });
    const root = createBlockRootNodeV2(instance);
    if (options.insert) useFlowStore.getState().addNode(root);
    return root;
  }

  const legacyRoot = createHuggingFaceClusterNode(
    definition,
    globalThis.crypto.randomUUID(),
    position,
    { ...suggestedValues, ...seededParameterOverrides },
    selectedAdmission?.id ?? null,
    executionParameterOverrides,
  );
  return compileRegisteredCatalogBlockV2(definition, legacyRoot, options.compilerTimeoutMs, options.insert);
}
