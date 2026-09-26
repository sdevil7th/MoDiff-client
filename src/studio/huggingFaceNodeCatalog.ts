import type {
  HuggingFaceNodeLibrary,
  HuggingFaceNodeLibraryBlockPlacement,
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryIntegrationStatus,
} from './huggingFaceNodeLibrary';
import { registeredBlockV2Route } from './registeredBlockV2Routes';
import { matchesSearchKeywords } from '../utils/searchKeywords';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';
import type { NodeCatalogView } from './nodeCatalog';
import { builtinNodeDisplayLabel } from '../workflow/nodePresentation';

export type HuggingFaceCatalogSectionId =
  | 'diffusers_cluster_nodes'
  | 'transformers_cluster_nodes'
  | 'modular_diffusers_block_nodes'
  | 'diffusers_component_nodes';

export type HuggingFaceCatalogEntryKind = 'cluster' | 'block' | 'component';

export type HuggingFaceCatalogBlockContext = {
  definitionId: string;
  pipelineClass: string;
  blocksClass: string;
  workflowId: string;
  placement: HuggingFaceNodeLibraryBlockPlacement;
  executionScope?: 'selected_workflow' | 'unpruned_pipeline';
};

export type HuggingFaceCatalogEntry = {
  id: string;
  kind: HuggingFaceCatalogEntryKind;
  label: string;
  description: string;
  detail: string;
  searchText: string;
  groupPath: string[];
  readiness: 'catalog_only' | 'composable' | 'graph_qualified';
  readinessLabel: 'Catalog only' | 'Composable' | 'Graph qualified';
  insertable: boolean;
  definitionIds: string[];
  integrationStatus?: HuggingFaceNodeLibraryIntegrationStatus;
  modularBlockPlacement?: HuggingFaceCatalogBlockContext;
  modularBlockContexts?: HuggingFaceCatalogBlockContext[];
};

export type HuggingFaceCatalogSection = {
  id: HuggingFaceCatalogSectionId;
  label: string;
  entries: HuggingFaceCatalogEntry[];
};

const SECTION_LABELS: Record<HuggingFaceCatalogSectionId, string> = {
  diffusers_cluster_nodes: 'Diffusers Blocks',
  transformers_cluster_nodes: 'Transformers Blocks',
  modular_diffusers_block_nodes: 'Modular Diffusers implementation',
  diffusers_component_nodes: 'Diffusers components',
};

