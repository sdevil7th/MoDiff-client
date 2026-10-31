import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { OperationGraph } from './operationAuthoring';
import { operationAuthoring } from './operationAuthoringHint';
import { operationPortCompatibility } from './operationCatalog';
import type { OperationPort } from './operationContracts';
import { operationScope } from './operationScope';
import { restoreVisualOperationGroups, unpackVisualOperationGroups } from './visualOperationGroups';

export type OperationComponentBundleAction = 'bundle' | 'components';

type Consumer = { node: CustomNodeType; input: OperationPort; output: OperationPort; leaves: OperationPort[] };

/** Exact declared component members are required for this reversible wiring
 * action. Tensor types, model names and a generic aggregate socket alone do
 * not establish that it can replace a particular component input. */
function supplies(output: OperationPort, input: OperationPort) {
  const left = output.semantics,
    right = input.semantics;
  return Boolean(
    left?.kind === 'component' &&
    right?.kind === 'component' &&
    left.owner === 'same_loader' &&
    right.owner === 'same_loader' &&
    left.scope === right.scope &&
    right.members.length &&
    right.members.every((member) =>
      left.members.some((candidate) => candidate.name === member.name && candidate.type === member.type),
    ) &&
    operationPortCompatibility(output, input) !== 'incompatible',
  );
}

function consumers(graph: OperationGraph, ownerId: string): Consumer[] {
  const scope = operationScope(graph, ownerId);
  const owner = scope.find((node) => node.id === ownerId)!;
  const outputs = operationAuthoring(owner)!.operation.ports.filter((port) => port.direction === 'output');
  return scope
    .filter((node) => node.id !== ownerId)
    .flatMap((node) => {
      const inputs = operationAuthoring(node)!.operation.ports.filter((port) => port.direction === 'input');
      return inputs
        .filter((input) => inputs.some((port) => port.semantics?.suppliedBy?.input === input.name))
        .flatMap((input) => {
          const leaves = inputs.filter((port) => port.semantics?.suppliedBy?.input === input.name);
          const candidates = outputs.filter(
            (output) =>
              supplies(output, input) &&
              leaves.every((port) =>
                port.semantics!.suppliedBy!.members.every((name) =>
                  output.semantics!.members.some(
                    (member) =>
                      member.name === name &&
                      port.semantics!.members.some(
                        (expected) => expected.name === name && expected.type === member.type,
                      ),
                  ),
                ),
              ),
          );
          return candidates.length === 1 ? [{ node, input, output: candidates[0]!, leaves }] : [];
        });
    });
}

function componentOutput(owner: CustomNodeType, input: OperationPort) {
  const candidates = operationAuthoring(owner)!.operation.ports.filter(
    (port) => port.direction === 'output' && supplies(port, input),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function changes(graph: OperationGraph, ownerId: string, action: OperationComponentBundleAction) {
  const owner = graph.nodes.find((node) => node.id === ownerId)!;
  const remove = new Set<string>();
  const add: OperationGraph['edges'] = [];
  for (const consumer of consumers(graph, ownerId)) {
    const existing = graph.edges.filter(
      (edge) => edge.target === consumer.node.id && edge.targetHandle === consumer.input.name,
    );
    const bundled = existing.find((edge) => edge.source === ownerId && edge.sourceHandle === consumer.output.name);
    if (
      existing.length > 1 ||
      (consumer.node.data.params[consumer.input.name]?.value ??
        consumer.node.data.params[consumer.input.name]?.default) != null
    )
      continue;
    if (action === 'bundle') {
      if (existing.length && !bundled) continue; // A deliberately supplied alternate bundle wins.
      // Backend bundles seal actual member identities to this loader. A type-
      // compatible custom supplier or literal cannot prove that identity here.
      // Leave that whole consumer's ordinary component path unchanged.
      const competing = consumer.leaves.some((input) => {
        const drivers = graph.edges.filter(
          (edge) => edge.target === consumer.node.id && edge.targetHandle === input.name,
        );
        if (drivers.length > 1) return true;
        if (drivers[0])
          return drivers[0].source !== ownerId || drivers[0].sourceHandle !== componentOutput(owner, input)?.name;
        return (consumer.node.data.params[input.name]?.value ?? consumer.node.data.params[input.name]?.default) != null;
      });
      if (competing) continue;
      const ordinary = graph.edges.filter(
        (edge) =>
          edge.source === ownerId &&
          edge.target === consumer.node.id &&
          consumer.leaves.some(
            (input) => edge.targetHandle === input.name && edge.sourceHandle === componentOutput(owner, input)?.name,
          ),
      );
      if (!ordinary.length) continue;
      ordinary.forEach((edge) => remove.add(edge.id));
      if (!bundled)
        add.push({
          id: `edge-${nanoid()}`,
          source: ownerId,
          sourceHandle: consumer.output.name,
          target: consumer.node.id,
          targetHandle: consumer.input.name,
        });
    } else {
      if (!bundled) continue;
      const required = consumer.leaves.filter(
        (input) =>
          !graph.edges.some((edge) => edge.target === consumer.node.id && edge.targetHandle === input.name) &&
          (consumer.node.data.params[input.name]?.value ?? consumer.node.data.params[input.name]?.default) == null,
      );
      const outputs = required.map((input) => componentOutput(owner, input));
      if (outputs.some((output) => !output)) continue; // Retain an aggregate that cannot be safely broken out.
      remove.add(bundled.id);
      required.forEach((input, index) =>
        add.push({
          id: `edge-${nanoid()}`,
          source: ownerId,
          sourceHandle: outputs[index]!.name,
          target: consumer.node.id,
          targetHandle: input.name,
        }),
      );
    }
  }
  return { remove, add };
}

/** Availability uses the same exact wiring plan as the action itself. */
export function availableOperationComponentBundleActions(graph: OperationGraph, ownerId: string) {
  const ordinary = unpackVisualOperationGroups(graph).graph;
  return (['bundle', 'components'] as const).filter((action) => changes(ordinary, ownerId, action).remove.size > 0);
}

/** Rewire existing implementations only. The backend owns actual component
 * objects, identity/override validation and execution; Undo owns exact history. */
export function setOperationComponentBundle(
  graph: OperationGraph,
  ownerId: string,
  action: OperationComponentBundleAction,
): OperationGraph {
  const unpacked = unpackVisualOperationGroups(graph);
  const { remove, add } = changes(unpacked.graph, ownerId, action);
  if (!remove.size) throw new Error('No declared component connections can be changed on this model branch.');
  const next = { ...unpacked.graph, edges: [...unpacked.graph.edges.filter((edge) => !remove.has(edge.id)), ...add] };
  return restoreVisualOperationGroups(next, unpacked);
}
