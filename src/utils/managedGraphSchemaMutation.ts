import type { NodeParams } from '../stores/useNodeStore';

type Handler = {
  before: (nodeId: string, paramKeys?: readonly (keyof NodeParams)[]) => boolean;
  after: () => void;
};

let handler: Handler | null = null;

export function setManagedGraphSchemaMutationHandler(before: Handler['before'], after: Handler['after']) {
  handler = { before, after };
}

export function beginManagedGraphSchemaMutation(nodeId: string, paramKeys?: readonly (keyof NodeParams)[]) {
  return handler?.before(nodeId, paramKeys) ?? false;
}

export function finishManagedGraphSchemaMutation() {
  handler?.after();
}
