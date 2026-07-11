import { ReactNode } from 'react';
import { FieldProps } from '../components/NodeContent';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../utils/classNames';
import { FieldFrame } from '../ui';

export default function UIGroupField({ props, children }: { props: FieldProps; children: ReactNode }) {
  const isCollapseField = !!props.fieldOptions?.collapse;
  const isOpen = !!props.value;
  const displayLabel = isCollapseField || props.label;

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className={cx('w-full [&>*]:mb-1', isCollapseField && 'border-b border-white/10')}
    >
      {displayLabel && (
        <div
          className={cx(
            'flex items-center justify-between text-sm text-modiff-text',
            isCollapseField ? 'nodrag cursor-pointer hover:text-hf-yellow' : 'cursor-default',
          )}
          onClick={() => props.updateStore(props.fieldKey, !isOpen)}
        >
          <span className="min-w-0 truncate">{props.label}</span>
          {isCollapseField && (
            <span className="grid size-5 place-items-center">
              {isOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
            </span>
          )}
        </div>
      )}
      {isCollapseField ? isOpen ? <>{children}</> : null : <>{children}</>}
    </FieldFrame>
  );
}
