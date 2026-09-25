import { nanoid } from 'nanoid';
import type { NodeData } from '../stores/useNodeStore';
import { connectionTypes, connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { createOperationStarter, type OperationStarter } from './operationAuthoring';
import { createNodeFromRegistry } from './nodeFactory';
import { groupNewOperationGraph } from './visualOperationGroups';
import { workflowTaskCategory } from './workflowTaskBrowser';

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
  // Starters describe execution stages, not media pickers. Complete only fresh
  // image/audio drafts, using exact required ports rather than guessing by task.
  // Same-role consumers share one source; masks/references keep separate sources.
  if (['Image', 'Audio'].includes(workflowTaskCategory(starter.task))) {
    const loaders = new Map<string, (typeof graph.nodes)[number]>();
    for (const required of starter.requiredInputs) {
      const target = sources.find(
        (node) => node.data.operationAuthoring!.operation.operationId === required.operationId,
      );
      const port = target?.data.operationAuthoring!.operation.ports.find(
        (item) => item.direction === 'input' && item.name === required.field,
      );
      const kind = port?.types.includes('image') ? 'image' : port?.types.includes('audio') ? 'audio' : null;
      if (
        !target ||
        !port ||
        !kind ||
        port.hidden ||
        graph.edges.some((edge) => edge.target === target.id && edge.targetHandle === port.name)
      )
        continue;
      const field = target.data.params[port.name];
      const key = kind === 'image' ? 'modules.Image.Load' : 'modules.Audio.Load';
      const output = registry[key]?.params[kind];
      if (
        !field ||
        field.hidden ||
        !(field.display === 'input' || field.isInput) ||
        !output ||
        output.hidden ||
        output.display !== 'output' ||
        !connectionTypesAreCompatible(output.type, field.type)
      ) {
        notices.push(
          `Connect a compatible source for ${target.data.label} · ${field?.label || port.name}. The media loader is unavailable or incompatible.`,
        );
        continue;
      }
      const role = `${kind}:${port.semanticName}`;
      let loader = loaders.get(role);
      if (!loader) {
        loader = createNodeFromRegistry(key, registry, { x: 80, y: 800 + loaders.size * 600 })!;
        if (port.semanticName.includes('mask')) loader.data.label = 'Load Mask';
        else if (!['image', 'images', 'audio', 'source_audio'].includes(port.semanticName))
          loader.data.label = `Load ${String(field.label || port.semanticName.replace(/_/gu, ' '))}`;
        graph.nodes.push(loader);
        loaders.set(role, loader);
      }
      graph.edges.push({
        id: `edge-${nanoid()}`,
        source: loader.id,
        sourceHandle: kind,
        target: target.id,
        targetHandle: port.name,
        type: 'default',
      });
    }
  }
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
  return { graph: groupNewOperationGraph(graph), notices };
}
