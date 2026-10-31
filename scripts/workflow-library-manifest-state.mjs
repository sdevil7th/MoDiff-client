export function compareCanonicalWorkflowRecordIds(left, right) {
  // Published IDs use codepoint order so host locale never rewrites unrelated pairs.
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function retainUnselectedCurrentWorkflowRecords(records, capabilities, requestedPair) {
  if (!requestedPair) return [];
  const currentPairs = new Set(
    capabilities.flatMap((capability) =>
      (capability.runnableModes ?? []).map((mode) => `${capability.modelType}|${mode}`),
    ),
  );
  return (records ?? []).filter((record) => {
    const pair = `${record.modelType}|${record.mode}`;
    return pair !== requestedPair && currentPairs.has(pair);
  });
}
