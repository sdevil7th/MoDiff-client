import { useMemo } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { BlockInstanceV2 } from '../studio/blockSchemaV2';
import { blockOperationGraphV2, blockViewModelV2 } from '../studio/blockRuntimeV2';
import { ModiffDisclosure } from '../ui';
import { encodingControlParam } from '../workflow/encodingNodePresentation';
import { sharedOperationInput } from '../workflow/operationSharedInputs';
import { unpackVisualOperationGroups } from '../workflow/visualOperationGroups';
import { EncodeImageSummary } from './EncodeImageSummary';
import { useNodesStore } from '../stores/useNodeStore';
import { optionalEncodingImageInput } from '../workflow/encodingOptionalInput';
import NodeContent from './NodeContent';

/** One visual encoder; disclosures do not participate in execution or persistence. */
export default function EncodingNodeControls({
  instance,
  updateStore,
}: {
  instance: BlockInstanceV2;
  updateStore: (param: string, value: unknown, key?: keyof NodeParams) => void;
}) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const operations = useNodesStore((state) => state.operationContracts);
  const support = useNodesStore((state) => state.pipelineSupport);
  const optionalImage = optionalEncodingImageInput(instance, operations, support);
  const view = useMemo(() => blockViewModelV2(instance), [instance]);
  const stages = useMemo(() => blockOperationGraphV2(instance).nodes, [instance]);
  const summaries = nodes.find((node) => node.id === instance.instanceId)?.data.uiState?.encodingSummaries;
  const seedLinks = useMemo(() => {
    try {
      const flat = unpackVisualOperationGroups({ nodes, edges }, new Set([instance.instanceId])).graph;
      return new Map(
        stages.map((stage) => {
          const shared = sharedOperationInput(
            flat.nodes,
            flat.edges,
            `${instance.instanceId}/${stage.data.blockProjectionNodeId}`,
            'seed',
          );
          return [
            stage.data.blockProjectionNodeId,
            shared?.members
              .filter((member) => member.node.id !== `${instance.instanceId}/${stage.data.blockProjectionNodeId}`)
              .map((member) => member.node.data.label)
              .filter(Boolean) ?? [],
          ];
        }),
      );
    } catch {
      // Customized/nested interfaces keep their existing editing restrictions.
      return new Map<string | undefined, unknown[]>();
    }
  }, [edges, instance.instanceId, nodes, stages]);
  const groups = [...new Set(instance.effectiveInterface.controls.map((control) => control.group ?? 'Settings'))];
  const images = stages.filter((stage) =>
    ['vae_encoder', 'image_encoder'].includes(stage.data.operationAuthoring?.operation.nodeType ?? ''),
  );
  if ((images.length || optionalImage) && !groups.includes('Image')) groups.push('Image');

  function sourceFor(nodeId: string, field: string) {
    const boundary = instance.effectiveInterface.boundary.inputs.filter((port) =>
      [port.binding, ...(port.mirrorBindings ?? [])].some(
        (binding) => binding.nodeId === nodeId && binding.fieldOrPortId === field,
      ),
    );
    const edge = edges.find(
      (edge) => edge.target === instance.instanceId && boundary.some((port) => port.portId === edge.targetHandle),
    );
    if (edge) return nodes.find((node) => node.id === edge.source)?.data.label ?? 'Connected source';
    const internal = instance.effectiveGraph.edges.find(
      (edge) => edge.targetNodeId === nodeId && edge.targetPortId === field,
    );
    return internal
      ? String(
          instance.effectiveGraph.nodes.find((node) => node.nodeId === internal.sourceNodeId)?.data.label ??
            'Internal source',
        )
      : null;
  }

  return (
    <div
      className="nodrag nowheel grid gap-2"
      data-encoding-content
      data-testid={`encoding-controls-${instance.instanceId}`}
    >
      {groups.map((group) => {
        const controls = instance.effectiveInterface.controls.filter(
          (control) => (control.group ?? 'Settings') === group,
        );
        const promptSources = [
          ...new Set(
            controls
              .filter((control) => control.binding.fieldId === 'prompt')
              .map((control) => sourceFor(control.binding.nodeId, 'prompt_input'))
              .filter(Boolean),
          ),
        ];
        return (
          <ModiffDisclosure
            key={group}
            label={group}
            defaultOpen
            unmount={false}
            panelClassName="grid gap-2 px-1 pt-2"
            aria-label={`${group} encoding controls`}
          >
            {group === 'Image' && optionalImage ? (
              <p className="text-xs text-modiff-subtle-text">
                Optional — connect the Image socket to use an image input. Text-only generation remains available
                without it.
              </p>
            ) : null}
            {promptSources.length ? (
              <p className="text-xs text-modiff-subtle-text">
                Using Prompt Input from {promptSources.join(', ')}. The local prompt is retained below as an inactive
                fallback.
              </p>
            ) : null}
            {group === 'Image'
              ? images.map((stage) => {
                  const source = sourceFor(stage.data.blockProjectionNodeId!, 'image');
                  const imageRequired = stage.data.operationAuthoring?.operation.ports.some(
                    (port) => port.direction === 'input' && port.name === 'image' && port.required,
                  );
                  const imageValue = stage.data.params.image?.value ?? stage.data.params.image?.default;
                  const needsImage =
                    imageRequired && !source && (imageValue === undefined || imageValue === null || imageValue === '');
                  return (
                    <div key={stage.id} className="grid gap-2">
                      {needsImage ? (
                        <p role="status" className="text-xs text-modiff-invalid">
                          Image input required — connect a separate Load Image node.
                        </p>
                      ) : source ? (
                        <p className="text-xs text-modiff-subtle-text">Image from {source}</p>
                      ) : null}
                      {stage.data.params.encode_summary || stage.data.params.encode_summary_data ? (
                        <EncodeImageSummary
                          nodeId={instance.instanceId}
                          params={
                            summaries?.[stage.id]?.graphHash === instance.effectiveGraph.graphHash
                              ? {
                                  ...stage.data.params,
                                  encode_summary: {
                                    ...stage.data.params.encode_summary,
                                    value: summaries[stage.id]!.value,
                                  },
                                }
                              : stage.data.params
                          }
                          executionStatus={stage.data.executionStatus}
                          progressMessage={stage.data.progressMessage}
                        />
                      ) : null}
                    </div>
                  );
                })
              : null}
            {controls.map((control) => {
              const param = view.controlParams[control.controlId];
              if (!param) return null;
              const links = seedLinks.get(control.binding.nodeId) ?? [];
              return (
                <div key={control.controlId}>
                  <NodeContent
                    nodeId={instance.instanceId}
                    params={{
                      [control.controlId]: encodingControlParam(
                        control,
                        param,
                        Boolean(sourceFor(control.binding.nodeId, 'prompt_input')),
                      ),
                    }}
                    updateStore={updateStore}
                    module={view.source.provider ?? 'MoDiff'}
                    action="BlockV2"
                    mode="controls"
                  />
                  {control.binding.fieldId === 'seed' ? (
                    <p className="mb-2 text-xs text-modiff-subtle-text">
                      {images.some(
                        (stage) =>
                          stage.data.blockProjectionNodeId === control.binding.nodeId &&
                          stage.data.operationAuthoring?.operation.nodeType === 'vae_encoder',
                      )
                        ? 'Seed for image-latent sampling.'
                        : 'Seed declared by this encoding stage.'}
                      {links.length ? ` Shared with ${links.join(', ')}; editing updates the linked value.` : ''}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </ModiffDisclosure>
        );
      })}
    </div>
  );
}
