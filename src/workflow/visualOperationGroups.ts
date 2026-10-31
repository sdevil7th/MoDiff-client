import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import {
  blockDefinitionContentHashV2,
  blockGraphHashV2,
  canonicalBlockStringifyV2,
  createBlockInstanceV2,
  normalizeBlockDefinitionV2,
  normalizeBlockInstanceV2,
  type BlockControlV2,
  type BlockDefinitionV2,
  type BlockJsonObject,
  type BlockPortV2,
  type BlockPreviewBindingV2,
} from '../studio/blockSchemaV2';
import { blockProjectionNodeIdV2, createBlockRootNodeV2, parameterCustomizationState } from '../studio/blockRuntimeV2';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { operationScope } from './operationScope';
import { operationOwnsModel } from './operationContracts';
import { remapOperationAuthoring } from './operationSharedInputs';
import { workflowTaskCategory } from './workflowTaskBrowser';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { hasInlineScalarControl } from '../studio/inlineScalarControl';

import {
  visualOperationGroup,
  unpackVisualOperationGroups,
  VISUAL_STAGE_LABELS,
  visualStagePresentation,
  VISUAL_STAGE_PROVIDER as PROVIDER,
  COMBINED_INPUT_PROVIDER,
  type VisualOperationGroup,
} from './visualOperationGroupProjection';
export {
  visualOperationGroup,
  visualOperationOwnerId,
  unpackVisualOperationGroups,
  planVisualSharedInput,
  VISUAL_STAGE_LABELS,
  VISUAL_STAGE_NAMES,
  type VisualOperationGroup,
} from './visualOperationGroupProjection';

function stageKind(node: CustomNodeType): VisualOperationGroup | null {
  const operation = operationAuthoring(node)?.operation;
  if (
    !operation &&
    node.data.studioRole === 'guider' &&
    Object.values(node.data.params).some((param) => param.display === 'output' && param.type === 'custom_guider')
  )
    return 'guidance';
  if (!operation || !['block', 'bundle'].includes(operation.decomposition) || operation.task?.includes('video'))
    return null;
  if (['text_encoder', 'vae_encoder', 'image_encoder'].includes(operation.nodeType)) return 'inputs';
  if (['guidance', 'guidance_layers'].includes(operation.nodeType)) return 'guidance';
  if (
    ['Image', 'Audio'].includes(workflowTaskCategory(operation.task ?? '')) &&
    (operation.nodeType === 'decoder' || operation.operationId === 'diffusion.decode_latents') &&
    operation.ports.some(
      (port) =>
        port.direction === 'output' &&
        port.types.includes(workflowTaskCategory(operation.task ?? '') === 'Audio' ? 'audio' : 'image'),
    )
  )
    return 'output';
  return null;
}

const nodeKey = (node: CustomNodeType) => `${node.data.module}.${node.data.action}`;
const SETUP_UTILITIES = new Set([
  'modules.ModularDiffusers.Lora',
  'modules.DiffusersImage.LoadAdapter',
  'modules.DiffusersAudio.LoadAdapter',
  'modules.DiffusersRuntime.PipelineQuantizationConfigV2',
  'modules.DiffusersRuntime.DiffusersExecutionRecipe',
]);

/** Select existing, connected implementations only. Never manufacture a mask,
 * decoder or modifier from a model name, task label or repository. */
