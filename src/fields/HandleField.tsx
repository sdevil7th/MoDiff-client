// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { Position, useUpdateNodeInternals } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { FieldProps } from '../components/NodeContent';
import { useEffect, useRef } from 'react';
import fieldAction, { consumeAutomaticSignalFieldActionSuppression, relaySignal } from '../utils/fieldAction';
import { dataTypeClass, normalizeDataType } from '../utils/dataTypeCategory';
import { FieldFrame } from '../ui';
import { useGraphFixStore } from '../stores/useGraphFixStore';
import { cx } from '../utils/classNames';
import { connectionColor, connectionTypeGradient, connectionTypes, edgeConnectionType } from '../theme/connectionTypes';
import { useFlowStore } from '../stores/useFlowStore';
import { GraphTypedHandle } from '../ui/GraphTypedHandle';

export default function HandleField(props: FieldProps) {
  const type = props.fieldType === 'output' ? 'source' : 'target';
  const position = props.handlePosition ?? (props.fieldType === 'output' ? Position.Right : Position.Left);
  const textAlignClassName = props.fieldType === 'output' ? 'text-right' : 'text-left';
  const isCompact = Boolean(props.compactHandle);
  const updateNodeInternals = useUpdateNodeInternals();
  const propsRef = useRef(props);
  propsRef.current = props;
  const { fieldKey, isConnected, nodeId, onChange, onSignal, signal } = props;
  const suppressInitialFieldAction = props.fieldOptions?.suppressInitialFieldAction === true;
  const suppressAutomaticSignalAction = props.fieldOptions?.suppressAutomaticSignalAction === true;
  const connectedTargetType = useFlowStore(
    useShallow((state) => {
      if (type !== 'target') return null;
      const edge = state.edges.find((item) => item.target === nodeId && item.targetHandle === fieldKey);
      return edge ? edgeConnectionType(edge, state.nodes) : null;
    }),
  );
  const visualType = connectedTargetType ?? props.connectionType ?? props.dataType;
  const handleColor = connectionColor(visualType);
  const handleGradient = connectionTypeGradient(visualType);
  const typeLabel = connectionTypes(visualType).join(' or ') || 'untyped';
  const directionLabel = type === 'source' ? 'Output' : 'Input';
  const endpointDescription = props.fieldOptions?.connectionDescription;
  const labelTitle = typeof endpointDescription === 'string' ? `${props.label} · ${endpointDescription}` : props.label;
  const graphFixHighlighted = useGraphFixStore((state) =>
    Boolean(
      (state.dialogOpen &&
        state.issueTargets.some((target) => target.nodeId === nodeId && target.handle === fieldKey)) ||
      state.previewCandidate?.operations.some(
        (operation) =>
          operation.kind === 'connect' &&
          ((operation.source.nodeId === nodeId && operation.source.handle === fieldKey) ||
            (operation.target.nodeId === nodeId && operation.target.handle === fieldKey)),
      ),
    ),
  );

  useEffect(() => {
    if (onChange && !suppressInitialFieldAction) {
      fieldAction(propsRef.current, (isConnected || false).toString());
      updateNodeInternals(nodeId);
    }
  }, [isConnected, nodeId, onChange, suppressInitialFieldAction, updateNodeInternals]);

  useEffect(() => {
    if (onSignal && signal?.value !== undefined) {
      if (
        !suppressInitialFieldAction &&
        !suppressAutomaticSignalAction &&
        !consumeAutomaticSignalFieldActionSuppression(nodeId, fieldKey, signal)
      ) {
        fieldAction(propsRef.current, signal?.value, 'onSignal');
      }
      updateNodeInternals(nodeId);
    }

    relaySignal(nodeId, fieldKey, signal);
  }, [
    fieldKey,
    nodeId,
    onSignal,
    signal,
    suppressInitialFieldAction,
    suppressAutomaticSignalAction,
    updateNodeInternals,
  ]);

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      disabled={props.disabled}
      hidden={props.hidden && !props.isConnected}
      layoutStyle={props.style}
      className={cx(
        isCompact ? 'relative h-5' : 'relative',
        graphFixHighlighted && 'bg-hf-yellow/10 ring-1 ring-inset ring-hf-yellow/70',
      )}
    >
      <GraphTypedHandle
        id={props.fieldKey}
        type={type}
        position={position}
        aria-label={`${directionLabel} ${props.label}, ${typeLabel}`}
        title={`${labelTitle} · ${typeLabel}`}
        data-connection-type={typeLabel}
        data-testid={`node-handle-${nodeId}-${props.fieldKey}`}
        connectionColor={handleColor}
        connectionGradient={handleGradient}
        className={cx(
          `${normalizeDataType(visualType)}-handle`,
          dataTypeClass(visualType),
          graphFixHighlighted && 'ring-2 ring-hf-yellow ring-offset-2 ring-offset-modiff-bg',
        )}
      />
      {isCompact ? (
        <span className="sr-only">{props.label}</span>
      ) : (
        <div
          className={`text-modiff-control mx-0.5 truncate px-2 text-modiff-subtle-text ${textAlignClassName}`}
          title={labelTitle}
        >
          {props.label}
        </div>
      )}
    </FieldFrame>
  );
}
