import config from '../../app.config';
import { useFlowStore } from '../stores/useFlowStore';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useStudioStore } from '../stores/useStudioStore';
import { formatRequestError, requestJson } from '../utils/requestJson';
import { registeredBlockAutoAuthorityStatusV2 } from './blockExecutionAuthorityV2';
import { normalizeBlockInstanceV2, type BlockAuthorityReceiptV2, type BlockInstanceV2 } from './blockSchemaV2';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import { registeredBlockRunFormV2 } from './blockRunFormV2';
import { registeredBlockV2Route } from './registeredBlockV2Routes';

const inFlight = new Map<string, Promise<BlockAuthorityReceiptV2>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseAuthorityResponse(value: unknown) {
  if (!isRecord(value) || value.error !== false || !isRecord(value.receipt)) {
    throw new Error('The backend Auto planner returned an invalid Block V2 authority response.');
  }
  return value.receipt;
}

function autoFormForInstance(
  instance: BlockInstanceV2,
  definition: HuggingFaceNodeLibraryDefinition,
  admission: HuggingFaceNodeLibraryExecutionAdmission,
) {
  const projected = registeredBlockRunFormV2(instance, 'auto');
  if (!projected || projected.route.definitionId !== definition.id || projected.route.admissionId !== admission.id) {
    throw new Error(`Registered Block ${instance.instanceId} cannot project its exact Auto planning form.`);
  }
  return projected.form;
}

function registeredCatalogContract(instance: BlockInstanceV2) {
  const source = instance.definitionSnapshot.source;
  const library = useHuggingFaceNodeLibraryStore.getState().library;
  const definition = library?.definitions.find(
    (candidate) =>
      candidate.id === source.manifestDefinitionId &&
      candidate.contentHash === source.manifestContentHash &&
      candidate.libraryRevision === source.libraryRevision,
  );
  const admission = definition?.executionAdmissions.find((candidate) => candidate.id === source.executionAdmissionId);
  const route = definition && admission ? registeredBlockV2Route(definition, admission) : null;
  if (
    !definition ||
    !admission ||
    !route ||
    instance.definitionRef.definitionId !== admission.id ||
    route.artifact.repo !== source.repository ||
    route.artifact.revision !== source.repositoryRevision
  ) {
    throw new Error(
      `Registered Block ${instance.instanceId} cannot prepare Auto because its exact catalog admission is unavailable or stale.`,
    );
  }
  return { definition, admission };
}

async function requestAuthority(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const source = instance.definitionSnapshot.source;
  if (
    !source.manifestDefinitionId ||
    !source.manifestContentHash ||
    !source.executionAdmissionId ||
    !source.repository ||
    !source.repositoryRevision
  ) {
    throw new Error(`Registered Block ${instance.instanceId} has incomplete immutable Auto provenance.`);
  }
  const { definition, admission } = registeredCatalogContract(instance);
  let rawReceipt: Record<string, unknown>;
  try {
    rawReceipt = await requestJson(`${config.serverAddress}/huggingface/cluster/auto-authority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schemaVersion: 1,
        instance,
        form: autoFormForInstance(instance, definition, admission),
      }),
      timeoutMs: 120_000,
      parse: parseAuthorityResponse,
    });
  } catch (error) {
    throw new Error(formatRequestError(error, `Registered Block ${instance.instanceId} Auto planning failed.`));
  }
  const normalized = normalizeBlockInstanceV2({
    ...instance,
    authorities: [...instance.authorities.filter(({ kind }) => kind !== 'auto'), rawReceipt as BlockAuthorityReceiptV2],
  });
  const receipt = normalized.authorities.find(({ kind }) => kind === 'auto');
  if (!receipt || !registeredBlockAutoAuthorityStatusV2(normalized).ready) {
    throw new Error(`The backend Auto planner returned a stale authority for Registered Block ${instance.instanceId}.`);
  }
  return receipt;
}

function requestAuthorityOnce(instance: BlockInstanceV2) {
  const current = inFlight.get(instance.instanceId);
  if (current) return current;
  const pending = requestAuthority(instance).finally(() => inFlight.delete(instance.instanceId));
  inFlight.set(instance.instanceId, pending);
  return pending;
}

/**
 * Ask the backend planner to issue and attach one exact, short-lived receipt
 * per registered V2 root. Expert/manual execution deliberately bypasses this
 * path and submits its concrete graph without manufacturing Auto authority.
 */
export async function prepareRegisteredBlockAutoAuthoritiesV2(instanceIds?: readonly string[]) {
  const studio = useStudioStore.getState();
  // Only the workflow's saved resource policy controls planning. Opening
  // Expert authoring tools must not bypass a planner or rewrite this policy.
  if (studio.form.resourceMode === 'expert') return;
  const requested = instanceIds ? new Set(instanceIds) : null;
  const roots = useFlowStore
    .getState()
    .nodes.filter(
      (node) =>
        node.data.blockInstanceV2 &&
        (node.data.blockInstanceV2.definitionSnapshot.source.kind === 'diffusers_catalog' ||
          node.data.blockInstanceV2.definitionSnapshot.source.kind === 'transformers_catalog') &&
        (!requested || requested.has(node.id)),
    )
    .map((node) => ({ id: node.id, instance: normalizeBlockInstanceV2(node.data.blockInstanceV2!) }));
  const pending = roots.filter(({ instance }) => !registeredBlockAutoAuthorityStatusV2(instance).ready);
  if (!pending.length) return;
  let library = useHuggingFaceNodeLibraryStore.getState().library;
  if (!library) {
    await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
    library = useHuggingFaceNodeLibraryStore.getState().library;
  }
  if (!library) throw new Error('The registered Hugging Face catalog is unavailable for Auto planning.');
  const receipts = new Map(
    await Promise.all(pending.map(async ({ id, instance }) => [id, await requestAuthorityOnce(instance)] as const)),
  );

  useFlowStore.setState((state) => ({
    nodes: state.nodes.map((node) => {
      const receipt = receipts.get(node.id);
      if (!receipt) return node;
      const current = node.data.blockInstanceV2;
      if (!current) throw new Error(`Registered Block ${node.id} disappeared while Auto was planning it.`);
      const next = normalizeBlockInstanceV2({
        ...current,
        authorities: [...current.authorities.filter(({ kind }) => kind !== 'auto'), receipt],
      });
      if (!registeredBlockAutoAuthorityStatusV2(next).ready) {
        throw new Error(`Registered Block ${node.id} changed while Auto was planning it. Prepare Auto again.`);
      }
      return { ...node, data: { ...node.data, blockInstanceV2: next } };
    }),
  }));
}
