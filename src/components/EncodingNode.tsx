import { lazy, memo, Suspense, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { BlockJsonValue } from '../studio/blockSchemaV2';
import { blockViewModelV2 } from '../studio/blockRuntimeV2';
import { encodingVisibleConnectors, isFocusedGuidance } from '../workflow/encodingNodePresentation';
import CustomNode from './CustomNode';
import { nodeConnectorParams } from '../studio/nodeConnectorResolution';
import { useNodesStore } from '../stores/useNodeStore';
import EncodingNodeControls from './EncodingNodeControls';
import GuidanceNodeControls from './GuidanceNodeControls';
import EncodingNodeMenu from './EncodingNodeMenu';
import NodeContent from './NodeContent';
import { ModiffButton } from '../ui';
import BlockInterfaceDialogV2 from './BlockInterfaceDialogV2';
import BlockSaveDialogV2 from './BlockSaveDialogV2';
import BlockCrossingPortsV2 from './BlockCrossingPortsV2';
import {
  visualOperationGroup,
  visualOperationGroupMedia,
  visualStagePresentation,
} from '../workflow/visualOperationGroupProjection';
const StageNodeControls = lazy(() => import('./StageNodeControls'));
const StageImplementationDialog = lazy(() => import('./StageImplementationDialog'));

/** Dedicated frontend node; the existing stage contract only binds values,
 * persistence and execution. An explicit edit opens the shared operation editor. */
const EncodingNode = memo((node: NodeProps<CustomNodeType>) => {
  const instance = node.data.blockInstanceV2!;
  const guidance = isFocusedGuidance(instance);
  const kind = visualOperationGroup({ ...node, position: instance.presentation.position })!;
  const { label } = visualStagePresentation(kind, visualOperationGroupMedia(node));
  const view = useMemo(() => blockViewModelV2(instance), [instance]);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [showPorts, setShowPorts] = useState(false);
  useNodesStore((state) => state.operationContracts);
  useNodesStore((state) => state.pipelineSupport);
  const edges = useFlowStore(
    useShallow((state) => state.edges.filter((edge) => edge.source === node.id || edge.target === node.id)),
  );
  const setValue = useFlowStore((state) => state.setBlockInstanceValueV2);
  const ensureProjection = useFlowStore((state) => state.ensureBlockProjectionV2);
  const allPorts = Object.fromEntries(
    Object.entries(nodeConnectorParams(node)).map(([id, param]) => [
      id,
      {
        ...param,
        isConnected: edges.some(
          (edge) =>
            (edge.source === node.id && edge.sourceHandle === id) ||
            (edge.target === node.id && edge.targetHandle === id),
        ),
      },
    ]),
  );
  const basicPorts = encodingVisibleConnectors(allPorts, instance);
  const extraPortCount = Object.keys(allPorts).length - Object.keys(basicPorts).length;
  const params = showPorts ? encodingVisibleConnectors(allPorts, instance, true) : basicPorts;
  const update = useCallback(
    (id: string, value: unknown, key?: keyof NodeParams) => {
      if (key === undefined || key === 'value') setValue(node.id, id, value as BlockJsonValue);
    },
    [node.id, setValue],
  );
  useLayoutEffect(() => {
    ensureProjection(node.id);
  }, [ensureProjection, node.id, instance.presentation.expanded]);

  return (
    <>
      <CustomNode
        {...node}
        surface={{
          testId: `${kind === 'inputs' ? 'encoding' : kind}-node-${node.id}`,
          hasAudioPreview: view.previewViews.some((preview) => preview.binding.mediaType === 'audio'),
          controls:
            kind === 'inputs' ? (
              <EncodingNodeControls instance={instance} updateStore={update} />
            ) : guidance ? (
              <GuidanceNodeControls instance={instance} />
            ) : (
              <Suspense
                fallback={
                  <p data-node-layout-pending role="status">
                    Loading stage controls…
                  </p>
                }
              >
                <StageNodeControls node={{ ...node, position: view.position }} edges={edges} updateStore={update} />
              </Suspense>
            ),
          actions: (
            <EncodingNodeMenu
              node={{ ...node, position: view.position }}
              inspect={() => requestAnimationFrame(() => setInspectOpen(true))}
              save={() => requestAnimationFrame(() => setSaveOpen(true))}
              canSave
            />
          ),
          connectors: (
            <>
              <NodeContent
                nodeId={node.id}
                params={params}
                updateStore={update}
                module={node.data.module}
                action={node.data.action}
                mode="connectors"
              />
              <BlockCrossingPortsV2 nodeId={node.id} />
              {extraPortCount > 0 ? (
                <ModiffButton
                  className="nodrag nowheel"
                  aria-expanded={showPorts}
                  onClick={() => setShowPorts(!showPorts)}
                >
                  {showPorts ? 'Hide' : 'Show'} implementation ports ({extraPortCount})
                </ModiffButton>
              ) : null}
            </>
          ),
          setSize: (width, height) =>
            useFlowStore.getState().setBlockPresentationV2(node.id, { size: { width, height } }),
        }}
      />
      {inspectOpen ? (
        <Suspense fallback={null}>
          <StageImplementationDialog
            label={label}
            instance={instance}
            onClose={() => setInspectOpen(false)}
            onConfigure={() => {
              setInspectOpen(false);
              setInterfaceOpen(true);
            }}
          />
        </Suspense>
      ) : null}
      {interfaceOpen ? <BlockInterfaceDialogV2 nodeId={node.id} onClose={() => setInterfaceOpen(false)} /> : null}
      {saveOpen ? <BlockSaveDialogV2 nodeId={node.id} onClose={() => setSaveOpen(false)} /> : null}
    </>
  );
});
EncodingNode.displayName = 'EncodingNode';
export default EncodingNode;
