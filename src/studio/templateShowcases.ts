import { featured } from './templateShowcases.json';
import { resolveTemplateAssetUrl } from './templateAssets';
import type { StudioTemplateId } from './types';

/** Accepted display media with its own recipe. Never qualifies a template lock. */
export function getTemplateShowcase(templateId: StudioTemplateId) {
  const entry = featured.find((asset) => asset.featuredTemplateId === templateId);
  if (
    !entry ||
    entry.status !== 'approved' ||
    !/^[a-f0-9]{64}$/u.test(entry.mediaSHA256) ||
    !/^[a-f0-9]{64}$/u.test(entry.recordSHA256)
  )
    return undefined;
  return {
    ...entry,
    mediaPath: resolveTemplateAssetUrl(entry.outputPath),
    recordPath: resolveTemplateAssetUrl(entry.recordPath),
  };
}
