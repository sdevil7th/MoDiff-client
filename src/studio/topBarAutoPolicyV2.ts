import type { Edge } from '@xyflow/react';

import { withoutBlockCompilationTransientsV2, type CustomNodeType } from '../stores/useFlowStore';
import {
  inspectRegisteredBlockAutoEligibilityV2,
  type RegisteredBlockAutoEligibilityV2,
} from './blockAutoEligibilityV2';

export type TopBarAutoPolicyV2 = Readonly<{
  graph: Readonly<{
    nodes: CustomNodeType[];
    edges: Edge[];
  }>;
  customGraphActive: boolean;
  registeredBlockEligibility: RegisteredBlockAutoEligibilityV2;
  autoUnavailable: boolean;
}>;

/**
 * Derive the graph eligible for automatic resource planning, independently of editing mode.
 *
 * Registered Block compilation temporarily attaches a hidden, disabled graph
 * so backend-owned dynamic fields can publish into an isolated witness. That
 * graph is neither the user's workflow nor an executable Block instance. It
 * must therefore be invisible to TopBar policy just as it is invisible to
 * persistence, export, run readiness, and execution.
 */
export function resolveTopBarAutoPolicyV2(input: {
  workflowCanvasHydrated: boolean;
  graphBindingPresent: boolean;
  graphBindingDiverged: boolean;
  templateGraphBuilding?: boolean;
  nodes: CustomNodeType[];
  edges: Edge[];
}): TopBarAutoPolicyV2 {
  const graph = withoutBlockCompilationTransientsV2(input.nodes, input.edges);
  const customGraphActive =
    input.workflowCanvasHydrated &&
    !input.templateGraphBuilding &&
    graph.nodes.length > 0 &&
    (!input.graphBindingPresent || input.graphBindingDiverged);
  const registeredBlockEligibility = inspectRegisteredBlockAutoEligibilityV2(graph.nodes, graph.edges);
  return {
    graph,
    customGraphActive,
    registeredBlockEligibility,
    // Graph topology is no longer an Auto blocker. The backend checks the
    // concrete exported scope and each model's resource contract at Run.
    autoUnavailable: customGraphActive && registeredBlockEligibility.code === 'malformed_graph',
  };
}