function operationStageMembers(
  graph: OperationGraph,
  ownerId: string,
  kind: VisualOperationGroup,
  combineGuidance = false,
) {
  const scope = operationScope(graph, ownerId);
  if (kind === 'inputs' && combineGuidance) {
    const ids = new Set(scope.map((node) => node.id));
    for (const node of graph.nodes) {
      if (
        ids.has(node.id) ||
        node.parentId ||
        node.data.blockInstanceV2 ||
        node.data.blockProjectionOwnerId ||
        operationAuthoring(node) ||
        stageKind(node) !== 'guidance'
      )
        continue;
      const outgoing = graph.edges.filter((edge) => edge.source === node.id);
      if (
        outgoing.length &&
        outgoing.every((edge) => {
          const from = node.data.params[edge.sourceHandle ?? ''];
          const to = scope.find((target) => target.id === edge.target)?.data.params[edge.targetHandle ?? ''];
          return (
            ids.has(edge.target) &&
            from?.display === 'output' &&
            from.type === 'custom_guider' &&
            to?.type === 'custom_guider' &&
            (to.display === 'input' || to.isInput)
          );
        }) &&
        !graph.edges.some((edge) => edge.target === node.id && !ids.has(edge.source))
      )
        scope.push(node);
    }
  }
  if (kind === 'inputs' || kind === 'guidance') {
    const members = scope.filter(
      (node) => stageKind(node) === kind || (kind === 'inputs' && combineGuidance && stageKind(node) === 'guidance'),
    );
    return kind === 'guidance' &&
      members.length > 1 &&
      !graph.edges.some(
        (edge) => members.some((node) => node.id === edge.source) && members.some((node) => node.id === edge.target),
      )
      ? []
      : members;
  }
  const ordinary = graph.nodes.filter(
    (node) => !node.parentId && !node.data.blockInstanceV2 && !node.data.blockProjectionOwnerId,
  );
  const scopeIds = new Set(scope.map((node) => node.id));
  const owner = scope.find((node) => node.id === ownerId)!;
  const category = workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '');
  if (!['Image', 'Audio'].includes(category)) return [];
  if (
    category === 'Audio' &&
    kind !== 'output' &&
    !(
      kind === 'setup' &&
      nodeKey(owner) === 'modules.DiffusersAudio.LoadPipeline' &&
      owner.data.params.pipeline?.type === 'audio_diffusion_pipeline'
    )
  )
    return [];
  if (kind === 'setup') {
    if (operationAuthoring(owner)?.operation.decomposition === 'integrated') return [];
    const members = new Set([ownerId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of ordinary.filter((node) => SETUP_UTILITIES.has(nodeKey(node)) && !members.has(node.id))) {
        // Descriptor/configuration suppliers feed the loader; a whole-pipeline
        // adapter consumes its pipeline. Every edge must be a declared socket.
        const connected = graph.edges.some((edge) => {
          if (!(
            (members.has(edge.target) && edge.source === node.id) ||
            (members.has(edge.source) && edge.target === node.id)
          ))
            return false;
          const source = graph.nodes.find((n) => n.id === edge.source)?.data.params[edge.sourceHandle ?? ''];
          const target = graph.nodes.find((n) => n.id === edge.target)?.data.params[edge.targetHandle ?? ''];
          return (
            source?.display === 'output' &&
            Boolean(
              target &&
              (target.display === 'input' || target.isInput) &&
              connectionTypesAreCompatible(source.type, target.type),
            )
          );
        });
        if (connected) {
          members.add(node.id);
          changed = true;
        }
      }
    }
    // A descriptor/configuration output shared outside this setup stays external.
    // Prune backwards as well: an earlier adapter feeding that shared supplier
    // must not be swallowed by the loader's visual wrapper.
    changed = true;
    while (changed) {
      changed = false;
      for (const id of [...members].filter((id) => id !== ownerId)) {
        const node = ordinary.find((node) => node.id === id)!;
        const directAdapter = ['modules.DiffusersImage.LoadAdapter', 'modules.DiffusersAudio.LoadAdapter'].includes(
          nodeKey(node),
        );
        if (
          graph.edges.some(
            (edge) => edge.source === id && !members.has(edge.target) && !(directAdapter && scopeIds.has(edge.target)),
          )
        ) {
          members.delete(id);
          changed = true;
        }
      }
    }
    return ordinary.filter((node) => members.has(node.id));
  }
  if (kind === 'output') {
    const decoders = scope.filter((node) => stageKind(node) === 'output');
    const members = new Set<string>();
    for (const decoder of decoders) {
      const media = category === 'Audio' ? 'audio' : 'image';
      const outputs = operationAuthoring(decoder)!.operation.ports.filter(
        (port) => port.direction === 'output' && port.types.includes(media),
      );
      const previews = ordinary.filter(
        (node) =>
          nodeKey(node) === (media === 'audio' ? 'modules.Audio.Export' : 'modules.Image.Preview') &&
          node.data.params.preview?.display === `ui_${media}` &&
          (media !== 'audio' ||
            (node.data.params.preview.dataSource === 'file' &&
              node.data.params.file?.display === 'output' &&
              node.data.params.file.type === 'audio')) &&
          graph.edges.filter((edge) => edge.target === node.id && edge.targetHandle === media).length === 1 &&
          graph.edges.some(
            (edge) =>
              edge.source === decoder.id &&
              outputs.some((port) => edge.sourceHandle === port.name) &&
              edge.target === node.id &&
              edge.targetHandle === media,
          ),
      );
      if (previews.length) {
        members.add(decoder.id);
        for (const preview of previews) members.add(preview.id);
      }
    }
    return ordinary.filter((node) => members.has(node.id));
  }
  if (category !== 'Image') return [];
  const task = operationAuthoring(owner)!.operation.task;
  if (!['inpaint', 'outpaint'].includes(task ?? '')) return [];
  const members = new Set<string>();
  for (const canvas of ordinary.filter((node) => nodeKey(node) === 'modules.DiffusersImage.OutpaintCanvas')) {
    const image = graph.edges.find(
      (edge) =>
        edge.source === canvas.id &&
        edge.sourceHandle === 'canvas' &&
        scopeIds.has(edge.target) &&
        edge.targetHandle === 'image',
    );
    const mask =
      image &&
      graph.edges.some(
        (edge) =>
          edge.source === canvas.id &&
          edge.sourceHandle === 'mask_image' &&
          edge.target === image.target &&
          edge.targetHandle === 'mask_image',
      );
    const source = graph.edges.find(
      (edge) => edge.target === canvas.id && edge.targetHandle === 'image' && edge.sourceHandle === 'image',
    );
    const loader =
      source && ordinary.find((node) => node.id === source.source && nodeKey(node) === 'modules.Image.Load');
    if (mask && loader) {
      members.add(canvas.id);
      members.add(loader.id);
    }
  }
  return ordinary.filter((node) => members.has(node.id));
}

