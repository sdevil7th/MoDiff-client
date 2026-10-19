import { useState } from 'react';
import selections from '../../tests/fixtures/weight-format-selections.v1.json';
import WorkflowModelInventoryRow from '../components/WorkflowModelInventoryRow';
import type { StudioAutoResourceInstallTarget } from '../studio/autoResource';
import { parseWorkflowModelDescriptors } from '../workflow/workflowChoices';

// Generic future public metadata exercises discovery/install presentation only.
// The captured pure file inventories do not publish the original private model.
const source = selections.rows[0]!;
const profiles = [
  {
    id: 'future-native',
    model_type: 'FutureNativePipeline',
    pipeline_class: 'FutureNativePipeline',
    default_repo: source.repo,
    public: true,
  },
];
const capability = {
  modelType: 'FutureNativePipeline',
  label: 'Future declared model',
  defaultRepo: source.repo,
  executionStatus: 'expert_only',
  qualificationStatus: 'contract-only',
  revisionCandidates: [source.revision],
  downloadFiles: ['model_index.json', 'transformer/model.safetensors'],
  weightFormatSelections: source.weightFormatSelections,
  executionProfiles: profiles,
};
const descriptors = parseWorkflowModelDescriptors(
  {
    schemaVersion: 2,
    capabilities: [
      capability,
      {
        ...capability,
        modelType: 'PrivateCandidate',
        executionProfiles: [{ ...profiles[0]!, id: 'private', model_type: 'PrivateCandidate', public: false }],
      },
    ],
  },
  [
    {
      pipelineClass: 'FutureNativePipeline',
      coverage: 'contract-only',
      reason: 'Presentation fixture only',
      equivalentTo: [],
      upstreamTasks: [],
      tasks: [
        {
          task: 'text_to_image',
          execution: 'declared',
          decomposition: 'stages',
          dependencies: 'unknown',
          runtimeRequirements: [],
          operationIds: ['load'],
          executionProfileIds: ['future-native', 'private'],
        },
      ],
    },
  ],
);

export function WorkflowModelInventoryFixture() {
  const [target, setTarget] = useState<StudioAutoResourceInstallTarget | null>(null);
  return (
    <main className="m-4 grid w-[368px] min-w-0 gap-3" data-testid="inventory-fixture">
      {descriptors.map((descriptor) => (
        <WorkflowModelInventoryRow
          key={descriptor.profileId}
          descriptor={descriptor}
          cache={[
            {
              id: source.repo,
              complete: true,
              installed: true,
              planned_revision: source.revision,
              planned_files: capability.downloadFiles,
            },
          ]}
          local={[]}
          diagnostics={null}
          installProgress={{}}
          activeInstallCount={0}
          hfTokenConfigured
          onConfigureHfToken={() => {
            throw new Error('This fixture requires no token.');
          }}
          onInstall={async (value) => {
            setTarget(value);
          }}
        />
      ))}
      <pre data-testid="inventory-target" className="min-w-0 overflow-auto text-modiff-metadata">
        {JSON.stringify(target)}
      </pre>
      <pre data-testid="inventory-choices" className="min-w-0 overflow-auto text-modiff-metadata">
        {JSON.stringify(source.weightFormatSelections)}
      </pre>
    </main>
  );
}
