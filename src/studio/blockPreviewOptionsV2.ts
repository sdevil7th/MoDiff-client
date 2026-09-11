import {
  blockGraphSubtreeNodeIdsV2,
  normalizeBlockContainerInterfaceV1,
  type BlockInstanceV2,
  type BlockPreviewBindingV2,
} from './blockSchemaV2';

export type BlockPreviewOptionV2 = { key: string; label: string; binding: BlockPreviewBindingV2 };

export function blockPreviewOptionKeyV2(binding: BlockPreviewBindingV2) {
  return `${binding.nodeId}\0${binding.outputPortId}\0${binding.mediaType}`;
}

/** Use the schema validator itself: no second set of media/type heuristics in the editor. */
export function blockPreviewOptionsV2(instance: BlockInstanceV2, subtreeId: string): BlockPreviewOptionV2[] {
  const included = blockGraphSubtreeNodeIdsV2(instance.effectiveGraph, subtreeId);
  return instance.effectiveGraph.nodes.flatMap((node) => {
    if (!included.has(node.nodeId)) return [];
    const params = node.data.params;
    if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
    return Object.entries(params).flatMap(([outputPortId, field]) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
      if (field.display !== 'output' && !String(field.display ?? '').startsWith('ui_')) return [];
      return (['image', 'video', 'audio', 'text', 'file'] as const).flatMap((mediaType) => {
        const binding = { nodeId: node.nodeId, outputPortId, mediaType };
        try {
          normalizeBlockContainerInterfaceV1(
            {
              schemaVersion: 1,
              boundary: { mode: 'explicit', inputs: [], outputs: [] },
              controls: [],
              previews: [binding],
            },
            instance.effectiveGraph,
            subtreeId,
          );
        } catch {
          return [];
        }
        return [
          {
            key: blockPreviewOptionKeyV2(binding),
            label: `${String(node.data.label || node.nodeId)} / ${String(field.label || outputPortId)} (${mediaType})`,
            binding,
          },
        ];
      });
    });
  });
}
