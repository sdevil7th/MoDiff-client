import type { StudioViewMode, WorkspacePanelTab } from './types';

export type WorkspaceMode = 'creator' | 'developer';

// Keep historical authoring values internal; they are not resource policies.
export function workspaceModeForView(view: StudioViewMode): WorkspaceMode {
  return view === 'expert' ? 'developer' : 'creator';
}

export function restoreWorkspaceView(workspace: unknown, legacyView: unknown): StudioViewMode {
  if (workspace === 'developer') return 'expert';
  if (workspace === 'creator') return 'auto';
  return legacyView === 'expert' || legacyView === 'manual' ? 'expert' : 'auto';
}

export interface WorkspacePanels {
  isLeftPanelOpen: boolean;
  leftPanelWidth: number;
  leftPanelTabIndex: number;
  isRightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelTab: WorkspacePanelTab;
}

export function workspacePanels(state: WorkspacePanels): WorkspacePanels {
  const { isLeftPanelOpen, leftPanelWidth, leftPanelTabIndex, isRightPanelOpen, rightPanelWidth, rightPanelTab } =
    state;
  return { isLeftPanelOpen, leftPanelWidth, leftPanelTabIndex, isRightPanelOpen, rightPanelWidth, rightPanelTab };
}

export function restoreWorkspacePanels(value: unknown): Partial<Record<WorkspaceMode, WorkspacePanels>> {
  const restored: Partial<Record<WorkspaceMode, WorkspacePanels>> = {};
  if (!value || typeof value !== 'object') return restored;
  for (const mode of ['creator', 'developer'] as const) {
    const panel = (value as Record<string, unknown>)[mode];
    if (!panel || typeof panel !== 'object') continue;
    const p = panel as Record<string, unknown>;
    if (
      typeof p.isLeftPanelOpen !== 'boolean' ||
      typeof p.isRightPanelOpen !== 'boolean' ||
      typeof p.leftPanelWidth !== 'number' ||
      !Number.isFinite(p.leftPanelWidth) ||
      p.leftPanelWidth < 240 ||
      typeof p.rightPanelWidth !== 'number' ||
      !Number.isFinite(p.rightPanelWidth) ||
      p.rightPanelWidth < 320 ||
      typeof p.leftPanelTabIndex !== 'number' ||
      !Number.isInteger(p.leftPanelTabIndex) ||
      p.leftPanelTabIndex < -1 ||
      p.leftPanelTabIndex > 4 ||
      typeof p.rightPanelTab !== 'string' ||
      !['studio', 'block', 'compatibility', 'queue', 'setup', 'app'].includes(p.rightPanelTab)
    )
      continue;
    restored[mode] = workspacePanels(p as unknown as WorkspacePanels);
  }
  return restored;
}
