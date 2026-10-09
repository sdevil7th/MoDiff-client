import { STUDIO_MODE_LABELS } from './modelProfiles';
import type { StudioOutput } from './types';

export function outputTaskDisplay(output: StudioOutput): string {
  const receipt = output.resolvedExecutionInputs;
  if (!receipt) return STUDIO_MODE_LABELS[output.mode];
  const task = receipt.graphTasks?.[0]?.task;
  const label = task && STUDIO_MODE_LABELS[task as keyof typeof STUDIO_MODE_LABELS];
  return typeof label === 'string' && receipt.graphTasks!.every((item) => item.task === task)
    ? label
    : 'Task not uniquely captured';
}
