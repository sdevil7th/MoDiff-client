import type { HuggingFaceNodeLibraryDefinition } from './huggingFaceNodeLibrary';
import type { StudioFormState } from './types';
import { registeredBlockV2Route } from './registeredBlockV2Routes';

/** Keep discovery and insertion on the same publisher-declared admission. */
export function huggingFaceCatalogAdmission(definition: HuggingFaceNodeLibraryDefinition, form: StudioFormState) {
  const admissions = definition.executionAdmissions.filter(
    (admission) =>
      admission.status === 'admitted' &&
      admission.claim === 'static_graph_contract_compatible' &&
      admission.executable === false &&
      admission.publication.readiness === 'graph_qualified' &&
      admission.publication.insertable &&
      admission.reasons.length === 0,
  );
  const admission =
    admissions.find((candidate) => form.modelType === definition.pipelineClass && form.mode === candidate.studioMode) ??
    admissions[0];
  return { admission, route: registeredBlockV2Route(definition, admission) };
}
