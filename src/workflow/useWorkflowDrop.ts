import { type Edge, type Viewport } from '@xyflow/react';
import { useCallback } from 'react';
import { nanoid } from 'nanoid';

import config from '../../app.config';
import { useStudioStore } from '../stores/useStudioStore';
import type { NodeData } from '../stores/useNodeStore';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import type { WorkflowTab, WorkflowTabSnapshot } from '../studio/types';
import { enqueueSnackbar } from '../ui/snackbar';
import { workflowSnapshotFromGraph } from '../studio/workflowInference';
import { createNodeFromRegistry } from './nodeFactory';
import {
  createUserBlockNode,
  expandedUserBlockAtPosition,
  placeNodeInsideExpandedUserBlock,
  USER_BLOCK_DRAG_PREFIX,
} from '../studio/userBlocks';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { formatRequestError, requestJson, RequestError } from '../utils/requestJson';
import { isRecord } from '../studio/outputContracts';
import { parseWorkflowPackage } from '../studio/workflowPackage';
import { expandedHuggingFaceClusterAtPosition } from '../studio/huggingFaceClusterGraph';
import { customizeHuggingFaceClusterInstance } from '../studio/huggingFaceClusterCustomization';
import { useHuggingFaceNodeLibraryStore } from '../stores/useHuggingFaceNodeLibraryStore';
import { useHuggingFaceModularConditionalStore } from '../stores/useHuggingFaceModularConditionalStore';
import {
  buildHuggingFaceCatalogSections,
  huggingFaceCatalogEntryForPipeline,
  huggingFaceClusterDisplayLabel,
} from '../studio/huggingFaceNodeCatalog';
import { HUGGING_FACE_CLUSTER_DRAG_PREFIX } from '../studio/huggingFaceClusterDrag';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import { createBlockInstanceV2 } from '../studio/blockSchemaV2';
import { createBlockRootNodeV2 } from '../studio/blockRuntimeV2';
import { USER_BLOCK_V2_DRAG_PREFIX } from '../studio/blockPersistenceV2';
import {
  beginBlockInsertionFeedbackV2,
  cancelBlockInsertionFeedbackV2,
  completeBlockInsertionFeedbackV2,
} from '../studio/blockInsertionFeedbackV2';
import {
  createModularDiffusersCatalogFragmentV2,
  createModularDiffusersCatalogNode,
  HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX,
  modularDiffusersCatalogEntryHasDescendants,
} from '../studio/modularDiffusersBlockInsertion';

type ScreenToFlowPosition = (position: { x: number; y: number }) => { x: number; y: number };
type CreateWorkflowTab = (
  title?: string,
  snapshot?: WorkflowTabSnapshot,
  source?: WorkflowTab['source'],
  sourceLabel?: string,
) => string;

type WorkflowGraphDrop = {
  nodes: CustomNodeType[];
  edges: Edge[];
  viewport: Viewport;
  error?: string;
};

type UseWorkflowDropOptions = {
  addNode: (node: CustomNodeType) => void;
  createWorkflowTab: CreateWorkflowTab;
  edgeType: string;
  nodesRegistry: Record<string, NodeData>;
  screenToFlowPosition: ScreenToFlowPosition;
};

function showGraphImportError(message: string) {
  enqueueSnackbar(message, { variant: 'error', autoHideDuration: message.length * 80 });
}

function savedWorkflowSnapshot(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isRecord(value.studioForm)) {
    return null;
  }
  return value as unknown as WorkflowTabSnapshot;
}

