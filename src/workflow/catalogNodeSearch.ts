import type { NodeData } from '../stores/useNodeStore';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { HuggingFaceNodeLibrary } from '../studio/huggingFaceNodeLibrary';
import type { HuggingFaceModularConditionalSnapshot } from '../studio/huggingFaceModularConditionals';
import type { StudioFormState } from '../studio/types';
import { huggingFaceCatalogAdmission } from '../studio/huggingFaceCatalogAdmission';
import {
  filterHuggingFaceCatalogSections,
  type HuggingFaceCatalogEntry,
  type HuggingFaceCatalogSection,
} from '../studio/huggingFaceNodeCatalog';
import type { NodeCatalogView } from '../studio/nodeCatalog';
import { registeredBlockInterfaceNode, type RegisteredBlockInterface } from '../studio/registeredBlockInterfaces';
import {
  createModularDiffusersCatalogNode,
  createModularDiffusersCatalogFragmentV2,
  modularDiffusersCatalogEntryHasDescendants,
} from '../studio/modularDiffusersBlockInsertion';
import { matchingNodeHandleForDrop, type HandleDirection } from './nodeConnectionMatching';

type CatalogContext = {
  library: HuggingFaceNodeLibrary;
  snapshot: HuggingFaceModularConditionalSnapshot | null;
  registry: Record<string, NodeData>;
  form: StudioFormState;
};

export function catalogNodeSearchEntries(
  sections: HuggingFaceCatalogSection[],
  context: CatalogContext,
  interfaces: RegisteredBlockInterface[],
  search: string,
  view: NodeCatalogView,
  dataType?: string | string[],
  handleType?: HandleDirection,
) {
  return filterHuggingFaceCatalogSections(sections, search, view)
    .flatMap(({ entries }) => entries)
    .filter((entry) => {
      if (!entry.insertable || entry.kind === 'component') return false;
      if (!handleType) return true;
      let node: NodeData | null = null;
      if (entry.kind === 'cluster') {
        const definition = context.library.definitions.find((item) => item.id === entry.id);
        const route = definition ? huggingFaceCatalogAdmission(definition, context.form).route : null;
        if (route) node = registeredBlockInterfaceNode(interfaces, route);
      } else {
        // Containers without public sockets stay discoverable through plain
        // search; do not invent state links from their internal leaves.
        if (modularDiffusersCatalogEntryHasDescendants(entry, context.library, context.snapshot)) return false;
        try {
          node = createModularDiffusersCatalogNode(
            entry,
            context.library,
            context.registry,
            { x: 0, y: 0 },
            context.snapshot,
          ).data;
        } catch {
          return false;
        }
      }
      return Boolean(node && matchingNodeHandleForDrop(node, dataType, handleType));
    });
}

/** Reuse the library's exact factories; constructing metadata grants no execution. */
export async function createCatalogSearchNode(
  entry: HuggingFaceCatalogEntry,
  context: CatalogContext,
  position: CustomNodeType['position'],
  signal: AbortSignal,
): Promise<CustomNodeType> {
  if (signal.aborted) throw new DOMException('Insertion cancelled.', 'AbortError');
  if (!entry.insertable) throw new Error('This catalog entry is not available for insertion.');
  if (entry.kind === 'block') {
    return modularDiffusersCatalogEntryHasDescendants(entry, context.library, context.snapshot)
      ? createModularDiffusersCatalogFragmentV2(entry, context.library, context.registry, position, context.snapshot)
      : createModularDiffusersCatalogNode(entry, context.library, context.registry, position, context.snapshot);
  }
  const definition = context.library.definitions.find((item) => item.id === entry.id);
  if (entry.kind !== 'cluster' || !definition) throw new Error('The selected catalog Block is no longer available.');
  const { createHuggingFaceClusterForGraph } = await import('../studio/huggingFaceClusterInsertion');
  return createHuggingFaceClusterForGraph(definition, position, context.form, { insert: false, signal });
}
