import { featured, workflowAssets } from './templateShowcases.json';
import { resolveTemplateAssetUrl } from './templateAssets';
import type { StudioTemplateId } from './types';

function showcasePaths(id: string, extension: 'webp' | 'mp4') {
  const base = `/template-gallery/showcases/${id}`;
  return {
    mediaPath: resolveTemplateAssetUrl(`${base}.${extension}`),
    recordPath: resolveTemplateAssetUrl(`${base}.json`),
  };
}

/** Accepted display media with its own recipe. Never qualifies a template lock. */
export function getTemplateShowcase(templateId: StudioTemplateId) {
  const entry = featured.find((asset) => asset.featuredTemplateId === templateId);
  return entry?.status === 'approved' ? { title: entry.title, ...showcasePaths(entry.id, 'webp') } : undefined;
}

/** The checked-in catalog's file and workflow identities are verified by the showcase test. */
export function getWorkflowShowcases(search: string) {
  const query = search.trim().toLowerCase();
  return workflowAssets.flatMap((entry) => {
    if (entry.status !== 'approved' || !`${entry.title} ${entry.modelLabel}`.toLowerCase().includes(query)) return [];
    const paths = showcasePaths(entry.id, 'mp4');
    const posterPath = resolveTemplateAssetUrl(entry.posterPath);
    return paths.mediaPath && paths.recordPath && posterPath ? [{ ...entry, ...paths, posterPath }] : [];
  });
}
