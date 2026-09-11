import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import type { UserBlockDefinition } from './types';
import type { HuggingFaceClusterExecutionSkeleton } from './huggingFaceClusterMaterializer';
import type {
  HuggingFaceNodeLibraryDefinition,
  HuggingFaceNodeLibraryExecutionAdmission,
} from './huggingFaceNodeLibrary';
import { createUserBlockFromSelection, createUserBlockNode } from './userBlocks';

type FlowGraph = {
  nodes: CustomNodeType[];
  edges: Edge[];
};

export type HuggingFaceClusterUserNodeFork = {
  block: UserBlockDefinition;
  blockNode: CustomNodeType;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ordinaryForkParam(param: CustomNodeType['data']['params'][string]) {
  const cloned = cloneJson(param);
  const options = isRecord(cloned.fieldOptions) ? { ...cloned.fieldOptions } : undefined;
  const binding = isRecord(options?.huggingFaceClusterBinding) ? options.huggingFaceClusterBinding : undefined;
  if (options) delete options.huggingFaceClusterBinding;
  return {
    ...cloned,
    ...(binding?.persistence === 'sealed' ? { disabled: false } : {}),
    fieldOptions: options && Object.keys(options).length > 0 ? options : undefined,
  };
}

function forkSourceId(id: string, instanceId: string) {
  const prefix = `${instanceId}__`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export function ordinaryForkNode(node: CustomNodeType, instanceId: string): CustomNodeType {
  const cloned = cloneJson(node);
  cloned.id = forkSourceId(cloned.id, instanceId);
  delete cloned.measured;
  delete cloned.hidden;
  delete cloned.parentId;
  delete cloned.extent;
  delete cloned.expandParent;
  delete cloned.data.huggingFaceClusterRole;
  delete cloned.data.huggingFaceClusterInstance;
  delete cloned.data.huggingFaceClusterInstanceId;
  delete cloned.data.huggingFaceClusterPath;
  delete cloned.data.huggingFaceClusterSemanticId;
  delete cloned.data.huggingFaceClusterParameterPath;
  delete cloned.data.huggingFaceClusterKind;
  delete cloned.data.huggingFaceClusterImplicit;
  delete cloned.data.huggingFaceClusterHasParameters;
  delete cloned.data.huggingFaceClusterPathExpanded;
  delete cloned.data.huggingFaceClusterConditionalRole;
  delete cloned.data.huggingFaceClusterConditionalStatus;
  delete cloned.data.huggingFaceClusterSelectedBlockName;
  delete cloned.data.huggingFaceClusterTriggerInputs;
  delete cloned.data.huggingFaceClusterExecutionAdmissionId;
  delete cloned.data.huggingFaceClusterExecutionSpecId;
  delete cloned.data.huggingFaceClusterExecutionRole;
  delete cloned.data.huggingFaceClusterExecutionPosition;
  cloned.selected = true;
  cloned.dragging = false;
  cloned.data.params = Object.fromEntries(
    Object.entries(cloned.data.params).map(([field, param]) => [field, ordinaryForkParam(param)]),
  );
  cloned.data.uiState = {
    ...cloned.data.uiState,
    disabled: false,
    validationSeverity: undefined,
    validationMessage: undefined,
  };
  return cloned;
}

/**
 * Convert one exact, finalized Cluster execution skeleton into a user-owned
 * snapshot. The ordinary nodes keep all resolved values and pinned artifact
 * revisions, but Cluster admission authority and immutable ownership are
 * deliberately removed.
 */
export function createHuggingFaceClusterUserNodeFork({
  graph,
  instanceId,
  definition,
  admission,
  skeleton,
  existingBlocks = [],
  name,
}: {
  graph: FlowGraph;
  instanceId: string;
  definition: HuggingFaceNodeLibraryDefinition;
  admission: HuggingFaceNodeLibraryExecutionAdmission;
  skeleton: HuggingFaceClusterExecutionSkeleton;
  existingBlocks?: UserBlockDefinition[];
  name?: string;
}): HuggingFaceClusterUserNodeFork {
  const root = graph.nodes.find((node) => node.id === instanceId && node.data.huggingFaceClusterRole === 'root');
  if (!root) throw new Error(`Hugging Face Cluster Node ${instanceId} was not found.`);
  if (
    skeleton.definitionId !== definition.id ||
    skeleton.instanceId !== instanceId ||
    skeleton.admissionId !== admission.id ||
    !skeleton.bindingsComplete ||
    skeleton.missingBindingSources.length > 0 ||
    skeleton.pendingFields.length > 0
  ) {
    throw new Error('The exact Cluster execution graph must be finalized before it can be forked.');
  }
  if (
    skeleton.nodes.some(
      (node) =>
        node.data.huggingFaceClusterRole !== 'execution' || node.data.huggingFaceClusterInstanceId !== instanceId,
    )
  ) {
    throw new Error('The Cluster execution graph has stale ownership.');
  }

  const selectedGraph = {
    nodes: skeleton.nodes.map((node) => ordinaryForkNode(node, instanceId)),
    edges: skeleton.edges.map((edge) => ({
      ...cloneJson(edge),
      id: forkSourceId(edge.id, instanceId),
      source: forkSourceId(edge.source, instanceId),
      target: forkSourceId(edge.target, instanceId),
      hidden: false,
    })),
  };
  const created = createUserBlockFromSelection(
    selectedGraph,
    name?.trim() || root.data.label || definition.label,
    existingBlocks,
  );
  if (!created.ok) throw new Error(`Could not fork the Cluster as a User Node: ${created.reason}`);
  const importedAt = Date.now();
  const block: UserBlockDefinition = {
    ...created.block,
    origin: {
      schemaVersion: 1,
      kind: 'hugging_face_cluster_fork',
      provider: definition.provider,
      definitionId: definition.id,
      libraryRevision: definition.libraryRevision,
      contentHash: definition.contentHash,
      pipelineClass: definition.pipelineClass,
      workflowId: definition.workflowId,
      rootBlockDefinitionId: definition.rootBlockDefinitionId,
      blockContractHash: definition.blockContractHash,
      compositionKind: 'modiff_graph_snapshot',
      admissionId: admission.id,
      repo: admission.artifact?.repo,
      revision: admission.artifact?.revision,
      importedAt,
    },
    updatedAt: importedAt,
  };
  return {
    block,
    blockNode: createUserBlockNode(block, root.position, root.id),
  };
}

export function replaceHuggingFaceClusterWithUserNode(
  graph: FlowGraph,
  instanceId: string,
  blockNode: CustomNodeType,
): FlowGraph {
  const removedIds = new Set(
    graph.nodes
      .filter((node) => node.id === instanceId || node.data.huggingFaceClusterInstanceId === instanceId)
      .map((node) => node.id),
  );
  return {
    nodes: [
      ...graph.nodes.filter((node) => !removedIds.has(node.id)).map((node) => ({ ...node, selected: false })),
      blockNode,
    ],
    edges: graph.edges.filter((edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)),
  };
}
