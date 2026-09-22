// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TemplateBrowserCategoryId } from '../studio/templateBrowser';
import type { FocusedModelManagerTarget, StudioViewMode, WorkspacePanelTab } from '../studio/types';
import type { ImageArtifact } from '../utils/imageArtifacts';
import { migrateLocalStorageKey } from '../utils/persistMigration';
import type { MediaKind } from '../studio/mediaCapabilities';
import {
  restoreWorkspaceView,
  workspaceModeForView,
  workspacePanels,
  restoreWorkspacePanels,
  type WorkspaceMode,
  type WorkspacePanels,
} from '../studio/workspaceMode';

const LEFT_PANEL_WIDTH_MIN = 240;
const RIGHT_PANEL_WIDTH_MIN = 320;

export interface fileBrowserParams {
  workflowTabId: string | null;
  workflowCanvasEpoch: number;
  nodeId: string;
  fieldKey: string;
  fileTypes: string[];
  path: string;
  multiple?: boolean;
  initialValues?: string[];
}

// values saved to localStorage
interface SettingsState {
  isLeftPanelOpen: boolean;
  leftPanelWidth: number;
  leftPanelTabIndex: number;

  isRightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelTab: WorkspacePanelTab;

  executeButtonIndex: number;
  studioViewMode: StudioViewMode;
  workspacePanelPreferences: Partial<Record<WorkspaceMode, WorkspacePanels>>;

  activeNodeGroups: string[];
  nodeGroupBy: 'module' | 'category';
  userBlockGrouping: 'source' | 'workflow';

  edgeType: 'default' | 'smoothstep';
  studioSectionOpen: Record<string, boolean>;
  modelTermsAcknowledgements: Record<string, number>;
}

export type LightboxOpener = {
  images: string[];
  artifacts?: ImageArtifact[];
  currentIndex: number;
  dataType: string | null;
  mimeType: string | null;
  comparison?: {
    beforeUrl: string;
    beforeLabel?: string;
    afterLabel?: string;
  };
} | null;

export type MediaViewerItem = {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  label: string;
  url?: string;
  text?: string;
  downloadName?: string;
};

export type MediaViewerOpener = {
  title: string;
  items: MediaViewerItem[];
  currentIndex: number;
  workflow?: {
    taskId: string;
    clientRunId?: string | null;
    workflowTabId: string;
    nodeId?: string | null;
    name: string;
  };
} | null;

export type MediaExportOpener = {
  source: string;
  kind: Exclude<MediaKind, 'text'>;
  filename: string;
  title?: string;
  defaultFormat?: string;
  defaultSampleRate?: number | null;
} | null;

export type WorkflowFocusRequest = {
  workflowTabId: string;
  nodeId: string | null;
  requestId: number;
  requestedAt: number;
} | null;

// values not saved to localStorage. TODO: make this a separate store?
interface SettingsStateVolatile {
  fileBrowserOpener: fileBrowserParams | null;
  //modelManagerOpener: { nodeId: string, fieldKey: string, fileTypes: string[], path: string } | null;
  modelManagerOpener: { nodeId: string | null; fieldKey: string | null; focus?: FocusedModelManagerTarget } | null;
  alertOpener: {
    title: string | null;
    message: string;
    confirmText: string | null;
    cancelText: string | null;
    onConfirm: () => void;
    onCancel?: () => void;
  } | null;
  settingsOpener: boolean | null;
  lightboxOpener: LightboxOpener;
  mediaViewerOpener: MediaViewerOpener;
  mediaExportOpener: MediaExportOpener;
  workflowFocusRequest: WorkflowFocusRequest;
  runActivityPendingTaskId: string | null;
  workflowLibraryView: 'start' | 'examples' | 'saved' | 'drafts';
  templateBrowserOpen: boolean;
  templateBrowserInitialCategory: TemplateBrowserCategoryId | null;
  galleryLibraryOpen: boolean;
  runningState: 'one_shot' | 'auto_queue' | 'loop';
}

