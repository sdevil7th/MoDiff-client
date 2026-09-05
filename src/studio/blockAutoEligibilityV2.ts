import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { canonicalizePersistedBlockGraphV2, isBlockRootV2 } from './blockRuntimeV2';
import { normalizeBlockInstanceV2 } from './blockSchemaV2';
import { registeredBlockRunFormV2, registeredBlockV2RouteForInstance } from './blockRunFormV2';

export type RegisteredBlockAutoEligibilityV2 = Readonly<{
  eligible: boolean;
  code:
    | 'eligible'
    | 'no_registered_root'
    | 'multiple_registered_roots'
    | 'target_not_registered_root'
    | 'malformed_graph'
    | 'stale_registered_definition'
    | 'customized_structure'
    | 'customized_interface'
    | 'unsafe_companion';
  reason: string;
  rootId?: string;
}>;

const SAFE_COMPANIONS = new Set([
  'modules.Audio.Export',
  'modules.Audio.Load',
  'modules.Image.Load',
  'modules.Image.Preview',
  'modules.Primitive.DataViewer',
  'modules.Primitive.ExportData',
  'modules.Text.Display',
  'modules.Video.Export',
  'modules.Video.Load',
]);

function rejected(
  code: Exclude<RegisteredBlockAutoEligibilityV2['code'], 'eligible'>,
  reason: string,
  rootId?: string,
): RegisteredBlockAutoEligibilityV2 {
  return { eligible: false, code, reason, ...(rootId ? { rootId } : {}) };
}

function upstreamNodeIds(nodes: readonly CustomNodeType[], edges: readonly Edge[], targetNodeId: string) {
  const known = new Set(nodes.map(({ id }) => id));
  const included = new Set([targetNodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    edges.forEach((edge) => {
      if (!included.has(edge.target) || included.has(edge.source) || !known.has(edge.source)) return;
      included.add(edge.source);
      changed = true;
    });
  }
  return included;
}

function safeCompanion(node: CustomNodeType) {
  if (
    node.data.blockInstanceV2 ||
    node.data.userBlockSnapshot ||
    node.data.userBlockId ||
    node.data.huggingFaceClusterInstance ||
    node.data.huggingFaceClusterRole ||
    node.data.blockCompilationTransientV2
  ) {
    return false;
  }
  return SAFE_COMPANIONS.has(`${node.data.module ?? ''}.${node.data.action ?? ''}`);
}

/**
 * Narrow structural eligibility only. The backend planner remains the final
 * resource/runtime authority and issues the short-lived instance receipt.
 */
export function inspectRegisteredBlockAutoEligibilityV2(
  nodesValue: readonly CustomNodeType[],
  edgesValue: readonly Edge[],
  targetNodeId?: string,
): RegisteredBlockAutoEligibilityV2 {
  let nodes: CustomNodeType[];
  let edges: Edge[];
  try {
    const canonical = canonicalizePersistedBlockGraphV2([...nodesValue], [...edgesValue]);
    nodes = canonical.nodes;
    edges = canonical.edges;
  } catch (error) {
    return rejected(
      'malformed_graph',
      `Auto is unavailable because the Block projection is malformed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const allRoots = nodes.filter((node) => node.data.blockInstanceV2 !== undefined);
  let scope = new Set(nodes.map(({ id }) => id));
  let selected: CustomNodeType | undefined;
  if (targetNodeId) {
    scope = upstreamNodeIds(nodes, edges, targetNodeId);
    selected = nodes.find(({ id }) => id === targetNodeId && scope.has(id));
    if (!selected?.data.blockInstanceV2) {
      return rejected('target_not_registered_root', 'Select an exact registered Block root before using Auto.');
    }
    const scopedRoots = allRoots.filter(({ id }) => scope.has(id));
    if (scopedRoots.length !== 1 || scopedRoots[0]?.id !== selected.id) {
      return rejected(
        'multiple_registered_roots',
        'Auto cannot plan a target whose upstream execution slice contains another registered Block.',
        selected.id,
      );
    }
  } else {
    if (allRoots.length === 0) {
      return rejected('no_registered_root', 'Auto requires one exact registered Diffusers or Transformers Block.');
    }
    if (allRoots.length !== 1) {
      return rejected(
        'multiple_registered_roots',
        'Auto currently plans one registered Block at a time. Select a Block and run it explicitly, or use Expert.',
      );
    }
    selected = allRoots[0];
  }

  if (!selected || !isBlockRootV2(selected) || !selected.data.blockInstanceV2) {
    return rejected('malformed_graph', 'Auto requires one valid source-neutral Block V2 root.', selected?.id);
  }
  let instance;
  try {
    instance = normalizeBlockInstanceV2(selected.data.blockInstanceV2);
  } catch (error) {
    return rejected(
      'malformed_graph',
      `Auto cannot validate this Block: ${error instanceof Error ? error.message : String(error)}`,
      selected.id,
    );
  }
  const route = registeredBlockV2RouteForInstance(instance);
  if (
    !route ||
    route.compiledDefinitionContentHash !== instance.definitionSnapshot.contentHash ||
    !registeredBlockRunFormV2(instance, 'auto')
  ) {
    return rejected(
      'stale_registered_definition',
      'Auto requires the current exact registered Block definition. This historical or unregistered Block remains runnable in Expert.',
      selected.id,
    );
  }
  if (
    instance.customization.state === 'structure_changed' ||
    instance.effectiveGraph.graphHash !== instance.definitionSnapshot.graph.graphHash ||
    instance.customization.baseGraphHash !== instance.definitionSnapshot.graph.graphHash ||
    instance.customization.effectiveGraphHash !== instance.effectiveGraph.graphHash
  ) {
    return rejected(
      'customized_structure',
      'Auto is unavailable after internal nodes or links change. Run the concrete customized graph in Expert.',
      selected.id,
    );
  }
  if (instance.effectiveInterface.baseInterfaceHash !== instance.effectiveInterface.effectiveInterfaceHash) {
    return rejected(
      'customized_interface',
      'Auto is unavailable after public controls or ports change. Run the concrete customized graph in Expert.',
      selected.id,
    );
  }

  const unsafe = nodes.find((node) => scope.has(node.id) && node.id !== selected!.id && !safeCompanion(node));
  if (unsafe) {
    return rejected(
      'unsafe_companion',
      `Auto has not reviewed companion node ${unsafe.data.label ?? unsafe.id}. Use Expert for this graph.`,
      selected.id,
    );
  }
  return {
    eligible: true,
    code: 'eligible',
    reason: 'Auto can ask the backend planner to qualify this exact registered Block instance.',
    rootId: selected.id,
  };
}
