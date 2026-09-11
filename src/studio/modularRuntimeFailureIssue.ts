import type { RunReadinessIssue, RuntimeFailure } from './types';

/** Historical runtime evidence is advisory, never authority to mutate a graph. */
export function modularRuntimeFailureIssue(
  failure: RuntimeFailure | null,
  targetsActiveWorkflow: boolean,
  visibleNodeId: string | null,
): RunReadinessIssue | null {
  if (
    !failure ||
    !targetsActiveWorkflow ||
    !visibleNodeId ||
    failure.oom ||
    !/(?:Modular block |Loop member )/u.test(failure.message)
  )
    return null;
  return {
    id: `modular-runtime:${failure.id}`,
    code: 'modular_runtime_failure',
    category: 'graph',
    severity: 'warning',
    blocking: false,
    action: 'inspect_node',
    nodeId: visibleNodeId,
    message: `Last execution failed: ${failure.message}`,
    details:
      'Inspect the named block and its inputs, component requirements or initial loop state. Correct the connection or supply a compatible value, then run again to verify. No tensor, model or parameter change is guessed automatically.',
  };
}
