import type { BlockInstanceV2 } from './blockSchemaV2';
import type { HuggingFaceNodeLibraryBlockDefinition } from './huggingFaceNodeLibrary';
import { exactReviewedStateContractV2 } from './reviewedStateContractV2';
import { blockContainerFieldValueV1 } from './blockContainerInterfaceV1';

export type ReviewedLoopIssueV2 = { nodeId: string; fieldId: string; code: string; message: string };

/** Diagnose saved drafts without changing their graph or assuming tensor shapes. */
export function inspectReviewedLoopV2(
  instance: BlockInstanceV2,
  definitions: readonly HuggingFaceNodeLibraryBlockDefinition[],
): ReviewedLoopIssueV2[] {
  const graph = instance.effectiveGraph;
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const kind = (id: string) => blockContainerFieldValueV1(instance, id, 'execution_kind');
  const issues: ReviewedLoopIssueV2[] = [];
  const orderedByOwner = new Map<string, string[]>();
  const owners = graph.nodes.filter((node) => kind(node.nodeId) === 'loop_owner');
  const ownerPaths = new Set(owners.map((node) => JSON.stringify(node.modularDiffusers?.placementPath)));
  for (const node of graph.nodes) {
    const parentIsLoop = ownerPaths.has(JSON.stringify(node.modularDiffusers?.placementPath?.slice(0, -1)));
    const executionKind = kind(node.nodeId);
    if (executionKind === 'loop_member' && !parentIsLoop)
      issues.push({
        nodeId: node.nodeId,
        fieldId: 'loop_members_in',
        code: 'modular_loop_scope_invalid',
        message: `${node.data.label ?? node.nodeId}: this iteration member has no enclosing upstream loop. Move it into a compatible loop; it cannot execute as a once-per-run step.`,
      });
    else if (parentIsLoop && executionKind && executionKind !== 'loop_member')
      issues.push({
        nodeId: node.nodeId,
        fieldId: 'execution_kind',
        code: 'modular_loop_scope_invalid',
        message: `${node.data.label ?? node.nodeId}: this block does not use the enclosing loop's iteration calling convention. Move it outside the loop or replace it with a compatible loop member.`,
      });
  }
  for (const owner of owners) {
    const path = owner.modularDiffusers?.placementPath;
    if (!path) continue;
    const members = graph.nodes.filter(
      (node) =>
        kind(node.nodeId) === 'loop_member' &&
        JSON.stringify(node.modularDiffusers?.placementPath?.slice(0, -1)) === JSON.stringify(path),
    );
    const ids = new Set(members.map((node) => node.nodeId));
    if (!members.length) {
      issues.push({
        nodeId: owner.nodeId,
        fieldId: 'loop_members_in',
        code: 'modular_loop_empty',
        message: `${owner.data.label ?? owner.nodeId}: the loop has no iteration members. Add compatible members and connect their Loop Members chain before running.`,
      });
      continue;
    }
    for (const member of members) {
      const outgoing = graph.edges.filter(
        (edge) => edge.sourceNodeId === member.nodeId && edge.sourcePortId === 'loop_members',
      );
      if (
        outgoing.length > 1 ||
        outgoing.some(
          (edge) =>
            edge.targetPortId !== 'loop_members_in' ||
            (!ids.has(edge.targetNodeId) && edge.targetNodeId !== owner.nodeId),
        )
      )
        issues.push({
          nodeId: member.nodeId,
          fieldId: 'loop_members',
          code: 'modular_loop_fork_invalid',
          message: `${member.data.label ?? member.nodeId}: Loop Members must have one successor in this loop, not a fork or a connection outside it. Keep only the intended successor.`,
        });
    }
    const ordered: string[] = [];
    let target = owner.nodeId;
    let invalid = false;
    while (true) {
      const incoming = graph.edges.filter(
        (edge) => edge.targetNodeId === target && edge.targetPortId === 'loop_members_in',
      );
      if (!incoming.length) break;
      const edge = incoming[0]!;
      if (
        incoming.length !== 1 ||
        edge.sourcePortId !== 'loop_members' ||
        !ids.has(edge.sourceNodeId) ||
        ordered.includes(edge.sourceNodeId)
      ) {
        issues.push({
          nodeId: target,
          fieldId: 'loop_members_in',
          code: 'modular_loop_order_invalid',
          message: `${nodes.get(target)?.data.label ?? target}: Loop Members must form one cycle-free chain inside this loop.`,
        });
        invalid = true;
        break;
      }
      ordered.unshift(edge.sourceNodeId);
      target = edge.sourceNodeId;
    }
    if (!invalid && ordered.length !== members.length) {
      issues.push({
        nodeId: target,
        fieldId: 'loop_members_in',
        code: 'modular_loop_members_disconnected',
        message: `${owner.data.label ?? owner.nodeId}: ${members.length - ordered.length} loop member(s) are disconnected. Connect their Loop Members chain to ${nodes.get(target)?.data.label ?? target}, or remove the unused members.`,
      });
    }
    if (!invalid && ordered.length === members.length) orderedByOwner.set(JSON.stringify(path), ordered);
  }
  for (const edge of graph.edges) {
    const prefix = edge.sourcePortId.startsWith('iteration_previous__')
      ? 'iteration_previous__'
      : edge.sourcePortId.startsWith('iteration_output__')
        ? 'iteration_output__'
        : null;
    if (!prefix) continue;
    const source = nodes.get(edge.sourceNodeId),
      target = nodes.get(edge.targetNodeId);
    const sourcePath = source?.modularDiffusers?.placementPath?.slice(0, -1);
    const targetPath = target?.modularDiffusers?.placementPath?.slice(0, -1);
    let message = '';
    if (
      !source ||
      !target ||
      kind(source.nodeId) !== 'loop_member' ||
      kind(target.nodeId) !== 'loop_member' ||
      !edge.targetPortId.startsWith('iteration_input__') ||
      !sourcePath ||
      JSON.stringify(sourcePath) !== JSON.stringify(targetPath)
    ) {
      message = 'An iteration connection must stay inside the same upstream loop.';
    } else {
      const outputName = edge.sourcePortId.slice(prefix.length);
      const inputName = edge.targetPortId.slice('iteration_input__'.length);
      const sourceContract = exactReviewedStateContractV2(source, definitions);
      const targetContract = exactReviewedStateContractV2(target, definitions);
      const output = sourceContract?.outputs.find((field) => field.name === outputName);
      const input = targetContract?.inputs.find((field) => field.name === inputName);
      if ((sourceContract && !output) || (targetContract && !input))
        message = 'The iteration port is not declared by its pinned upstream block.';
      else if (output && input && output.type !== input.type && ![output.type, input.type].includes('opaque'))
        message = `${inputName} expects ${input.type}; ${outputName} supplies ${output.type}. Connect a matching upstream value.`;
      const order = orderedByOwner.get(JSON.stringify(targetPath));
      if (
        !message &&
        prefix === 'iteration_output__' &&
        order &&
        order.indexOf(source.nodeId) >= order.indexOf(target.nodeId)
      )
        message =
          'The current-iteration producer runs after this input. Reorder the Loop Members chain, or explicitly use its previous-iteration output.';
      const value = blockContainerFieldValueV1(instance, target.nodeId, edge.targetPortId);
      if (!message && value !== null && value !== undefined)
        message = 'This input has both an iteration wire and a constant. Disconnect the wire or clear the constant.';
    }
    if (message)
      issues.push({
        nodeId: edge.targetNodeId,
        fieldId: edge.targetPortId,
        code: 'modular_loop_binding_invalid',
        message: `${target?.data.label ?? edge.targetNodeId}: ${message}`,
      });
  }
  return issues;
}
