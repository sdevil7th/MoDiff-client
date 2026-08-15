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
