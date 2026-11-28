import { STUDIO_MODE_LABELS } from './modelProfiles';
import { outputTaskKey } from './resolvedExecutionInputs';
import type { StudioOutput } from './types';

export function outputTaskDisplay(output: StudioOutput): string {
  const receipt = output.resolvedExecutionInputs;
  if (!receipt)
    return output.legacyRecordedFields && !output.legacyRecordedFields.includes('mode')
      ? 'Task not captured'
      : STUDIO_MODE_LABELS[output.mode];
  const task = outputTaskKey(output);
  return task ? STUDIO_MODE_LABELS[task] : 'Task not uniquely captured';
}
