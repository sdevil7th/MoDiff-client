import { useEffect, useRef } from 'react';
import type { FieldProps } from '../components/NodeContent';
import fieldAction from './fieldAction';

export function useInitialFieldAction(props: FieldProps, value: unknown = props.value) {
  const latestRef = useRef({ props, value });
  const activeContractRef = useRef('');
  const contractKey = props.onChange
    ? `${props.nodeId}\u0000${props.module}\u0000${props.action}\u0000${props.fieldKey}`
    : '';
  latestRef.current = { props, value };

  useEffect(() => {
    if (activeContractRef.current === contractKey) return;
    activeContractRef.current = contractKey;
    if (contractKey) void fieldAction(latestRef.current.props, latestRef.current.value);
  }, [contractKey]);
}