export function availableOperationStageGroups(graph: OperationGraph, ownerId: string): VisualOperationGroup[] {
  const unpacked = unpackVisualOperationGroups(graph);
  const grouped = new Set([...unpacked.members.values()].flat());
  return (Object.keys(VISUAL_STAGE_LABELS) as VisualOperationGroup[]).filter((kind) => {
    const members = operationStageMembers(unpacked.graph, ownerId, kind);
    return members.length > 0 && members.every((node) => !grouped.has(node.id));
  });
}

/** Compose ordinary leaves into the existing V2 contract; no library write. */
export function groupVisualStages(
  graph: OperationGraph,
  memberIds: readonly string[],
  kind: VisualOperationGroup,
  previous?: CustomNodeType,
  options: {
    combineGuidance?: boolean;
    newDefinition?: boolean;
    implicitScalarControlNodeIds?: readonly string[];
  } = {},
): OperationGraph {
  const selected = new Set(memberIds);
  const members = graph.nodes.filter((node) => selected.has(node.id));
  if (!members.length) return graph;
  if (
    members.length !== selected.size ||
    members.some((node) => node.parentId || node.data.blockInstanceV2 || node.data.blockProjectionOwnerId)
  )
    throw new Error('Choose ordinary stage nodes from one model branch.');
  const implicitScalars = new Set(options.implicitScalarControlNodeIds ?? []);
  if (
    implicitScalars.size &&
    (kind !== 'inputs' ||
      [...implicitScalars].some(
        (id) => !selected.has(id) || operationAuthoring(members.find((node) => node.id === id)!)?.operation,
      ))
  )
    throw new Error('Implicit Inputs controls require explicitly adopted generic ordinary members.');
  const rootId = previous?.id ?? `visual-${nanoid()}`;
  const old = previous?.data.blockInstanceV2;
  if (old) {
    const customized =
      [...old.effectiveInterface.boundary.inputs, ...old.effectiveInterface.boundary.outputs].some(
        (port) => port.mirrorBindings?.length,
      ) || old.effectiveInterface.controls.some((control) => control.mirrorBindings?.length);
    if (customized)
      throw new Error(
        'This group has a mirrored custom interface. Ungroup its stages before changing the task; its bindings have not been changed.',
      );
  }
  const remap = (id: string) =>
    selected.has(id) ? (id.startsWith(`${rootId}/`) ? id.slice(rootId.length + 1) : `stage-${id}`) : id;
  const position = previous?.position ?? {
    x: Math.min(...members.map((node) => node.position.x)),
    y: Math.min(...members.map((node) => node.position.y)),
  };
  const bound = new Set(
    graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  const inputs: BlockPortV2[] = [],
    outputs: BlockPortV2[] = [],
    controls: BlockControlV2[] = [];
  const previews: BlockPreviewBindingV2[] = [];
  for (const node of members) {
    for (const [field, param] of Object.entries(node.data.params)) {
      const connected = graph.edges.some(
        (edge) =>
          (edge.source === node.id && edge.sourceHandle === field && !selected.has(edge.target)) ||
          (edge.target === node.id && edge.targetHandle === field && !selected.has(edge.source)),
      );
      if (['ui_image', 'ui_audio'].includes(param.display ?? '') && kind === 'output')
        previews.push({
          nodeId: remap(node.id),
          outputPortId: field,
          mediaType: param.display === 'ui_audio' ? 'audio' : 'image',
          ...(previews.length ? {} : { primary: true }),
        });
      if ((param.hidden && !connected) || param.display?.startsWith('ui_')) continue;
      const type = Array.isArray(param.type)
        ? param.type.join('|')
        : (param.type ?? (param.display === 'layerconfig' ? 'dict' : undefined));
      if (!type) continue;
      const id = `${remap(node.id)}:${field}`;
      // Ordinary fields may intentionally omit their visible label (for
      // example Image.Load.path). The explicit Block interface still needs a
      // non-empty name without changing the original leaf field.
      const label = (typeof param.label === 'string' && param.label.trim()) || field;
      if (
        param.display === 'output' ||
        (!bound.has(`${node.id}\0${field}`) && (param.display === 'input' || param.isInput || connected))
      ) {
        (param.display === 'output' ? outputs : inputs).push({
          portId: id,
          label,
          valueType: type,
          required: false,
          binding: { nodeId: remap(node.id), fieldOrPortId: field },
        });
      }
      if (
        (param.display ||
          (stageKind(node) === 'guidance' && !param.isInput) ||
          ((['setup', 'mask', 'output'].includes(kind) || implicitScalars.has(node.id)) &&
            (!param.isInput || hasInlineScalarControl(param)))) &&
        !['input', 'output'].includes(param.display ?? '') &&
        !param.signal &&
        !bound.has(`${node.id}\0${field}`)
      ) {
        if (
          (old?.presentation.removedControlBindings?.some((b) => b.nodeId === remap(node.id) && b.fieldId === field) ||
            (old?.effectiveGraph.nodes.some(
              (member) =>
                member.nodeId === remap(node.id) &&
                Boolean((member.data.params as Record<string, unknown> | undefined)?.[field]),
            ) &&
              old?.definitionSnapshot.controls.some(
                (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
              ))) &&
          !old?.effectiveInterface.controls.some(
            (c) => c.binding.nodeId === remap(node.id) && c.binding.fieldId === field,
          )
        )
          continue;
        const value = param.value ?? param.default;
        controls.push({
          controlId: id,
          label,
          valueType: type,
          order: controls.length,
          binding: { nodeId: remap(node.id), fieldId: field },
          ...(value === undefined ? {} : { defaultValue: JSON.parse(JSON.stringify(value)) }),
          group:
            stageKind(node) === 'inputs'
              ? operationAuthoring(node)?.operation.nodeType === 'text_encoder'
                ? 'Text'
                : 'Image'
              : stageKind(node) === 'guidance'
                ? 'Guidance'
                : node.data.label?.trim() || VISUAL_STAGE_LABELS[kind],
        });
      }
    }
  }
  const innerGraph = {
    nodes: members.map((node) => {
      const data = structuredClone(node.data);
      const hint = remapOperationAuthoring(data.operationAuthoring, remap);
      if (hint) data.operationAuthoring = hint;
      return {
        nodeId: remap(node.id),
        nodeType: node.type ?? 'custom',
        data: JSON.parse(JSON.stringify(data)) as BlockJsonObject,
      };
    }),
    edges: graph.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => ({
        edgeId: edge.id.startsWith(`${rootId}/`) ? edge.id.slice(rootId.length + 1) : `edge-${edge.id}`,
        sourceNodeId: remap(edge.source),
        sourcePortId: edge.sourceHandle!,
        targetNodeId: remap(edge.target),
        targetPortId: edge.targetHandle!,
      })),
  };
  const graphHash = blockGraphHashV2(innerGraph);
  if (old) {
    // Preserve configured labels and sealed controls when their exact bindings
    // survive. Connected wires are lowered to those same leaves before adapting.
    for (const direction of ['inputs', 'outputs'] as const) {
      const ports = direction === 'inputs' ? inputs : outputs;
      for (const port of ports) {
        const prior = old.effectiveInterface.boundary[direction].find(
          (candidate) =>
            candidate.binding.nodeId === port.binding.nodeId &&
            candidate.binding.fieldOrPortId === port.binding.fieldOrPortId,
        );
        if (prior) {
          port.label = prior.label;
          port.required = prior.required;
        }
      }
    }
    for (const control of controls) {
      const prior = old.effectiveInterface.controls.find(
        (candidate) =>
          candidate.binding.nodeId === control.binding.nodeId && candidate.binding.fieldId === control.binding.fieldId,
      );
      if (prior) {
        control.label = prior.label;
        if (prior.group) control.group = prior.group;
        if (prior.sealed) control.sealed = true;
      }
    }
  }
  const base: Omit<BlockDefinitionV2, 'contentHash'> = {
    schemaVersion: 2,
    definitionId: `definition-${rootId}`,
    displayName:
      old?.definitionSnapshot.displayName ??
      visualStagePresentation(
        kind,
        previews.length && previews.every((preview) => preview.mediaType === 'audio') ? 'audio' : null,
      ).label,
    source: {
      kind: 'user',
      provider: kind === 'inputs' && options.combineGuidance ? COMBINED_INPUT_PROVIDER : `${PROVIDER}${kind}`,
    },
    graph: { ...innerGraph, graphHash },
    boundary: { mode: 'explicit', inputs, outputs },
    controls,
    previews,
    ownership: { kind: 'user', definitionMutable: true },
    ...(options.newDefinition && old?.presentation.removedControlBindings
      ? { removedControlBindings: structuredClone(old.presentation.removedControlBindings) }
      : {}),
  };
  const definition = normalizeBlockDefinitionV2({ ...base, contentHash: blockDefinitionContentHashV2(base) });
  let instance = createBlockInstanceV2(definition, {
    instanceId: rootId,
    position,
    // Compact new text-only image encoders; preserve every existing/user size.
    // The renderer measures controls and grows safely when a route needs more.
    size: old?.presentation.size ?? {
      width: 400,
      height:
        kind === 'inputs'
          ? members.length === 1 &&
            operationAuthoring(members[0]!)?.operation.nodeType === 'text_encoder' &&
            workflowTaskCategory(operationAuthoring(members[0]!)?.operation.task ?? '') === 'Image'
            ? 400
            : 540
          : 420,
    },
    internalLayout: Object.fromEntries(
      members.map((node, index) => [
        remap(node.id),
        old?.presentation.internalLayout[remap(node.id)] ?? { x: 28 + index * 420, y: 110, width: 360, height: 460 },
      ]),
    ),
  });
  if (old && !options.newDefinition) {
    // The reusable definition is immutable. Adapt only this workflow's effective
    // graph/interface; current public values were materialized by unpack above.
    const adapted: typeof instance = {
      ...instance,
      definitionRef: old.definitionRef,
      definitionSnapshot: old.definitionSnapshot,
      effectiveInterface: {
        ...instance.effectiveInterface,
        baseInterfaceHash: old.effectiveInterface.baseInterfaceHash,
      },
      customization: {
        state: 'structure_changed',
        baseGraphHash: old.customization.baseGraphHash,
        effectiveGraphHash: graphHash,
      },
      previewStates: instance.previewStates.map(
        (preview) =>
          old.previewStates.find(
            (prior) =>
              prior.binding.nodeId === preview.binding.nodeId &&
              prior.binding.outputPortId === preview.binding.outputPortId &&
              prior.binding.mediaType === preview.binding.mediaType,
          ) ?? preview,
      ),
      presentation: {
        ...instance.presentation,
        expanded: old.presentation.expanded,
        ...(old.presentation.removedControlBindings
          ? { removedControlBindings: structuredClone(old.presentation.removedControlBindings) }
          : {}),
      },
    };
    // A task return can recover the exact original graph and interface. Derive
    // the state from the retained snapshot before enforcing the V2 invariant.
    adapted.customization.state = parameterCustomizationState(adapted);
    instance = normalizeBlockInstanceV2(adapted);
  }
  const root = createBlockRootNodeV2(instance, { selected: previous?.selected });
  const endpoint = (id: string, handle: string | null | undefined) => `${remap(id)}:${handle}`;
  const result = {
    nodes: [...graph.nodes.filter((node) => !selected.has(node.id)), root],
    edges: graph.edges
      .filter((edge) => !(selected.has(edge.source) && selected.has(edge.target)))
      .map((edge) => ({
        ...edge,
        ...(selected.has(edge.source)
          ? { source: rootId, sourceHandle: endpoint(edge.source, edge.sourceHandle) }
          : {}),
        ...(selected.has(edge.target)
          ? { target: rootId, targetHandle: endpoint(edge.target, edge.targetHandle) }
          : {}),
      })),
  };
  // Shared-value relationships can cross visual groups. Keep their references
  // tied to the actual projected loader after changing its owning wrapper.
  const replacements = new Map(members.map((node) => [node.id, blockProjectionNodeIdV2(rootId, remap(node.id))]));
  return remapVisualGroupReferences(result, (id) => replacements.get(id) ?? id);
}

function remapVisualGroupReferences(graph: OperationGraph, remap: (id: string) => string): OperationGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const hint = remapOperationAuthoring(node.data.operationAuthoring, remap);
      const instance = node.data.blockInstanceV2;
      const data = { ...node.data, ...(hint ? { operationAuthoring: hint } : {}) };
      if (instance) {
        const effectiveGraph = {
          ...instance.effectiveGraph,
          nodes: instance.effectiveGraph.nodes.map((child) => {
            const hint = remapOperationAuthoring(child.data.operationAuthoring, remap);
            return hint
              ? { ...child, data: { ...child.data, operationAuthoring: JSON.parse(JSON.stringify(hint)) } }
              : child;
          }),
        };
        effectiveGraph.graphHash = blockGraphHashV2(effectiveGraph);
        if (effectiveGraph.graphHash !== instance.effectiveGraph.graphHash) {
          const next = {
            ...instance,
            effectiveGraph,
            customization: { ...instance.customization, effectiveGraphHash: effectiveGraph.graphHash },
          };
          next.customization.state = parameterCustomizationState(next);
          data.blockInstanceV2 = normalizeBlockInstanceV2(next);
        }
      }
      return { ...node, data };
    }),
  };
}

