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
import { ModiffButton, ModiffDialog } from '../ui';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';

const launcherModes: { mode: StudioMode; icon: ReactNode }[] = [
  { mode: 'text_to_image', icon: <Sparkles size={18} /> },
  { mode: 'edit_image', icon: <Brush size={18} /> },
  { mode: 'multi_image_reference_edit', icon: <GitCompareArrows size={18} /> },
  { mode: 'inpaint', icon: <ScanLine size={18} /> },
  { mode: 'outpaint', icon: <Expand size={18} /> },
  { mode: 'control_image', icon: <SlidersHorizontal size={18} /> },
  { mode: 'control_edit_image', icon: <GitCompareArrows size={18} /> },
  { mode: 'control_inpaint', icon: <ScanLine size={18} /> },
  { mode: 'layer_decomposition', icon: <Layers size={18} /> },
  { mode: 'text_to_video', icon: <Clapperboard size={18} /> },
  { mode: 'image_to_video', icon: <Clapperboard size={18} /> },
  { mode: 'video_to_video', icon: <Video size={18} /> },
  { mode: 'video_color_edit', icon: <SlidersHorizontal size={18} /> },
  { mode: 'text_to_3d', icon: <Layers size={18} /> },
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
    <ModiffDialog
      open
      onClose={prepareWorkflowForManualInsertion}
      title="Start with a task"
      panelClassName="max-w-[920px]"
      bodyClassName="max-h-[78vh]"
      testId="task-launcher"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-modiff-subtle-text">
          Pick a task mode, browse templates, or jump straight into the graph.
        </p>
        <ModiffButton
          tone="primary"
          size="normal"
          icon={<GalleryVerticalEnd size={16} />}
          data-testid="launcher-open-template-browser"
          onClick={() => {
            prepareWorkflowForManualInsertion();
            setTemplateBrowserOpen(true);
            setRightPanelOpen(true);
            setRightPanelTab('studio');
          }}
        >
          Browse templates
        </ModiffButton>
      </div>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
        {launcherModes.map(({ mode, icon }) => {
          const isLoading = loadingMode === mode;

          return (
            <ModiffButton
              key={mode}
              tone="secondary"
              align="left"
              fullWidth
              disabled={loadingMode !== null}
              loading={isLoading}
              icon={icon}
              data-testid={`launcher-mode-${mode}`}
              onClick={() => {
                void handleModeSelect(mode);
              }}
              className="h-auto min-h-24 items-start gap-3 bg-modiff-bg p-3 hover:bg-modiff-panel"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold">{STUDIO_MODE_LABELS[mode]}</span>
                <span className="mt-1 block text-xs leading-5 text-modiff-subtle-text">
                  {STUDIO_MODE_DESCRIPTIONS[mode]}
                </span>
              </span>
            </ModiffButton>
          );
        })}
      </div>
    </ModiffDialog>
  );
}
