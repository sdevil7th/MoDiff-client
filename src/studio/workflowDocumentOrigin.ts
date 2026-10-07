// This page's generated IDs only: never persisted or inferred from saved metadata.
const freshWorkflowIds = new Set<string>();

export function markFreshWorkflowId(id: string) {
  freshWorkflowIds.add(id);
}

export function isFreshWorkflowId(id: string) {
  return freshWorkflowIds.has(id);
}

export function forgetFreshWorkflowId(id: string) {
  freshWorkflowIds.delete(id);
}
