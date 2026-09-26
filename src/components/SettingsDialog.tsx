// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useState } from 'react';
import { Activity, Clock3, RotateCcw, Settings, Trash2 } from 'lucide-react';

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
      title={
        <span className="flex items-center gap-2">
          <Settings size={17} className="text-hf-yellow" />
          Settings
        </span>
      }
      description="App preferences and current task activity."
      panelClassName="max-w-2xl"
      bodyClassName="!p-0"
      testId="settings-dialog"
      footer={<ModiffButton onClick={onClose}>Close</ModiffButton>}
      toolbar={
        <ModiffTabs
          aria-label="Settings sections"
          className="p-2"
          options={tabs.map((item) => ({
            value: item.id,
            label: item.label,
            id: `settings-tab-${item.id}`,
            controls: `settings-panel-${item.id}`,
          }))}
          value={tab}
          onValueChange={setTab}
          size="normal"
        />
      }
    >
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
          <div className="grid gap-5 text-sm text-modiff-text">
            <section className="grid gap-3">
              <h3 className="font-semibold">Graph appearance</h3>
              <ModiffFieldShell
                label="Connection style"
                description="Applies to connections on the canvas and newly added links."
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
            </section>
            <section className="flex flex-wrap items-center justify-between gap-3 border-t border-modiff-border pt-4">
              <div className="min-w-0 flex-1 basis-56">
                <h3 className="font-semibold">Restore app preferences</h3>
                <p className="mt-1 text-modiff-subtle-text">
                  Reset view and panel preferences. Saved workflow files and downloaded models are not deleted.
                </p>
              </div>
              <ModiffButton icon={<RotateCcw size={15} />} onClick={handleResetToDefault}>
                Reset preferences
              </ModiffButton>
            </section>
          </div>
        )}

        {tab === 'tasks' && (
          <div className="overflow-hidden rounded-modiff-compact border border-modiff-border">
            <div className="flex items-center gap-2 border-b border-modiff-border bg-modiff-panel px-3 py-3 text-sm font-semibold text-modiff-text">
              <Clock3 size={16} className="text-modiff-subtle-text" />
              {taskCount ? `${taskCount} task${taskCount === 1 ? '' : 's'} in queue` : 'No queued tasks'}
            </div>
            {!currentTask && Object.keys(queuedTasks).length === 0 ? (
              <p className="p-4 text-sm text-modiff-subtle-text">
                Run a workflow to see its progress here. Pending tasks can be cancelled individually.
              </p>
            ) : null}

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
          <div className="grid gap-3 text-sm text-modiff-subtle-text">
            <h3 className="text-base font-semibold text-modiff-text">MoDiff</h3>
            <p>A graph workspace for generating images, video and audio with modular model workflows.</p>
            <p>
              Use a Block as one node, or expand it to inspect and customize its connected blocks. Save workflow changes
              to keep prompts, parameters and layout.
            </p>
            <p>
              Models manages local artifacts and Hugging Face downloads. Setup contains runtime diagnostics and recovery
              actions.
            </p>
          </div>
        )}
      </div>
    </ModiffDialog>
  );
};

export default SettingsDialog;
