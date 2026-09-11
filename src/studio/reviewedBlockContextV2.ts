import type { BlockGraphNodeModularDiffusersV2, BlockGraphNodeV2, BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceModularConditionalSnapshot } from './huggingFaceModularConditionals';

export type ReviewedBlockContextIssueV2 = {
  code: 'component_missing' | 'component_type_conflict';
  component: string;
  requiredType: string;
  actualType: string | null;
};

/** Exact source authority plus component requirements, not original-tree membership. */
export function assessReviewedBlockContextV2(
  source: BlockGraphNodeModularDiffusersV2,
  destination: Pick<BlockGraphNodeModularDiffusersV2, 'pipelineClass' | 'libraryRevision'>,
  snapshot: HuggingFaceModularConditionalSnapshot | null,
): { status: 'compatible' | 'unresolved' | 'incompatible' | 'unreviewed'; issues: ReviewedBlockContextIssueV2[] } {
  if (source.libraryRevision !== destination.libraryRevision) return { status: 'unreviewed', issues: [] };
  if (source.pipelineClass === destination.pipelineClass) return { status: 'compatible', issues: [] };
  if (!snapshot || snapshot.diffusersRevision !== source.libraryRevision) return { status: 'unreviewed', issues: [] };
  const definition = snapshot.blockDefinitions.find(
    (block) => block.id === source.blockDefinitionId && block.contentHash === source.blockContractHash,
  );
  const pipeline = snapshot.pipelines.find((item) => item.pipelineClass === destination.pipelineClass);
  const root = snapshot.blockDefinitions.find((item) => item.id === pipeline?.rootBlockDefinitionId);
  if (!definition || !root) return { status: 'unreviewed', issues: [] };
  const available = new Map(root.components.map((component) => [component.name, component]));
  const issues: ReviewedBlockContextIssueV2[] = [];
  for (const component of definition.components) {
    const existing = available.get(component.name);
    if (!existing) {
      if (component.creationMethod !== 'from_config')
        issues.push({
          code: 'component_missing',
          component: component.name,
          requiredType: component.type,
          actualType: null,
        });
    } else if (existing.type !== component.type)
      issues.push({
        code: 'component_type_conflict',
        component: component.name,
        requiredType: component.type,
        actualType: existing.type,
      });
  }
  return {
    status: issues.some((issue) => issue.code === 'component_type_conflict')
      ? 'incompatible'
      : issues.length
        ? 'unresolved'
        : 'compatible',
    issues,
  };
}

export function reviewedBlockFitsContextV2(
  source: BlockGraphNodeModularDiffusersV2,
  destination: Pick<BlockGraphNodeModularDiffusersV2, 'pipelineClass' | 'libraryRevision'>,
  snapshot: HuggingFaceModularConditionalSnapshot | null,
) {
  const result = assessReviewedBlockContextV2(source, destination, snapshot);
  // Missing components can be supplied by the user; execution must validate the
  // actual bundle. Do not classify missing weights as an origin-label mismatch.
  return result.status === 'compatible' || result.status === 'unresolved';
}

/** A semantic-invalid draft is editable; exact authority remains mandatory. */
export function reviewedBlockCanBeAuthoredV2(
  source: BlockGraphNodeModularDiffusersV2,
  destination: Pick<BlockGraphNodeModularDiffusersV2, 'pipelineClass' | 'libraryRevision'>,
  snapshot: HuggingFaceModularConditionalSnapshot | null,
) {
  return assessReviewedBlockContextV2(source, destination, snapshot).status !== 'unreviewed';
}

/** Rebind execution context while retaining immutable catalog source metadata. */
export function bindReviewedNodeContextV2(
  node: BlockGraphNodeV2,
  destination: Pick<BlockGraphNodeModularDiffusersV2, 'pipelineClass' | 'workflowId'>,
) {
  const copy = structuredClone(node);
  const params = copy.data.params;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    for (const [key, value] of Object.entries({
      pipeline_class: destination.pipelineClass,
      workflow_id: destination.workflowId,
    })) {
      const field = params[key];
      if (value && field && typeof field === 'object' && !Array.isArray(field)) field.value = value;
    }
  }
  return copy;
}

/** A reused parent's provenance is not the enclosing workflow's execution context. */
export function reviewedDestinationContextV2(instance: BlockInstanceV2, fallback: BlockGraphNodeModularDiffusersV2) {
  const source = instance.definitionSnapshot.source;
  return {
    pipelineClass: source.pipelineClass ?? fallback.pipelineClass,
    workflowId: source.workflow ?? fallback.workflowId,
    libraryRevision: source.libraryRevision ?? fallback.libraryRevision,
  };
}

/** Declarations are advisory; execution checks the actual connected components. */
export function inspectReviewedComponentRequirementsV2(
  instance: BlockInstanceV2,
  snapshot: HuggingFaceModularConditionalSnapshot | null,
) {
  return instance.effectiveGraph.nodes.flatMap((node) => {
    const source = node.modularDiffusers;
    if (source?.kind !== 'upstream_block') return [];
    const assessment = assessReviewedBlockContextV2(source, reviewedDestinationContextV2(instance, source), snapshot);
    return assessment.issues.map((requirement) => ({
      nodeId: node.nodeId,
      component: requirement.component,
      message: `${node.data.label ?? source.blockClass}: requires ${requirement.component} (${requirement.requiredType}); the original destination declares ${requirement.actualType ?? 'no component'}.`,
    }));
  });
}
