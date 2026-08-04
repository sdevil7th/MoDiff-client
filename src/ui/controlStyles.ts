export type ModiffControlSize = 'compact' | 'dense' | 'normal' | 'prominent';

export const controlHeightClasses: Record<ModiffControlSize, string> = {
  compact: 'h-7 text-modiff-metadata',
  dense: 'h-8 text-modiff-control',
  normal: 'h-9 text-modiff-control',
  prominent: 'h-10 text-modiff-control',
};

export const controlMinHeightClasses: Record<ModiffControlSize, string> = {
  compact: 'min-h-7 text-modiff-metadata',
  dense: 'min-h-8 text-modiff-control',
  normal: 'min-h-9 text-modiff-control',
  prominent: 'min-h-10 text-modiff-control',
};
