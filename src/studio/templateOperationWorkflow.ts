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
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { groupNewOperationGraph } from '../workflow/visualOperationGroups';
import { CONTROLLED_WORKFLOW_NODE_KEYS } from './controlledWorkflowContracts';
import { loraWorkflowFieldValues, upscaleWorkflowFieldValues } from './controlledWorkflowValues';
import { resolveStudioExecutionSpecValues } from './executionSpecValues';
import type {
  StudioExecutionSpec,
  StudioFormState,
  StudioGraphRole,
  StudioModelProfile,
  StudioTemplate,
} from './types';

const OWNER_IDENTITY = new Set(['artifact', 'defaultRevision', 'pipelineClass', 'executionProfileId', 'modelVariant']);

/** Construct one ordinary, visible graph from the backend's exact starter and
 * declared semantic bindings. This is authoring, never an execution receipt. */
export function createTemplateOperationGraph(
  template: StudioTemplate,
  form: StudioFormState,
  starter: OperationStarter,
  registry: Record<string, NodeData>,
  spec: StudioExecutionSpec,
  capability: StudioModelProfile,
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
  const roles = new Map<StudioGraphRole, CustomNodeType>();
  const claimed = new Set<string>();
  for (const [role, key, x, y] of spec.roles) {
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
    claimed.add(node.id);
    roles.set(role, node);
  }
  const revisionField = owner.data.params.revision;
  const revision = revisionField?.value ?? revisionField?.default;
  const values = resolveStudioExecutionSpecValues(form, spec, capability, {
    ...(typeof revision === 'string' ? { defaultModelRevision: revision } : {}),
  });
  const set = (node: CustomNodeType, names: string[], value: unknown) => {
    const name = names.find((field) => node.data.params[field]);
    if (!name) throw new Error(`The template setting ${names[0]} is not declared on ${node.data.label}.`);
    const field = node.data.params[name]!;
    field.value =
      field.type === 'model' && typeof value === 'string' ? { source: 'hub', value } : structuredClone(value);
    const hint = operationAuthoring(node);
    if (hint) hint.authored = [...new Set([...(hint.authored ?? []), name])];
  };
  if (selection.componentPolicy) {
    const policy = selection.componentPolicy;
    set(owner, ['attention_backend'], policy.attentionBackend);
    set(owner, ['vae_slicing'], policy.vaeSlicing);
    set(owner, ['vae_tiling'], policy.vaeTiling);
  }
  for (const [role, field, source] of spec.bindings) {
    const node = roles.get(role)!;
    // The selected backend profile owns its exact repository, revision and
    // class. A semantic binding spec may also serve a reviewed family variant
    // (Schnell/Krea); it must not overwrite that resolved identity with Dev.
    if (node.id === owner.id && OWNER_IDENTITY.has(source)) continue;
    const value = values[source];
    if (value === undefined) throw new Error(`The template setting ${source} has no declared value.`);
    set(node, [field], value);
  }
  // A real starter Guider owns the scale shared by encoding and denoising.
  // Keep the declared scalar binding as a mirror of the creator form rather
  // than leaving the now-hidden denoiser field as the effective control.
  const guidance = graph.nodes.filter(
    (node) => operationAuthoring(node)?.operation.operationId === 'diffusion.guidance',
  );
  if (guidance.length > 1) throw new Error('The template has several guidance owners.');
  if (guidance[0]) set(guidance[0], ['guidance_scale'], form.guidanceScale);
  if (selection.guidancePolicy) {
    const guider = guidance[0];
    const policy = selection.guidancePolicy;
    const flux = ['FluxModularPipeline', 'FluxKontextModularPipeline'].includes(selection.pipelineClass);
    if (!guider || (!flux && selection.pipelineClass !== 'ZImageModularPipeline'))
      throw new Error('The template guidance policy has no compatible declared owner.');
    set(guider, ['enabled'], policy.enabled);
    set(guider, ['use_original_formulation'], policy.useOriginalFormulation);
    if (flux) {
      const scale = policy.distilledGuidanceScale;
      const denoisers = graph.nodes.filter(
        (node) => operationAuthoring(node)?.operation.operationId === 'diffusion.denoise',
      );
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0 || scale > 20 || denoisers.length !== 1)
        throw new Error('The FLUX template needs its separate reviewed distilled guidance scale.');
      set(denoisers[0]!, ['guidance_scale'], scale);
    } else if (policy.distilledGuidanceScale !== undefined) {
      throw new Error('The template distilled guidance policy requires a FLUX pipeline.');
    }
  }
  const connect = (source: CustomNodeType, sourceNames: string[], target: CustomNodeType, targetNames: string[]) => {
    const sourceHandle = sourceNames.find((name) => source.data.params[name]);
    const targetHandle = targetNames.find((name) => target.data.params[name]);
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
  for (const [source, output, target, input] of spec.edges) {
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
      const nodes = adapters.map((adapter, index) => {
        const node = utility(
          native ? CONTROLLED_WORKFLOW_NODE_KEYS.lora : CONTROLLED_WORKFLOW_NODE_KEYS.directLora,
          index,
        );
        for (const { fields, value } of loraWorkflowFieldValues(adapter, index)) {
          // Native descriptors are assembled before ModelsLoader applies the
          // ordered list; replace_existing is a pipeline-mutation switch.
          if (native && fields[0] === 'replace_existing') continue;
          set(node, fields, value);
        }
        if (adapterName !== undefined) set(node, ['adapter_name'], adapterName);
        return node;
      });
      if (native) {
        for (let index = 1; index < nodes.length; index++)
          connect(nodes[index - 1]!, ['lora'], nodes[index]!, ['previous_loras']);
        connect(nodes[nodes.length - 1]!, ['lora'], owner, ['lora_list']);
      } else {
        const consumers = graph.edges.filter((edge) => edge.source === owner.id && edge.sourceHandle === 'pipeline');
        if (consumers.length !== 1) throw new Error('The template LoRA pipeline consumer is ambiguous.');
        const consumer = consumers[0]!;
        graph.edges = graph.edges.filter((edge) => edge.id !== consumer.id);
        connect(owner, ['pipeline'], nodes[0]!, ['pipeline']);
        for (let index = 1; index < nodes.length; index++)
          connect(nodes[index - 1]!, ['output'], nodes[index]!, ['pipeline']);
        connect(
          nodes[nodes.length - 1]!,
          ['output'],
          graph.nodes.find((node) => node.id === consumer.target)!,
          [consumer.targetHandle!],
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
    } else throw new Error(`The image template does not declare support for ${block}.`);
  }
  return groupNewOperationGraph(graph);
}
