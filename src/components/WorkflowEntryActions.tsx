import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { prepareWorkflowForManualInsertion } from '../studio/manualGraphInsertion';
import { ModiffButton } from '../ui';

/** Shared document actions; workspace choice never creates another graph format. */
export default function WorkflowEntryActions({ templates = false }: { templates?: boolean }) {
  const workflow = useStudioStore((state) => state.activeWorkflowTabId);
  const tabs = useStudioStore((state) => state.workflowTabs);
  const recent = [...tabs]
    .filter((tab) => tab.id !== workflow)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 6);
  const dismiss = () => prepareWorkflowForManualInsertion({ revealWorkspace: false });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <ModiffButton onClick={() => prepareWorkflowForManualInsertion()} data-testid="launcher-mode-advanced_workflow">
          Empty workflow
        </ModiffButton>
        <ModiffButton
          onClick={() => {
            dismiss();
            useSettingsStore.getState().setLeftPanelTabIndex(4);
            useSettingsStore.getState().setLeftPanelOpen(true);
          }}
        >
          Open workflow
        </ModiffButton>
        {templates ? (
          <ModiffButton
            onClick={() => {
              dismiss();
              useSettingsStore.getState().setTemplateBrowserOpen(true);
            }}
          >
            Browse templates
          </ModiffButton>
        ) : null}
      </div>
      {recent.length ? (
        <section aria-label="Recent workflows" className="space-y-1">
          <h3 className="text-xs font-semibold text-modiff-subtle-text">Recent workflows</h3>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {recent.map((tab) => (
              <ModiffButton
                key={tab.id}
                title={tab.title}
                className="max-w-56 shrink-0"
                onClick={() => {
                  dismiss();
                  useStudioStore.getState().switchWorkflowTab(tab.id);
                }}
              >
                <span className="truncate">{tab.title}</span>
              </ModiffButton>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
