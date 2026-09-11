import type { BlockDefinitionV2 } from './blockSchemaV2';
import type { UserBlockDefinition } from './types';

export type StoredUserBlockDefinition = UserBlockDefinition | BlockDefinitionV2;
export type UserBlockGrouping = 'source' | 'workflow';

export function isBlockDefinitionV2(block: StoredUserBlockDefinition): block is BlockDefinitionV2 {
  return 'schemaVersion' in block && block.schemaVersion === 2;
}

export function storedUserBlockId(block: StoredUserBlockDefinition) {
  return isBlockDefinitionV2(block) ? block.definitionId : block.id;
}

export function storedUserBlockName(block: StoredUserBlockDefinition) {
  return isBlockDefinitionV2(block) ? block.displayName : block.name;
}

function familyLabel(value: string | undefined) {
  if (!value) return 'Other';
  return value
    .replace(/ModularPipeline$/u, '')
    .replace(/Pipeline$/u, '')
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function taskLabel(value: string | undefined) {
  return value
    ? familyLabel(value)
        .replace(/text2image/iu, 'Text to image')
        .replace(/image2image/iu, 'Image to image')
    : 'Custom Blocks';
}

function displayFamily(name: string) {
  // Old saved forks sometimes omit pipelineClass. Their original display
  // prefix is useful for browsing, but never becomes execution provenance.
  return name.includes(' — ') ? name.split(' — ')[0]!.replace(/\s*\(Fork\)$/u, '') : 'Custom Blocks';
}

/** Display-only context from the existing save naming convention, not execution provenance. */
export function storedUserBlockGroupPath(block: StoredUserBlockDefinition, grouping: UserBlockGrouping = 'source') {
  if (grouping === 'workflow') {
    const name = storedUserBlockName(block);
    const separator = name.lastIndexOf(' — ');
    return separator > 0 && name.slice(separator + 3).trim()
      ? [name.slice(separator + 3).trim(), name.slice(0, separator).trim()]
      : ['No saved workflow context', name];
  }
  if (isBlockDefinitionV2(block)) {
    const source = block.source;
    const origin =
      source.library === 'diffusers' || source.catalogCategory === 'diffusers'
        ? 'Diffusers derived'
        : source.library === 'transformers' || source.catalogCategory === 'transformers'
          ? 'Transformers derived'
          : source.kind === 'hub_import'
            ? 'Hub imports'
            : 'Workflow created';
    return [
      origin,
      source.pipelineClass ? familyLabel(source.pipelineClass) : displayFamily(block.displayName),
      taskLabel(source.workflow),
    ];
  }
  const origin = block.origin;
  const source =
    origin?.provider === 'diffusers'
      ? 'Diffusers derived'
      : origin?.provider === 'transformers'
        ? 'Transformers derived'
        : origin?.kind === 'hugging_face_hub_import'
          ? 'Hub imports'
          : 'Workflow created';
  return [
    source,
    origin?.pipelineClass ? familyLabel(origin.pipelineClass) : displayFamily(block.name),
    taskLabel(origin?.workflowId),
  ];
}

export function storedUserBlockRevision(block: StoredUserBlockDefinition) {
  // A schema number is not a saved revision. V2 has a content identity; legacy saves have a timestamp.
  return isBlockDefinitionV2(block)
    ? `Revision ${block.contentHash.replace(/^.*:/u, '').slice(0, 12)}`
    : `Saved ${new Date(block.updatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function uniqueStoredUserBlocks(blocks: StoredUserBlockDefinition[]) {
  // Equal names/contents with different IDs are distinct reusable definitions, not duplicates.
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const id = storedUserBlockId(block);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
