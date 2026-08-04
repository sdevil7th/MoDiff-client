import config from '../../app.config';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import type { Edge } from '@xyflow/react';
import { sanitizeImageArtifactUrl } from '../utils/imageArtifacts';
import { bundledPublicAssetUrl, firstImageValue } from './outputUtils';

export type GraphImageSource = {
  id: string;
  label: string;
  nodeId: string;
  fieldKey: string;
  url: string | null;
};

function isPotentialImageSourceParam(param: NodeParams) {
  const display = String(param.display ?? '');
  const type = Array.isArray(param.type) ? param.type.join(',') : String(param.type ?? '');
  const fileTypes = Array.isArray(param.fieldOptions?.fileTypes) ? param.fieldOptions.fileTypes : [];
  return (
    display === 'ui_image' ||
    display === 'ui_imagecompare' ||
    (display === 'filebrowser' && (fileTypes.length === 0 || fileTypes.includes('image'))) ||
    (/\bimage\b/i.test(type) && display !== 'input' && display !== 'output')
  );
}

function imageValueFromParam(param: NodeParams): string | null {
  return isPotentialImageSourceParam(param) ? firstImageValue(param.value ?? param.default) : null;
}

export function resolveGraphImageSourceUrl(value: string): string | null {
  if (/^(?:javascript|vbscript):/i.test(value.trim())) return null;
  let resolved: string;
  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    resolved = value;
  } else {
    const bundled = bundledPublicAssetUrl(value);
    if (bundled) resolved = bundled;
    else if (value.startsWith('/cache/') || value.startsWith('/preview?') || value.startsWith('/file?')) {
      resolved = `${config.serverAddress}${value}`;
    } else {
      resolved = `${config.serverAddress}/preview?file=${encodeURIComponent(value)}`;
    }
  }
  return sanitizeImageArtifactUrl(resolved);
}

/**
 * Finds image-bearing fields on executable upstream nodes. The capability is
 * graph-derived, so it survives template conversion, save/restore, duplication,
 * and manually-authored graphs without relying on template presentation data.
 */
export function graphImageSources(nodes: CustomNodeType[], edges: Edge[], targetNodeId: string): GraphImageSource[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => {
    const sources = incoming.get(edge.target) ?? [];
    sources.push(edge.source);
    incoming.set(edge.target, sources);
  });

  const distances = new Map<string, number>();
  const queue = (incoming.get(targetNodeId) ?? []).map((nodeId) => ({ nodeId, distance: 1 }));
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry || entry.nodeId === targetNodeId) continue;
    const previous = distances.get(entry.nodeId);
    if (previous !== undefined && previous <= entry.distance) continue;
    distances.set(entry.nodeId, entry.distance);
    (incoming.get(entry.nodeId) ?? []).forEach((nodeId) => {
      queue.push({ nodeId, distance: entry.distance + 1 });
    });
  }

  const sources: GraphImageSource[] = [];
  const candidates = [...distances.entries()];

  // A common finishing graph branches one decoded image into both a "before"
  // preview and a transform/upscale path. The before preview is a sibling, not
  // a strict ancestor of the final preview, but its input provenance is still
  // on the final preview's executable path. Include only image-bearing sibling
  // nodes fed directly by an ancestor so unrelated canvas images cannot become
  // comparison sources.
  nodes.forEach((node) => {
    if (node.id === targetNodeId || distances.has(node.id)) return;
    if (!Object.values(node.data.params ?? {}).some(isPotentialImageSourceParam)) return;
    const sharedAncestorDistances = (incoming.get(node.id) ?? [])
      .map((sourceId) => distances.get(sourceId))
      .filter((distance): distance is number => distance !== undefined);
    if (sharedAncestorDistances.length === 0) return;
    candidates.push([node.id, Math.min(...sharedAncestorDistances) + 0.5]);
  });

  candidates
    .sort(([leftId, leftDistance], [rightId, rightDistance]) => {
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
      const left = nodeById.get(leftId);
      const right = nodeById.get(rightId);
      return (left?.position.x ?? 0) - (right?.position.x ?? 0);
    })
    .forEach(([nodeId]) => {
      const node = nodeById.get(nodeId);
      if (!node) return;
      Object.entries(node.data.params ?? {}).forEach(([fieldKey, param]) => {
        const rawValue = imageValueFromParam(param);
        if (!isPotentialImageSourceParam(param)) return;
        sources.push({
          id: `${nodeId}:${fieldKey}`,
          label: `${node.data.label || node.data.action} · ${param.label || fieldKey}`,
          nodeId,
          fieldKey,
          url: rawValue ? resolveGraphImageSourceUrl(rawValue) : null,
        });
      });
    });

  const seen = new Set<string>();
  return sources.filter((source) => {
    const identity = source.url ?? source.id;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
