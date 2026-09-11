import type { CustomNodeType } from '../stores/useFlowStore';
import {
  canonicalBlockStringifyV2,
  normalizeBlockInstanceV2,
  type BlockAuthorityReceiptV2,
  type BlockInstanceV2,
} from './blockSchemaV2';
import { hashString } from './stableHash';

export type RegisteredBlockAutoAuthorityStatusV2 = Readonly<{
  required: boolean;
  ready: boolean;
  code: 'not_registered' | 'ready' | 'missing' | 'stale';
  instanceId: string;
  reason?: string;
}>;

/** Stable hash a resource planner must bind into a Block V2 Auto receipt. */
export function blockExecutionParameterHashV2(instanceValue: BlockInstanceV2) {
  const instance = normalizeBlockInstanceV2(instanceValue);
  return `block-execution-parameters-v2-${hashString(
    canonicalBlockStringifyV2({
      values: instance.values,
      effectiveInterfaceHash: instance.effectiveInterface.effectiveInterfaceHash,
    }),
  )}`;
}

function receiptCoversRegisteredInstance(receipt: BlockAuthorityReceiptV2, instance: BlockInstanceV2, nowMs: number) {
  const source = instance.definitionSnapshot.source;
  if (!source.repository || !source.repositoryRevision) return false;
  return (
    receipt.kind === 'auto' &&
    receipt.definitionId === instance.definitionRef.definitionId &&
    receipt.definitionContentHash === instance.definitionRef.contentHash &&
    receipt.effectiveGraphHash === instance.effectiveGraph.graphHash &&
    receipt.executionParameterHash === blockExecutionParameterHashV2(instance) &&
    receipt.admissionId === source.executionAdmissionId &&
    receipt.artifactRevisions[source.repository] === source.repositoryRevision &&
    Date.parse(receipt.issuedAt) <= nowMs &&
    receipt.expiresAt !== undefined &&
    Date.parse(receipt.expiresAt) > nowMs
  );
}

/**
 * Validate—but never manufacture—the planner authority for one registered
 * catalog Block. Expert/manual execution intentionally does not call this.
 */
export function registeredBlockAutoAuthorityStatusV2(
  instanceValue: BlockInstanceV2,
  nowMs = Date.now(),
): RegisteredBlockAutoAuthorityStatusV2 {
  const instance = normalizeBlockInstanceV2(instanceValue);
  const source = instance.definitionSnapshot.source;
  if (source.kind !== 'diffusers_catalog' && source.kind !== 'transformers_catalog') {
    return { required: false, ready: true, code: 'not_registered', instanceId: instance.instanceId };
  }
  if (!source.repository || !source.repositoryRevision || !source.executionAdmissionId) {
    return {
      required: true,
      ready: false,
      code: 'stale',
      instanceId: instance.instanceId,
      reason:
        'Its exact execution admission or immutable model repository revision is missing from the registered definition.',
    };
  }
  const autoReceipts = instance.authorities.filter(({ kind }) => kind === 'auto');
  if (autoReceipts.some((receipt) => receiptCoversRegisteredInstance(receipt, instance, nowMs))) {
    return { required: true, ready: true, code: 'ready', instanceId: instance.instanceId };
  }
  return {
    required: true,
    ready: false,
    code: autoReceipts.length ? 'stale' : 'missing',
    instanceId: instance.instanceId,
    reason: autoReceipts.length
      ? 'Its Auto receipt no longer matches the exact definition, graph, parameters, artifact revision, or validity window.'
      : 'No planner-issued Auto receipt is attached to this workflow instance.',
  };
}

export function registeredBlockAutoAuthorityIssuesV2(nodes: readonly CustomNodeType[], nowMs = Date.now()) {
  return nodes.flatMap((node) => {
    const instance = node.data.blockInstanceV2;
    if (!instance) return [];
    const status = registeredBlockAutoAuthorityStatusV2(instance, nowMs);
    return status.required && !status.ready ? [status] : [];
  });
}

export function assertRegisteredBlockAutoAuthoritiesV2(nodes: readonly CustomNodeType[], nowMs = Date.now()) {
  const failure = registeredBlockAutoAuthorityIssuesV2(nodes, nowMs)[0];
  if (!failure) return;
  throw new Error(
    `Registered Block ${failure.instanceId} cannot run in Auto: ${failure.reason ?? 'its exact authority is missing.'} ` +
      'Switch to Expert to submit the concrete graph manually, or let Auto prepare this exact Block again.',
  );
}
