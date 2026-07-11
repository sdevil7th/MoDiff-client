import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { FieldProps } from '../components/NodeContent';
import { useEffect, useRef } from 'react';
import fieldAction, { relaySignal } from '../utils/fieldAction';
import { dataTypeClass, normalizeDataType } from '../utils/dataTypeCategory';
import { FieldFrame } from '../ui';

export default function HandleField(props: FieldProps) {
  const type = props.fieldType === 'output' ? 'source' : 'target';
  const position = props.fieldType === 'output' ? Position.Right : Position.Left;
  const textAlignClassName = props.fieldType === 'output' ? 'text-right' : 'text-left';
  const isCompact = Boolean(props.compactHandle);
  const updateNodeInternals = useUpdateNodeInternals();
  const propsRef = useRef(props);
  propsRef.current = props;
  const { fieldKey, isConnected, nodeId, onChange, onSignal, signal } = props;

  useEffect(() => {
    if (onChange) {
      fieldAction(propsRef.current, (isConnected || false).toString());
      updateNodeInternals(nodeId);
    }
  }, [isConnected, nodeId, onChange, updateNodeInternals]);

  useEffect(() => {
    if (onSignal && signal?.value !== undefined) {
      fieldAction(propsRef.current, signal?.value, 'onSignal');
      updateNodeInternals(nodeId);
    }

    relaySignal(nodeId, fieldKey, signal);
  }, [fieldKey, nodeId, onSignal, signal, updateNodeInternals]);

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      disabled={props.disabled}
      hidden={props.hidden && !props.isConnected}
      layoutStyle={props.style}
      className={isCompact ? 'relative h-5' : 'relative'}
    >
      <Handle
        id={props.fieldKey}
        type={type}
        position={position}
        className={`${normalizeDataType(props.dataType)}-handle ${dataTypeClass(props.dataType)}`}
      />
      {isCompact ? (
        <span className="sr-only">{props.label}</span>
      ) : (
        <div className={`mx-0.5 truncate px-2 text-[13px] text-gray-400 ${textAlignClassName}`} title={props.label}>
          {props.label}
        </div>
      )}
    </FieldFrame>
  );
}
