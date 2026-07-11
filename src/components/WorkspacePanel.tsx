import { AppWindow, CirclePlay, MoreHorizontal, Rocket, Settings2, type LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import type { WorkspacePanelTab } from '../studio/types';
import { ModiffMenu, ModiffMenuItem } from '../ui';
import { cx } from '../utils/classNames';
import { handleHorizontalWheel } from '../utils/horizontalWheel';
import ModelSetupPanel from './ModelSetupPanel';
import RunQueuePanel from './RunQueuePanel';
import StudioPanel from './StudioPanel';
import AppModePanel from './AppModePanel';

const tabs: { value: WorkspacePanelTab; label: string; Icon: LucideIcon }[] = [
  { value: 'studio', label: 'Studio', Icon: Rocket },
  { value: 'queue', label: 'Queue', Icon: CirclePlay },
  { value: 'setup', label: 'Setup', Icon: Settings2 },
  { value: 'app', label: 'Run as app', Icon: AppWindow },
];

export default function WorkspacePanel() {
  const rightPanelTab = useSettingsStore((state) => state.rightPanelTab);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const studioViewMode = useSettingsStore((state) => state.studioViewMode);
  const appModeConfigs = useStudioStore((state) => state.appModeConfigs);
  const hasAppOutputNode = useFlowStore((state) =>
    state.nodes.some((node) => /preview|save|output|video|audio|image/i.test(`${node.data?.label ?? ''} ${node.id}`)),
  );
  const primaryTabs = tabs.filter((tab) => tab.value === 'studio' || tab.value === 'queue' || tab.value === 'setup');
  const overflowTabs =
    studioViewMode === 'expert'
      ? tabs.filter((tab) => tab.value === 'app' && (appModeConfigs.length > 0 || hasAppOutputNode))
      : [];
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
        role="tablist"
        aria-label="Workspace panels"
        className="flex min-h-[42px] flex-none overflow-x-auto overflow-y-hidden border-b border-modiff-border bg-modiff-bg"
        onWheel={handleHorizontalWheel}
      >
        {visibleTabs.map((tab) => {
          const selected = activeTab === tab.value;
          const Icon = tab.Icon;

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`workspace-tab-${tab.value}`}
              onClick={() => setRightPanelTab(tab.value)}
              className={cx(
                'inline-flex h-[42px] min-w-[72px] flex-none items-center justify-center gap-1.5 px-2 text-xs font-semibold transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hf-yellow',
                selected ? 'bg-modiff-panel text-hf-yellow' : 'text-gray-300 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
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
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {activeTab === 'studio' && <StudioPanel />}
        {activeTab === 'queue' && <RunQueuePanel />}
        {activeTab === 'setup' && <ModelSetupPanel />}
        {activeTab === 'app' && <AppModePanel />}
      </div>
    </div>
  );
}
