import { ReactFlowProvider } from '@xyflow/react';
import NodeContent from '../components/NodeContent';
import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { graphNodeControlParams, updateGraphNodeControl } from '../studio/graphNodeControls';
import { createBlockInstanceV2, migrateUserBlockDefinitionV1 } from '../studio/blockSchemaV2';
import { createBlockRootNodeV2 } from '../studio/blockRuntimeV2';
import { ModiffButton } from './primitives';

const query = new URLSearchParams(window.location.search);
const grouped = query.has('block');
const defaulted = query.has('structured-default');
const version = query.has('v2') ? 2 : 1;
const boundReferences = query.has('bound-references');
const fixtureId = grouped ? 'layout-block' : 'layout-ordinary';
const initialLayout = {
  schemaVersion: version,
  coordinateSpace: 'normalized_xyxy',
  regions: [
    {
      id: 'subject',
      description: 'Original region',
      targetBox: [0.1, 0.2, 0.7, 0.9],
      ...(version === 2 ? { action: 'place' } : {}),
    },
  ],
};
const node: CustomNodeType = {
  id: grouped ? 'layout-encode-leaf' : fixtureId,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: 'custom',
    module: 'ControlFixture',
    action: 'EncodeInputs',
    label: 'Encode Inputs',
    category: 'Control fixture',
    params: {
      prompt: {
        label: 'Prompt',
        type: 'string',
        display: 'textarea',
        value: 'Keep the raw <subject> prompt exactly.\n',
      },
      layout_conditioning: {
        label: 'Layout',
        type: 'layout_conditioning',
        display: 'layout',
        ...(defaulted ? { default: initialLayout } : { value: null, default: null }),
        disabled: query.has('disabled'),
        fieldOptions: {
          layoutConditioning: {
            schemaVersion: version,
            sourceRegions: false,
            ...(boundReferences ? { supportsBoundSourceRegions: true } : {}),
          },
        },
      },
    },
  },
};
const referenceNode: CustomNodeType = {
  id: 'layout-reference-source',
  type: 'custom',
  position: { x: -400, y: 0 },
  data: {
    type: 'custom',
    module: 'ControlFixture',
    action: 'EncodeReference',
    label: 'Reference source',
    category: 'Control fixture',
    params: {
      file: { type: 'string', display: 'text', label: 'Reference file', value: 'reference-a.png' },
      reference_binding: { type: 'reference_conditioning', display: 'output' },
      layout_reference_summary: { type: 'string', display: 'output', hidden: true },
    },
  },
};
if (boundReferences) node.data.params.reference_binding = { type: 'reference_conditioning', display: 'input' };
const fixtureNodes = boundReferences ? [referenceNode, node] : [node];
const fixtureEdges = boundReferences
  ? [
      {
        id: 'bound-reference',
        source: referenceNode.id,
        sourceHandle: 'reference_binding',
        target: node.id,
        targetHandle: 'reference_binding',
      },
    ]
  : [];
if (query.has('source-region'))
  node.data.params.layout_conditioning!.value = {
    ...initialLayout,
    regions: [{ ...initialLayout.regions[0]!, source: { referenceIndex: 0, box: [0, 0, 1, 1] } }],
  };

