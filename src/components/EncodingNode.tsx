import { memo, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { BlockJsonValue } from '../studio/blockSchemaV2';
import { blockOperationGraphV2, blockViewModelV2 } from '../studio/blockRuntimeV2';
import { ModiffButton, ModiffDialog } from '../ui';
import { encodingVisibleConnectors, isFocusedGuidance } from '../workflow/encodingNodePresentation';
import CustomNode from './CustomNode';
import { nodeConnectorParams } from '../studio/nodeConnectorResolution';
import { useNodesStore } from '../stores/useNodeStore';
import EncodingNodeControls from './EncodingNodeControls';
import GuidanceNodeControls from './GuidanceNodeControls';
import EncodingNodeMenu from './EncodingNodeMenu';
import NodeContent from './NodeContent';
import NodeInspectionDetails from './NodeInspectionDetails';
import BlockInterfaceDialogV2 from './BlockInterfaceDialogV2';
import BlockSaveDialogV2 from './BlockSaveDialogV2';
import BlockCrossingPortsV2 from './BlockCrossingPortsV2';

/** Dedicated frontend node; the existing stage contract only binds values,
 * persistence and execution. It never expands into a canvas container. */
const EncodingNode = memo((node: NodeProps<CustomNodeType>) => {
  const instance = node.data.blockInstanceV2!;
  const guidance = isFocusedGuidance(instance);
  const label = guidance ? 'Guidance' : 'Encode Inputs';
  const stagesLabel = guidance ? 'guidance' : 'encoding';
  const view = useMemo(() => blockViewModelV2(instance), [instance]);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  useNodesStore((state) => state.operationContracts);
  useNodesStore((state) => state.pipelineSupport);
  const edges = useFlowStore(
    useShallow((state) => state.edges.filter((edge) => edge.source === node.id || edge.target === node.id)),
  );
  const setValue = useFlowStore((state) => state.setBlockInstanceValueV2);
  const ensureProjection = useFlowStore((state) => state.ensureBlockProjectionV2);
  const params = encodingVisibleConnectors(
    Object.fromEntries(
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
    ),
    instance.effectiveInterface.boundary.outputs,
  );
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
          testId: `${guidance ? 'guidance' : 'encoding'}-node-${node.id}`,
          controls: guidance ? (
            <GuidanceNodeControls instance={instance} />
          ) : (
            <EncodingNodeControls instance={instance} updateStore={update} />
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
                module="MoDiff"
                action="Encoding"
                mode="connectors"
              />
              <BlockCrossingPortsV2 nodeId={node.id} />
            </>
          ),
          setSize: (width, height) =>
            useFlowStore.getState().setBlockPresentationV2(node.id, { size: { width, height } }),
        }}
      />
      {inspectOpen ? (
        <ModiffDialog
          open
          title={`${label} implementation`}
          onClose={() => setInspectOpen(false)}
          footer={
            <ModiffButton
              onClick={() => {
                setInspectOpen(false);
                setInterfaceOpen(true);
              }}
            >
              Configure inputs, outputs and controls
            </ModiffButton>
          }
        >
          <p className="mb-4 text-sm text-modiff-subtle-text">
            These stages execute behind this node. To edit their connections on the canvas, use Separate {stagesLabel}{' '}
            stages.
          </p>
          <div className="grid gap-4">
            {blockOperationGraphV2(instance).nodes.map((stage) => (
              <section key={stage.id}>
                <h3 className="mb-2 font-semibold">{stage.data.label}</h3>
                <NodeInspectionDetails node={stage} section="implementation" />
              </section>
            ))}
          </div>
        </ModiffDialog>
      ) : null}
      {interfaceOpen ? <BlockInterfaceDialogV2 nodeId={node.id} onClose={() => setInterfaceOpen(false)} /> : null}
      {saveOpen ? <BlockSaveDialogV2 nodeId={node.id} onClose={() => setSaveOpen(false)} /> : null}
    </>
  );
});
EncodingNode.displayName = 'EncodingNode';
export default EncodingNode;
