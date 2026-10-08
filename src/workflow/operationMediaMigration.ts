import type { Edge } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import type { OperationPort } from './operationContracts';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';

function mediaRole(port: OperationPort | undefined): string | null {
  const semantics = port?.semantics;
  if (
    !port ||
    port.direction !== 'input' ||
    port.hidden ||
    !port.semanticName ||
    port.roles.includes('component') ||
    port.roles.includes('pipeline') ||
    semantics?.kind !== 'media' ||
    semantics.owner !== 'none' ||
    semantics.scope !== null ||
    semantics.state !== null
  )
    return null;
  const kinds = port.types.filter((type) => type === 'image' || type === 'audio').sort();
  return kinds.length === 1 ? JSON.stringify([port.semanticName, kinds[0]]) : null;
}

/** Reuse an existing material source for a newly declared input of the same role.
 * Component ownership, different media roles and ambiguous drivers never fan out. */
export function preservedMediaFanout(
  before: OperationGraph,
  after: OperationGraph,
  previous: CustomNodeType[],
  targets: CustomNodeType[],
): { edges: Edge[]; attention: string[] } {
  const previousIds = new Set(previous.map((node) => node.id));
  const targetIds = new Set(targets.map((node) => node.id));
  const added: Edge[] = [],
    attention = new Set<string>();
  const ports = (node: CustomNodeType) => operationAuthoring(node)?.operation.ports ?? [];
  const drivers = new Map<string, Map<string, Edge>>();
  for (const edge of before.edges) {
    if (!previousIds.has(edge.target) || previousIds.has(edge.source)) continue;
    const old = previous.find((node) => node.id === edge.target)!;
    const role = mediaRole(ports(old).find((port) => port.name === edge.targetHandle));
    if (!role) continue;
    // Only a successfully preserved connection can authorize an additional one.
    const retained = after.edges.some((candidate) => {
      if (
        candidate.source !== edge.source ||
        candidate.sourceHandle !== edge.sourceHandle ||
        !targetIds.has(candidate.target)
      )
        return false;
      const target = targets.find((node) => node.id === candidate.target)!;
      return (
        !target.data.uiState?.disabled &&
        mediaRole(ports(target).find((port) => port.name === candidate.targetHandle)) === role
      );
    });
    if (!retained) continue;
    const source = after.nodes.find((node) => node.id === edge.source);
    const output = source?.data.params[edge.sourceHandle ?? ''];
    if (!source || source.data.uiState?.disabled || !output || output.hidden || output.display !== 'output') continue;
    if (!drivers.has(role)) drivers.set(role, new Map());
    drivers.get(role)!.set(JSON.stringify([edge.source, edge.sourceHandle]), edge);
  }
  function wouldCycle(source: string, target: string): boolean {
    const visited = new Set<string>(),
      pending = [target];
    while (pending.length) {
      const node = pending.pop()!;
      if (node === source) return true;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const edge of [...after.edges, ...added]) if (edge.source === node) pending.push(edge.target);
    }
    return false;
  }
  for (const target of targets) {
    if (target.data.uiState?.disabled) continue;
    const operation = operationAuthoring(target)?.operation;
    if (!operation) continue;
    const old = previous.find((node) => operationAuthoring(node)?.operation.operationId === operation.operationId);
    for (const port of operation.ports) {
      const role = mediaRole(port),
        field = target.data.params[port.name];
      if (
        !role ||
        !port.required ||
        !field ||
        field.hidden ||
        field.disabled ||
        !(field.display === 'input' || field.isInput) ||
        after.edges.some((edge) => edge.target === target.id && edge.targetHandle === port.name) ||
        (old &&
          ports(old).some(
            (previousPort) =>
              previousPort.name === port.name && previousPort.required && mediaRole(previousPort) === role,
          ))
      )
        continue;
      const value = field.value ?? field.default;
      if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) continue;
      const candidates = [...(drivers.get(role)?.values() ?? [])];
      if (candidates.length > 1) {
        attention.add(
          `The ${port.semanticName} input has several preserved sources. Connect the new required inputs explicitly.`,
        );
        continue;
      }
      const driver = candidates[0];
      if (!driver) continue;
      const output = after.nodes.find((node) => node.id === driver.source)!.data.params[driver.sourceHandle ?? '']!;
      if (!connectionTypesAreCompatible(output.type, field.type)) continue;
      if (wouldCycle(driver.source, target.id)) {
        attention.add(
          `The preserved ${port.semanticName} source would create a cycle. Connect the new required input explicitly.`,
        );
        continue;
      }
      added.push({ ...driver, id: `edge-${nanoid()}`, target: target.id, targetHandle: port.name });
    }
  }
  return { edges: added, attention: [...attention] };
}
