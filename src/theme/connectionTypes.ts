import { MarkerType, type Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';
import { nodeConnectorParam } from '../studio/nodeConnectorResolution';
import { dataTypeClass } from '../utils/dataTypeCategory';
import { connectionTypes } from './connectionTypeCompatibility';

export { connectionTypes, connectionTypesAreCompatible } from './connectionTypeCompatibility';

export const NEUTRAL_CONNECTION_TYPE = 'default';
export const NEUTRAL_CONNECTION_COLOR = '#94A3B8';

/**
 * Connection colors describe values moving through the graph. They are kept
 * separate from node category colors, which describe what a node does.
 */
export const connectionTypeColors: Readonly<Record<string, string>> = {
  image: '#60A5FA',
  video: '#06B6D4',
  audio: '#F472B6',
  video_asset: '#67E8F9',
  video_asset_collection: '#5EEAD4',
  video_collection: '#34D399',
  collection: '#A3E635',

  pipeline: '#FCA5A5',
  image_diffusion_pipeline: '#FB7185',
  video_diffusion_pipeline: '#F97316',
  audio_diffusion_pipeline: '#E879F9',
  modular_pipeline: '#F43F5E',

  custom_controlnet: '#FB923C',
  custom_guider: '#FDBA74',
  custom_ip_adapter: '#F9A8D4',
  custom_lora: '#F0ABFC',
  diffusers_auto_model: '#A78BFA',
  diffusers_auto_models: '#8B5CF6',
  diffusers_execution_recipe: '#C4B5FD',
  multimodal_text_model: '#D8B4FE',
  wan_vace_pipeline: '#FDA4AF',

  latent: '#818CF8',
  latents: '#6366F1',
  tensor: '#A5B4FC',
  embeddings: '#FBBF24',
  image_embeds: '#FCD34D',
  text: '#2DD4BF',
  str: '#7DD3FC',
  string: '#38BDF8',

  bool: '#F59E0B',
  float: '#FDE047',
  int: '#84CC16',
  layers_config: '#BEF264',
  quant_config: '#FACC15',
  quantization_config: '#FDE68A',

  any: NEUTRAL_CONNECTION_COLOR,
  default: NEUTRAL_CONNECTION_COLOR,
  missing: NEUTRAL_CONNECTION_COLOR,
};

export type ResolvedConnectionType = string | string[];

type ConnectionEdgeData = Record<string, unknown> & {
  connectionType?: ResolvedConnectionType;
};

function concreteConnectionTypes(value: unknown) {
  return connectionTypes(value).filter((item) => item !== 'any');
}

function resolvedConnectionType(types: string[]): ResolvedConnectionType {
  const normalized = Array.from(new Set(types)).sort();
  if (normalized.length === 0) return NEUTRAL_CONNECTION_TYPE;
  return normalized.length === 1 ? normalized[0]! : normalized;
}

function sameConnectionType(left: unknown, right: unknown) {
  const leftTypes = connectionTypes(left);
  const rightTypes = connectionTypes(right);
  return leftTypes.length === rightTypes.length && leftTypes.every((item, index) => item === rightTypes[index]);
}

/**
 * Resolve the concrete payload represented by an edge. Exact intersections
 * win; `any` adopts the concrete type on the opposite handle.
 */
export function resolveConnectionType(sourceType: unknown, targetType: unknown): ResolvedConnectionType {
  const source = connectionTypes(sourceType);
  const target = connectionTypes(targetType);
  const sourceConcrete = source.filter((item) => item !== 'any');
  const targetConcrete = target.filter((item) => item !== 'any');
  const intersection = sourceConcrete.filter((item) => targetConcrete.includes(item));
  if (intersection.length > 0) return resolvedConnectionType(intersection);
  if (source.includes('any') && targetConcrete.length > 0) return resolvedConnectionType(targetConcrete);
  if (target.includes('any') && sourceConcrete.length > 0) return resolvedConnectionType(sourceConcrete);
  if (sourceConcrete.length > 0 && target.length === 0) return resolvedConnectionType(sourceConcrete);
  if (targetConcrete.length > 0 && source.length === 0) return resolvedConnectionType(targetConcrete);
  return NEUTRAL_CONNECTION_TYPE;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Unknown concrete backend types still receive a stable, high-contrast color.
 * Only untyped/default handles intentionally use the neutral color.
 */
function generatedConnectionColor(signature: string) {
  const hash = hashString(signature);
  const hue = hash % 360;
  const saturation = 68 + ((hash >>> 9) % 13);
  const lightness = 62 + ((hash >>> 17) % 9);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export function connectionColor(type: unknown): string {
  const concrete = concreteConnectionTypes(type);
  if (concrete.length === 0) return NEUTRAL_CONNECTION_COLOR;
  if (concrete.length > 1) {
    return generatedConnectionColor(`union:${concrete.join('|')}`);
  }
  const normalized = concrete[0]!;
  const known = connectionTypeColors[normalized];
  if (known) return known;
  return generatedConnectionColor(normalized);
}

export function connectionTypeGradient(type: unknown): string | undefined {
  const types = concreteConnectionTypes(type);
  if (types.length <= 1) return undefined;
  const step = 100 / types.length;
  const stops = types.flatMap((item, index) => {
    const color = connectionColor(item);
    const start = (index * step).toFixed(2);
    const end = ((index + 1) * step).toFixed(2);
    return [`${color} ${start}%`, `${color} ${end}%`];
  });
  return `linear-gradient(135deg, ${stops.join(', ')})`;
}

function edgeParamTypes(edge: Edge, nodes: CustomNodeType[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const sourceHandle = edge.sourceHandle ?? '';
  const targetHandle = edge.targetHandle ?? '';
  return {
    sourceType: nodeConnectorParam(source, sourceHandle)?.type,
    targetType: nodeConnectorParam(target, targetHandle)?.type,
  };
}

export function edgeConnectionType(edge: Edge, nodes: CustomNodeType[]): ResolvedConnectionType {
  const { sourceType, targetType } = edgeParamTypes(edge, nodes);
  if (sourceType !== undefined || targetType !== undefined) {
    return resolveConnectionType(sourceType, targetType);
  }
  const stored = (edge.data as ConnectionEdgeData | undefined)?.connectionType;
  return resolvedConnectionType(concreteConnectionTypes(stored));
}

function connectionClassName(className: string | undefined, type: ResolvedConnectionType) {
  const retained = (className ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((item) => !item.startsWith('category-'));
  const concrete = concreteConnectionTypes(type);
  const typeClass = concrete.length > 1 ? `category-union-${concrete.join('-')}` : dataTypeClass(concrete[0] ?? type);
  return [...retained, typeClass].join(' ');
}

function markerMatches(marker: Edge['markerEnd'], color: string) {
  return (
    typeof marker === 'object' && marker !== null && marker.type === MarkerType.ArrowClosed && marker.color === color
  );
}

export function decorateConnectionEdge(edge: Edge, nodes: CustomNodeType[]): Edge {
  const type = edgeConnectionType(edge, nodes);
  const color = connectionColor(type);
  const className = connectionClassName(edge.className, type);
  const data = edge.data as ConnectionEdgeData | undefined;
  const unchanged =
    data?.connectionType !== undefined &&
    sameConnectionType(data.connectionType, type) &&
    edge.style?.stroke === color &&
    className === edge.className &&
    markerMatches(edge.markerEnd, color);
  if (unchanged) return edge;

  return {
    ...edge,
    className,
    data: { ...(data ?? {}), connectionType: type },
    style: { ...edge.style, stroke: color },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
      width: 18,
      height: 18,
    },
  };
}

export function decorateConnectionEdges(nodes: CustomNodeType[], edges: Edge[]): Edge[] {
  let changed = false;
  const decorated = edges.map((edge) => {
    const next = decorateConnectionEdge(edge, nodes);
    if (next !== edge) changed = true;
    return next;
  });
  return changed ? decorated : edges;
}
