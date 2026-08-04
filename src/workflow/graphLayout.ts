import type { Edge } from '@xyflow/react';

import type { CustomNodeType } from '../stores/useFlowStore';

export const GRAPH_LAYOUT_HORIZONTAL_GAP = 140;
export const GRAPH_LAYOUT_VERTICAL_GAP = 72;

type Size = { width: number; height: number };
type Point = { x: number; y: number };

type Component = {
  id: number;
  members: string[];
  width: number;
  height: number;
  originalY: number;
};

function finiteDimension(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function styleDimension(value: unknown) {
  if (typeof value === 'number') return finiteDimension(value);
  if (typeof value !== 'string') return undefined;
  return finiteDimension(Number.parseFloat(value));
}

export function graphNodeSize(node: CustomNodeType): Size {
  const paramCount = Object.keys(node.data.params ?? {}).length;
  const isContainer = node.data.type === 'loop' || node.data.type === 'group';
  const fallbackWidth = node.data.type === 'loop' ? 520 : node.data.type === 'group' ? 420 : 300;
  const fallbackHeight =
    node.data.type === 'loop'
      ? 300
      : node.data.type === 'group'
        ? 220
        : Math.min(620, Math.max(140, 78 + paramCount * 28));
  return {
    width:
      (isContainer ? finiteDimension(node.width) : finiteDimension(node.measured?.width)) ??
      (isContainer ? finiteDimension(node.measured?.width) : finiteDimension(node.width)) ??
      styleDimension(node.style?.width) ??
      fallbackWidth,
    height:
      (isContainer ? finiteDimension(node.height) : finiteDimension(node.measured?.height)) ??
      (isContainer ? finiteDimension(node.measured?.height) : finiteDimension(node.height)) ??
      styleDimension(node.style?.height) ??
      fallbackHeight,
  };
}

function tarjanComponents(ids: string[], adjacency: Map<string, Set<string>>) {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (id: string) => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);

    const targets = [...(adjacency.get(id) ?? [])].sort();
    targets.forEach((target) => {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id) ?? 0, indices.get(target) ?? 0));
      }
    });

    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };

  [...ids].sort().forEach((id) => {
    if (!indices.has(id)) visit(id);
  });
  return components;
}

function componentRanks(
  components: Component[],
  outgoing: Map<number, Set<number>>,
  incoming: Map<number, Set<number>>,
) {
  const indegree = new Map(components.map((component) => [component.id, incoming.get(component.id)?.size ?? 0]));
  const ranks = new Map(components.map((component) => [component.id, 0]));
  const queue = components
    .filter((component) => (indegree.get(component.id) ?? 0) === 0)
    .map((component) => component.id)
    .sort((left, right) => left - right);

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) break;
    [...(outgoing.get(id) ?? [])]
      .sort((left, right) => left - right)
      .forEach((target) => {
        ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(id) ?? 0) + 1));
        const nextIndegree = (indegree.get(target) ?? 1) - 1;
        indegree.set(target, nextIndegree);
        if (nextIndegree === 0) {
          queue.push(target);
          queue.sort((left, right) => left - right);
        }
      });
  }
  return ranks;
}

function reorderRanks(
  rankOrders: Map<number, number[]>,
  outgoing: Map<number, Set<number>>,
  incoming: Map<number, Set<number>>,
) {
  const ranks = [...rankOrders.keys()].sort((left, right) => left - right);
  const orderIndex = () => {
    const index = new Map<number, number>();
    rankOrders.forEach((ids) => ids.forEach((id, position) => index.set(id, position)));
    return index;
  };
  const sweep = (rankList: number[], neighbors: Map<number, Set<number>>) => {
    const index = orderIndex();
    rankList.forEach((rank) => {
      const previousOrder = new Map((rankOrders.get(rank) ?? []).map((id, position) => [id, position]));
      const ordered = [...(rankOrders.get(rank) ?? [])].sort((left, right) => {
        const barycenter = (id: number) => {
          const values = [...(neighbors.get(id) ?? [])]
            .map((neighbor) => index.get(neighbor))
            .filter((value): value is number => value !== undefined);
          return values.length === 0
            ? (previousOrder.get(id) ?? 0)
            : values.reduce((sum, value) => sum + value, 0) / values.length;
        };
        return (
          barycenter(left) - barycenter(right) ||
          (previousOrder.get(left) ?? 0) - (previousOrder.get(right) ?? 0) ||
          left - right
        );
      });
      rankOrders.set(rank, ordered);
    });
  };

  for (let pass = 0; pass < 4; pass += 1) {
    sweep(ranks.slice(1), incoming);
    sweep([...ranks].reverse().slice(1), outgoing);
  }
}

