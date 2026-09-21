import { lazy, Suspense, useState } from 'react';
import type { CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore } from '../stores/useNodeStore';
import { blockOperationGraphV2 } from '../studio/blockRuntimeV2';
import { operationAuthoring } from '../workflow/operationAuthoring';
import { ModiffDisclosure, ModiffFieldShell, ModiffSelect } from '../ui';
import OperationGraphControls from './OperationGraphControls';

const BlockModelTaskControls = lazy(() => import('./BlockModelTaskControls'));

/** Local target choices never change library browsing or the authored graph. */
export default function OperationOwnerControls({ node }: { node: CustomNodeType }) {
  if (node.data.blockInstanceV2) return <BlockOwnerChoices node={node} />;
  const hint = operationAuthoring(node);
  if (
    !hint ||
    !hint.operation.pipelineClass ||
    !hint.operation.task ||
    hint.operation.decomposition !== 'loader' ||
    (node.parentId && !node.data.blockProjectionOwnerId)
  )
    return null;
  return (
    <OwnerChoices
      key={`${node.id}:${hint.operation.pipelineClass}:${hint.operation.task}`}
      ownerId={node.data.blockProjectionNodeId ?? node.id}
      blockId={node.data.blockProjectionOwnerId}
      pipelineClass={hint.operation.pipelineClass}
      currentTask={hint.operation.task}
    />
  );
}

function BlockOwnerChoices({ node }: { node: CustomNodeType }) {
  const loaders = blockOperationGraphV2(node.data.blockInstanceV2!).nodes.filter(
    (candidate) => operationAuthoring(candidate)?.operation.decomposition === 'loader',
  );
  const [choice, setChoice] = useState('');
  const loader = loaders.find((candidate) => candidate.data.blockProjectionNodeId === choice) ?? loaders[0];
  const hint = loader ? operationAuthoring(loader) : null;
  if (!loader || !hint?.operation.pipelineClass || !hint.operation.task)
    return node.data.blockInstanceV2!.effectiveGraph.nodes.some((n) => n.modularDiffusers) ||
      node.data.blockInstanceV2!.routeSelection?.routeSetId === 'diffusers.definition-switch:v1' ? (
      <Suspense fallback={<p role="status">Loading model/task controls…</p>}>
        <BlockModelTaskControls node={node} />
      </Suspense>
    ) : null;
  return (
    <div className="grid gap-2">
      {loaders.length > 1 ? (
        <ModiffFieldShell label="Loader to change">
          <ModiffSelect
            aria-label="Block loader to change"
            value={loader.data.blockProjectionNodeId!}
            onValueChange={setChoice}
            options={loaders.map((candidate) => ({
              value: candidate.data.blockProjectionNodeId!,
              label: `${candidate.data.label} · ${candidate.data.operationAuthoring!.operation.pipelineClass} · ${candidate.data.blockProjectionNodeId}`,
            }))}
          />
        </ModiffFieldShell>
      ) : null}
      <OwnerChoices
        key={`${loader.id}:${hint.operation.pipelineClass}:${hint.operation.task}`}
        ownerId={loader.data.blockProjectionNodeId!}
        blockId={node.id}
        pipelineClass={hint.operation.pipelineClass}
        currentTask={hint.operation.task}
      />
    </div>
  );
}

function OwnerChoices({
  ownerId,
  blockId,
  pipelineClass,
  currentTask,
}: {
  ownerId: string;
  blockId?: string;
  pipelineClass: string;
  currentTask: string;
}) {
  const support = useNodesStore((state) => state.pipelineSupport);
  const models = useNodesStore((state) => state.studioModelCapabilities);
  const [pipeline, setPipeline] = useState(pipelineClass);
  const [task, setTask] = useState(currentTask);
  const [profileId, setProfileId] = useState('');
  const pipelines = support.filter((p) => p.tasks.some((t) => t.operationIds.length));
  const entry = pipelines.find((p) => p.pipelineClass === pipeline);
  const tasks = entry?.tasks.filter((t) => t.operationIds.length) ?? [];
  const selected = tasks.find((t) => t.task === task);
  const profiles = models.flatMap((model) =>
    (model.executionProfiles ?? [])
      .filter((profile) => selected?.executionProfileIds.includes(profile.id))
      .map((profile) => ({ value: profile.id, label: `${model.label} · ${profile.default_repo}` })),
  );
  return (
    <ModiffDisclosure label="Change model / task" panelClassName="grid gap-2 py-2">
      <p className="text-xs text-modiff-subtle-text">
        Review changes to this loader and its connected nodes. Model files and resources are checked when you run.
      </p>
      <ModiffFieldShell label="Pipeline">
        <ModiffSelect
          aria-label="Replacement pipeline"
          value={pipeline}
          onValueChange={(value) => {
            const next = pipelines.find((p) => p.pipelineClass === value)?.tasks.filter((t) => t.operationIds.length);
            setPipeline(value);
            setProfileId('');
            setTask(next?.find((t) => t.task === task)?.task ?? next?.[0]?.task ?? '');
          }}
          options={pipelines.map((p) => ({ value: p.pipelineClass, label: p.pipelineClass }))}
        />
      </ModiffFieldShell>
      <ModiffFieldShell label="Task">
        <ModiffSelect
          aria-label="Replacement task"
          value={selected?.task ?? ''}
          onValueChange={(value) => {
            setTask(value);
            setProfileId('');
          }}
          options={tasks.map((t) => ({ value: t.task, label: t.task.replace(/_/gu, ' ') }))}
        />
      </ModiffFieldShell>
      {profiles.length ? (
        <ModiffFieldShell label="Model">
          <ModiffSelect
            aria-label="Replacement model"
            value={profileId}
            onValueChange={setProfileId}
            options={[{ value: '', label: 'Keep compatible model selection' }, ...profiles]}
          />
        </ModiffFieldShell>
      ) : null}
      {selected ? (
        <OperationGraphControls
          pipeline={pipeline}
          task={selected.task}
          ownerId={ownerId}
          blockId={blockId}
          executionProfileId={profiles.some((profile) => profile.value === profileId) ? profileId : undefined}
        />
      ) : (
        <p role="status" className="text-xs text-modiff-subtle-text">
          Select an available pipeline and task to preview a change.
        </p>
      )}
    </ModiffDisclosure>
  );
}
