import { canonicalJsonHash } from './canonical-json.mjs';

export function backendNodesFromCanonicalWorkflow(graph) {
  return [
    ...new Set(
      (graph?.nodes ?? [])
        .map((node) => `${node?.data?.module}.${node?.data?.action}`)
        .filter((value) => !value.includes('undefined')),
    ),
  ].sort();
}

export function canonicalWorkflowContract(manifest, graph) {
  const actualGraphHash = canonicalJsonHash(graph);
  if (manifest?.graphHash !== actualGraphHash) {
    throw new Error(`${String(manifest?.id ?? 'Canonical workflow')} graph hash does not match its manifest.`);
  }
  const backendNodes = backendNodesFromCanonicalWorkflow(graph);
  if (backendNodes.length === 0) {
    throw new Error(`${String(manifest?.id ?? 'Canonical workflow')} has no executable backend nodes.`);
  }
  return {
    graphHash: `sha256:workflow-graph-v1:${actualGraphHash}`,
    backendNodes,
  };
}

export function findCanonicalWorkflowRecord(workflows, template) {
  return (
    workflows.find((workflow) => workflow.manifest.sourceTemplateId === template.id) ??
    workflows.find(
      (workflow) =>
        workflow.manifest.id === `${template.modelType}:${template.mode}` &&
        workflow.manifest.modelType === template.modelType &&
        workflow.manifest.mode === template.mode,
    ) ??
    null
  );
}

function sameNodeContract(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort())
  );
}

export function assessHistoricalEvidence(candidate, canonicalWorkflow, backendRegistry, expected = {}) {
  if (!candidate) return { matches: false, status: 'missing', reasons: ['successful_real_run_receipt'] };
  if (!canonicalWorkflow) {
    return { matches: false, status: 'no_canonical_workflow', reasons: ['canonical_workflow'] };
  }
  const reasons = [];
  if (expected.catalogTemplateLockHash && candidate.catalogTemplateLockHash !== expected.catalogTemplateLockHash) {
    reasons.push('catalog_template_lock_mismatch');
  }
  if (expected.promptSettingsHash && candidate.promptSettingsHash !== expected.promptSettingsHash) {
    reasons.push('prompt_settings_hash_mismatch');
  }
  if (candidate.canonicalWorkflowHash) {
    if (candidate.canonicalWorkflowHash !== canonicalWorkflow.graphHash) {
      reasons.push('canonical_workflow_hash_mismatch');
    }
  }
  if (!sameNodeContract(candidate.backendNodes, canonicalWorkflow.backendNodes)) {
    reasons.push('canonical_workflow_node_contract_mismatch');
  }
  const missingBackendNodes = Array.isArray(candidate.backendNodes)
    ? [...new Set(candidate.backendNodes)].filter((nodeKey) => !backendRegistry.has(nodeKey)).sort()
    : [];
  if (missingBackendNodes.length > 0) reasons.push('historical_backend_nodes_missing');
  return {
    matches: reasons.length === 0,
    status:
      reasons.length === 0 ? (candidate.canonicalWorkflowHash ? 'current' : 'legacy_node_contract_match') : 'stale',
    reasons,
    missingBackendNodes,
  };
}
