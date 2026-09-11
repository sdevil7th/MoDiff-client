import type { NodeData } from '../stores/useNodeStore';
import type { HuggingFaceCatalogSection } from './huggingFaceNodeCatalog';
import {
  isBlockDefinitionV2,
  storedUserBlockId,
  storedUserBlockName,
  type StoredUserBlockDefinition,
} from './userBlockLibrary';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

/** Aliases must point to the same executable action with the same complete
 * field/default contract. Similar labels or signatures are insufficient. */
export function runtimeNodeIdentityV2(node: NodeData) {
  const contract = Object.fromEntries(
    Object.entries(node).filter(([key]) => !['label', 'description', 'category'].includes(key)),
  );
  return JSON.stringify(canonical(contract));
}

export function auditSavedUserNodesV2(blocks: StoredUserBlockDefinition[]) {
  const groups = new Map<string, Array<{ id: string; name: string }>>();
  for (const block of blocks) {
    const contract = isBlockDefinitionV2(block)
      ? {
          graph: block.graph,
          boundary: block.boundary,
          controls: block.controls,
          previews: block.previews,
          suggestedInputs: block.suggestedInputs,
          source: block.source,
        }
      : {
          nodes: block.nodes,
          edges: block.edges,
          inputs: block.inputs,
          outputs: block.outputs,
          exposedParams: block.exposedParams,
        };
    const identity = JSON.stringify(canonical(contract));
    groups.set(identity, [
      ...(groups.get(identity) ?? []),
      { id: storedUserBlockId(block), name: storedUserBlockName(block) },
    ]);
  }
  return {
    entries: blocks.length,
    distinctSavedContracts: groups.size,
    identicalSavedContractGroups: [...groups.values()].filter((group) => group.length > 1),
  };
}

export function auditNodeLibraryV2(registry: Record<string, NodeData>, sections: HuggingFaceCatalogSection[]) {
  const runtimeGroups = new Map<string, string[]>();
  for (const [key, node] of Object.entries(registry)) {
    const identity = runtimeNodeIdentityV2(node);
    runtimeGroups.set(identity, [...(runtimeGroups.get(identity) ?? []), key]);
  }
  const aliases = [...runtimeGroups.values()].filter((keys) => keys.length > 1);
  return {
    runtimeEntries: Object.keys(registry).length,
    uniqueRuntimeContracts: runtimeGroups.size,
    exactRuntimeAliases: aliases,
    sections: sections.map((section) => {
      const labels = new Map<string, string[]>();
      for (const entry of section.entries) labels.set(entry.label, [...(labels.get(entry.label) ?? []), entry.id]);
      return {
        id: section.id,
        label: section.label,
        entries: section.entries.length,
        uniqueIdentities: new Set(section.entries.map((entry) => entry.id)).size,
        placementContexts: section.entries.reduce(
          (count, entry) => count + (entry.modularBlockContexts?.length ?? 0),
          0,
        ),
        sameLabelDifferentIdentities: [...labels]
          .filter(([, ids]) => new Set(ids).size > 1)
          .map(([label, ids]) => ({ label, ids })),
      };
    }),
    decisions: [
      'Exact runtime aliases share one library entry; all registry keys remain resolvable in saved workflows.',
      'Modular placements with the same immutable Block definition are already merged into one entry with selectable contexts.',
      'Component references are already grouped by name, class, creation method and reuse contract; they are not extra executable nodes.',
      'Same-label entries with different executable identities remain distinct pending source-contract review.',
      'User-owned definitions and revisions remain distinct even if their names or contents match.',
    ],
  };
}
