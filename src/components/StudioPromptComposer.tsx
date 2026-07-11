import { WandSparkles } from 'lucide-react';

import type { StudioFormState, StudioTemplate, StudioTemplatePromptGuide } from '../studio/types';
import { SectionHeader, StudioButton, StudioChip } from '../ui';

const FALLBACK_HINTS = [
  'Describe the subject first, then composition, style, lighting, camera, and constraints.',
  'Keep exact text short and put it in quotes when the model needs to render letters.',
];

const FALLBACK_SECTIONS = [
  ['Subject', ['one clear subject', 'premium product', 'same character identity']],
  ['Composition', ['centered composition', 'negative space', 'preserve composition']],
  ['Style', ['cinematic realism', 'editorial design', 'minimal studio look']],
] as const;

const GUIDE_SECTIONS: Array<[label: string, field: keyof StudioTemplatePromptGuide]> = [
  ['Subject', 'subject'],
  ['Environment', 'environment'],
  ['Preserve', 'preservation'],
  ['Change', 'change'],
  ['Composition', 'composition'],
  ['Texture / materials', 'materials'],
  ['Style', 'style'],
  ['Lighting', 'lighting'],
  ['Camera', 'camera'],
  ['Motion', 'motion'],
  ['Continuity', 'continuity'],
  ['Arrangement', 'arrangement'],
  ['Mix', 'mix'],
  ['Parameters', 'parameters'],
  ['Text', 'textRendering'],
];

type PromptComposerProps = {
  form: StudioFormState;
  template: StudioTemplate | undefined;
  onChange: (values: Partial<StudioFormState>) => void;
};

export function StudioPromptComposer({ form, template, onChange }: PromptComposerProps) {
  const guide = template?.promptGuide;
  const sections = guide
    ? GUIDE_SECTIONS.map(([label, field]) => [label, guide[field]] as const).filter(
        (section): section is readonly [string, string[]] => Array.isArray(section[1]) && section[1].length > 0,
      )
    : FALLBACK_SECTIONS;
  const negativeChips = guide?.negative ?? ['low quality', 'blurry', 'warped text', 'distorted anatomy'];
  const hints = guide?.modelHints ?? FALLBACK_HINTS;

  const appendPrompt = (value: string) => {
    const trimmed = form.prompt.trim();
    onChange({ prompt: trimmed ? `${trimmed}, ${value}` : value });
  };

  const appendNegative = (value: string) => {
    const trimmed = form.negativePrompt.trim();
    onChange({ negativePrompt: trimmed ? `${trimmed}, ${value}` : value });
  };

  return (
    <section>
      <SectionHeader title="Prompt composer" />
      <div className="grid gap-2">
        {sections.map(([label, values]) => (
          <fieldset key={label}>
            <legend className="mb-1 text-xs font-semibold uppercase text-hf-gray">{label}</legend>
            <div className="flex flex-wrap gap-1">
              {values.map((value) => (
                <StudioChip
                  key={`${label}-${value}`}
                  aria-label={`Add ${label.toLowerCase()} detail: ${value}`}
                  onClick={() => appendPrompt(value)}
                >
                  {value}
                </StudioChip>
              ))}
            </div>
          </fieldset>
        ))}
        {negativeChips.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-xs font-semibold uppercase text-hf-gray">Avoid</legend>
            <div className="flex flex-wrap gap-1">
              {negativeChips.map((value) => (
                <StudioChip
                  key={`negative-${value}`}
                  aria-label={`Add negative prompt detail: ${value}`}
                  onClick={() => appendNegative(value)}
                >
                  {value}
                </StudioChip>
              ))}
            </div>
          </fieldset>
        )}
        {hints.length > 0 && (
          <div className="grid gap-1 border border-modiff-border bg-modiff-bg p-2" aria-label="Prompt guidance">
            {hints.map((hint) => (
              <p key={hint} className="text-xs text-gray-400">
                {hint}
              </p>
            ))}
          </div>
        )}
        {template && (
          <StudioButton
            tone="ghost"
            icon={<WandSparkles size={15} />}
            onClick={() =>
              onChange({ prompt: template.prompt, negativePrompt: template.negativePrompt ?? form.negativePrompt })
            }
          >
            Restore template prompt
          </StudioButton>
        )}
      </div>
    </section>
  );
}
