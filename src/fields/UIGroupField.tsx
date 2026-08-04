// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { ReactNode } from 'react';
import { FieldProps } from '../components/NodeContent';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cx } from '../utils/classNames';
import { FieldFrame } from '../ui';
import { GraphControlButton } from '../ui/GraphControls';

export default function UIGroupField({ props, children }: { props: FieldProps; children: ReactNode }) {
  const isCollapseField = !!props.fieldOptions?.collapse;
  const isOpen = !!props.value;
  const displayLabel = isCollapseField || props.label;
  const labelContent = (
    <>
      <span className="min-w-0 truncate">{props.label}</span>
      {isCollapseField && (
        <span className="grid size-5 place-items-center">
          {isOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </span>
      )}
    </>
  );

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      layoutStyle={props.style}
      className={cx('w-full [&>*]:mb-1', isCollapseField && 'border-b border-modiff-border-subtle')}
    >
      {displayLabel &&
        (isCollapseField ? (
          <GraphControlButton
            type="button"
            disabled={props.disabled}
            aria-expanded={isOpen}
            className="nodrag flex min-h-7 w-full cursor-pointer items-center justify-between text-sm text-modiff-text hover:text-hf-yellow"
            onClick={() => props.updateStore(props.fieldKey, !isOpen)}
          >
            {labelContent}
          </GraphControlButton>
        ) : (
          <div className="flex cursor-default items-center justify-between text-sm text-modiff-text">
            {labelContent}
          </div>
        ))}
      {isCollapseField ? isOpen ? <>{children}</> : null : <>{children}</>}
    </FieldFrame>
  );
}
