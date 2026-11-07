import type { NodeData } from '../stores/useNodeStore';
import { isRecord } from './outputContracts';
import { stableStringify } from './templateExactness';
import type { WorkflowTab } from './types';

export type WorkflowHydrationBaseline = {
  tab: WorkflowTab;
  canvasEpoch: number;
  registry: Readonly<Record<string, NodeData>>;
};

const EMPTY_IMAGE_PREVIEW = stableStringify({ type: 'image', display: 'ui_image', value: [] });

/** Comparison only: passive restore metadata never changes the saved document. */
export function matchesCleanWorkflowHydrationBaseline(local: WorkflowTab, baseline: WorkflowHydrationBaseline) {
  const original = baseline.tab;
  if (original.dirty || local.snapshot.nodes.length !== original.snapshot.nodes.length) return false;
  const originalNodes: unknown[] = [];
  const localNodes: unknown[] = [];
  for (const [index, node] of local.snapshot.nodes.entries()) {
    const old = original.snapshot.nodes[index];
    if (!isRecord(old) || !isRecord(node) || !isRecord(old.data) || !isRecord(node.data)) return false;
    if (!isRecord(old.data.params) || !isRecord(node.data.params)) return false;
    const oldParams = { ...old.data.params };
    const params = { ...node.data.params };
    const definition = baseline.registry[`${String(node.data.module)}.${String(node.data.action)}`];
    for (const [field, param] of Object.entries(params)) {
      if (!Object.prototype.hasOwnProperty.call(oldParams, field)) {
        const declared =
          isRecord(definition?.params) && Object.prototype.hasOwnProperty.call(definition.params, field)
            ? definition.params[field]
            : undefined;
        // Only the exact empty preview supplied by this node's current registry
        // can appear without being an authored document change.
        if (stableStringify(param) !== EMPTY_IMAGE_PREVIEW || stableStringify(declared) !== EMPTY_IMAGE_PREVIEW)
          return false;
        delete params[field];
        continue;
      }
      const prior = oldParams[field];
      if (
        isRecord(prior) &&
        isRecord(param) &&
        (prior.display === 'input' || prior.display === 'output') &&
        prior.display === param.display
      ) {
        const oldParam = { ...prior };
        const currentParam = { ...param };
        if (oldParam.isConnected === false) delete oldParam.isConnected;
        if (currentParam.isConnected === false) delete currentParam.isConnected;
        oldParams[field] = oldParam;
        params[field] = currentParam;
      }
    }
    originalNodes.push({ ...old, data: { ...old.data, params: oldParams } });
    localNodes.push({ ...node, data: { ...node.data, params } });
  }
  const signature = (tab: WorkflowTab, nodes: unknown[]) =>
    stableStringify([
      tab.id,
      tab.createdAt,
      tab.title,
      tab.source,
      tab.sourceLabel,
      tab.intent ?? 'saved',
      { ...tab.snapshot, nodes },
    ]);
  return signature(original, originalNodes) === signature(local, localNodes);
}
