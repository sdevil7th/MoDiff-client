import type { CustomNodeType } from '../stores/useFlowStore';

export function collisionFreeInsertPosition(
  initial: { x: number; y: number },
  nodes: CustomNodeType[],
  size: { width: number; height: number },
) {
  const padding = 32;
  const topLevelNodes = nodes.filter((node) => !node.parentId && !node.hidden);
  const overlapsExistingNode = (position: { x: number; y: number }) =>
    topLevelNodes.some((node) => {
      const width = node.measured?.width ?? node.width ?? 320;
      const height = node.measured?.height ?? node.height ?? 220;
      return (
        position.x < node.position.x + width + padding &&
        position.x + size.width + padding > node.position.x &&
        position.y < node.position.y + height + padding &&
        position.y + size.height + padding > node.position.y
      );
    });

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const column = attempt % 6;
    const row = Math.floor(attempt / 6);
    const candidate = {
      x: initial.x + column * (size.width + padding),
      y: initial.y + row * (size.height + padding),
    };
    if (!overlapsExistingNode(candidate)) return candidate;
  }
  // A fully expanded hierarchy can cover the entire bounded search grid.
  // Falling back to the original point would put a new node on top of it.
  return {
    x: Math.max(
      initial.x,
      ...topLevelNodes.map((node) => node.position.x + (node.measured?.width ?? node.width ?? 320) + padding),
    ),
    y: initial.y,
  };
}
