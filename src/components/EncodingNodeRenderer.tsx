import { lazy, Suspense } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { visualNodeTitle } from '../studio/visualNodeCatalog';
import { CustomNodeFrame, CustomNodeHeaderFrame } from '../ui';
import { nodeConnectorParams } from '../studio/nodeConnectorResolution';
import NodeContent from './NodeContent';

const EncodingNode = lazy(() => import('./EncodingNode'));

/** Load the encoding editor only when a workflow contains this node. */
export default function EncodingNodeRenderer(props: NodeProps<CustomNodeType>) {
  const ports = nodeConnectorParams(props);
  const catalog = useNodesStore((state) => state.visualNodeCatalog);
  return (
    <Suspense
      fallback={
        <CustomNodeFrame id={props.id} minWidth={280} maxWidth={720}>
          <CustomNodeHeaderFrame>{visualNodeTitle(catalog, props.data)}</CustomNodeHeaderFrame>
          <p role="status" className="p-3 text-sm text-modiff-subtle-text">
            Loading node controls…
          </p>
          <NodeContent
            nodeId={props.id}
            params={ports}
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
