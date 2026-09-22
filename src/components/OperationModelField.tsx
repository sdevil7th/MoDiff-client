import { useMemo, type ReactNode } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { FieldProps } from './NodeContent';
import { operationModelSource } from '../workflow/operationModelSource';
import { FieldFrame } from '../ui';
import OperationModelPicker from './OperationModelPicker';

/** Keep graph conversion/planning out of the startup field-renderer bundle. */
export default function OperationModelField({
  root,
  field,
  value,
  fallback,
}: {
  root: CustomNodeType;
  field: FieldProps;
  value: string;
  fallback: ReactNode;
}) {
  const node = useMemo(() => operationModelSource(root, field.fieldKey), [root, field.fieldKey]);
  return node ? (
    <FieldFrame dataKey={field.fieldKey} hidden={field.hidden} layoutStyle={field.style} className="modiff-field">
      <OperationModelPicker node={node} value={value} disabled={field.disabled || field.isConnected} />
    </FieldFrame>
  ) : (
    fallback
  );
}
