import { TEMPLATE_DEFAULT_INPUT_BINDINGS } from './generated/templateDefaultInputBindings';
import { resolveTemplateAssetUrl } from './templateAssets';

type BundledInputAsset = {
  fileName?: string;
  runtimePath: string;
};

const BUNDLED_INPUT_ASSETS = Object.values(TEMPLATE_DEFAULT_INPUT_BINDINGS)
  .flat()
  .flatMap((binding) => binding.defaultAssets as BundledInputAsset[])
  .filter((asset) => Boolean(asset.fileName?.trim()));

function escapedPattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a backend-uploaded copy of a bundled template input back to its
 * byte-identical public asset. Backend uploads add a six-character suffix when
 * the deterministic filename already exists.
 */
export function bundledTemplateInputPreviewUrl(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const basename = normalized.split('/').pop() ?? normalized;

  for (const asset of BUNDLED_INPUT_ASSETS) {
    const fileName = asset.fileName?.trim();
    if (!fileName) continue;
    const dot = fileName.lastIndexOf('.');
    const stem = dot >= 0 ? fileName.slice(0, dot) : fileName;
    const extension = dot >= 0 ? fileName.slice(dot) : '';
    const uploadName = new RegExp(`^${escapedPattern(stem)}(?:_[A-Za-z0-9_-]{6})?${escapedPattern(extension)}$`);
    if (uploadName.test(basename)) return resolveTemplateAssetUrl(asset.runtimePath) ?? asset.runtimePath;
  }

  return null;
}
