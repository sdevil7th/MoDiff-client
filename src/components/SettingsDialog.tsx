// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useState } from 'react';
import { Activity, Clock3, Trash2 } from 'lucide-react';

import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useTaskStore } from '../stores/useTaskStore';
import {
  ModiffButton,
  ModiffDialog,
  ModiffFieldShell,
  ModiffIconButton,
  ModiffProgress,
  ModiffRadioGroup,
  ModiffTabs,
} from '../ui';
import { cx } from '../utils/classNames';
import { enqueueSnackbar } from '../ui/snackbar';
import { formatRequestError } from '../utils/requestJson';
import { cancelQueuedTask } from '../utils/serverActions';

const tabs = [
  { id: 'preferences', label: 'Preferences' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'about', label: 'About' },
] as const;

type SettingsTab = (typeof tabs)[number]['id'];

const edgeOptions = [
  { id: 'default', label: 'Curve' },
  { id: 'smoothstep', label: 'Step' },
] as const;

const SettingsDialog = ({ opener, onClose }: { opener: boolean | null; onClose: () => void }) => {
  const { edgeType, setEdgeType, resetToDefault } = useSettingsStore();
  const setAllEdgesType = useFlowStore((state) => state.setAllEdgesType);

  const { queuedTasks, currentTask, taskCount } = useTaskStore();

  const [tab, setTab] = useState<SettingsTab>('preferences');

  const handleLineTypeChange = (value: 'default' | 'smoothstep') => {
    setEdgeType(value);
    setAllEdgesType(value);
  };

  const handleResetToDefault = () => {
    resetToDefault();
    setAllEdgesType('default');
  };

  const handleCancelTask = async (task_id: string) => {
    try {
      await cancelQueuedTask(task_id);
    } catch (error) {
      console.error('Failed to cancel task', error);
      enqueueSnackbar(formatRequestError(error, 'Failed to cancel task'), {
        variant: 'error',
        autoHideDuration: 1500,
      });
    }
  };

  return (
    <ModiffDialog
      open={Boolean(opener)}
      onClose={onClose}
      title="Settings"
      panelClassName="max-w-3xl"
      bodyClassName="!max-h-[68vh] !p-0"
      footer={<ModiffButton onClick={onClose}>Close</ModiffButton>}
    >
      <ModiffTabs
        aria-label="Settings sections"
        className="sticky top-0 z-[1] border-b border-modiff-border bg-modiff-panel p-1"
        options={tabs.map((item) => ({
          value: item.id,
          label: item.label,
          id: `settings-tab-${item.id}`,
          controls: `settings-panel-${item.id}`,
        }))}
        value={tab}
        onValueChange={setTab}
        size="prominent"
      />
      {tabs
        .filter((item) => item.id !== tab)
        .map((item) => (
          <div
            key={item.id}
            id={`settings-panel-${item.id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${item.id}`}
            hidden
          />
        ))}
      <div id={`settings-panel-${tab}`} role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="p-4">
        {tab === 'preferences' && (
          <div className="mx-auto max-w-2xl">
            <div className="grid gap-3 text-sm text-modiff-text">
              <ModiffFieldShell
                label="Line type"
                layout="inline"
                labelClassName="w-32 shrink-0 text-right text-sm text-modiff-text"
                className="gap-4"
              >
                <ModiffRadioGroup
                  aria-label="Line type"
                  className="flex flex-wrap gap-3"
                  name="edge-type"
                  value={edgeType}
                  options={edgeOptions.map((option) => ({ value: option.id, label: option.label }))}
                  onValueChange={(value) => handleLineTypeChange(value as 'default' | 'smoothstep')}
                />
              </ModiffFieldShell>

              <div className="flex items-center gap-4">
                <span className="w-32 shrink-0 text-right text-sm font-semibold text-modiff-subtle-text">
                  Local storage
                </span>
                <ModiffButton icon={<Trash2 size={15} />} onClick={handleResetToDefault}>
                  Reset to default
                </ModiffButton>
              </div>
            </div>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="overflow-hidden rounded-modiff-compact border border-modiff-border">
            <div className="border-b border-modiff-border px-3 py-3 text-center text-sm font-bold text-modiff-green">
              {`${taskCount ? taskCount : 'No'} tasks queued`}
            </div>

            {currentTask && (
              <div className="flex items-center gap-3 border-b border-modiff-border px-3 py-3 text-sm text-modiff-text">
                <Activity size={18} className="shrink-0 text-hf-yellow" />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{`[${currentTask.task_id?.substring(0, 6)}] ${currentTask.name}`}</div>
                  <ModiffProgress value={currentTask.progress ?? 0} className="mt-2 max-w-[250px]" />
                </div>
              </div>
            )}

            {Object.entries(queuedTasks).map(([task_id, task]) => (
              <div
                key={task_id}
                className="flex items-center gap-3 border-b border-modiff-border px-3 py-3 text-sm text-modiff-text last:border-b-0"
              >
                <Clock3 size={18} className="shrink-0 text-modiff-subtle-text" />
                <div className="min-w-0 flex-1 truncate">{`[${task_id.substring(0, 6)}] ${task.name}`}</div>
                <ModiffIconButton
                  label="Cancel task"
                  className="border border-modiff-red text-modiff-red hover:bg-modiff-red/10 hover:text-modiff-red"
                  onClick={() => {
                    void handleCancelTask(task_id);
                  }}
                >
                  <Trash2 size={15} />
                </ModiffIconButton>
              </div>
            ))}
          </div>
        )}

        {tab === 'about' && (
          <div
            className={cx(
              'flex min-h-48 flex-col items-center justify-center text-center text-modiff-text',
              'rounded-modiff-compact border border-modiff-border bg-modiff-bg p-6',
            )}
          >
            <p className="text-base font-semibold">
              <b>MoDiff</b>, modular diffusion without the hype.
            </p>
            <p className="mt-1 text-sm text-modiff-subtle-text">This page will get better, I promise.</p>
          </div>
        )}
      </div>
    </ModiffDialog>
  );
};

export default SettingsDialog;
