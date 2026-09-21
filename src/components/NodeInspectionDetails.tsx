import { useFlowStore, type CustomNodeType } from '../stores/useFlowStore';
import { useNodesStore, type NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { blockConnectorParamsV2 } from '../studio/blockRuntimeV2';
import { formatStudioFieldValue } from '../studio/presetDiff';
import { deepEqual } from '../utils/deepEqual';
import { operationAuthoring, operationFieldValue } from '../workflow/operationAuthoring';
import type { NodeInspectorSection } from './NodeInspectorSections';

/** Read only. Selecting a section cannot resolve schemas, import code or allocate models. */
export default function NodeInspectionDetails({
  node,
  section,
}: {
  node: CustomNodeType;
  section: Exclude<NodeInspectorSection, 'parameters'>;
}) {
  const edges = useFlowStore((state) => state.edges);
  const owner = useFlowStore((state) => state.nodes.find((item) => item.id === node.data.blockProjectionOwnerId));
  const extension = useNodesStore((state) => state.customModules.find((item) => item.moduleKey === node.data.module));
  const developer = useSettingsStore((state) => state.studioViewMode) === 'expert';
  const hint = operationAuthoring(node);
  const instance = node.data.blockInstanceV2;
  const source = instance?.definitionSnapshot.source;
  const identity = `${node.data.module}.${node.data.action}`;
  const modular =
    node.data.modularDiffusersCatalogNode ??
    owner?.data.blockInstanceV2?.effectiveGraph.nodes.find((item) => item.nodeId === node.data.blockProjectionNodeId)
      ?.modularDiffusers;

  if (section === 'interface') {
    const ports = instance
      ? blockConnectorParamsV2(instance)
      : {
          inputs: Object.fromEntries(
            Object.entries(node.data.params).filter(
              ([, param]) => param.display !== 'output' && (param.display === 'input' || param.isInput),
            ),
          ),
          outputs: Object.fromEntries(
            Object.entries(node.data.params).filter(([, param]) => param.display === 'output'),
          ),
        };
    return (
      <div className="grid gap-3 text-xs text-modiff-text">
        {instance ? <p>Public sockets of this Block instance. Its internal graph remains unchanged.</p> : null}
        {(['inputs', 'outputs'] as const).map((direction) => (
          <div key={direction} className="grid gap-2">
            <h3 className="font-semibold">{direction === 'inputs' ? 'Inputs' : 'Outputs'}</h3>
            {Object.entries(ports[direction]).map(([name, param]: [string, NodeParams]) => {
              const connections = edges.filter((edge) =>
                direction === 'inputs'
                  ? edge.target === node.id && edge.targetHandle === name
                  : edge.source === node.id && edge.sourceHandle === name,
              );
              return (
                <div key={name} className="break-words">
                  <p>
                    {param.label || name} · {Array.isArray(param.type) ? param.type.join(' | ') : param.type || 'Any'}
                    {param.required ? ' · Required' : ''}
                  </p>
                  <p className="text-modiff-subtle-text">Socket: {name}</p>
                  {connections.length ? (
                    connections.map((edge) => (
                      <p key={edge.id} className="text-modiff-subtle-text">
                        {direction === 'inputs'
                          ? `From ${edge.source}.${edge.sourceHandle}`
                          : `To ${edge.target}.${edge.targetHandle}`}
                      </p>
                    ))
                  ) : (
                    <p className="text-modiff-subtle-text">Not connected</p>
                  )}
                </div>
              );
            })}
            {!Object.keys(ports[direction]).length ? <p>No declared {direction}.</p> : null}
          </div>
        ))}
      </div>
    );
  }

  if (section === 'docs') {
    const description = instance?.definitionSnapshot.description || node.data.description;
    return (
      <div className="grid gap-3 break-words text-xs text-modiff-text">
        <p className="whitespace-pre-wrap">{description || 'No description supplied by this node.'}</p>
        {instance ? (
          <p>Use Expand Block on the canvas to edit this composition. This does not edit the Python implementation.</p>
        ) : null}
        {Object.entries(node.data.params)
          .filter(([, param]) => param.description && !param.hidden)
          .map(([name, param]) => (
            <div key={name}>
              <h3 className="font-semibold">{param.label || name}</h3>
              <p className="whitespace-pre-wrap text-modiff-subtle-text">{param.description}</p>
            </div>
          ))}
        {instance?.effectiveInterface.controls
          .filter((control) => control.help)
          .map((control) => (
            <div key={control.controlId}>
              <h3 className="font-semibold">{control.label}</h3>
              <p className="whitespace-pre-wrap text-modiff-subtle-text">{control.help}</p>
            </div>
          ))}
      </div>
    );
  }

  if (section === 'run') {
    return (
      <div className="grid gap-2 break-words text-xs text-modiff-text">
        <p>
          {node.data.executionStatus ? `Status: ${node.data.executionStatus}` : 'No execution recorded for this node.'}
        </p>
        <p>{node.data.isCached ? 'Cached outputs reported.' : 'No cached outputs reported.'}</p>
        <p className="text-modiff-subtle-text">Reuse on the next run still requires matching execution inputs.</p>
        {node.data.activeTaskId ? <p>Task: {node.data.activeTaskId}</p> : null}
        {node.data.executionPhase ? <p>Phase: {node.data.executionPhase}</p> : null}
        {node.data.progressMessage ? <p>{node.data.progressMessage}</p> : null}
        {node.data.uiState?.validationMessage ? <p>Validation: {node.data.uiState.validationMessage}</p> : null}
        {node.data.uiState?.errorMessage ? <p>Error: {node.data.uiState.errorMessage}</p> : null}
        <p className="text-modiff-subtle-text">
          These are the node's current diagnostics. Previous runs remain in history.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 break-words text-xs text-modiff-text">
      <p>{identity}</p>
      {developer ? <p className="text-modiff-subtle-text">Canvas node: {node.id}</p> : null}
      {hint ? (
        <>
          <p>
            {hint.operation.pipelineClass} · {hint.operation.task}
          </p>
          <p>
            {hint.operation.blockName ??
              (hint.operation.decomposition === 'loader'
                ? 'Model loader'
                : hint.operation.decomposition === 'integrated'
                  ? 'Model operation'
                  : 'Whole pipeline call')}
          </p>
          <dl className="grid gap-2">
            {Object.entries(hint.defaults).map(([name, value]) => {
              const connected = edges.find((edge) => edge.target === node.id && edge.targetHandle === name);
              return (
                <div key={name}>
                  <dt>
                    {name} —{' '}
                    {connected
                      ? `Connected from ${connected.source}.${connected.sourceHandle}; saved fallback`
                      : deepEqual(value, operationFieldValue(node.data.params[name]))
                        ? 'Selected contract default'
                        : 'User override'}
                  </dt>
                  <dd className="text-modiff-subtle-text">
                    {formatStudioFieldValue(operationFieldValue(node.data.params[name]))}
                  </dd>
                </div>
              );
            })}
          </dl>
          {hint.retained.length ? (
            <div>
              <p>Retained settings — excluded from execution:</p>
              <ul className="list-inside list-disc">
                {hint.retained.map((setting, index) => (
                  <li key={index}>
                    {setting.pipeline} / {setting.field}: {formatStudioFieldValue(setting.value)}. {setting.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      {instance && source ? (
        <>
          <p>
            Editable graph composition · {instance.effectiveGraph.nodes.length} internal nodes ·{' '}
            {instance.effectiveGraph.edges.length} internal connections
          </p>
          <p>Definition: {instance.definitionSnapshot.definitionId}</p>
          <p>Revision: {instance.definitionSnapshot.contentHash}</p>
          <p>
            Source: {source.kind} {source.library} {source.pipelineClass}
          </p>
          {source.repository ? (
            <p>
              Repository: {source.repository} · {source.repositoryRevision ?? 'Revision not supplied'}
            </p>
          ) : null}
          {source.libraryRevision ? <p>Library revision: {source.libraryRevision}</p> : null}
          <p>Customization: {instance.customization.state.replace(/_/gu, ' ')}</p>
        </>
      ) : null}
      {modular ? (
        <>
          <p>Pinned upstream implementation: {modular.blockClass ?? modular.blocksClass}</p>
          <p>
            {modular.pipelineClass} · {modular.workflowId}
          </p>
          <p>Library revision: {modular.libraryRevision}</p>
          {modular.placementPath?.length ? <p>Placement: {modular.placementPath.join(' / ')}</p> : null}
          {modular.blockContractHash ? <p>Contract: {modular.blockContractHash}</p> : null}
        </>
      ) : null}
      {extension ? (
        <>
          <p>
            Custom Python implementation · {extension.name} · {extension.status}
          </p>
          <p>Source: {extension.path}</p>
          {extension.revision ? <p>Revision: {extension.revision}</p> : null}
          <p>Inspected code: {extension.codeHash ?? 'Not inspected'}</p>
          {extension.diagnostic ? <p>{extension.diagnostic}</p> : null}
          <p className="text-modiff-subtle-text">
            Manage source and approvals in Custom nodes. Inspection grants no code permission.
          </p>
        </>
      ) : null}
      {!instance && !hint && !extension && !modular ? (
        <p className="text-modiff-subtle-text">
          Registered node implementation. Its controls and sockets come from the backend contract.
        </p>
      ) : null}
    </div>
  );
}
