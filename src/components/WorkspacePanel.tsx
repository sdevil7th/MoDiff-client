import { AlertTriangle, AppWindow, CirclePlay, MoreHorizontal, Rocket, Settings2, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { WorkspacePanelTab } from '../studio/types';
import { ModiffMenu, ModiffMenuItem, ModiffTabs } from '../ui';
import { handleHorizontalWheel } from '../utils/horizontalWheel';
import ModelSetupPanel from './ModelSetupPanel';
import RunQueuePanel from './RunQueuePanel';
import StudioPanel from './StudioPanel';
import AppModePanel from './AppModePanel';
import CompatibilityPanel from './CompatibilityPanel';
import BlockEditorPanelV2 from './BlockEditorPanelV2';
import { useBlockEditorStore } from '../stores/useBlockEditorStore';

const tabs: { value: WorkspacePanelTab; label: string; Icon: LucideIcon }[] = [
  { value: 'studio', label: 'Studio', Icon: Rocket },
  { value: 'block', label: 'Block', Icon: Settings2 },
  { value: 'compatibility', label: 'Compatibility', Icon: AlertTriangle },
  { value: 'queue', label: 'Queue', Icon: CirclePlay },
  { value: 'setup', label: 'Setup', Icon: Settings2 },
  { value: 'app', label: 'Run as app', Icon: AppWindow },
];

export default function WorkspacePanel() {
  const blockEditor = useBlockEditorStore((state) => state.target);
  const rightPanelTab = useSettingsStore((state) => state.rightPanelTab);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const appModeConfigs = useStudioStore((state) => state.appModeConfigs);
  const hasAppOutputNode = useFlowStore((state) =>
    state.nodes.some((node) => /preview|save|output|video|audio|image/i.test(`${node.data?.label ?? ''} ${node.id}`)),
  );
  const primaryTabs = tabs.filter(
    (tab) =>
      tab.value === 'studio' ||
      (tab.value === 'block' && Boolean(blockEditor)) ||
      tab.value === 'queue' ||
      tab.value === 'setup' ||
      (tab.value === 'compatibility' && rightPanelTab === 'compatibility'),
  );
  const overflowTabs = tabs.filter((tab) => tab.value === 'app' && (appModeConfigs.length > 0 || hasAppOutputNode));
  const activeOverflowTab = overflowTabs.find((tab) => tab.value === rightPanelTab);
  const visibleTabs = activeOverflowTab ? [...primaryTabs, activeOverflowTab] : primaryTabs;
  const activeTab = visibleTabs.some((tab) => tab.value === rightPanelTab) ? rightPanelTab : 'studio';

  useEffect(() => {
    if (activeTab !== rightPanelTab) {
      setRightPanelTab(activeTab);
    }
  }, [activeTab, rightPanelTab, setRightPanelTab]);

  return (
    <div className="flex h-full flex-col" data-testid="workspace-panel">
      <div
        aria-label="Workspace panels"
        className="flex min-h-[42px] flex-none overflow-x-auto overflow-y-hidden border-b border-modiff-border bg-modiff-bg"
        onWheel={handleHorizontalWheel}
      >
        <ModiffTabs
          aria-label="Workspace panels"
          className="min-w-0 flex-1 flex-nowrap gap-0"
          value={activeTab}
          onValueChange={setRightPanelTab}
          options={visibleTabs.map((tab) => {
            const Icon = tab.Icon;
            return {
              value: tab.value,
              id: `workspace-tab-${tab.value}`,
              controls: `workspace-panel-${tab.value}`,
              label: (
                <>
                  <Icon size={15} />
                  <span>{tab.label}</span>
                </>
              ),
              testId: `workspace-tab-${tab.value}`,
              className: 'h-[42px] min-w-[72px] flex-none justify-center gap-1.5 rounded-none px-2 text-xs',
            };
          })}
        />
        {overflowTabs.length > 0 && (
          <div className="flex h-[42px] flex-none items-center px-1" data-testid="workspace-tabs-more">
            <ModiffMenu
              label={
                <>
                  <MoreHorizontal size={16} />
                  <span className="sr-only">More panels</span>
                </>
              }
            >
              {overflowTabs.map((tab) => {
                const Icon = tab.Icon;
                return (
                  <ModiffMenuItem
                    key={tab.value}
                    active={activeTab === tab.value}
                    onClick={() => setRightPanelTab(tab.value)}
                  >
                    <Icon size={15} />
                    <span>{tab.label}</span>
                  </ModiffMenuItem>
                );
              })}
            </ModiffMenu>
          </div>
        )}
      </div>
      {visibleTabs
        .filter((tab) => tab.value !== activeTab)
        .map((tab) => (
          <div
            key={tab.value}
            id={`workspace-panel-${tab.value}`}
            role="tabpanel"
            aria-labelledby={`workspace-tab-${tab.value}`}
            hidden
          />
        ))}
      <div
        id={`workspace-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`workspace-tab-${activeTab}`}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
      >
        {activeTab === 'studio' && <StudioPanel />}
        {activeTab === 'block' && <BlockEditorPanelV2 />}
        {activeTab === 'compatibility' && <CompatibilityPanel />}
        {activeTab === 'queue' && <RunQueuePanel />}
        {activeTab === 'setup' && <ModelSetupPanel />}
        {activeTab === 'app' && <AppModePanel />}
      </div>
    </div>
  );
}
