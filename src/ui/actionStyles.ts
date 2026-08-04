export type ModiffActionTone = 'primary' | 'secondary' | 'danger' | 'ghost';

export const modiffActionToneClasses: Record<ModiffActionTone, string> = {
  primary:
    'bg-hf-yellow text-modiff-on-accent hover:bg-hf-orange active:bg-modiff-primary-pressed focus-visible:outline-modiff-focus',
  secondary:
    'border border-modiff-border bg-modiff-panel text-modiff-text hover:border-hf-yellow/70 hover:bg-modiff-surface-hover hover:text-modiff-text active:bg-modiff-surface-pressed focus-visible:outline-modiff-focus',
  danger:
    'bg-modiff-invalid text-modiff-on-danger hover:brightness-110 active:brightness-90 focus-visible:outline-modiff-invalid',
  ghost:
    'text-modiff-subtle-text hover:bg-modiff-surface-hover hover:text-modiff-text active:bg-modiff-surface-pressed focus-visible:outline-modiff-focus',
};