interface SettingsActions {
  setWorkflowLibraryView: (view: SettingsStateVolatile['workflowLibraryView']) => void;
  setLeftPanelOpen: (open: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  setLeftPanelTabIndex: (index: number) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelTab: (tab: WorkspacePanelTab) => void;

  setExecuteButtonIndex: (index: number) => void;
  setStudioViewMode: (mode: StudioViewMode) => void;

  setActiveNodeGroups: (group: string) => void;
  setNodeGroupBy: (by: 'module' | 'category') => void;
  setUserBlockGrouping: (by: 'source' | 'workflow') => void;

  setEdgeType: (type: 'default' | 'smoothstep') => void;
  setStudioSectionOpen: (section: string, open: boolean) => void;
  acknowledgeModelTerms: (key: string) => void;

  setFileBrowserOpener: (opener: fileBrowserParams | null) => void;
  setModelManagerOpener: (
    opener: { nodeId: string | null; fieldKey: string | null; focus?: FocusedModelManagerTarget } | null,
  ) => void;
  setAlertOpener: (
    opener: {
      title: string | null;
      message: string;
      confirmText: string | null;
      cancelText: string | null;
      onConfirm: () => void;
      onCancel?: () => void;
    } | null,
  ) => void;
  setSettingsOpener: (opener: boolean | null) => void;
  setRunningState: (state: 'one_shot' | 'auto_queue' | 'loop') => void;
  setLightboxOpener: (opener: LightboxOpener) => void;
  setMediaViewerOpener: (opener: MediaViewerOpener) => void;
  setMediaExportOpener: (opener: MediaExportOpener) => void;
  setWorkflowFocusRequest: (request: WorkflowFocusRequest) => void;
  setRunActivityPendingTaskId: (taskId: string | null) => void;
  setTemplateBrowserOpen: (open: boolean) => void;
  openTemplateBrowser: (category?: TemplateBrowserCategoryId | null) => void;
  clearTemplateBrowserInitialCategory: () => void;
  setGalleryLibraryOpen: (open: boolean) => void;

  resetToDefault: () => void;
}

const defaultState: SettingsState = {
  isLeftPanelOpen: false,
  leftPanelWidth: LEFT_PANEL_WIDTH_MIN,
  leftPanelTabIndex: -1,
  isRightPanelOpen: true,
  rightPanelWidth: RIGHT_PANEL_WIDTH_MIN,
  rightPanelTab: 'studio',
  executeButtonIndex: 0,
  studioViewMode: 'auto',
  workspacePanelPreferences: {},
  activeNodeGroups: [],
  nodeGroupBy: 'module',
  userBlockGrouping: 'source',
  edgeType: 'default',
  studioSectionOpen: {},
  modelTermsAcknowledgements: {},
};

const defaultVolatileState: SettingsStateVolatile = {
  fileBrowserOpener: null,
  modelManagerOpener: null,
  alertOpener: null,
  settingsOpener: null,
  lightboxOpener: null,
  mediaViewerOpener: null,
  mediaExportOpener: null,
  workflowFocusRequest: null,
  runActivityPendingTaskId: null,
  workflowLibraryView: 'start',
  templateBrowserOpen: false,
  templateBrowserInitialCategory: null,
  galleryLibraryOpen: false,
  runningState: 'one_shot',
};

const SETTINGS_STORAGE_KEY = 'modiff.settings';
migrateLocalStorageKey('settings', SETTINGS_STORAGE_KEY);

export const useSettingsStore = create<SettingsState & SettingsStateVolatile & SettingsActions>()(
  persist(
    (set, get) => ({
      ...defaultState,
      ...defaultVolatileState,

      // Actions
      setWorkflowLibraryView: (view) => set({ workflowLibraryView: view }),
      setLeftPanelOpen: (open: boolean) => set({ isLeftPanelOpen: open }),
      setLeftPanelWidth: (width: number) => set({ leftPanelWidth: Math.max(LEFT_PANEL_WIDTH_MIN, width) }),
      setLeftPanelTabIndex: (index: number) => set({ leftPanelTabIndex: index }),
      setRightPanelOpen: (open: boolean) => set({ isRightPanelOpen: open }),
      setRightPanelWidth: (width: number) => set({ rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_MIN, width) }),
      setRightPanelTab: (tab: WorkspacePanelTab) => set({ rightPanelTab: tab }),

      setExecuteButtonIndex: (index: number) => set({ executeButtonIndex: index }),
      setStudioViewMode: (mode: StudioViewMode) =>
        set((state) => {
          const view = mode === 'expert' ? 'expert' : 'auto';
          if (view === state.studioViewMode) return state;
          const panels = workspacePanels(state);
          return {
            ...panels,
            ...state.workspacePanelPreferences[workspaceModeForView(view)],
            studioViewMode: view,
            workspacePanelPreferences: {
              ...state.workspacePanelPreferences,
              [workspaceModeForView(state.studioViewMode)]: panels,
            },
          };
        }),

      setActiveNodeGroups: (group: string) => {
        const current = get().activeNodeGroups;
        if (current.includes(group)) {
          set({ activeNodeGroups: current.filter((g) => g !== group) });
        } else {
          set({ activeNodeGroups: [...current, group] });
        }
      },

      setNodeGroupBy: (by: 'module' | 'category') => set({ nodeGroupBy: by }),
      setUserBlockGrouping: (by: 'source' | 'workflow') => set({ userBlockGrouping: by }),

      setEdgeType: (type: 'default' | 'smoothstep') => set({ edgeType: type }),
      setStudioSectionOpen: (section: string, open: boolean) =>
        set((state) => ({
          studioSectionOpen: {
            ...state.studioSectionOpen,
            [section]: open,
          },
        })),
      acknowledgeModelTerms: (key: string) =>
        set((state) => ({
          modelTermsAcknowledgements: {
            ...state.modelTermsAcknowledgements,
            [key]: Date.now(),
          },
        })),

      setFileBrowserOpener: (opener: fileBrowserParams | null) => set({ fileBrowserOpener: opener }),
      setModelManagerOpener: (
        opener: { nodeId: string | null; fieldKey: string | null; focus?: FocusedModelManagerTarget } | null,
      ) => set({ modelManagerOpener: opener }),
      setAlertOpener: (
        opener: {
          title: string | null;
          message: string;
          confirmText: string | null;
          cancelText: string | null;
          onConfirm: () => void;
          onCancel?: () => void;
        } | null,
      ) => set({ alertOpener: opener }),
      setSettingsOpener: (opener: boolean | null) => set({ settingsOpener: opener }),
      setRunningState: (state: 'one_shot' | 'auto_queue' | 'loop') => set({ runningState: state }),
      setLightboxOpener: (opener: LightboxOpener) => set({ lightboxOpener: opener }),
      setMediaViewerOpener: (opener: MediaViewerOpener) => set({ mediaViewerOpener: opener }),
      setMediaExportOpener: (opener: MediaExportOpener) => set({ mediaExportOpener: opener }),
      setWorkflowFocusRequest: (request: WorkflowFocusRequest) => set({ workflowFocusRequest: request }),
      setRunActivityPendingTaskId: (taskId: string | null) => set({ runActivityPendingTaskId: taskId }),
      setTemplateBrowserOpen: (open: boolean) => set({ templateBrowserOpen: open }),
      openTemplateBrowser: (category?: TemplateBrowserCategoryId | null) =>
        set({
          templateBrowserOpen: true,
          templateBrowserInitialCategory: category ?? null,
        }),
      clearTemplateBrowserInitialCategory: () => set({ templateBrowserInitialCategory: null }),
      setGalleryLibraryOpen: (open: boolean) => set({ galleryLibraryOpen: open }),

      resetToDefault: () => set({ ...defaultState }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const { workspaceMode, ...value } =
          persisted && typeof persisted === 'object'
            ? (persisted as Partial<SettingsState> & { workspaceMode?: unknown })
            : {};
        return {
          ...current,
          ...value,
          studioViewMode: restoreWorkspaceView(workspaceMode, value.studioViewMode),
          workspacePanelPreferences: restoreWorkspacePanels(value.workspacePanelPreferences),
          userBlockGrouping: value.userBlockGrouping === 'workflow' ? 'workflow' : 'source',
          modelTermsAcknowledgements:
            value.modelTermsAcknowledgements && typeof value.modelTermsAcknowledgements === 'object'
              ? value.modelTermsAcknowledgements
              : {},
        };
      },
      partialize: (state) => {
        // remove the volatile keys from the state
        const persistedState: Partial<typeof state> = { ...state };
        const volatileKeys = Object.keys(defaultVolatileState) as (keyof SettingsStateVolatile)[];
        volatileKeys.forEach((key) => delete persistedState[key]);

        // return the state without the volatile keys
        // Derive both names from one live preference, retaining older-client restore.
        return { ...persistedState, workspaceMode: workspaceModeForView(state.studioViewMode) } as SettingsState;
      },
    },
  ),
);
