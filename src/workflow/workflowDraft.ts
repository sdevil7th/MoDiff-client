import { nanoid } from 'nanoid';
import type { NodeData } from '../stores/useNodeStore';
import { connectionTypes, connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { createOperationStarter, type OperationStarter } from './operationAuthoring';
import { createNodeFromRegistry } from './nodeFactory';

const OUTPUTS = [
  { type: 'image', key: 'modules.Image.Preview', input: 'image' },
  { type: 'audio', key: 'modules.Audio.Preview', input: 'audio' },
  { type: 'video', key: 'modules.Video.ExportAsset', input: 'video' },
  { type: 'video_asset', key: 'modules.Video.ExportAsset', input: 'video' },
];

/** Add ordinary typed output nodes, without turning metadata into execution permission. */
export function createWorkflowDraft(starter: OperationStarter, registry: Record<string, NodeData>) {
  const graph = createOperationStarter(starter, { x: 80, y: 120 });
  const notices: string[] = [];
  const sources = [...graph.nodes];
  let outputCount = 0;
  for (const node of sources) {
    for (const port of node.data.operationAuthoring!.operation.ports) {
      if (
        port.direction !== 'output' ||
        port.hidden ||
        port.semantics?.kind !== 'media' ||
        graph.edges.some((e) => e.source === node.id && e.sourceHandle === port.name)
      )
        continue;
      const concreteTypes = connectionTypes(port.types);
      const output = OUTPUTS.find((candidate) => concreteTypes.includes(candidate.type));
      if (!output) continue;
      const definition = registry[output.key];
      const input = definition?.params[output.input];
      if (
        !input ||
        input.hidden ||
        !(input.display === 'input' || input.isInput) ||
        !connectionTypesAreCompatible(port.types, input.type)
      )
        continue;
      const target = createNodeFromRegistry(output.key, registry, {
        x: 80 + sources.length * 420,
        y: 120 + outputCount * 340,
      })!;
      graph.nodes.push(target);
      graph.edges.push({
        id: `edge-${nanoid()}`,
        source: node.id,
        sourceHandle: port.name,
        target: target.id,
        targetHandle: output.input,
        type: 'default',
      });
      outputCount++;
    }
  }
  if (!outputCount)
    notices.push('No compatible output node is registered. Connect a Preview, Save or Export node before running.');
  return { graph, notices };
}
