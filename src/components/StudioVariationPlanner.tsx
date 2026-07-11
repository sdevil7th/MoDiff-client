import { Shuffle, SlidersHorizontal } from 'lucide-react';

import { isTemplateExactEligible } from '../studio/templateExactness';
import { VIDEO_STUDIO_MODES } from '../studio/modelProfiles';
import type { StudioFormState, StudioTemplate } from '../studio/types';
import { SectionHeader, StudioButton } from '../ui';

export type StudioVariationOption = {
  label: string;
  detail: string;
  values: Partial<StudioFormState>;
};

type StudioVariationPlannerProps = {
  form: StudioFormState;
  template: StudioTemplate | undefined;
  onChange: (values: Partial<StudioFormState>) => void;
  onRunSweep: (variations: StudioVariationOption[]) => void;
  disabled?: boolean;
};

export function StudioVariationPlanner({
  disabled = false,
  form,
  template,
  onChange,
  onRunSweep,
}: StudioVariationPlannerProps) {
  const exactEligible = template ? isTemplateExactEligible(template, form) : false;
  const isVideoMode = VIDEO_STUDIO_MODES.includes(form.mode);
  const strengthVariations: StudioVariationOption[] =
    form.mode === 'edit_image' ||
    form.mode === 'multi_image_reference_edit' ||
    form.mode === 'inpaint' ||
    form.mode === 'layer_decomposition'
      ? [
          {
            label: 'Lower strength',
            detail: `Strength ${Math.max(0, Number((form.strength - 0.1).toFixed(2)))}`,
            values: { strength: Math.max(0, Number((form.strength - 0.1).toFixed(2))) },
          },
          {
            label: 'Higher strength',
            detail: `Strength ${Math.min(1, Number((form.strength + 0.1).toFixed(2)))}`,
            values: { strength: Math.min(1, Number((form.strength + 0.1).toFixed(2))) },
          },
        ]
      : [];
  const videoVariations: StudioVariationOption[] = isVideoMode
    ? [
        {
          label: 'Lower conditioning',
          detail: `Conditioning ${Math.max(0, Number((form.conditioningScale - 0.15).toFixed(2)))}`,
          values: { conditioningScale: Math.max(0, Number((form.conditioningScale - 0.15).toFixed(2))) },
        },
        {
          label: 'Higher conditioning',
          detail: `Conditioning ${Math.min(2, Number((form.conditioningScale + 0.15).toFixed(2)))}`,
          values: { conditioningScale: Math.min(2, Number((form.conditioningScale + 0.15).toFixed(2))) },
        },
        {
          label: 'Shorter clip',
          detail: `${Math.max(17, form.numFrames - 32)} frames`,
          values: { numFrames: Math.max(17, form.numFrames - 32) },
        },
        {
          label: 'Quality clip',
          detail: '50 steps, 81 frames',
          values: { steps: 50, numFrames: 81, randomSeed: false },
        },
      ]
    : [];
  const variations: StudioVariationOption[] = [
    {
      label: 'Next seed',
      detail: `Seed ${form.seed + 1}`,
      values: { seed: form.seed + 1, randomSeed: false },
    },
    {
      label: 'Lower guidance',
      detail: `Guidance ${Math.max(0, Number((form.guidanceScale - 0.5).toFixed(1)))}`,
      values: { guidanceScale: Math.max(0, Number((form.guidanceScale - 0.5).toFixed(1))) },
    },
    {
      label: 'Higher guidance',
      detail: `Guidance ${Math.min(10, Number((form.guidanceScale + 0.5).toFixed(1)))}`,
      values: { guidanceScale: Math.min(10, Number((form.guidanceScale + 0.5).toFixed(1))) },
    },
    {
      label: 'Quality pass',
      detail: `${Math.min(80, form.steps + 12)} steps`,
      values: { steps: Math.min(80, form.steps + 12) },
    },
    ...strengthVariations,
    ...videoVariations,
  ];

  return (
    <section>
      <SectionHeader title="Variation planner" />
      <div className="grid gap-2">
        <p className="text-xs text-gray-400">
          {exactEligible
            ? 'Current settings match the locked template. Any sweep below will become Modified.'
            : 'Current settings already differ from the locked template or no active template is selected.'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {variations.map((variation, index) => (
            <StudioButton
              key={variation.label}
              tone="ghost"
              align="left"
              icon={index === 0 ? <Shuffle size={15} /> : <SlidersHorizontal size={15} />}
              onClick={() => onChange(variation.values)}
            >
              <span>
                <span className="block text-xs font-bold text-modiff-text">{variation.label}</span>
                <span className="block text-xs text-hf-orange">{variation.detail} | Modified</span>
              </span>
            </StudioButton>
          ))}
        </div>
        <StudioButton
          fullWidth
          tone="secondary"
          icon={<Shuffle size={15} />}
          disabled={disabled}
          onClick={() => onRunSweep(variations)}
        >
          Run sweep
        </StudioButton>
      </div>
    </section>
  );
}
