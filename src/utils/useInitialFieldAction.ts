import { useEffect, useRef } from 'react';
import type { FieldProps } from '../components/NodeContent';
import fieldAction from './fieldAction';

export function useInitialFieldAction(props: FieldProps, value: unknown = props.value) {
  const initialRef = useRef({ props, value });

  useEffect(() => {
    fieldAction(initialRef.current.props, initialRef.current.value);
  }, []);
}