export function useWorkflowDrop({
  addNode,
  createWorkflowTab,
  edgeType,
  nodesRegistry,
  screenToFlowPosition,
}: UseWorkflowDropOptions) {
  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      if (event.dataTransfer.files.length > 0) {
        const file = event.dataTransfer.files.item(0);
        if (!file || file.type !== 'application/json') {
          return;
        }

        const reader = new FileReader();
        reader.onload = (readerEvent) => {
          try {
            const value = JSON.parse(readerEvent.target?.result as string) as unknown;
            const workflowPackage = parseWorkflowPackage(value);
            const snapshot = savedWorkflowSnapshot(value) ?? workflowPackage?.snapshot;
            const title = workflowPackage?.title || file.name.replace(/\.json$/i, '') || 'Imported workflow';
            createWorkflowTab(
              title,
              snapshot ??
                workflowSnapshotFromGraph(value as WorkflowGraphDrop, edgeType, useStudioStore.getState().form),
              'import',
              file.name,
            );
            enqueueSnackbar('Workflow opened as a new tab', { variant: 'success', autoHideDuration: 2200 });
          } catch (error) {
            showGraphImportError(formatRequestError(error, 'Could not read the workflow JSON.'));
          }
        };
        reader.readAsText(file);
        return;
      }

      const data = event.dataTransfer.getData('text/plain');
      if (!data) {
        return;
      }

      if (data.endsWith('.json')) {
        const url = `${config.serverAddress}/file?file=${encodeURIComponent(data)}&t=${Date.now()}`;
        let graph: WorkflowGraphDrop;
        try {
          graph = await requestJson<WorkflowGraphDrop>(url, {
            parse: (value) => {
              if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('The workflow file is not a JSON object.');
              }
              const candidate = value as WorkflowGraphDrop;
              if (candidate.error) {
                throw new RequestError(candidate.error, { kind: 'application', url, payload: value });
              }
              return candidate;
            },
          });
        } catch (error) {
          showGraphImportError(`Error fetching graph file: ${formatRequestError(error, 'Request failed.')}`);
          return;
        }

        createWorkflowTab(
          data.split(/[\\/]/).pop() || 'Imported graph',
          workflowSnapshotFromGraph(graph, edgeType, useStudioStore.getState().form),
          'import',
          data,
        );
        enqueueSnackbar('Workflow opened as a new tab', { variant: 'success', autoHideDuration: 2200 });
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      if (data.startsWith(HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX)) {
        const entryId = data.slice(HUGGING_FACE_MODULAR_BLOCK_DRAG_PREFIX.length);
        const library = useHuggingFaceNodeLibraryStore.getState().library;
        const modularSnapshot = useHuggingFaceModularConditionalStore.getState().snapshot;
        const entry = library
          ? buildHuggingFaceCatalogSections(library, modularSnapshot)
              .flatMap(({ entries }) => entries)
              .find((candidate) => candidate.id === entryId && candidate.kind === 'block')
          : undefined;
        if (!library || !entry) {
          showGraphImportError('The exact Modular Diffusers block is no longer available. Reload the node catalog.');
          return;
        }
        try {
          prepareWorkflowForManualInsertion();
          const flow = useFlowStore.getState();
          const nodeById = new Map(flow.nodes.map((node) => [node.id, node]));
          const absolutePosition = (node: CustomNodeType) => {
            let x = node.position.x;
            let y = node.position.y;
            let parentId = node.parentId;
            const visited = new Set([node.id]);
            while (parentId) {
              if (visited.has(parentId)) break;
              visited.add(parentId);
              const parent = nodeById.get(parentId);
              if (!parent) break;
              x += parent.position.x;
              y += parent.position.y;
              parentId = parent.parentId;
            }
            return { x, y };
          };
          const target = flow.nodes
            .filter((node) => {
              if (node.data.blockInstanceV2?.presentation.expanded === true) return true;
              return (
                node.data.blockProjectionContainer === true && node.data.blockProjectionContainerExpanded !== false
              );
            })
            .filter((node) => {
              const width = node.measured?.width ?? node.width ?? 360;
              const height = node.measured?.height ?? node.height ?? 320;
              const origin = absolutePosition(node);
              return (
                position.x >= origin.x &&
                position.x <= origin.x + width &&
                position.y >= origin.y &&
                position.y <= origin.y + height
              );
            })
            .sort((left, right) => (right.data.blockProjectionDepth ?? -1) - (left.data.blockProjectionDepth ?? -1))[0];
          const owner = target
            ? flow.nodes.find((node) => node.id === (target.data.blockProjectionOwnerId ?? target.id))
            : undefined;
          const contextualEntry = huggingFaceCatalogEntryForPipeline(
            entry,
            owner?.data.blockInstanceV2?.definitionSnapshot.source.pipelineClass,
          );
          const modularNode = modularDiffusersCatalogEntryHasDescendants(contextualEntry, library, modularSnapshot)
            ? createModularDiffusersCatalogFragmentV2(
                contextualEntry,
                library,
                nodesRegistry,
                position,
                modularSnapshot,
              )
            : createModularDiffusersCatalogNode(contextualEntry, library, nodesRegistry, position, modularSnapshot);
          addNode(modularNode);
          if (target) {
            const ownerId = target.data.blockProjectionOwnerId ?? target.id;
            if (modularNode.data.blockInstanceV2) {
              flow.adoptBlockFragmentIntoBlockV2(modularNode.id, ownerId, target.data.blockProjectionNodeId);
            } else {
              flow.adoptNodeIntoBlockV2(modularNode.id, ownerId, target.data.blockProjectionNodeId);
            }
          }
        } catch (error) {
          showGraphImportError(formatRequestError(error, 'Could not add the Modular Diffusers block.'));
        }
        return;
      }

      if (data.startsWith(HUGGING_FACE_CLUSTER_DRAG_PREFIX)) {
        const definitionId = data.slice(HUGGING_FACE_CLUSTER_DRAG_PREFIX.length);
        const definition = useHuggingFaceNodeLibraryStore
          .getState()
          .library?.definitions.find((candidate) => candidate.id === definitionId);
        if (!definition) {
          showGraphImportError('The exact reviewed Cluster Node is no longer available. Reload the node catalog.');
          return;
        }
        const flow = useFlowStore.getState();
        if (
          expandedUserBlockAtPosition(flow.nodes, position) ||
          expandedHuggingFaceClusterAtPosition(flow.nodes, position)
        ) {
          enqueueSnackbar('Cluster Nodes and User Nodes cannot be nested. The Cluster Node was added top-level.', {
            variant: 'warning',
            autoHideDuration: 3000,
          });
        }
        prepareWorkflowForManualInsertion();
        const pendingId = beginBlockInsertionFeedbackV2(huggingFaceClusterDisplayLabel(definition), position);
        try {
          const { createHuggingFaceClusterForGraph } = await import('../studio/huggingFaceClusterInsertion');
          const cluster = await createHuggingFaceClusterForGraph(definition, position, useStudioStore.getState().form, {
            insert: false,
          });
          completeBlockInsertionFeedbackV2(pendingId, cluster);
        } catch (error) {
          showGraphImportError(formatRequestError(error, 'Could not add the Cluster Node.'));
        } finally {
          cancelBlockInsertionFeedbackV2(pendingId);
        }
        return;
      }

      if (data.startsWith(USER_BLOCK_V2_DRAG_PREFIX)) {
        const definitionId = data.slice(USER_BLOCK_V2_DRAG_PREFIX.length);
        const definition = useUserBlockStore
          .getState()
          .blockDefinitionsV2.find((item) => item.definitionId === definitionId);
        if (!definition) {
          showGraphImportError('Block V2 definition is no longer available.');
          return;
        }
        prepareWorkflowForManualInsertion();
        const flow = useFlowStore.getState();
        if (
          expandedUserBlockAtPosition(flow.nodes, position) ||
          expandedHuggingFaceClusterAtPosition(flow.nodes, position)
        ) {
          enqueueSnackbar('Cluster Nodes and User Nodes cannot be nested. The User Node was added top-level.', {
            variant: 'warning',
            autoHideDuration: 3000,
          });
        }
        addNode(
          createBlockRootNodeV2(
            createBlockInstanceV2(definition, {
              instanceId: `block-v2-${nanoid(16)}`,
              position,
              size: { width: 420, height: 480 },
            }),
          ),
        );
        return;
      }

      if (data.startsWith(USER_BLOCK_DRAG_PREFIX)) {
        const blockId = data.slice(USER_BLOCK_DRAG_PREFIX.length);
        const block = useUserBlockStore.getState().blocks.find((item) => item.id === blockId);
        if (!block) {
          showGraphImportError('Block is no longer available.');
          return;
        }
        prepareWorkflowForManualInsertion();
        const flow = useFlowStore.getState();
        if (
          expandedUserBlockAtPosition(flow.nodes, position) ||
          expandedHuggingFaceClusterAtPosition(flow.nodes, position)
        ) {
          enqueueSnackbar('Cluster Nodes and User Nodes cannot be nested. The User Node was added top-level.', {
            variant: 'warning',
            autoHideDuration: 3000,
          });
        }
        addNode(createUserBlockNode(block, position));
        return;
      }

      const newNode = createNodeFromRegistry(data, nodesRegistry, position);
      if (!newNode) {
        showGraphImportError(`Node ${data} not found. Reload the page to refresh the node list.`);
        return;
      }

      prepareWorkflowForManualInsertion();
      const flow = useFlowStore.getState();
      const expandedUserBlock = expandedUserBlockAtPosition(flow.nodes, position);
      const expandedCluster = expandedUserBlock ? null : expandedHuggingFaceClusterAtPosition(flow.nodes, position);
      if (expandedCluster) {
        flow.beginHistoryTransaction('Customize Cluster and add node');
        try {
          const customized = await customizeHuggingFaceClusterInstance(expandedCluster.id);
          const customizedFlow = useFlowStore.getState();
          customizedFlow.toggleUserBlockExpanded(customized.blockNodeId);
          const expandedCustomized = useFlowStore
            .getState()
            .nodes.find((node) => node.id === customized.blockNodeId && node.data.type === 'block');
          if (!expandedCustomized) throw new Error('The customized User Node could not be expanded.');
          addNode(placeNodeInsideExpandedUserBlock(newNode, expandedCustomized, position));
          globalThis.queueMicrotask(() => {
            useFlowStore.getState().fitUserBlockToChildren(customized.blockNodeId);
            useStudioStore.getState().saveActiveWorkflowTab(true);
          });
          enqueueSnackbar('Cluster customized as a User Node and the new node was added inside it.', {
            variant: 'success',
            autoHideDuration: 3000,
          });
        } catch (error) {
          showGraphImportError(formatRequestError(error, 'Could not customize the Cluster as a User Node.'));
        } finally {
          useFlowStore.getState().commitHistoryTransaction();
        }
        return;
      }
      addNode(expandedUserBlock ? placeNodeInsideExpandedUserBlock(newNode, expandedUserBlock, position) : newNode);
      if (expandedUserBlock) {
        globalThis.queueMicrotask(() => {
          useFlowStore.getState().fitUserBlockToChildren(expandedUserBlock.id);
          useStudioStore.getState().saveActiveWorkflowTab(true);
        });
      }
    },
    [screenToFlowPosition, addNode, nodesRegistry, edgeType, createWorkflowTab],
  );

  return {
    handleDragOver,
    handleDrop,
  };
}
