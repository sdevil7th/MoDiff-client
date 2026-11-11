import { createRoot } from 'react-dom/client';
import UIImageField from '../../../src/fields/UIImageField';
import { useFlowStore, type CustomNodeType } from '../../../src/stores/useFlowStore';
import { studioPreviewSlotKey, useStudioStore } from '../../../src/stores/useStudioStore';
import {
  blockPreviewViewsV2,
  blockProjectionNodeIdV2,
  setBlockPreviewStateV2,
} from '../../../src/studio/blockRuntimeV2';
import { prepareUserBlockCreationV2 } from '../../../src/studio/userBlockCreationV2';
import { createUserBlockFromSelection } from '../../../src/studio/userBlocks';
import type { StudioPreviewSlot } from '../../../src/studio/types';

const workflowTabId = 'v2-preview-workflow';
const taskId = 'v2-preview-task';
const urls = ['/preview-fixture/item-0.png', '/preview-fixture/item-1.png'];

function newRoot() {
  const leaf: CustomNodeType = {
    id: 'collection-leaf',
    type: 'custom',
    selected: true,
    position: { x: 0, y: 0 },
    data: {
      type: 'custom',
      module: 'modules.Image',
      action: 'Preview',
      label: 'Preview',
      params: {
        output: { type: 'image', display: 'output' },
        preview: { type: 'url', display: 'ui_image', dataSource: 'output' },
      },
    },
  };
  const draft = createUserBlockFromSelection({ nodes: [leaf], edges: [] }, 'Collection preview');
  if (!draft.ok) throw new Error(draft.reason);
  const prepared = prepareUserBlockCreationV2(draft, draft.block);
  const root = prepared.graph.nodes.find((node) => node.data.blockInstanceV2)!;
  const instance = root.data.blockInstanceV2!;
  return {
    ...root,
    data: {
      ...root.data,
      blockInstanceV2: setBlockPreviewStateV2(instance, instance.previewStates[0]!.binding, {
        taskId,
        mediaReference: urls[0],
        status: 'complete',
      }),
    },
  };
}

// eslint-disable-next-line react-refresh/only-export-components -- Isolated mounted-field regression entry point.
function PreviewProbe({ root, slot }: { root: CustomNodeType; slot: StudioPreviewSlot }) {
  const view = blockPreviewViewsV2(root.data.blockInstanceV2!)[0]!;
  const param = view.params[view.previewId]!;
  const setStatus = (status: StudioPreviewSlot['status']) =>
    useStudioStore.setState({
      previewSlots: {
        [studioPreviewSlotKey(slot.nodeId, slot.fieldKey, workflowTabId)]: { ...slot, status },
      },
    });
  return (
    <section data-testid="mounted-v2-preview">
      <button onClick={() => setStatus('ready')}>Ready preview</button>
      <button onClick={() => setStatus('pending')}>Pending preview</button>
      <button onClick={() => setStatus('failed')}>Failed preview</button>
      <button onClick={() => useStudioStore.setState({ activeWorkflowTabId: 'other-workflow' })}>Other workflow</button>
      <button onClick={() => useStudioStore.setState({ activeWorkflowTabId: workflowTabId })}>Current workflow</button>
      <UIImageField
        nodeId={root.id}
        fieldKey={view.previewId}
        label="Preview"
        display="ui_image"
        disabled={false}
        hidden={false}
        style={{}}
        value={param.value}
        default={undefined}
        options={[]}
        dataType="url"
        fieldType="ui_image"
        module="MoDiff"
        action="BlockV2Preview"
        fieldOptions={param.fieldOptions}
        artifacts={param.artifacts}
        updateStore={() => undefined}
      />
    </section>
  );
}

export function mountBlockPreviewProbe(savedRoot?: CustomNodeType) {
  const root = savedRoot ?? newRoot();
  const binding = root.data.blockInstanceV2!.previewStates[0]!.binding;
  const nodeId = blockProjectionNodeIdV2(root.id, binding.nodeId);
  const slot: StudioPreviewSlot = {
    schemaVersion: 1,
    workflowTabId,
    nodeId,
    fieldKey: binding.outputPortId,
    currentOutputId: 'v2-preview-output',
    status: 'ready',
    generation: 1,
    attemptIndex: 0,
    pendingClientRunId: null,
    pendingTaskId: null,
    updatedAt: 100,
  };
  useFlowStore.setState({ nodes: [root], edges: [] });
  useStudioStore.setState({
    activeWorkflowTabId: workflowTabId,
    outputs: [],
    previewSlots: {},
    previewStateRevision: 0,
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  createRoot(host).render(<PreviewProbe root={root} slot={slot} />);
  return {
    root,
    backend: {
      error: false,
      revision: 1,
      previewSlots: [slot],
      outputs: [
        {
          id: slot.currentOutputId,
          nodeId,
          fieldKey: binding.outputPortId,
          workflowTabId,
          taskId,
          attemptIndex: 0,
          value: urls,
          url: urls[0],
          displayType: 'image_collection',
          mediaItems: urls.map((url, index) => ({ index, url, displayType: 'image', taskId, attemptIndex: 0 })),
        },
      ],
    },
  };
}

export function hydrateBlockPreviewProbe() {
  return useStudioStore.getState().fetchBackendOutputs();
}
