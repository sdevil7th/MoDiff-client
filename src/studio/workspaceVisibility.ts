import { useSettingsStore } from '../stores/useSettingsStore';

/** Explicit canvas gestures reopen inspection without replacing an open tool. */
export function revealWorkspaceForGraphEditing() {
  const settings = useSettingsStore.getState();
  if (settings.isRightPanelOpen) return;
  settings.setRightPanelTab('studio');
  settings.setRightPanelOpen(true);
}