export function groupOperationStages(
  graph: OperationGraph,
  ownerId: string,
  kinds: VisualOperationGroup[] = ['inputs', 'guidance'],
  combineGuidance = false,
) {
  const unpacked = unpackVisualOperationGroups(graph);
  const grouped = new Set([...unpacked.members.values()].flat());
  let next = graph;
  for (const kind of kinds) {
    const members = operationStageMembers(unpacked.graph, ownerId, kind, combineGuidance);
    if (members.some((node) => grouped.has(node.id))) continue;
    if (members.length) {
      next = groupVisualStages(
        next,
        members.map((node) => node.id),
        kind,
        undefined,
        { combineGuidance: kind === 'inputs' && combineGuidance },
      );
    }
  }
  return next;
}

export function groupNewOperationGraph(graph: OperationGraph) {
  let next = graph;
  for (const owner of graph.nodes.filter((node) => operationOwnsModel(operationAuthoring(node)?.operation)))
    next =
      workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '') === 'Image'
        ? groupOperationStages(next, owner.id, ['inputs', 'setup', 'output'], true)
        : workflowTaskCategory(operationAuthoring(owner)?.operation.task ?? '') === 'Audio'
          ? groupOperationStages(next, owner.id, ['inputs', 'guidance', 'setup', 'output'])
          : groupOperationStages(next, owner.id);
  // Fresh groups have no saved reusable baseline yet. Bind that baseline to the
  // completed ordinary graph, after all cross-group owner references are known.
  const existing = new Set(graph.nodes.map((node) => node.id));
  next = {
    ...next,
    nodes: next.nodes.map((node) => {
      if (existing.has(node.id) || !visualOperationGroup(node)) return node;
      const instance = node.data.blockInstanceV2!;
      const base = { ...instance.definitionSnapshot, graph: instance.effectiveGraph };
      const definition = normalizeBlockDefinitionV2({ ...base, contentHash: blockDefinitionContentHashV2(base) });
      const fresh = createBlockInstanceV2(definition, { ...instance.presentation, instanceId: instance.instanceId });
      fresh.previewStates = instance.previewStates;
      return createBlockRootNodeV2(fresh, { selected: node.selected });
    }),
  };
  return next;
}

