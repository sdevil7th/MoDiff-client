// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { NodeProps } from '@xyflow/react';
import { memo, useCallback, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';
import { CustomNodeType, useFlowStore } from '../stores/useFlowStore';
import { NodeParams } from '../stores/useNodeStore';

import { dataTypeClass, normalizeDataType } from '../utils/dataTypeCategory';
import { sanitizeModiffNodeStyle } from '../theme';
import NodeContent from './NodeContent';

import { AnyNodeFrame, NodeResizeHandle } from '../ui';
import { useNodeLayoutSync } from '../utils/useNodeLayoutSync';
import { cx } from '../utils/classNames';

const AnyNode = memo((node: NodeProps<CustomNodeType>) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const style = sanitizeModiffNodeStyle(node.data.style, `${node.id}.node`);
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  useNodeLayoutSync(node.id, nodeRef);
  const validationSeverity = node.data.uiState?.validationSeverity;
  const validationMessage = node.data.uiState?.validationMessage || node.data.uiState?.errorMessage;
  const isError = validationSeverity === 'error';

  const handleOnChange = useCallback(
    (param: string, value: unknown, key?: keyof NodeParams) => {
      setParam(node.id, param, value, key);
    },
    [setParam, node.id],
  );

  return (
    <AnyNodeFrame
      ref={nodeRef}
      id={node.id}
      className={`${normalizeDataType(`${node.data.module}_${node.data.action}`)} ${dataTypeClass(node.data.category)} module-${normalizeDataType(node.data.module)}`}
      nodeStyle={style}
    >
      {validationMessage && (
        <span
          role="img"
          tabIndex={0}
          title={validationMessage}
          aria-label={isError ? 'Node error details' : 'Node warning details'}
          className={cx(
            'nodrag absolute right-0 top-0 z-10 grid size-7 cursor-help place-items-center rounded-modiff-compact border bg-modiff-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
            isError ? 'border-modiff-red/70 text-modiff-red' : 'border-hf-orange/70 text-hf-orange',
          )}
        >
          <TriangleAlert size={15} />
        </span>
      )}
      <div className="nowheel min-h-0 w-full flex-1 overflow-auto p-2" data-testid={`node-scroll-body-${node.id}`}>
        <NodeContent
          nodeId={node.id}
          params={node.data.params}
          updateStore={handleOnChange}
          module={node.data.module || ''}
          action={node.data.action || ''}
          mode="controls"
          executionStatus={node.data.executionStatus}
          progressMessage={node.data.progressMessage}
        />
      </div>
      <NodeContent
        nodeId={node.id}
        params={node.data.params}
        updateStore={handleOnChange}
        module={node.data.module || ''}
        action={node.data.action || ''}
        mode="connectors"
        executionStatus={node.data.executionStatus}
        progressMessage={node.data.progressMessage}
      />
      {node.data.resizable && <NodeResizeHandle />}
    </AnyNodeFrame>
  );
});

export default AnyNode;
