import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import { cx } from '../utils/classNames';
import { useModiffFieldControl } from './fieldContext';
import { ModiffIconButton, type ModiffIconButtonProps } from './primitives';

/**
 * Behavior-preserving controls for graph nodes and canvas overlays whose
 * geometry cannot use the opinionated sizing of normal form primitives.
 * Feature code remains responsible for layout, while interaction states and
 * semantic colors stay centralized here.
 */
export const GraphControlButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function GraphControlButton({ 'aria-label': ariaLabel, className, title, type = 'button', ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        title={title}
        className={cx(
          'transition-colors active:bg-modiff-surface-pressed disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 aria-[busy=true]:cursor-progress aria-[pressed=true]:bg-modiff-selected-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
          className,
        )}
        {...props}
      />
    );
  },
);

export type GraphIconButtonProps = ModiffIconButtonProps;

export const GraphIconButton = forwardRef<HTMLButtonElement, GraphIconButtonProps>(function GraphIconButton(
  { className, size = 'compact', ...props },
  ref,
) {
  return <ModiffIconButton {...props} ref={ref} size={size} className={cx('nodrag nowheel', className)} />;
});

export const GraphControlInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function GraphControlInput(
    {
      'aria-describedby': ariaDescribedBy,
      'aria-errormessage': ariaErrorMessage,
      'aria-invalid': ariaInvalid,
      className,
      disabled,
      id,
      readOnly,
      required,
      type = 'text',
      ...props
    },
    ref,
  ) {
    const isChoice = type === 'checkbox' || type === 'radio';
    const isRange = type === 'range';
    const field = useModiffFieldControl({
      ariaDescribedBy,
      ariaErrorMessage,
      disabled,
      id,
      invalid: ariaInvalid === true || ariaInvalid === 'true',
      readOnly,
      required,
    });
    return (
      <input
        {...props}
        ref={ref}
        id={field.id}
        type={type}
        aria-describedby={field.ariaDescribedBy}
        aria-errormessage={field.ariaErrorMessage}
        aria-invalid={field.invalid || undefined}
        disabled={field.disabled}
        readOnly={field.readOnly}
        required={field.required}
        className={cx(
          'read-only:cursor-default read-only:bg-modiff-disabled/10 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-modiff-invalid aria-invalid:focus-visible:outline-modiff-invalid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
          isChoice && 'accent-hf-yellow',
          isRange && 'accent-hf-yellow',
          !isChoice && !isRange && type !== 'file' && 'text-modiff-text placeholder:text-modiff-subtle-text',
          className,
        )}
      />
    );
  },
);

export const GraphControlTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function GraphControlTextarea(
    {
      'aria-describedby': ariaDescribedBy,
      'aria-errormessage': ariaErrorMessage,
      'aria-invalid': ariaInvalid,
      className,
      disabled,
      id,
      readOnly,
      required,
      ...props
    },
    ref,
  ) {
    const field = useModiffFieldControl({
      ariaDescribedBy,
      ariaErrorMessage,
      disabled,
      id,
      invalid: ariaInvalid === true || ariaInvalid === 'true',
      readOnly,
      required,
    });
    return (
      <textarea
        {...props}
        ref={ref}
        id={field.id}
        aria-describedby={field.ariaDescribedBy}
        aria-errormessage={field.ariaErrorMessage}
        aria-invalid={field.invalid || undefined}
        disabled={field.disabled}
        readOnly={field.readOnly}
        required={field.required}
        className={cx(
          'text-modiff-text placeholder:text-modiff-subtle-text read-only:cursor-default read-only:bg-modiff-disabled/10 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-modiff-invalid aria-invalid:focus-visible:outline-modiff-invalid focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-modiff-focus',
          className,
        )}
      />
    );
  },
);
