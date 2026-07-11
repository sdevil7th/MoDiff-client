import { Check, ClipboardCopy, WandSparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { StudioFormState, StudioTemplate } from '../studio/types';
import { buildPromptDiff } from '../studio/promptDiff';
import { enqueueSnackbar } from '../ui/snackbar';
import { SectionHeader, StudioButton, StudioChip } from '../ui';
import { cx } from '../utils/classNames';

type StudioPromptEnhancerProps = {
  form: StudioFormState;
  template: StudioTemplate | undefined;
  onApply: (values: Partial<StudioFormState>) => void;
};

function splitPrompt(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendUnique(parts: string[], additions: string[]) {
  const seen = new Set(parts.map((part) => part.toLowerCase()));
  additions.forEach((addition) => {
    const key = addition.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      parts.push(addition);
    }
  });
  return parts;
}

function modeAdditions(form: StudioFormState) {
  if (form.mode === 'edit_image') {
    return ['preserve source identity', 'match original lighting', 'localized edit'];
  }
  if (form.mode === 'multi_image_reference_edit') {
    return ['coherent blend of references', 'consistent perspective', 'preserve strongest design details'];
  }
  if (form.mode === 'control_image') {
    return ['follow the control image structure', 'clean edges', 'stable composition'];
  }
  if (form.mode === 'inpaint') {
    return ['edit only inside the mask', 'preserve unmasked areas', 'consistent texture'];
  }
  if (form.mode === 'layer_decomposition') {
    return ['clean layer boundaries', 'separated foreground and background', 'editable alpha'];
  }
  return ['one clear subject', 'balanced composition', 'professional finish'];
}

function buildEnhancedPrompt(form: StudioFormState, template: StudioTemplate | undefined) {
  const baseParts = splitPrompt(form.prompt || template?.prompt || '');
  const guide = template?.promptGuide;
  const additions = [...modeAdditions(form), guide?.lighting?.[0], guide?.camera?.[0], guide?.style?.[0]].filter(
    (item): item is string => Boolean(item),
  );

  const prompt = appendUnique(baseParts.length > 0 ? baseParts : ['A polished image'], additions).join(', ');
  const negative = appendUnique(
    splitPrompt(form.negativePrompt),
    guide?.negative?.slice(0, 3) ?? ['low quality', 'blurry', 'artifacts'],
  ).join(', ');

  return { prompt, negativePrompt: negative };
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value);
  enqueueSnackbar('Enhanced prompt copied', { variant: 'success', autoHideDuration: 1800 });
}

export function StudioPromptEnhancer({ form, template, onApply }: StudioPromptEnhancerProps) {
  const [proposal, setProposal] = useState<Pick<StudioFormState, 'prompt' | 'negativePrompt'> | null>(null);
  const diff = useMemo(() => (proposal ? buildPromptDiff(form.prompt, proposal.prompt) : []), [form.prompt, proposal]);
  const addedCount = diff.filter((token) => token.kind === 'added').length;
  const removedCount = diff.filter((token) => token.kind === 'removed').length;

  return (
    <section>
      <SectionHeader
        title="Prompt enhancer"
        action={
          proposal ? (
            <div className="flex gap-1">
              <StudioChip tone={addedCount ? 'success' : 'default'}>{`+${addedCount}`}</StudioChip>
              <StudioChip tone={removedCount ? 'error' : 'default'}>{`-${removedCount}`}</StudioChip>
            </div>
          ) : undefined
        }
      />
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          <StudioButton
            tone="ghost"
            icon={<WandSparkles size={15} />}
            onClick={() => setProposal(buildEnhancedPrompt(form, template))}
          >
            Suggest
          </StudioButton>
          {proposal && (
            <>
              <StudioButton
                tone="primary"
                icon={<Check size={15} />}
                onClick={() => {
                  onApply(proposal);
                  setProposal(null);
                }}
              >
                Apply
              </StudioButton>
              <StudioButton
                tone="ghost"
                icon={<ClipboardCopy size={15} />}
                onClick={() => copyText(`${proposal.prompt}\n\nNegative:\n${proposal.negativePrompt}`)}
              >
                Copy
              </StudioButton>
              <StudioButton tone="ghost" icon={<X size={15} />} onClick={() => setProposal(null)}>
                Dismiss
              </StudioButton>
            </>
          )}
        </div>

        {proposal && (
          <div
            className="grid gap-2 border border-modiff-border bg-modiff-bg p-2"
            data-testid="studio-prompt-enhancer-diff"
          >
            <div className="max-h-40 overflow-y-auto">
              {diff.map((token, index) => (
                <span
                  key={`${token.text}-${index}`}
                  className={cx(
                    'mb-1 mr-1 inline-block rounded-modiff-compact px-1 text-xs',
                    token.kind === 'same' && 'text-gray-400',
                    token.kind === 'added' && 'bg-modiff-green/10 text-modiff-green',
                    token.kind === 'removed' && 'bg-modiff-red/10 text-modiff-red line-through',
                  )}
                >
                  {token.text}
                </span>
              ))}
            </div>
            <div className="grid gap-1 border-t border-modiff-border pt-2">
              <p className="text-xs font-semibold uppercase text-hf-gray">Negative</p>
              <p className="break-words text-xs text-gray-300">{proposal.negativePrompt || 'None'}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
