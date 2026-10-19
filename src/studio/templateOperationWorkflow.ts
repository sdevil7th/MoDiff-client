import { attachPromptEnhancementParents } from './promptEnhancementAuthoring';
import { selectedAudioAdapterPolicy } from '../workflow/selectedAudioAdapterAuthority';
import {
  validateModelSetupAdapterSelection,
  requiredAdapterControlsUnavailable,
  type ModelSetupAdapterAuthority,
} from '../workflow/modelSetupAdapters';
import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import {
  createOperationStarter,
  operationAuthoring,
  type OperationGraph,
  type OperationStarter,
} from '../workflow/operationAuthoring';
import { operationOwnsModel } from '../workflow/operationContracts';
import { acceptsOperationValue } from '../workflow/operationFieldValue';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { groupNewOperationGraph } from '../workflow/visualOperationGroups';
import { CONTROLLED_WORKFLOW_NODE_KEYS } from './controlledWorkflowContracts';
import { loraWorkflowFieldValues, upscaleWorkflowFieldValues } from './controlledWorkflowValues';
import { orderedAdapterChainLinks } from './adapterChainLinks';
import { resolveStudioExecutionSpecValues } from './executionSpecValues';
import { resolveTemplateModelSelection } from './templateModelSelection';
import type {
  StudioExecutionSpec,
  StudioFormState,
  StudioGraphRole,
  StudioModelProfile,
  StudioTemplate,
} from './types';

const OWNER_IDENTITY = new Set(['artifact', 'defaultRevision', 'pipelineClass', 'executionProfileId', 'modelVariant']);
const IDENTITY_BINDINGS: Record<string, readonly string[]> = {
  repo_id: ['artifact'],
  model_id: ['artifact'],
  revision: ['defaultRevision'],
  pipeline_class: ['pipelineClass'],
  execution_profile_id: ['executionProfileId'],
  model_type: ['pipelineClass', 'modelVariant'],
  variant: ['modelVariant'],
  reviewed_variant: ['modelVariant'],
  workflow_id: ['defaultWorkflow', 'workflowId'],
  trust_remote_code: ['false'],
};
const DEPENDENCY_IDENTITY_BINDINGS: Record<string, readonly string[]> = {
  model_type: ['kind', 'controlnetKind'],
  model_id: ['repo', 'controlnetRepo'],
  variant: ['empty', 'fp16', 'controlnetWeightVariant'],
  revision: ['revision', 'controlnetRevision'],
};
const canonicalIdentityField = (field: string) =>
  field === 'block_path' || Object.prototype.hasOwnProperty.call(IDENTITY_BINDINGS, field);
const canonicalIdentitySource = (field: string, source: string) =>
  field === 'block_path'
    ? (source.startsWith('workflow') && source.endsWith('Block')) || source === 'semanticGeneratorBlock'
    : Object.prototype.hasOwnProperty.call(IDENTITY_BINDINGS, field) && IDENTITY_BINDINGS[field]!.includes(source);

/** Construct one ordinary, visible graph from the backend's exact starter and
 * declared semantic bindings. This is authoring, never an execution receipt. */
