import semanticTokens from './semanticTokens.json';

const css = semanticTokens.cssVariables;

export const modiffColors = {
  primary: css['color-hf-yellow'],
  primaryGradientEnd: css['color-hf-orange'],
  secondary: css['color-modiff-panel'],
  appBackground: css['color-modiff-bg'],
  paper: css['color-modiff-surface'],
  tableHeader: css['color-modiff-panel'],
  textPrimary: css['color-modiff-text'],
  textMuted: css['color-modiff-subtle-text'],
  subtleText: css['color-modiff-subtle-text'],
  topBar: css['color-modiff-surface'],
  leftPanel: css['color-modiff-bg'],
  panelDivider: css['color-modiff-border'],
  borderSubtle: css['color-modiff-border-subtle'],
  surfaceHover: css['color-modiff-surface-hover'],
  surfacePressed: css['color-modiff-surface-pressed'],
  selectedSurface: css['color-modiff-selected-surface'],
  onAccent: css['color-modiff-on-accent'],
  onDanger: css['color-modiff-on-danger'],
  mediaBackdrop: css['color-modiff-media-backdrop'],
  overlayText: css['color-modiff-overlay-text'],
  dialogBackdrop: css['color-modiff-dialog-backdrop'],
  primaryPressed: css['color-modiff-primary-pressed'],
  focus: css['color-modiff-focus'],
  warning: css['color-modiff-warning'],
  invalid: css['color-modiff-invalid'],
  disabled: css['color-modiff-disabled'],
  imageBackdrop: semanticTokens.runtimeColors.imageBackdrop,
  flowHandle: semanticTokens.runtimeColors.flowHandle,
  flowHandleOutline: css['color-modiff-bg'],
  connectionValid: css['color-modiff-green'],
  connectionInvalid: css['color-modiff-red'],
  suggestedOption: css['color-hf-yellow'],
  checkerLight: semanticTokens.runtimeColors.checkerLight,
  checkerDark: semanticTokens.runtimeColors.checkerDark,
  splineCurve: css['color-modiff-blue'],
} as const;

export const modiffOverlays = semanticTokens.overlays;

export const modiffTypography = {
  fontFamily: css['font-sans'],
  monoFontFamily: css['font-mono'],
  ...semanticTokens.typography,
} as const;

export const modiffControlSizes = semanticTokens.controlSizes;

export const modiffRadii = semanticTokens.radii;

export const modiffLayout = semanticTokens.layout;

export const modiffShadows = {
  node: css['shadow-modiff-node'],
  nodeError: semanticTokens.shadows.nodeError,
  progressInset: semanticTokens.shadows.progressInset,
} as const;

export const modiffGradients = {
  progress: `linear-gradient(100deg, ${modiffColors.primary} 50%, ${modiffColors.primaryGradientEnd} 90%)`,
} as const;

export { semanticTokens };
