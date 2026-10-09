import { canonicalAuxiliaryTerminalBinding } from './workflow-library-dead-nodes.mjs';

/** Parse independent backend source declarations; never use manifest metadata
 * as authority for an auxiliary execution terminal. */
export async function parseCanonicalAuxiliarySources(payload, selectedCapabilities, moduleServer) {
  const selected = new Set(selectedCapabilities.map((capability) => capability.modelType));
  const capabilities = payload.capabilities.filter(
    (capability) =>
      selected.has(capability.modelType) &&
      capability.studioExecutionSpecs?.some((spec) => spec.auxiliaryTerminalRoles?.length),
  );
  if (capabilities.length === 0) return { sources: new Map(), unpackGraph: (graph) => graph };
  const specParser = await moduleServer.ssrLoadModule('/src/studio/executionSpecs.ts');
  const operationParser = await moduleServer.ssrLoadModule('/src/workflow/operationContracts.ts');
  const { unpackVisualOperationGroups } = await moduleServer.ssrLoadModule('/src/workflow/visualOperationGroups.ts');
  const operationContracts = operationParser.parseOperationContracts(
    payload.operationContracts,
    payload.operationContractSchemaVersion,
  );
  const sources = new Map(
    capabilities.flatMap((capability) =>
      specParser
        .parseStudioExecutionSpecs(
          capability.studioExecutionSpecs,
          capability.modelType,
          capability.runnableModes,
          capability.executionProfiles,
        )
        .filter((executionSpec) => executionSpec.auxiliaryTerminalRoles?.length)
        .map((executionSpec) => [
          `${executionSpec.modelType}|${executionSpec.mode}`,
          { executionSpec, operationContracts },
        ]),
    ),
  );
  return { sources, unpackGraph: (graph) => unpackVisualOperationGroups(graph).graph };
}

export function attachCanonicalAuxiliaryBinding(record, graph, parsed) {
  const source = parsed.sources.get(`${record.modelType}|${record.mode}`);
  if (source)
    record.auxiliaryTerminalBinding = canonicalAuxiliaryTerminalBinding(record, parsed.unpackGraph(graph), source);
  return record;
}