export function createTemplateOperationGraph(
  template: StudioTemplate,
  form: StudioFormState,
  starter: OperationStarter,
  registry: Record<string, NodeData>,
  spec: StudioExecutionSpec,
  capability: StudioModelProfile,
  authority?: ModelSetupAdapterAuthority,
): OperationGraph {
  const selection = template.executionSelection;
  if (
    !selection ||
    starter.pipelineClass !== selection.pipelineClass ||
    starter.task !== selection.task ||
    spec.modelType !== selection.bindingSpec.modelType ||
    spec.mode !== selection.bindingSpec.mode ||
    spec.pipelineClass !== selection.pipelineClass
  ) {
    throw new Error('The template operation recipe does not match its backend execution contract.');
  }
  const graph = createOperationStarter(starter, { x: 80, y: 120 });
  const owners = graph.nodes.filter((node) => operationOwnsModel(operationAuthoring(node)?.operation));
  if (owners.length !== 1) throw new Error('The template needs exactly one declared model owner.');
  const owner = owners[0]!;
  const ownerBoundFields = new Set(Object.keys(operationAuthoring(owner)?.operation.binding?.values ?? {}));
  const ownerIdentityField = (field: string) => ownerBoundFields.has(field) || canonicalIdentityField(field);
  const ownerRole = spec.roles.find(([, key]) => key === `${owner.data.module}.${owner.data.action}`)?.[0];
  const ownerBindingSources = new Map(
    spec.bindings.filter(([role]) => role === ownerRole).map(([, field, source]) => [field, source]),
  );
  const recipe = starter.authoring;
  if (
    selection.authoringRecipeId !== recipe?.id ||
    (recipe &&
      (recipe.baseSpecId !== spec.id ||
        recipe.baseSpecContentHash !== spec.contentHash ||
        !recipe.executionProfileIds.includes(selection.executionProfileId)))
  )
    throw new Error('The template authoring recipe is stale or belongs to another execution specification.');
  const declarations = recipe ?? spec;
  const adapterName = selection.loraPolicy?.defaultAdapterName;
  const lora = template.workflowBlockSettings?.lora;
  if (
    selection.loraPolicy !== undefined &&
    (typeof adapterName !== 'string' ||
      !adapterName ||
      adapterName !== adapterName.trim() ||
      adapterName.length > 256 ||
      [...adapterName].some((character) => character.charCodeAt(0) < 32) ||
      !owner.data.params.lora_list ||
      template.workflowBlocks?.filter((block) => block === 'lora').length !== 1 ||
      !lora ||
      Boolean(lora.additionalAdapters?.length) ||
      (lora.adapterName !== undefined && lora.adapterName !== adapterName))
  )
    throw new Error('The template adapter identity policy needs one compatible native LoRA descriptor.');
  const ownerProfile = owner.data.params.execution_profile_id;
  if (ownerProfile && (ownerProfile.value ?? ownerProfile.default) !== selection.executionProfileId)
    throw new Error('The backend resolved a different template execution profile.');
  const lockedRevision = template.modelArtifact?.revision ?? template.example?.modelRevision;
  if (
    template.example?.mediaType === 'audio' ||
    template.modelArtifact ||
    (lockedRevision && /^[a-f0-9]{40}$/u.test(lockedRevision))
  ) {
    const selected = resolveTemplateModelSelection(template, [capability]);
    const repositoryField = owner.data.params.repo_id ?? owner.data.params.model_id;
    const repository = repositoryField?.value ?? repositoryField?.default;
    const revision = owner.data.params.revision;
    if (
      !selected ||
      !repository ||
      typeof repository !== 'object' ||
      !('source' in repository) ||
      repository.source !== 'hub' ||
      !('value' in repository) ||
      repository.value !== selected.repository ||
      (revision?.value ?? revision?.default) !== selected.revision
    )
      throw new Error('The backend resolved a different immutable template model artifact.');
  }
  const roles = new Map<StudioGraphRole, CustomNodeType>();
  const claimed = new Set<string>();
  for (const [role, key, x, y] of declarations.roles) {
    if (roles.has(role)) throw new Error(`The backend template role ${role} is duplicated.`);
    const matches = graph.nodes.filter(
      (node) => `${node.data.module}.${node.data.action}` === key && !claimed.has(node.id),
    );
    if (matches.length > 1) throw new Error(`The template role ${role} is ambiguous.`);
    const node = matches[0] ?? createNodeFromRegistry(key, registry, { x, y });
    if (!node) throw new Error(`The backend registry is missing the template role ${role}.`);
    if (!matches.length) {
      // Execution stages must come from the resolved starter. Only the
      // backend-declared media/configuration/auxiliary roles supplement it.
      if (starter.nodes.some((item) => item.operation.nodeKey === key))
        throw new Error(`The template operation role ${role} is missing.`);
      graph.nodes.push(node);
    }
    if (node.data.studioRole !== undefined && node.data.studioRole !== role)
      throw new Error('The template node role does not match its backend declaration.');
    node.data.studioRole = role;
    claimed.add(node.id);
    roles.set(role, node);
  }
  const revisionField = owner.data.params.revision;
  const revision = revisionField?.value ?? revisionField?.default;
  const values = resolveStudioExecutionSpecValues(form, spec, capability, {
    ...(typeof revision === 'string' ? { defaultModelRevision: revision } : {}),
    ...(template.example?.mediaType === 'audio'
      ? { audioTemplateBaseModel: resolveTemplateModelSelection(template, [capability])?.repository }
      : {}),
  });
  const declaresField = (node: CustomNodeType, name: string) =>
    Object.prototype.hasOwnProperty.call(node.data.params, name) && Boolean(node.data.params[name]);
  const set = (node: CustomNodeType, names: string[], value: unknown) => {
    const name = names.find((field) => declaresField(node, field));
    if (!name) throw new Error(`The template setting ${names[0]} is not declared on ${node.data.label}.`);
    const field = node.data.params[name]!;
    if (node.id === owner.id && ownerIdentityField(name))
      throw new Error('The template authoring value cannot change the resolved model identity.');
    const normalized =
      field.type === 'model' && typeof value === 'string' ? { source: 'hub', value } : structuredClone(value);
    const types = Array.isArray(field.type) ? field.type : [field.type];
    const modelSelector = field.display === 'modelselect' || types.includes('model');
    const selector =
      modelSelector && normalized && typeof normalized === 'object' && !Array.isArray(normalized)
        ? (normalized as Record<string, unknown>)
        : null;
    const sources = field.fieldOptions?.sources;
    const selectorSchema = [field.value, field.default].find(
      (item) => item && typeof item === 'object' && !Array.isArray(item) && 'source' in item && 'value' in item,
    ) as Record<string, unknown> | undefined;
    const selectorKeys = ['source', 'value', 'revision', 'sha256', 'byteSize', 'license'];
    const validSelector =
      selector &&
      Object.keys(selector).every(
        (key) =>
          selectorKeys.includes(key) &&
          (['source', 'value'].includes(key) ||
            (selectorSchema && Object.prototype.hasOwnProperty.call(selectorSchema, key))),
      ) &&
      (selector.source === 'hub' || selector.source === 'local') &&
      typeof selector.value === 'string' &&
      selector.value.length <= 4096 &&
      (selector.revision === undefined ||
        (typeof selector.revision === 'string' && /^[0-9a-f]{40}$/.test(selector.revision))) &&
      (selector.sha256 === undefined ||
        (typeof selector.sha256 === 'string' && /^[0-9a-f]{64}$/.test(selector.sha256))) &&
      (selector.byteSize === undefined ||
        (typeof selector.byteSize === 'number' && Number.isSafeInteger(selector.byteSize) && selector.byteSize > 0)) &&
      (selector.license === undefined || (typeof selector.license === 'string' && selector.license.length <= 256)) &&
      (sources === undefined || (Array.isArray(sources) && sources.includes(selector.source)));
    const fileBrowser = field.display === 'filebrowser';
    const validFile =
      (typeof normalized === 'string' && normalized.length <= 4096) ||
      (field.fieldOptions?.multiple === true &&
        Array.isArray(normalized) &&
        normalized.length <= 64 &&
        normalized.every((item) => typeof item === 'string' && item.length <= 4096));
    const optionalNull = normalized === null && (field.default === null || field.value === null) && !field.required;
    // Selectors decorate numeric option values as strings for display. Keep the
    // executable value numeric and compare it with the declared numeric domain.
    const options =
      field.options && types.some((type) => ['int', 'float', 'number'].includes(type ?? ''))
        ? (Array.isArray(field.options) ? field.options : Object.keys(field.options)).map((option) => {
            const value = option && typeof option === 'object' && 'value' in option ? option.value : option;
            return typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value;
          })
        : field.options;
    const multipleSelect = field.display === 'select' && field.fieldOptions?.multiple === true;
    const acceptsScalar = (value: unknown) => {
      const scalar =
        field.display === 'random' && value && typeof value === 'object' && !Array.isArray(value) && 'value' in value
          ? value.value
          : value;
      return (
        acceptsOperationValue({ ...field, options }, value) &&
        (!types.some((type) => ['int', 'float', 'number'].includes(type ?? '')) || typeof scalar === 'number') &&
        (!types.some((type) => ['str', 'string', 'text'].includes(type ?? '')) || typeof scalar === 'string')
      );
    };
    const validMultipleSelect =
      multipleSelect && Array.isArray(normalized) && normalized.length <= 64 && normalized.every(acceptsScalar);
    if (
      field.display === 'output' ||
      (modelSelector && !validSelector) ||
      (fileBrowser && !validFile) ||
      (!optionalNull &&
        !modelSelector &&
        !fileBrowser &&
        (multipleSelect ? !validMultipleSelect : !acceptsScalar(normalized)))
    )
      throw new Error(`The template setting ${field.label || name} is incompatible with ${node.data.label}.`);
    field.value = normalized;
    const hint = operationAuthoring(node);
    if (hint) hint.authored = [...new Set([...(hint.authored ?? []), name])];
  };
  for (const [role, field, value] of recipe?.initialValues ?? []) {
    const node = roles.get(role);
    const parameter = node && declaresField(node, field) && node.data.params[field];
    if (!node || !parameter) throw new Error('The template authoring literal is incompatible with its declared field.');
    if (
      canonicalIdentityField(field) ||
      Object.prototype.hasOwnProperty.call(operationAuthoring(node)?.operation.binding?.values ?? {}, field)
    )
      throw new Error('The template authoring literal cannot change a declared identity.');
    set(node, [field], value);
  }
  const backendDefaultInputs = new Set(selection.backendDefaultInputs ?? []);
  for (const source of backendDefaultInputs) {
    if (
      !['prompt', 'negativePrompt'].includes(source) ||
      declarations.bindings.filter(([, , name]) => name === source).length !== 1
    )
      throw new Error(`The template backend default ${source} needs one declared text binding.`);
  }
  for (const [role, field, source] of declarations.bindings) {
    const node = roles.get(role)!;
    // The selected backend profile owns its exact repository, revision and
    // class. A semantic binding spec may also serve a reviewed family variant
    // (Schnell/Krea); it must not overwrite that resolved identity with Dev.
    if (node.id === owner.id && (ownerIdentityField(field) || OWNER_IDENTITY.has(source))) {
      if (
        !declaresField(node, field) ||
        node.data.params[field]!.display === 'output' ||
        !(canonicalIdentityField(field)
          ? canonicalIdentitySource(field, source)
          : ownerBindingSources.get(field) === source)
      )
        throw new Error('The template binding cannot change the resolved model identity.');
      continue;
    }
    if (node.id !== owner.id) {
      const canonical = canonicalIdentityField(field);
      const owned = Object.prototype.hasOwnProperty.call(
        operationAuthoring(node)?.operation.binding?.values ?? {},
        field,
      );
      const exactBase = spec.bindings.some(([r, f, s]) => r === role && f === field && s === source);
      const declaredDependency =
        exactBase &&
        Object.prototype.hasOwnProperty.call(DEPENDENCY_IDENTITY_BINDINGS, field) &&
        DEPENDENCY_IDENTITY_BINDINGS[field]!.includes(source);
      if (
        (canonical && !canonicalIdentitySource(field, source) && !declaredDependency) ||
        (owned && !canonical && !exactBase)
      )
        throw new Error('The template binding cannot change a declared dependency identity.');
    }
    const value = values[source];
    if (value === undefined) throw new Error(`The template setting ${source} has no declared value.`);
    if (backendDefaultInputs.has(source as 'prompt' | 'negativePrompt') && value === '') {
      const hint = operationAuthoring(node);
      const declared = node.data.params[field];
      const backendDefault = hint?.defaults[field];
      if (
        !declared ||
        typeof backendDefault !== 'string' ||
        !backendDefault.trim() ||
        hint?.authored?.includes(field) ||
        (declared.value ?? declared.default) !== backendDefault
      )
        throw new Error(`The template backend default ${source} is missing or already authored.`);
      continue;
    }
    set(node, [field], value);
  }
  const connect = (source: CustomNodeType, sourceNames: string[], target: CustomNodeType, targetNames: string[]) => {
    const sourceHandle = sourceNames.find((name) => declaresField(source, name));
    const targetHandle = targetNames.find((name) => declaresField(target, name));
    const left = sourceHandle && source.data.params[sourceHandle];
    const right = targetHandle && target.data.params[targetHandle];
    if (
      !left ||
      !right ||
      left.display !== 'output' ||
      !(right.display === 'input' || right.isInput) ||
      !connectionTypesAreCompatible(left.type, right.type)
    )
      throw new Error(`The template connection from ${source.data.label} to ${target.data.label} is incompatible.`);
    const existing = graph.edges.find((edge) => edge.target === target.id && edge.targetHandle === targetHandle);
    if (existing) {
      if (existing.source !== source.id || existing.sourceHandle !== sourceHandle)
        throw new Error(`The template has competing suppliers for ${target.data.label}.`);
      return;
    }
    graph.edges.push({
      id: `edge-${nanoid()}`,
      source: source.id,
      sourceHandle,
      target: target.id,
      targetHandle,
      type: 'default',
    });
  };
  for (const [source, output, target, input] of declarations.edges) {
    const from = roles.get(source)!;
    const to = roles.get(target)!;
    const supplied = graph.edges.find((edge) => edge.target === to.id && edge.targetHandle === input);
    const assembly =
      supplied &&
      graph.nodes.find(
        (node) => node.id === supplied.source && operationAuthoring(node)?.operation.nodeType === 'reference_assembly',
      );
    if (assembly && from.data.module === 'modules.Image' && from.data.action === 'Load') {
      // Kontext's published multi-reference starter owns the composition stage.
      // Feed its one declared media input rather than bypassing it with the
      // single-image semantic binding spec.
      const required = starter.requiredInputs.filter(
        (item) =>
          item.operationId === operationAuthoring(assembly)!.operation.operationId &&
          assembly.data.params[item.field]?.type === 'image',
      );
      if (required.length !== 1) throw new Error('The template reference assembly input is ambiguous.');
      connect(from, [output], assembly, [required[0]!.field]);
    } else connect(from, [output], to, [input]);
  }
  const utility = (key: string, index: number) => {
    const node = createNodeFromRegistry(key, registry, { x: 80 + index * 420, y: 760 });
    if (!node) throw new Error(`The backend registry is missing ${key}.`);
    graph.nodes.push(node);
    return node;
  };
  for (const block of template.workflowBlocks ?? []) {
    if (block === 'lora') {
      const settings = template.workflowBlockSettings?.lora;
      if (!settings) throw new Error('The template LoRA contract is missing.');
      const adapters = [settings, ...(settings.additionalAdapters ?? [])];
      const native = Boolean(owner.data.params.lora_list);
      const audio = owner.data.params.pipeline?.type === 'audio_diffusion_pipeline';
      if (audio) {
        const tail = graph.edges
          .filter((edge) => edge.source === owner.id && edge.sourceHandle === 'pipeline')
          .map((edge) => ({ target: edge.target, targetHandle: edge.targetHandle! }));
        const policy = selectedAudioAdapterPolicy(owner, graph, tail, authority);
        if (typeof policy === 'string') throw new Error(policy);
        if (policy.requiredControls) {
          if (!authority) throw new Error('Refresh audio model capabilities before adding LoRA.');
          const reason = requiredAdapterControlsUnavailable(graph, owner, authority, policy.requiredControls);
          if (reason) throw new Error(reason);
        }
        if (adapters.length !== policy.maxOwnedAdapters)
          throw new Error('The selected audio template supports exactly one populated adapter.');
      }
      const nodes = adapters.map((adapter, index) => {
        const node = utility(
          native
            ? CONTROLLED_WORKFLOW_NODE_KEYS.lora
            : audio
              ? CONTROLLED_WORKFLOW_NODE_KEYS.audioLora
              : CONTROLLED_WORKFLOW_NODE_KEYS.directLora,
          index,
        );
        for (const { fields, value } of loraWorkflowFieldValues(adapter, index)) {
          // Native descriptors are assembled before ModelsLoader applies the
          // ordered list; replace_existing is a pipeline-mutation switch.
          if (native && fields[0] === 'replace_existing') continue;
          set(node, fields, value);
        }
        if (adapterName !== undefined) set(node, ['adapter_name'], adapterName);
        if (audio) {
          const selected = node.data.params.adapter_path?.value;
          // A user-supplied empty selection remains an editable, Run-blocked
          // draft. Populated selections always use the normal strict validator.
          const draft =
            template.evidencePolicy === 'user_supplied' &&
            selected &&
            typeof selected === 'object' &&
            'source' in selected &&
            'value' in selected &&
            (selected.source === 'hub' || selected.source === 'local') &&
            selected.value === '';
          if (!draft) validateModelSetupAdapterSelection(node);
        }
        return node;
      });
      if (native) {
        for (const link of orderedAdapterChainLinks({
          adapterIds: nodes.map((node) => node.id),
          inputHandles: ['previous_loras'],
          outputHandles: ['lora'],
          target: { nodeId: owner.id, handles: ['lora_list'] },
        }))
          connect(
            graph.nodes.find((node) => node.id === link.source)!,
            link.sourceHandles,
            graph.nodes.find((node) => node.id === link.target)!,
            link.targetHandles,
          );
      } else {
        const consumers = graph.edges.filter((edge) => edge.source === owner.id && edge.sourceHandle === 'pipeline');
        if (consumers.length !== 1) throw new Error('The template LoRA pipeline consumer is ambiguous.');
        const consumer = consumers[0]!;
        graph.edges = graph.edges.filter((edge) => edge.id !== consumer.id);
        for (const link of orderedAdapterChainLinks({
          adapterIds: nodes.map((node) => node.id),
          inputHandles: ['pipeline'],
          outputHandles: ['output'],
          source: { nodeId: owner.id, handles: ['pipeline'] },
          target: { nodeId: consumer.target, handles: [consumer.targetHandle!] },
        }))
          connect(
            graph.nodes.find((node) => node.id === link.source)!,
            link.sourceHandles,
            graph.nodes.find((node) => node.id === link.target)!,
            link.targetHandles,
          );
      }
    } else if (block === 'upscaler') {
      const preview = roles.get('preview');
      const input = graph.edges.find((edge) => edge.target === preview?.id && edge.targetHandle === 'image');
      if (!preview || !input) throw new Error('The template has no image output to upscale.');
      const upscaler = utility(CONTROLLED_WORKFLOW_NODE_KEYS.upscaler, 0);
      for (const { fields, value } of upscaleWorkflowFieldValues(template.workflowBlockSettings?.upscaler, form.device))
        set(upscaler, fields, value);
      const upscalePreview = utility(CONTROLLED_WORKFLOW_NODE_KEYS.preview, 1);
      upscalePreview.data.label = 'Upscaled Image';
      connect(
        graph.nodes.find((node) => node.id === input.source)!,
        [input.sourceHandle!],
        upscaler,
        ['image', 'images'],
      );
      connect(upscaler, ['images', 'output', 'image'], upscalePreview, ['image']);
    } else throw new Error(`The template does not declare support for ${block}.`);
  }
  return groupNewOperationGraph(attachPromptEnhancementParents(graph, recipe));
}