function layoutLevel(nodes: CustomNodeType[], pairs: Array<[string, string]>): Map<string, Point> {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const adjacency = new Map(ids.map((id) => [id, new Set<string>()]));
  pairs.forEach(([source, target]) => {
    if (source !== target && idSet.has(source) && idSet.has(target)) adjacency.get(source)?.add(target);
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rawComponents = tarjanComponents(ids, adjacency);
  const componentByNode = new Map<string, number>();
  const components = rawComponents.map((members, id) => {
    members.forEach((member) => componentByNode.set(member, id));
    const sizes = members.map((member) => graphNodeSize(nodeById.get(member)!));
    return {
      id,
      members,
      width: Math.max(...sizes.map((size) => size.width)),
      height:
        sizes.reduce((sum, size) => sum + size.height, 0) + Math.max(0, sizes.length - 1) * GRAPH_LAYOUT_VERTICAL_GAP,
      originalY: members.reduce((sum, member) => sum + (nodeById.get(member)?.position.y ?? 0), 0) / members.length,
    };
  });
  const outgoing = new Map(components.map((component) => [component.id, new Set<number>()]));
  const incoming = new Map(components.map((component) => [component.id, new Set<number>()]));
  pairs.forEach(([source, target]) => {
    const sourceComponent = componentByNode.get(source);
    const targetComponent = componentByNode.get(target);
    if (sourceComponent === undefined || targetComponent === undefined || sourceComponent === targetComponent) return;
    outgoing.get(sourceComponent)?.add(targetComponent);
    incoming.get(targetComponent)?.add(sourceComponent);
  });

  const ranks = componentRanks(components, outgoing, incoming);
  const rankOrders = new Map<number, number[]>();
  components.forEach((component) => {
    const rank = ranks.get(component.id) ?? 0;
    rankOrders.set(rank, [...(rankOrders.get(rank) ?? []), component.id]);
  });
  rankOrders.forEach((componentIds, rank) => {
    rankOrders.set(
      rank,
      componentIds.sort((left, right) => {
        const leftComponent = components[left]!;
        const rightComponent = components[right]!;
        return leftComponent.originalY - rightComponent.originalY || left - right;
      }),
    );
  });
  reorderRanks(rankOrders, outgoing, incoming);

  const rankWidths = new Map<number, number>();
  rankOrders.forEach((componentIds, rank) => {
    rankWidths.set(rank, Math.max(...componentIds.map((id) => components[id]!.width)));
  });
  const rankX = new Map<number, number>();
  let nextX = 0;
  [...rankOrders.keys()]
    .sort((left, right) => left - right)
    .forEach((rank) => {
      rankX.set(rank, nextX);
      nextX += (rankWidths.get(rank) ?? 0) + GRAPH_LAYOUT_HORIZONTAL_GAP;
    });
  const columnHeights = new Map<number, number>();
  rankOrders.forEach((componentIds, rank) => {
    columnHeights.set(
      rank,
      componentIds.reduce((sum, id) => sum + components[id]!.height, 0) +
        Math.max(0, componentIds.length - 1) * GRAPH_LAYOUT_VERTICAL_GAP,
    );
  });
  const tallestColumn = Math.max(0, ...columnHeights.values());
  const positions = new Map<string, Point>();

  rankOrders.forEach((componentIds, rank) => {
    let y = (tallestColumn - (columnHeights.get(rank) ?? 0)) / 2;
    componentIds.forEach((componentId) => {
      const component = components[componentId]!;
      let memberY = y;
      component.members.forEach((member) => {
        const size = graphNodeSize(nodeById.get(member)!);
        positions.set(member, {
          x: (rankX.get(rank) ?? 0) + (component.width - size.width) / 2,
          y: memberY,
        });
        memberY += size.height + GRAPH_LAYOUT_VERTICAL_GAP;
      });
      y += component.height + GRAPH_LAYOUT_VERTICAL_GAP;
    });
  });
  return positions;
}

function directDescendant(
  nodeId: string,
  parentId: string | undefined,
  nodeById: Map<string, CustomNodeType>,
): string | null {
  let current = nodeById.get(nodeId);
  const visited = new Set<string>();
  while (current && current.parentId !== parentId && current.parentId && !visited.has(current.id)) {
    visited.add(current.id);
    current = nodeById.get(current.parentId);
  }
  if (!current) return null;
  if (current.parentId === parentId) return current.id;
  if (parentId === undefined && !current.parentId) return current.id;
  return null;
}

function containerPadding(node: CustomNodeType | undefined) {
  if (node?.data.type === 'loop') return { left: 28, top: 64, right: 28, bottom: 64 };
  return { left: 20, top: 48, right: 20, bottom: 20 };
}

/**
 * Deterministic, dependency-free layered layout. Container children are laid
 * out first, containers are resized, and then each container participates as a
 * single node in its parent's topology.
 */
export function arrangeGraphNodes(nodes: CustomNodeType[], edges: Edge[]): CustomNodeType[] {
  if (nodes.length < 2) return nodes;
  const nextById = new Map(nodes.map((node) => [node.id, { ...node, position: { ...node.position } }]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();
  const depthOf = (node: CustomNodeType): number => {
    const known = depths.get(node.id);
    if (known !== undefined) return known;
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    const depth = parent ? depthOf(parent) + 1 : 0;
    depths.set(node.id, depth);
    return depth;
  };
  nodes.forEach(depthOf);
  const containers = nodes
    .filter((node) => node.data.type === 'group' || node.data.type === 'loop')
    .sort((left, right) => (depths.get(right.id) ?? 0) - (depths.get(left.id) ?? 0) || left.id.localeCompare(right.id));
  const levels: Array<string | undefined> = [...containers.map((node) => node.id), undefined];

  levels.forEach((parentId) => {
    const levelNodes = [...nextById.values()].filter((node) => node.parentId === parentId);
    if (levelNodes.length === 0) return;
    const pairKeys = new Set<string>();
    const pairs: Array<[string, string]> = [];
    edges.forEach((edge) => {
      const source = directDescendant(edge.source, parentId, nextById);
      const target = directDescendant(edge.target, parentId, nextById);
      if (!source || !target || source === target) return;
      const key = `${source}\u0000${target}`;
      if (pairKeys.has(key)) return;
      pairKeys.add(key);
      pairs.push([source, target]);
    });
    const positions = layoutLevel(levelNodes, pairs);
    const parent = parentId ? nextById.get(parentId) : undefined;
    const padding = containerPadding(parent);
    levelNodes.forEach((node) => {
      const point = positions.get(node.id);
      if (!point) return;
      nextById.set(node.id, {
        ...node,
        position: { x: point.x + (parent ? padding.left : 0), y: point.y + (parent ? padding.top : 0) },
      });
    });
    if (parent) {
      const arrangedChildren = levelNodes.map((node) => nextById.get(node.id)!);
      const width = Math.max(
        parent.data.type === 'loop' ? 360 : 0,
        ...arrangedChildren.map((child) => child.position.x + graphNodeSize(child).width + padding.right),
      );
      const height = Math.max(
        parent.data.type === 'loop' ? 240 : 0,
        ...arrangedChildren.map((child) => child.position.y + graphNodeSize(child).height + padding.bottom),
      );
      nextById.set(parent.id, { ...parent, width, height });
    }
  });

  return nodes.map((node) => nextById.get(node.id) ?? node);
}

export async function waitForGraphNodeMeasurements(getNodes: () => CustomNodeType[], timeoutMs = 500): Promise<void> {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    let lastMeasuredSignature: string | null = null;
    let stableMeasuredFrames = 0;
    const check = () => {
      const candidates = getNodes().filter((node) => node.data.type !== 'group' && node.data.type !== 'loop');
      const measured = candidates.every(
        (node) => finiteDimension(node.measured?.width) && finiteDimension(node.measured?.height),
      );
      if (measured) {
        const signature = candidates
          .map((node) => `${node.id}:${node.measured!.width}x${node.measured!.height}`)
          .sort()
          .join('|');
        stableMeasuredFrames = signature === lastMeasuredSignature ? stableMeasuredFrames + 1 : 1;
        lastMeasuredSignature = signature;
      } else {
        lastMeasuredSignature = null;
        stableMeasuredFrames = 0;
      }
      if (stableMeasuredFrames >= 2 || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.requestAnimationFrame(check);
    };
    window.requestAnimationFrame(check);
  });
}
