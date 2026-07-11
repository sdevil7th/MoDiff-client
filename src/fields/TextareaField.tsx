import { FieldProps } from '../components/NodeContent';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { FieldFrame } from '../ui';
import { cx } from '../utils/classNames';

export default function TextareaField(props: FieldProps) {
  const inputId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const fieldValue = props.value === null || props.value === undefined ? '' : String(props.value);
  const [draftValue, setDraftValue] = useState(fieldValue);
  const [isFocused, setIsFocused] = useState(false);
  const skipNextCommitRef = useRef(false);
  const { fieldKey, updateStore } = props;

  const updateOverflow = useCallback(() => {
    const textarea = textareaRef.current;
    setHasOverflow(Boolean(textarea && textarea.scrollHeight > textarea.clientHeight));
  }, []);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(fieldValue);
    }
  }, [fieldValue, isFocused]);

  useEffect(() => {
    updateOverflow();
  }, [draftValue, updateOverflow]);

  const commitValue = useCallback(
    (value: string) => {
      if (value !== fieldValue) {
        updateStore(fieldKey, value);
      }
    },
    [fieldKey, fieldValue, updateStore],
  );

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className={cx('modiff-field modiff-textarea-field nodrag flex flex-col pt-1', hasOverflow && 'nowheel')}
    >
      <label
        htmlFor={inputId}
        className="mb-1 w-fit rounded-modiff-compact bg-modiff-surface px-2 text-[13px] text-gray-400"
        title={props.label}
      >
        {props.label}
      </label>
      <textarea
        id={inputId}
        ref={textareaRef}
        value={draftValue}
        disabled={props.disabled}
        onChange={(event) => {
          setDraftValue(event.target.value);
          updateOverflow();
        }}
        onFocus={() => {
          setIsFocused(true);
          updateOverflow();
        }}
        onBlur={(event) => {
          setIsFocused(false);
          if (skipNextCommitRef.current) {
            skipNextCommitRef.current = false;
            return;
          }
          commitValue(event.currentTarget.value);
          updateOverflow();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            skipNextCommitRef.current = true;
            setDraftValue(fieldValue);
            event.currentTarget.blur();
          }
        }}
        onInput={updateOverflow}
        autoComplete="off"
        rows={3}
        className="min-h-20 max-h-72 w-full max-w-full resize-y rounded-modiff-compact border border-transparent bg-modiff-bg p-2 text-sm text-modiff-text outline-none focus:border-hf-yellow disabled:cursor-not-allowed disabled:opacity-50"
      />
    </FieldFrame>
  );
}