/** Planner adapter only: flatten the same effective graph, apply, then retain its presentation. */
export function restoreVisualOperationGroups(
  next: OperationGraph,
  unpacked: ReturnType<typeof unpackVisualOperationGroups>,
  replacements: Record<string, string> = {},
) {
  // Keep replacement runtime identities: a different pipeline must not reuse
  // a Python encoder instance merely to retain a visual wrapper's identity.
  let graph = next;
  for (const root of unpacked.roots) {
    for (const control of root.data.blockInstanceV2!.effectiveInterface.controls.filter((control) => control.sealed)) {
      const id = `${root.id}/${control.binding.nodeId}`;
      const before = unpacked.graph.nodes.find((node) => node.id === id)?.data.params[control.binding.fieldId];
      const after = next.nodes.find((node) => node.id === (replacements[id] ?? id))?.data.params[
        control.binding.fieldId
      ];
      if (
        !after ||
        canonicalBlockStringifyV2(before?.value ?? before?.default) !==
          canonicalBlockStringifyV2(after.value ?? after.default)
      )
        throw new Error(
          `The sealed ${control.label} control would change. Separate these stages or configure their interface before adapting the model or task. Nothing changed.`,
        );
    }
    const previousMembers = unpacked.members.get(root.id)!;
    const retained = previousMembers
      .map((id) => replacements[id] ?? id)
      .filter((id) => graph.nodes.some((node) => node.id === id));
    const kind = visualOperationGroup(root)!;
    const previousOwner = unpacked.graph.nodes.find(
      (node) =>
        operationOwnsModel(operationAuthoring(node)?.operation) &&
        operationScope(unpacked.graph, node.id).some((member) => previousMembers.includes(member.id)),
    );
    const owner =
      previousOwner && next.nodes.find((node) => node.id === (replacements[previousOwner.id] ?? previousOwner.id));
    const combined =
      kind === 'inputs' &&
      (root.data.blockInstanceV2!.definitionSnapshot.source.provider === COMBINED_INPUT_PROVIDER ||
        unpacked.graph.nodes.some((node) => previousMembers.includes(node.id) && stageKind(node) === 'guidance'));
    const added = owner ? operationStageMembers(next, owner.id, kind, combined).map((node) => node.id) : [];
    graph = groupVisualStages(graph, [...new Set([...retained, ...added])], kind, root);
  }
  return graph;
}

