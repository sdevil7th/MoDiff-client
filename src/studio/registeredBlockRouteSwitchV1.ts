import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  type WorkflowOperationContext,
} from '../stores/useStudioStore';
import {
  definitionForRegisteredRouteV1,
  inactiveBlockRouteDraftInstanceV1,
  registeredRouteSetForBlockV1,
} from './blockRouteSelectionV1';
import { canonicalBlockDefinitionV2, canonicalBlockStringifyV2 } from './blockSchemaV2';
import { getFormDefaultsForRegisteredRoute } from './modelProfiles';
import { registeredBlockV2Route } from './registeredBlockV2Routes';
import type { StudioMode, StudioModelType } from './types';

function bytesHex(value: ArrayBuffer) {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function canonicalDefinitionSha256(definition: Parameters<typeof canonicalBlockDefinitionV2>[0]) {
  if (!globalThis.crypto?.subtle) return null;
  const canonical = canonicalBlockStringifyV2(canonicalBlockDefinitionV2(definition));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `sha256:${bytesHex(digest)}`;
}

export async function switchRegisteredBlockRouteV1(
  instanceId: string,
  targetRouteKey: string,
  options: {
    compilerTimeoutMs?: number;
    signal?: AbortSignal;
    source?: { context: WorkflowOperationContext; signature: string };
  } = {},
) {
  const source = options.source ?? {
    context: captureWorkflowOperationContext(),
    signature: JSON.stringify(useFlowStore.getState().toObject()),
  };
  const assertCurrent = () => {
    if (options.signal?.aborted) throw new DOMException('Model change cancelled.', 'AbortError');
    assertWorkflowOperationContext(source.context, { includeForm: false });
    if (JSON.stringify(useFlowStore.getState().toObject()) !== source.signature)
      throw new Error('The graph changed while preparing this model change. Review it and try again.');
  };
  assertCurrent();
  const root = useFlowStore.getState().nodes.find((node) => node.id === instanceId);
  if (!root?.data.blockInstanceV2) throw new Error(`Block V2 root ${instanceId} is unavailable.`);
  const resolved = registeredRouteSetForBlockV1(root.data.blockInstanceV2);
  if (!resolved) throw new Error('This Block does not belong to a registered model route set.');
  const targetRoute = resolved.routeSet.routes.find(({ key }) => key === targetRouteKey);
  if (!targetRoute) throw new Error(`Unknown model route ${targetRouteKey}.`);
  if (targetRoute.key === resolved.activeRoute.key) return root.data.blockInstanceV2;

  const libraryStore = useHuggingFaceNodeLibraryStore.getState();
  if (!libraryStore.loaded) await libraryStore.fetchLibrary();
  assertCurrent();
  const library = useHuggingFaceNodeLibraryStore.getState().library;
  if (!library) throw new Error(useHuggingFaceNodeLibraryStore.getState().error || 'Node library is unavailable.');
  const definition = definitionForRegisteredRouteV1(library.definitions, targetRoute);
  const admissions = definition.executionAdmissions.filter(
    ({ status, publication }) =>
      status === 'admitted' && publication.insertable && publication.readiness === 'graph_qualified',
  );
  const matchingAdmissions = admissions.filter(({ id }) => id === targetRoute.compiledDefinitionId);
  if (matchingAdmissions.length !== 1)
    throw new Error(`Destination ${targetRoute.label} does not resolve to its one exact insertable admission.`);
  const admission = matchingAdmissions[0]!;
  const registered = registeredBlockV2Route(definition, admission);
  if (!registered) throw new Error(`Destination ${targetRoute.label} is not bound to its current registered route.`);
  const inactiveDraft = inactiveBlockRouteDraftInstanceV1(root.data.blockInstanceV2, targetRouteKey);
  const exactDraft =
    inactiveDraft &&
    inactiveDraft.definitionRef.definitionId === targetRoute.compiledDefinitionId &&
    inactiveDraft.definitionRef.contentHash === registered.compiledDefinitionContentHash &&
    (await canonicalDefinitionSha256(inactiveDraft.definitionSnapshot)) === registered.compiledDefinitionCanonicalSha256
      ? inactiveDraft
      : null;
  assertCurrent();
  let compiledDestination = exactDraft;
  if (!compiledDestination) {
    const { createHuggingFaceClusterForGraph } = await import('./huggingFaceClusterInsertion');
    assertCurrent();
    const form = getFormDefaultsForRegisteredRoute(
      admission.studioMode as StudioMode,
      definition.pipelineClass as StudioModelType,
    );
    const compiledRoot = await createHuggingFaceClusterForGraph(
      definition,
      root.data.blockInstanceV2.presentation.position,
      form,
      { compilerTimeoutMs: options.compilerTimeoutMs, insert: false, signal: options.signal },
    );
    compiledDestination = compiledRoot.data.blockInstanceV2 ?? null;
    if (!compiledDestination) throw new Error(`Destination ${targetRoute.label} did not compile to BlockInstanceV2.`);
  }

  assertCurrent();
  useFlowStore.getState().switchBlockRouteV1(instanceId, targetRouteKey, compiledDestination);
  const switched = useFlowStore.getState().nodes.find((node) => node.id === instanceId)?.data.blockInstanceV2;
  if (!switched) throw new Error(`Block V2 root ${instanceId} disappeared during route switching.`);
  return switched;
}
