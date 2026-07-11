export const modiffColors = {
  primary: '#FFD21E',
  primaryGradientEnd: '#FF9D00',
  secondary: '#141C2E',
  appBackground: '#0B0F19',
  paper: '#101623',
  tableHeader: '#141C2E',
  textPrimary: '#F9FAFB',
  textMuted: '#6B7280',
  topBar: '#101623',
  leftPanel: '#0B0F19',
  panelDivider: '#1E2939',
  imageBackdrop: '#000000',
  flowHandle: '#aaaaaa',
  flowHandleOutline: '#0B0F19',
  connectionValid: '#00BAA7',
  connectionInvalid: '#FB2C36',
  suggestedOption: '#FFD21E',
  checkerLight: '#999',
  checkerDark: '#6a6a6a',
  splineCurve: '#3080FF',
} as const;

export const modiffOverlays = {
  hoverLight: 'rgba(255, 255, 255, 0.1)',
  hoverLightStrong: 'rgba(255, 255, 255, 0.25)',
  subtleLight: 'rgba(255, 255, 255, 0.12)',
  softLight: 'rgba(255, 255, 255, 0.15)',
  transparentLight: 'rgba(255, 255, 255, 0)',
  actionRest: 'rgba(255, 255, 255, 0.05)',
  mutedLight: 'rgba(255, 255, 255, 0.3)',
  strongLight: 'rgba(255, 255, 255, 0.7)',
  disabledText: 'rgba(255, 255, 255, 0.4)',
  selectedOverlay: 'rgba(0, 0, 0, 0.28)',
  dialogChrome: 'rgba(0, 0, 0, 0.22)',
  imageOverlay: 'rgba(0, 0, 0, 0.75)',
  imageOverlaySoft: 'rgba(0, 0, 0, 0.45)',
  imageOverlayMedium: 'rgba(0, 0, 0, 0.5)',
  lowContrastOverlay: 'rgba(0, 0, 0, 0.4)',
  imageHandleOutline: 'rgba(0, 0, 0, 0.7)',
  taskLauncherBackdrop: 'rgba(16, 16, 16, 0.78)',
  diffAdded: 'rgba(46, 125, 50, 0.14)',
  diffRemoved: 'rgba(211, 47, 47, 0.14)',
} as const;

export const modiffTypography = {
  fontFamily: '"Source Sans Pro", ui-sans-serif, system-ui, sans-serif',
  monoFontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  baseFontSize: 14,
  fieldLabelSize: 13,
  fieldInputSize: 14,
  compactCaptionSize: 12,
  tinyCaptionSize: 11,
} as const;

export const modiffRadii = {
  none: 0,
  compact: 0.5,
  menu: 1,
} as const;

export const modiffLayout = {
  topBarHeight: 58,
  tabBarWidth: 54,
  tabButtonHeight: 50,
  workspaceMinWidth: 240,
  resizeHandleWidth: 6,
  maxNodeWidth: 1280,
  maxNodeHeight: 1280,
} as const;

export const modiffShadows = {
  node: '0px 10px 24px rgba(0, 0, 0, 0.35)',
  nodeError: '0 0 0 2px rgba(244, 67, 54, 0.35), 0px 12px 28px rgba(0, 0, 0, 0.45)',
  progressInset: 'inset 0 0 0 4px rgba(255, 255, 255, 0.12)',
} as const;

export const modiffGradients = {
  progress: `linear-gradient(100deg, ${modiffColors.primary} 50%, ${modiffColors.primaryGradientEnd} 90%)`,
} as const;
