import type { BlockDefinitionV2, BlockInstanceV2, CompositeNodeCapabilitiesV2 } from './blockSchemaV2';

/**
 * The active workspace/user permission boundary used to resolve composite
 * actions. This is session context, not persisted block data or execution
 * authority.
 */
export type CompositeBlockPermissionBoundaryV2 = Readonly<{
  /** The workflow may be changed and saved by the active user. */
  editWorkflow: boolean;
  /** The active workspace permits explicit public-interface changes. */
  configureInterfaces: boolean;
  /** The active user may create reusable definitions in User Nodes. */
  createUserDefinitions: boolean;
  /** The active user may update an existing reusable User Node definition. */
  updateUserDefinitions: boolean;
}>;

const NO_CAPABILITIES: Readonly<CompositeNodeCapabilitiesV2> = Object.freeze({
  editInstanceValues: false,
  editInstanceStructure: false,
  configureInterface: false,
  keepWorkflowOnly: false,
  saveAsNewUserNode: false,
  updateReusableDefinition: false,
});

function definitionMatchesInstance(definition: BlockDefinitionV2, instance: BlockInstanceV2) {
  const snapshot = instance.definitionSnapshot;
  const registeredSource =
    definition.source.kind === 'diffusers_catalog' || definition.source.kind === 'transformers_catalog';
  const ownershipIsCanonical = registeredSource
    ? definition.ownership.kind === 'registered' && !definition.ownership.definitionMutable
    : definition.ownership.kind === 'user' && definition.ownership.definitionMutable;
  const graphChanged = instance.effectiveGraph.graphHash !== snapshot.graph.graphHash;
  const interfaceChanged =
    instance.effectiveInterface.effectiveInterfaceHash !== instance.effectiveInterface.baseInterfaceHash;
  const customizationStateIsCanonical =
    instance.customization.state === 'structure_changed'
      ? graphChanged || interfaceChanged
      : (instance.customization.state === 'unchanged' || instance.customization.state === 'parameters_changed') &&
        !graphChanged &&
        !interfaceChanged;
  return (
    ownershipIsCanonical &&
    customizationStateIsCanonical &&
    instance.schemaVersion === 2 &&
    definition.schemaVersion === 2 &&
    snapshot.schemaVersion === 2 &&
    instance.definitionRef.definitionId === definition.definitionId &&
    instance.definitionRef.contentHash === definition.contentHash &&
    snapshot.definitionId === definition.definitionId &&
    snapshot.contentHash === definition.contentHash &&
    snapshot.source.kind === definition.source.kind &&
    snapshot.ownership.kind === definition.ownership.kind &&
    snapshot.ownership.definitionMutable === definition.ownership.definitionMutable &&
    instance.customization.baseGraphHash === snapshot.graph.graphHash &&
    instance.customization.effectiveGraphHash === instance.effectiveGraph.graphHash &&
    Boolean(instance.effectiveInterface.baseInterfaceHash) &&
    Boolean(instance.effectiveInterface.effectiveInterfaceHash)
  );
}

/**
 * Resolve the actions permitted for one canonical composite block.
 *
 * The result is a transient renderer view. It is intentionally independent
 * of run/preview state and authority receipts, is not written to the block,
 * and is excluded from definition/graph hashing.
 *
 * `definition` must be the exact reusable definition represented by the
 * instance snapshot. A mismatch fails closed so an instance can never update
 * a different reusable definition accidentally.
 */
export function resolveCompositeBlockCapabilitiesV2(
  definition: BlockDefinitionV2,
  instance: BlockInstanceV2,
  permissions: CompositeBlockPermissionBoundaryV2,
): CompositeNodeCapabilitiesV2 {
  if (!definitionMatchesInstance(definition, instance)) return { ...NO_CAPABILITIES };

  const canEditWorkflow = permissions.editWorkflow;
  const userOwnedMutableDefinition = definition.ownership.kind === 'user' && definition.ownership.definitionMutable;

  return {
    // Registered and user-owned blocks share the same instance editing model.
    editInstanceValues: canEditWorkflow,
    editInstanceStructure: canEditWorkflow,
    configureInterface: canEditWorkflow && permissions.configureInterfaces,
    keepWorkflowOnly: canEditWorkflow,
    saveAsNewUserNode: canEditWorkflow && permissions.createUserDefinitions,
    // Catalog definitions are immutable even when every workspace permission
    // is granted. Only an explicitly user-owned mutable definition may update.
    updateReusableDefinition: canEditWorkflow && permissions.updateUserDefinitions && userOwnedMutableDefinition,
  };
}
