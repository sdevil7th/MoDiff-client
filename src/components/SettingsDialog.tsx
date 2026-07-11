import { useState } from 'react';
import { Activity, Clock3, Trash2 } from 'lucide-react';

import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useTaskStore } from '../stores/useTaskStore';
import { ModiffButton, ModiffIconButton, ModiffProgress } from '../ui';
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

  if (!opener) {
    return null;
  }

  return (
    <div className="relative z-50">
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="flex max-h-[75vh] w-full max-w-3xl flex-col overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node">
          <header className="border-b border-modiff-border bg-modiff-panel">
            <h2 className="sr-only">Settings</h2>
            <div className="flex flex-wrap gap-1 p-1">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx(
                    'inline-flex h-10 items-center rounded-modiff-compact px-3 text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow',
                    tab === item.id ? 'bg-hf-yellow text-black' : 'text-gray-300 hover:bg-white/10 hover:text-white',
                  )}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tab === 'preferences' && (
              <div className="mx-auto max-w-2xl">
                <div className="grid grid-cols-[minmax(120px,0.35fr)_minmax(0,1fr)] items-center gap-x-4 gap-y-3 text-sm text-modiff-text">
                  <div className="text-right font-semibold">Line type</div>
                  <fieldset className="flex flex-wrap gap-3">
                    <legend className="sr-only">Line type</legend>
                    {edgeOptions.map((option) => (
                      <label
                        key={option.id}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-modiff-compact px-1 py-1 text-sm text-gray-200 hover:bg-white/10"
                      >
                        <input
                          type="radio"
                          name="edge-type"
                          value={option.id}
                          checked={edgeType === option.id}
                          onChange={() => handleLineTypeChange(option.id)}
                          className="size-4 accent-hf-yellow"
                        />
                        {option.label}
                      </label>
                    ))}
                  </fieldset>

                  <div className="text-right font-semibold">Local storage</div>
                  <div>
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
                    <Clock3 size={18} className="shrink-0 text-gray-400" />
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
                <p className="mt-1 text-sm text-gray-300">This page will get better, I promise.</p>
              </div>
            )}
          </div>
          <footer className="flex justify-center gap-2 border-t border-modiff-border bg-modiff-panel px-4 py-3">
            <ModiffButton onClick={onClose}>Close</ModiffButton>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
