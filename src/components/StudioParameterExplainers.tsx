import { Info } from 'lucide-react';

import { STUDIO_MODEL_LABELS } from '../studio/modelProfiles';
import type { StudioFormState } from '../studio/types';
import { SectionHeader } from '../ui';

type StudioParameterExplainersProps = {
  form: StudioFormState;
};

export function StudioParameterExplainers({ form }: StudioParameterExplainersProps) {
  const rows = [
    [
      'Seed',
      form.randomSeed ? 'Random on run, so exact examples cannot be promised.' : `Locked to ${form.seed} for reruns.`,
    ],
    ['Guidance', `${form.guidanceScale} balances prompt obedience against natural detail.`],
    ['Steps', `${form.steps} sampling steps sets quality/runtime tradeoff.`],
    ['Strength', `${form.strength} controls how much source images can change in edit workflows.`],
    ['Size', `${form.width}x${form.height} changes composition and exactness hash.`],
    ['Dtype', `${form.dtype} affects memory use and can affect reproducibility.`],
    ['Model', STUDIO_MODEL_LABELS[form.modelType]],
  ] as const;

  return (
    <section>
      <SectionHeader title="Parameter notes" />
      <div className="grid gap-1 border border-modiff-border bg-modiff-bg p-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-2 text-xs">
            <Info size={13} className="mt-0.5 shrink-0 text-hf-gray" />
            <p className="min-w-0 text-gray-400">
              <span className="font-semibold text-modiff-text">{label}:</span> {value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