function words(value: string) {
  return value
    .replace(/ModularPipeline$/u, '')
    .replace(/Pipeline$/u, '')
    .replace(/Step$/u, '')
    .replace(/[_-]/gu, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function shortType(value: string) {
  const parts = value.split('.').filter(Boolean);
  return parts[parts.length - 1] || value;
}

function uniqueSorted(values: Iterable<string>) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function titleWords(value: string) {
  return words(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function definitionFamilyLabel(definition: HuggingFaceNodeLibraryDefinition) {
  return definition.label.split('—')[0]?.trim() || words(definition.pipelineClass);
}

function definitionModality(definition: HuggingFaceNodeLibraryDefinition) {
  const outputContract = definition.outputs
    .map(({ name, type }) => `${name} ${type}`)
    .join(' ')
    .toLowerCase();
  const hasAudio = outputContract.includes('audio');
  const hasVideo = outputContract.includes('video');
  const hasImage = outputContract.includes('image');
  if (hasAudio && hasVideo) return 'Multimodal';
  if (hasVideo) return 'Video';
  if (hasAudio) return 'Audio';
  if (hasImage) return 'Image';
  return 'Other';
}

function definitionSearchText(definition: HuggingFaceNodeLibraryDefinition) {
  // Search the workflow's own identity. Component/step metadata can mention
  // another family (for example Anima's Qwen encoder); those have their own rows.
  return [
    definition.label,
    definition.pipelineClass,
    definition.blocksClass,
    definition.workflowId,
    definition.taskId,
    definition.taskContractId,
  ]
    .join(' ')
    .toLowerCase();
}

export function huggingFaceClusterDisplayLabel(definition: HuggingFaceNodeLibraryDefinition) {
  if (definition.provider === 'transformers') return definition.label.replace(/\bPipeline\b/giu, 'Block');
  const declaredWorkflowLabel = definition.label.split('—').slice(1).join('—').trim();
  const declaredFamilyLabel = definition.label.split('—')[0]?.trim() || '';
  // Prefer a publisher-reviewed human family name when one was supplied.
  // Deriving every label from the Python class turned WanTI2VPipeline into
  // the misleading "Wan TI2 V" and discarded its 2.2/5B identity.
  const familyLabel =
    declaredFamilyLabel && declaredFamilyLabel !== definition.pipelineClass
      ? declaredFamilyLabel.replace(/(?:Modular)?Pipeline$/u, '').trim()
      : words(definition.pipelineClass);
  const workflowLabel = (declaredWorkflowLabel || words(definition.workflowId)).replace(
    /\b(?:Modular\s+)?Pipeline\b/giu,
    'Block',
  );
  return `${familyLabel} — ${workflowLabel}`;
}

function clusterEntries(
  library: HuggingFaceNodeLibrary,
  provider: HuggingFaceNodeLibraryDefinition['provider'],
): HuggingFaceCatalogEntry[] {
  return library.definitions
    .filter((definition) => definition.provider === provider)
    .map((definition) => {
      const graphQualified = definition.executionAdmissions.some(
        (admission) =>
          admission.status === 'admitted' &&
          admission.publication.readiness === 'graph_qualified' &&
          admission.publication.insertable &&
          Boolean(registeredBlockV2Route(definition, admission)),
      );
      return {
        id: definition.id,
        kind: 'cluster' as const,
        label: huggingFaceClusterDisplayLabel(definition),
        description:
          definition.description ||
          `Block containing the reviewed ${definition.pipelineClass} ${definition.workflowId} workflow.`,
        detail: `${words(definition.taskId)} · ${definition.steps.length} block${definition.steps.length === 1 ? '' : 's'}`,
        searchText: definitionSearchText(definition),
        groupPath: [definitionModality(definition), titleWords(definition.taskId), definitionFamilyLabel(definition)],
        readiness: graphQualified ? ('graph_qualified' as const) : ('catalog_only' as const),
        readinessLabel: graphQualified ? ('Graph qualified' as const) : ('Catalog only' as const),
        // Every reviewed Modular Diffusers workflow has an exact structural
        // BlockDefinitionV2 fallback. Execution/publication qualification is
        // still represented independently by the readiness badge. Never use
        // the legacy Cluster renderer as an insertion fallback.
        insertable: graphQualified || provider === 'diffusers',
        definitionIds: [definition.id],
        integrationStatus: definition.integrationStatus,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

function modularBlockRole(className: string, kind: string) {
  const value = `${className} ${kind}`.toLowerCase();
  if (kind === 'auto' || kind === 'conditional' || kind === 'sequential') return 'Containers & Routing';
  if (kind === 'loop' || value.includes('loop')) return 'Denoise Loops';
  if (value.includes('load') || value.includes('component')) return 'Load Components';
  if (value.includes('encoder') || value.includes('condition') || value.includes('embedding'))
    return 'Encode & Condition';
  if (value.includes('input') || value.includes('latent') || value.includes('timestep') || value.includes('rope'))
    return 'Prepare Inputs & Latents';
  if (value.includes('denois')) return 'Denoise';
  if (value.includes('decode') || value.includes('postprocess') || value.includes('output')) return 'Decode & Output';
  if (value.includes('preview')) return 'Preview';
  return 'Other';
}

function blockContextKey(context: HuggingFaceCatalogBlockContext) {
  return [
    context.definitionId,
    context.pipelineClass,
    context.workflowId,
    context.executionScope ?? 'selected_workflow',
    context.placement.path.join('/'),
  ].join('\u0000');
}

function deduplicateBlockEntries(entries: HuggingFaceCatalogEntry[], library: HuggingFaceNodeLibrary) {
  const byDefinition = new Map<string, HuggingFaceCatalogEntry>();
  entries.forEach((entry) => {
    const context = entry.modularBlockPlacement;
    if (!context) return;
    const semanticId = context.placement.blockDefinitionId;
    const previous = byDefinition.get(semanticId);
    if (!previous) {
      byDefinition.set(semanticId, {
        ...entry,
        id: `modular-block:${semanticId}`,
        modularBlockContexts: [context],
      });
      return;
    }
    const contexts = [...(previous.modularBlockContexts ?? [previous.modularBlockPlacement!]), context];
    previous.modularBlockContexts = [
      ...new Map(contexts.map((candidate) => [blockContextKey(candidate), candidate])).values(),
    ].sort(
      (left, right) =>
        left.pipelineClass.localeCompare(right.pipelineClass) ||
        left.workflowId.localeCompare(right.workflowId) ||
        left.placement.path.join('/').localeCompare(right.placement.path.join('/')),
    );
    previous.modularBlockPlacement = previous.modularBlockContexts[0];
    previous.definitionIds = uniqueSorted([...previous.definitionIds, ...entry.definitionIds]);
    previous.searchText = `${previous.searchText} ${entry.searchText}`;
  });

  return [...byDefinition.values()]
    .map((entry) => {
      const contexts = entry.modularBlockContexts ?? (entry.modularBlockPlacement ? [entry.modularBlockPlacement] : []);
      const families = uniqueSorted(contexts.map(({ pipelineClass }) => words(pipelineClass)));
      const role = entry.groupPath[entry.groupPath.length - 1] || 'Other';
      return {
        ...entry,
        detail: `${entry.detail} · ${contexts.length} context${contexts.length === 1 ? '' : 's'} · ${families.join(', ')}`,
        groupPath: [
          (() => {
            const modalities = uniqueSorted(
              contexts.flatMap((context) =>
                library.definitions
                  .filter((definition) => definition.pipelineClass === context.pipelineClass)
                  .map(definitionModality),
              ),
            );
            return modalities.length === 1 ? modalities[0]! : 'Shared Across Modalities';
          })(),
          role,
          families.length === 1 ? families[0]! : 'Shared Across Families',
        ],
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function huggingFaceCatalogEntryForPipeline(
  entry: HuggingFaceCatalogEntry,
  pipelineClass?: string | null,
): HuggingFaceCatalogEntry {
  if (entry.kind !== 'block' || !entry.modularBlockContexts?.length) return entry;
  const context =
    (pipelineClass
      ? entry.modularBlockContexts.find((candidate) => candidate.pipelineClass === pipelineClass)
      : undefined) ?? entry.modularBlockContexts[0]!;
  return { ...entry, modularBlockPlacement: context };
}

function selectedWorkflowBlockEntries(library: HuggingFaceNodeLibrary): HuggingFaceCatalogEntry[] {
  const blocks = new Map(library.blockDefinitions.map((block) => [block.id, block]));
  return deduplicateBlockEntries(
    library.definitions
      .filter((definition) => definition.provider === 'diffusers' && Boolean(definition.blocksClass))
      .flatMap((definition) =>
        definition.blockPlacements.map((placement) => {
          const block = blocks.get(placement.blockDefinitionId)!;
          const definitionIds = [definition.id];
          const description = block.description || `Reviewed Modular Diffusers block class ${block.className}.`;
          return {
            id: `modular-placement:${definition.id}:${placement.path.join('/')}`,
            kind: 'block' as const,
            label: compositeBlockLabel(definition, placement, words(block.className)),
            description,
            detail: `${words(definition.pipelineClass)} · ${words(definition.workflowId)} · ${placement.legacyPath}`,
            searchText: [block.className, block.kind, placement.legacyPath, ...definitionIds].join(' ').toLowerCase(),
            groupPath: [words(definition.pipelineClass), modularBlockRole(block.className, block.kind)],
            readiness: 'composable' as const,
            readinessLabel: 'Composable' as const,
            insertable: true,
            definitionIds,
            modularBlockPlacement: {
              definitionId: definition.id,
              pipelineClass: definition.pipelineClass,
              blocksClass: definition.blocksClass!,
              workflowId: definition.workflowId,
              placement,
              executionScope: 'selected_workflow' as const,
            },
          };
        }),
      ),
    library,
  );
}

/** Composite placements name ordinary runtime nodes through the reviewed adapter
 * contract. Keep those names consistent with canvas/search, without guessing from
 * prose descriptions or confusing Load Image with Load Image Pipeline. */
function compositeBlockLabel(
  definition: HuggingFaceNodeLibraryDefinition,
  placement: HuggingFaceNodeLibraryBlockPlacement,
  fallback: string,
) {
  if (!placement.blockDefinitionId.startsWith('diffusers.composite-block:')) return fallback;
  const identities = new Set(
    definition.graphAdapterContracts.flatMap((contract) => {
      const index = contract.actionSequence.indexOf(placement.legacyPath);
      return index < 0 ? [] : [contract.upstreamBlockSequence[index]!];
    }),
  );
  return identities.size === 1 ? builtinNodeDisplayLabel([...identities][0]!, fallback) : fallback;
}

function unprunedBlockEntries(
  library: HuggingFaceNodeLibrary,
  snapshot: HuggingFaceModularConditionalSnapshot,
): HuggingFaceCatalogEntry[] {
  if (snapshot.diffusersRevision !== library.diffusersRevision) return selectedWorkflowBlockEntries(library);
  const blocks = new Map(snapshot.blockDefinitions.map((block) => [block.id, block]));
  const definitionsByPipeline = new Map<string, HuggingFaceNodeLibraryDefinition[]>();
  library.definitions.forEach((definition) => {
    if (definition.provider !== 'diffusers' || !definition.blocksClass) return;
    definitionsByPipeline.set(definition.pipelineClass, [
      ...(definitionsByPipeline.get(definition.pipelineClass) ?? []),
      definition,
    ]);
  });
  return deduplicateBlockEntries(
    snapshot.pipelines.flatMap((pipeline) => {
      const definitions = (definitionsByPipeline.get(pipeline.pipelineClass) ?? []).sort((left, right) =>
        left.workflowId.localeCompare(right.workflowId),
      );
      const context = definitions[0];
      if (!context) return [];
      return pipeline.placements.map((placement): HuggingFaceCatalogEntry => {
        const block = blocks.get(placement.blockDefinitionId)!;
        const description = block.description || `Reviewed Modular Diffusers block class ${block.className}.`;
        return {
          id: `modular-placement:${pipeline.pipelineClass}:unpruned:${placement.path.join('/')}`,
          kind: 'block',
          label: words(block.className),
          description,
          detail: `${words(pipeline.pipelineClass)} · ${block.kind} · ${placement.legacyPath}`,
          searchText: [
            block.className,
            block.kind,
            placement.legacyPath,
            pipeline.pipelineClass,
            context.blocksClass,
            ...definitions.map(({ id, workflowId }) => `${id} ${workflowId}`),
          ]
            .join(' ')
            .toLowerCase(),
          groupPath: [words(pipeline.pipelineClass), modularBlockRole(block.className, block.kind)],
          readiness: 'composable',
          readinessLabel: 'Composable',
          insertable: true,
          definitionIds: definitions.map(({ id }) => id),
          modularBlockPlacement: {
            definitionId: context.id,
            pipelineClass: pipeline.pipelineClass,
            blocksClass: context.blocksClass,
            workflowId: '__unpruned__',
            placement,
            executionScope: 'unpruned_pipeline',
          },
        };
      });
    }),
    library,
  );
}

function componentEntries(library: HuggingFaceNodeLibrary): HuggingFaceCatalogEntry[] {
  const entries = new Map<
    string,
    {
      name: string;
      type: string;
      creationMethod: string;
      reuseKey: string[];
      definitionIds: Set<string>;
    }
  >();
  library.definitions.forEach((definition) => {
    if (definition.provider !== 'diffusers') return;
    definition.components.forEach((component) => {
      const identity = JSON.stringify([component.name, component.type, component.creationMethod, component.reuseKey]);
      const current = entries.get(identity) ?? { ...component, definitionIds: new Set<string>() };
      current.definitionIds.add(definition.id);
      entries.set(identity, current);
    });
  });
  return [...entries.entries()]
    .map(([identity, component]) => {
      const definitionIds = uniqueSorted(component.definitionIds);
      const typeLabel = shortType(component.type);
      const label = `${words(component.name)} — ${words(typeLabel)}`;
      const description = `Reviewed Diffusers component ${component.type}.`;
      return {
        id: `diffusers.component:${identity}`,
        kind: 'component' as const,
        label,
        description,
        detail: `${component.creationMethod || 'runtime'} · ${definitionIds.length} Block${definitionIds.length === 1 ? '' : 's'}`,
        searchText: [component.name, component.type, component.creationMethod, ...component.reuseKey]
          .join(' ')
          .toLowerCase(),
        groupPath: [
          /scheduler/iu.test(component.type)
            ? 'Schedulers'
            : /tokenizer/iu.test(component.type)
              ? 'Tokenizers'
              : /vae|autoencoder/iu.test(component.type)
                ? 'Image & Video Decoders'
                : /text|clip|t5|bert/iu.test(component.type)
                  ? 'Text Encoders'
                  : /processor|extractor/iu.test(component.type)
                    ? 'Processors'
                    : /controlnet|adapter/iu.test(component.type)
                      ? 'Conditioning & Adapters'
                      : /unet|transformer/iu.test(component.type)
                        ? 'Denoise Models'
                        : 'Other Components',
          words(typeLabel),
        ],
        readiness: 'catalog_only' as const,
        readinessLabel: 'Catalog only' as const,
        insertable: false,
        definitionIds,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function buildHuggingFaceCatalogSections(
  library: HuggingFaceNodeLibrary,
  modularSnapshot?: HuggingFaceModularConditionalSnapshot | null,
): HuggingFaceCatalogSection[] {
  const entries: Record<HuggingFaceCatalogSectionId, HuggingFaceCatalogEntry[]> = {
    diffusers_cluster_nodes: clusterEntries(library, 'diffusers'),
    transformers_cluster_nodes: clusterEntries(library, 'transformers'),
    modular_diffusers_block_nodes: modularSnapshot
      ? unprunedBlockEntries(library, modularSnapshot)
      : selectedWorkflowBlockEntries(library),
    diffusers_component_nodes: componentEntries(library),
  };
  return (Object.keys(SECTION_LABELS) as HuggingFaceCatalogSectionId[]).map((id) => ({
    id,
    label: SECTION_LABELS[id],
    entries: entries[id],
  }));
}

export function filterHuggingFaceCatalogSections(
  sections: HuggingFaceCatalogSection[],
  search: string,
  view: NodeCatalogView = 'advanced',
): HuggingFaceCatalogSection[] {
  const visibleSections =
    view === 'common' || view === 'experimental'
      ? sections
          .map((section) => ({
            ...section,
            entries: section.entries.filter(
              (entry) => entry.kind === 'cluster' && entry.insertable && entry.readiness === 'graph_qualified',
            ),
          }))
          .filter((section) => section.entries.length > 0)
      : sections;
  const query = search.trim().toLowerCase();
  if (!query) return visibleSections;
  return visibleSections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        matchesSearchKeywords(search, [
          section.label,
          entry.id,
          entry.label,
          entry.detail,
          ...(entry.groupPath ?? []),
          entry.searchText,
        ]),
      ),
    }))
    .filter((section) => section.entries.length > 0);
}
