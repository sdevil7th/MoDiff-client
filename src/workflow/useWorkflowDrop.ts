import { type Edge, type Viewport } from '@xyflow/react';
import { useCallback } from 'react';

import config from '../../app.config';
import { useStudioStore } from '../stores/useStudioStore';
import type { NodeData } from '../stores/useNodeStore';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { WorkflowTab, WorkflowTabSnapshot } from '../studio/types';
import { enqueueSnackbar } from '../ui/snackbar';
import { workflowSnapshotFromGraph } from '../studio/workflowInference';
import { createNodeFromRegistry } from './nodeFactory';
import { createUserBlockNode, USER_BLOCK_DRAG_PREFIX } from '../studio/userBlocks';
import { useUserBlockStore } from '../stores/useUserBlockStore';
import { formatRequestError, requestJson, RequestError } from '../utils/requestJson';
import { isRecord } from '../studio/outputContracts';
import { parseWorkflowPackage } from '../studio/workflowPackage';

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

      if (data.startsWith(USER_BLOCK_DRAG_PREFIX)) {
        const blockId = data.slice(USER_BLOCK_DRAG_PREFIX.length);
        const block = useUserBlockStore.getState().blocks.find((item) => item.id === blockId);
        if (!block) {
          showGraphImportError('Block is no longer available.');
          return;
        }
        addNode(createUserBlockNode(block, position));
        return;
      }

      const newNode = createNodeFromRegistry(data, nodesRegistry, position);
      if (!newNode) {
        showGraphImportError(`Node ${data} not found. Reload the page to refresh the node list.`);
        return;
      }

      addNode(newNode);
    },
    [screenToFlowPosition, addNode, nodesRegistry, edgeType, createWorkflowTab],
  );

  return {
    handleDragOver,
    handleDrop,
  };
}
