import { lazy, Suspense } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { CustomNodeFrame, CustomNodeHeaderFrame } from '../ui';
import { blockConnectorParamsV2 } from '../studio/blockRuntimeV2';
import NodeContent from './NodeContent';

const EncodingNode = lazy(() => import('./EncodingNode'));

/** Load the encoding editor only when a workflow contains this node. */
export default function EncodingNodeRenderer(props: NodeProps<CustomNodeType>) {
  const ports = blockConnectorParamsV2(props.data.blockInstanceV2!);
  return (
    <Suspense
      fallback={
        <CustomNodeFrame id={props.id} minWidth={280} maxWidth={720}>
          <CustomNodeHeaderFrame>{props.data.label}</CustomNodeHeaderFrame>
          <p role="status" className="p-3 text-sm text-modiff-subtle-text">
            Loading node controls…
          </p>
          <NodeContent
            nodeId={props.id}
            params={{ ...ports.inputs, ...ports.outputs }}
            module="MoDiff"
            action="Encoding"
            mode="connectors"
            updateStore={() => undefined}
          />
        </CustomNodeFrame>
      }
    >
      <EncodingNode {...props} />
    </Suspense>
  );
}