// Development-only fixture using the same field and ordinary/Block control paths.
if (query.has('layout-conditioning') && !useFlowStore.getState().nodes.some(({ id }) => id === fixtureId)) {
  const definition = migrateUserBlockDefinitionV1({
    id: 'layout-controls',
    name: 'Encode Inputs',
    version: 1,
    nodes: fixtureNodes,
    edges: fixtureEdges,
    inputs: [],
    outputs: [],
    exposedParams: [
      ...Object.keys(node.data.params)
        .filter((key) => key !== 'reference_binding')
        .map((key) => ({
          id: key,
          kind: 'graph-param' as const,
          label: key,
          nodeId: node.id,
          paramKey: key,
        })),
      ...(boundReferences
        ? [
            {
              id: 'reference_file',
              kind: 'graph-param' as const,
              label: 'Reference file',
              nodeId: referenceNode.id,
              paramKey: 'file',
            },
          ]
        : []),
    ],
    createdAt: 1,
    updatedAt: 1,
  });
  const root = grouped
    ? createBlockRootNodeV2(
        createBlockInstanceV2(definition, {
          instanceId: fixtureId,
          position: { x: 0, y: 0 },
          size: { width: 368, height: 480 },
        }),
      )
    : node;
  useFlowStore.setState({
    nodes: grouped ? [root] : fixtureNodes,
    edges: grouped ? [] : fixtureEdges,
    historyPast: [],
    historyFuture: [],
    historyTransaction: null,
  });
}
if (query.has('layout-conditioning')) useStudioStore.setState({ activeWorkflowTabId: 'layout-widget-fixture' });

export function LayoutConditioningFixture() {
  const nodes = useFlowStore((state) => state.nodes);
  const owner = nodes.find(({ id }) => id === fixtureId)!;
  const params = graphNodeControlParams(owner);
  const currentLayout = params.layout_conditioning?.value ?? params.layout_conditioning?.default ?? null;
  const setLayout = (value: unknown) =>
    updateGraphNodeControl('layout-widget-fixture', fixtureId, 'layout_conditioning', value);
  return (
    <ReactFlowProvider>
      <main
        className="m-4 grid w-[368px] min-w-0 gap-3 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-3"
        data-testid="layout-widget"
      >
        <h1 className="text-modiff-card-title text-modiff-text">{grouped ? 'Block' : 'Ordinary'} layout controls</h1>
        <NodeContent
          nodeId={fixtureId}
          module={owner.data.module}
          action={owner.data.action}
          params={params}
          updateStore={(key, value) => updateGraphNodeControl('layout-widget-fixture', fixtureId, key, value)}
        />
        <div className="flex flex-wrap gap-2">
          <ModiffButton
            onClick={() => {
              if (grouped)
                useFlowStore
                  .getState()
                  .setBlockPresentationV2(fixtureId, { expanded: !owner.data.blockInstanceV2!.presentation.expanded });
              else useFlowStore.getState().setParam(fixtureId, 'layout_conditioning', structuredClone(currentLayout));
            }}
          >
            Refresh equivalent controls
          </ModiffButton>
          <ModiffButton
            onClick={() =>
              setLayout({
                ...initialLayout,
                regions: [{ ...initialLayout.regions[0]!, description: 'Concurrent edit' }],
              })
            }
          >
            Apply concurrent layout
          </ModiffButton>
          <ModiffButton onClick={() => useFlowStore.getState().undo()}>Undo</ModiffButton>
          <ModiffButton onClick={() => useFlowStore.getState().redo()}>Redo</ModiffButton>
          {boundReferences ? (
            <ModiffButton
              onClick={() => {
                if (grouped)
                  useFlowStore.getState().setBlockInstanceValueV2(fixtureId, 'reference_file', 'reference-b.png');
                else useFlowStore.getState().setParamWithHistory(referenceNode.id, 'file', 'reference-b.png');
              }}
            >
              Replace reference media
            </ModiffButton>
          ) : null}
        </div>
        <span data-testid="layout-projection-state" className="text-modiff-metadata text-modiff-subtle-text">
          {grouped ? String(owner.data.blockInstanceV2?.presentation.expanded) : 'ordinary'}
        </span>
        <pre data-testid="layout-api" className="min-w-0 overflow-auto text-modiff-metadata">
          {JSON.stringify(useFlowStore.getState().exportGraph('layout-test', undefined, { randomizeSeeds: false }))}
        </pre>
        {boundReferences ? (
          <pre data-testid="layout-snapshot" className="min-w-0 overflow-auto text-modiff-metadata">
            {JSON.stringify(useFlowStore.getState().toObject())}
          </pre>
        ) : null}
      </main>
    </ReactFlowProvider>
  );
}
