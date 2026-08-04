export function editorialPosterSizeError(width, height) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    return `editorial poster has invalid dimensions: ${width}x${height}`;
  }

  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  return shortSide < 768 || longSide < 1024 ? `editorial poster is too small: ${width}x${height}` : null;
}
