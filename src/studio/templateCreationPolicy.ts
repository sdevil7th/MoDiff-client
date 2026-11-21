import type { StudioTemplate } from './types';

export function isPlanningOnlyTemplate(template: StudioTemplate) {
  return (
    template.readinessPolicy === 'planning' ||
    template.difficulty === 'blocked' ||
    template.example?.status === 'blocked'
  );
}
