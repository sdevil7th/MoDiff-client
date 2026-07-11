import { useState } from 'react';
import type { ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  Brush,
  Clapperboard,
  Expand,
  GitCompareArrows,
  GalleryVerticalEnd,
  Layers,
  LoaderCircle,
  Network,
  ScanLine,
  SlidersHorizontal,
  Sparkles,
  Video,
} from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { createOrUpdateStudioGraph } from '../studio/graphBridge';
import { STUDIO_MODE_DESCRIPTIONS, STUDIO_MODE_LABELS } from '../studio/modelProfiles';
import type { StudioMode } from '../studio/types';
import { cx } from '../utils/classNames';

const launcherModes: { mode: StudioMode; icon: ReactNode }[] = [
  { mode: 'text_to_image', icon: <Sparkles size={18} /> },
  { mode: 'edit_image', icon: <Brush size={18} /> },
  { mode: 'multi_image_reference_edit', icon: <GitCompareArrows size={18} /> },
  { mode: 'inpaint', icon: <ScanLine size={18} /> },
  { mode: 'outpaint', icon: <Expand size={18} /> },
  { mode: 'control_image', icon: <SlidersHorizontal size={18} /> },
  { mode: 'layer_decomposition', icon: <Layers size={18} /> },
  { mode: 'text_to_video', icon: <Clapperboard size={18} /> },
  { mode: 'video_to_video', icon: <Video size={18} /> },
  { mode: 'video_color_edit', icon: <SlidersHorizontal size={18} /> },
  { mode: 'advanced_workflow', icon: <Network size={18} /> },
];

export default function TaskLauncher() {
  const [loadingMode, setLoadingMode] = useState<StudioMode | null>(null);
  const selectMode = useStudioStore((state) => state.selectMode);
  const setLauncherDismissed = useStudioStore((state) => state.setLauncherDismissed);
  const form = useStudioStore((state) => state.form);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setTemplateBrowserOpen = useSettingsStore((state) => state.setTemplateBrowserOpen);

  const handleModeSelect = async (mode: StudioMode) => {
    setLauncherDismissed(true);

    if (mode === 'advanced_workflow') {
      setRightPanelOpen(false);
      return;
    }

    selectMode(mode);
    setRightPanelOpen(true);
    setRightPanelTab('studio');
    setLoadingMode(mode);

    try {
      const selectedForm = { ...form, ...useStudioStore.getState().form, mode };
      await createOrUpdateStudioGraph(selectedForm);
      enqueueSnackbar(`${STUDIO_MODE_LABELS[mode]} graph ready`, { variant: 'success', autoHideDuration: 2200 });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 7000 });
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <div
      data-testid="task-launcher"
      className="absolute inset-0 z-[5] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-[920px] border border-modiff-border bg-modiff-surface p-4 shadow-modiff-node">
        <h1 className="mb-1 text-lg font-bold text-modiff-text">Start with a task</h1>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-modiff-muted">
            Pick a task mode, browse recipes, or jump straight into the graph.
          </p>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-modiff-compact bg-hf-yellow px-3 text-sm font-semibold text-black transition hover:bg-hf-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
            data-testid="launcher-open-template-browser"
            onClick={() => {
              setTemplateBrowserOpen(true);
              setRightPanelOpen(true);
              setRightPanelTab('studio');
            }}
          >
            <GalleryVerticalEnd size={16} />
            Browse recipes
          </button>
        </div>

        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
          {launcherModes.map(({ mode, icon }) => {
            const isLoading = loadingMode === mode;

            return (
              <button
                key={mode}
                type="button"
                disabled={loadingMode !== null}
                data-testid={`launcher-mode-${mode}`}
                onClick={() => {
                  void handleModeSelect(mode);
                }}
                className={cx(
                  'flex min-h-24 items-start justify-start gap-3 border border-modiff-border bg-modiff-bg p-3 text-left text-modiff-text transition',
                  'hover:border-hf-yellow/70 hover:bg-modiff-panel disabled:pointer-events-none disabled:opacity-50',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
                )}
              >
                <span className="mt-0.5 grid size-5 flex-none place-items-center text-hf-yellow">
                  {isLoading ? <LoaderCircle size={18} className="animate-spin" /> : icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold">{STUDIO_MODE_LABELS[mode]}</span>
                  <span className="mt-1 block text-xs leading-5 text-modiff-muted">
                    {STUDIO_MODE_DESCRIPTIONS[mode]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
