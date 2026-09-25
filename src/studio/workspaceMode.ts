/** One-time cleanup: current panel fields already represent the last active layout. */
export function unifiedWorkspaceSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const settings = { ...value } as Record<string, unknown>;
  for (const key of ['workspaceMode', 'studioViewMode', 'workspacePanelPreferences']) delete settings[key];
  return settings;
}
