import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TemplateBrowserCategoryId } from '../studio/templateBrowser';
import type { FocusedModelManagerTarget, StudioViewMode, WorkspacePanelTab } from '../studio/types';
import type { ImageArtifact } from '../utils/imageArtifacts';
import { migrateLocalStorageKey } from '../utils/persistMigration';

const LEFT_PANEL_WIDTH_MIN = 240;
const RIGHT_PANEL_WIDTH_MIN = 320;

export interface fileBrowserParams {
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

  activeNodeGroups: string[];
  nodeGroupBy: 'module' | 'category';

  edgeType: 'default' | 'smoothstep';
  studioSectionOpen: Record<string, boolean>;
}

export type LightboxOpener = {
  images: string[];
  artifacts?: ImageArtifact[];
  currentIndex: number;
  dataType: string | null;
  mimeType: string | null;
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
  templateBrowserOpen: boolean;
  templateBrowserInitialCategory: TemplateBrowserCategoryId | null;
  galleryLibraryOpen: boolean;
  runningState: 'one_shot' | 'auto_queue' | 'loop';
}

interface SettingsActions {
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

  setEdgeType: (type: 'default' | 'smoothstep') => void;
  setStudioSectionOpen: (section: string, open: boolean) => void;

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
  isRightPanelOpen: false,
  rightPanelWidth: RIGHT_PANEL_WIDTH_MIN,
  rightPanelTab: 'studio',
  executeButtonIndex: 0,
  studioViewMode: 'auto',
  activeNodeGroups: [],
  nodeGroupBy: 'module',
  edgeType: 'default',
  studioSectionOpen: {},
};

const defaultVolatileState: SettingsStateVolatile = {
  fileBrowserOpener: null,
  modelManagerOpener: null,
  alertOpener: null,
  settingsOpener: null,
  lightboxOpener: null,
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
      setLeftPanelOpen: (open: boolean) => set({ isLeftPanelOpen: open }),
      setLeftPanelWidth: (width: number) => set({ leftPanelWidth: Math.max(LEFT_PANEL_WIDTH_MIN, width) }),
      setLeftPanelTabIndex: (index: number) => set({ leftPanelTabIndex: index }),
      setRightPanelOpen: (open: boolean) => set({ isRightPanelOpen: open }),
      setRightPanelWidth: (width: number) => set({ rightPanelWidth: Math.max(RIGHT_PANEL_WIDTH_MIN, width) }),
      setRightPanelTab: (tab: WorkspacePanelTab) => set({ rightPanelTab: tab }),

      setExecuteButtonIndex: (index: number) => set({ executeButtonIndex: index }),
      setStudioViewMode: (mode: StudioViewMode) => set({ studioViewMode: mode === 'expert' ? 'expert' : 'auto' }),

      setActiveNodeGroups: (group: string) => {
        const current = get().activeNodeGroups;
        if (current.includes(group)) {
          set({ activeNodeGroups: current.filter((g) => g !== group) });
        } else {
          set({ activeNodeGroups: [...current, group] });
        }
      },

      setNodeGroupBy: (by: 'module' | 'category') => set({ nodeGroupBy: by }),

      setEdgeType: (type: 'default' | 'smoothstep') => set({ edgeType: type }),
      setStudioSectionOpen: (section: string, open: boolean) =>
        set((state) => ({
          studioSectionOpen: {
            ...state.studioSectionOpen,
            [section]: open,
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
        const value = persisted && typeof persisted === 'object' ? (persisted as Partial<SettingsState>) : {};
        const legacyMode = (value as { studioViewMode?: unknown }).studioViewMode;
        return {
          ...current,
          ...value,
          studioViewMode: legacyMode === 'manual' || legacyMode === 'expert' ? 'expert' : 'auto',
        };
      },
      partialize: (state) => {
        // remove the volatile keys from the state
        const persistedState: Partial<typeof state> = { ...state };
        const volatileKeys = Object.keys(defaultVolatileState) as (keyof SettingsStateVolatile)[];
        volatileKeys.forEach((key) => delete persistedState[key]);

        // return the state without the volatile keys
        return persistedState as SettingsState;
      },
    },
  ),
);
