import { isRecord } from '../studio/outputContracts';
import { parseWorkflowPackage } from '../studio/workflowPackage';
import { workflowSnapshotFromGraph } from '../studio/workflowInference';
import type { StudioFormState, WorkflowTabSnapshot } from '../studio/types';

/** Keep authored names intact, including multilingual labels. Only format a filename fallback. */
export function workflowExampleDisplayName(path: string, name?: string) {
  const basename =
    path
      .split(/[\\/]/u)
      .pop()
      ?.replace(/\.json$/iu, '') ?? '';
  if (name && name !== basename) return name;
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/u.test(basename)) return basename;
  return basename.charAt(0).toUpperCase() + basename.slice(1).replace(/[-_]/gu, ' ');
}

/** Both file selection and canvas drop open the existing portable formats in a new tab. */
export async function readWorkflowJson(file: File, edgeType: string, form: StudioFormState) {
  const value: unknown = JSON.parse(await file.text());
  const pkg = parseWorkflowPackage(value);
  const title = pkg?.title || file.name.replace(/\.json$/i, '') || 'Imported workflow';
  const graph = isRecord(value) && Array.isArray(value.nodes) && Array.isArray(value.edges) ? value : null;
  if (graph && isRecord(graph.studioForm)) return { title, snapshot: graph as unknown as WorkflowTabSnapshot };
  if (pkg) return { title, snapshot: pkg.snapshot };
  if (graph) return { title, snapshot: workflowSnapshotFromGraph(graph, edgeType, form) };
  throw new Error('Choose a MoDiff workflow JSON file or an exported workflow package.');
}