export function visualGroupOwners(graph: OperationGraph, groupId: string) {
  const unpacked = unpackVisualOperationGroups(graph);
  const members = unpacked.members.get(groupId) ?? [];
  return unpacked.graph.nodes.filter(
    (node) =>
      operationOwnsModel(operationAuthoring(node)?.operation) &&
      operationScope(unpacked.graph, node.id).some((member) => members.includes(member.id)),
  );
}

/** Explicit presentation conversion. Existing saved definitions stay untouched;
 * this workflow receives a new combined definition containing the same leaves. */
export function combineOperationInputStages(graph: OperationGraph, ownerId: string): OperationGraph {
  const unpacked = unpackVisualOperationGroups(graph);
  const members = operationStageMembers(unpacked.graph, ownerId, 'inputs', true);
  if (!members.some((node) => stageKind(node) === 'inputs') || !members.some((node) => stageKind(node) === 'guidance'))
    throw new Error('This branch has no separate encoding and Guidance stages to combine.');
  const selected = new Set(members.map((node) => node.id));
  const priorRoots = unpacked.roots.filter((root) => unpacked.members.get(root.id)!.some((id) => selected.has(id)));
  if (
    priorRoots.some(
      (root) =>
        !['inputs', 'guidance'].includes(visualOperationGroup(root)!) ||
        unpacked.members.get(root.id)!.some((id) => !selected.has(id)),
    )
  )
    throw new Error('These stages have additional grouped members. Separate them before combining.');
  if (
    priorRoots.length === 1 &&
    priorRoots[0]!.data.blockInstanceV2!.definitionSnapshot.source.provider === COMBINED_INPUT_PROVIDER
  )
    throw new Error('Encoding and Guidance are already combined.');
  if (
    priorRoots.some((root) => {
      const surface = root.data.blockInstanceV2!.effectiveInterface;
      return [...surface.boundary.inputs, ...surface.boundary.outputs, ...surface.controls].some(
        (field) => field.mirrorBindings?.length,
      );
    })
  )
    throw new Error('These stages have mirrored custom bindings. Separate them before combining. Nothing changed.');
  const previous = priorRoots.find((root) => visualOperationGroup(root) === 'inputs') ?? priorRoots[0];
  const rootId = previous?.id ?? `visual-${nanoid()}`;
  const semantic = (flatId: string) =>
    flatId.startsWith(`${rootId}/`) ? flatId.slice(rootId.length + 1) : `stage-${flatId}`;
  let baseline = previous;
  if (previous) {
    const old = previous.data.blockInstanceV2!;
    const controls = priorRoots.flatMap((root) =>
      root.data.blockInstanceV2!.effectiveInterface.controls.map((control) => ({
        ...control,
        binding: { ...control.binding, nodeId: semantic(`${root.id}/${control.binding.nodeId}`) },
      })),
    );
    const ports = (direction: 'inputs' | 'outputs') =>
      priorRoots.flatMap((root) =>
        root.data.blockInstanceV2!.effectiveInterface.boundary[direction].map((port) => ({
          ...port,
          binding: { ...port.binding, nodeId: semantic(`${root.id}/${port.binding.nodeId}`) },
        })),
      );
    const boundary = { mode: old.effectiveInterface.boundary.mode, inputs: ports('inputs'), outputs: ports('outputs') };
    const removed = priorRoots.flatMap((root) => {
      const instance = root.data.blockInstanceV2!;
      const removed = [
        ...(instance.presentation.removedControlBindings ?? []),
        ...instance.definitionSnapshot.controls
          .filter(
            (control) =>
              !instance.effectiveInterface.controls.some(
                (current) =>
                  current.binding.nodeId === control.binding.nodeId &&
                  current.binding.fieldId === control.binding.fieldId,
              ),
          )
          .map((control) => control.binding),
      ];
      return removed.map((binding) => ({ ...binding, nodeId: semantic(`${root.id}/${binding.nodeId}`) }));
    });
    const removedControlBindings = [
      ...new Map(removed.map((binding) => [`${binding.nodeId}\0${binding.fieldId}`, binding])).values(),
    ];
    // This temporary preservation surface is read by groupVisualStages only;
    // it never replaces or mutates the old immutable definition snapshot.
    baseline = {
      ...previous,
      data: {
        ...previous.data,
        blockInstanceV2: {
          ...old,
          effectiveInterface: { ...old.effectiveInterface, controls, boundary },
          presentation: { ...old.presentation, removedControlBindings },
        },
      },
    };
  }
  let next = groupVisualStages(unpacked.graph, [...selected], 'inputs', baseline, {
    combineGuidance: true,
    newDefinition: true,
  });
  next = restoreVisualOperationGroups(next, {
    ...unpacked,
    roots: unpacked.roots.filter((root) => !priorRoots.includes(root)),
  });
  return next;
}
