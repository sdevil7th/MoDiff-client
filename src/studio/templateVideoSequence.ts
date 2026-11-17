import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationGraph } from '../workflow/operationAuthoring';
import { operationAuthoring } from '../workflow/operationAuthoring';
import { operationOwnsModel } from '../workflow/operationContracts';
import { remapOperationAuthoring } from '../workflow/operationSharedInputs';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { groupNewOperationGraph, groupVisualStages, operationStageMemberIds } from '../workflow/visualOperationGroups';
import { createUserBlockDraftV2, prepareUserBlockCreationV2 } from './userBlockCreationV2';
import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import { createStoryboardShotBlock } from '../workflow/storyboardShotPresentation';
import type { StudioFormState, StudioTemplate } from './types';
import { upscaleWorkflowFieldValues } from './controlledWorkflowValues';

/** Author concrete shot subgraphs through the normal factories and Block
 * creation path. No model execution, implicit loop or second persisted graph. */
export function createTemplateVideoSequence(
  template: StudioTemplate,
  form: StudioFormState,
  registry: Record<string, NodeData>,
  single: (template: StudioTemplate, form: StudioFormState) => OperationGraph,
): OperationGraph {
  const quality = template.workflowBlocks?.includes('quality_video_sequence') === true;
  const settings = quality
    ? template.workflowBlockSettings?.qualityVideoSequence
    : template.workflowBlockSettings?.videoSequence;
  const text = quality
    ? template.workflowBlockSettings?.qualityVideoSequence?.shotsJson
    : template.workflowBlockSettings?.videoSequence?.promptsJson;
  if (!settings || typeof text !== 'string') throw new Error('The sequence needs its complete authored storyboard.');
  const records: unknown = JSON.parse(text);
  if (!Array.isArray(records) || !records.length || records.length > 64)
    throw new Error('The sequence needs one to 64 explicit shots.');
  const shots = records.map((value, index) => {
    const row = typeof value === 'string' ? { prompt: value } : value;
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.prompt !== 'string' || !row.prompt.trim())
      throw new Error(`Shot ${index + 1} needs a prompt.`);
    return row as {
      prompt: string;
      title?: string;
      seed?: number;
      duration_seconds?: number;
      conditioning_strength?: number;
      reference_count?: number;
    };
  });
  const plan = quality ? template.workflowBlockSettings!.qualityVideoSequence! : undefined;
  const values = {
    ...form,
    width: plan?.width ?? form.width,
    height: plan?.height ?? form.height,
    fps: plan?.fps ?? form.fps,
    steps: plan?.steps ?? form.steps,
    guidanceScale: plan?.guidanceScale ?? form.guidanceScale,
  };
  if (plan?.mode && template.executionSelection?.task !== plan.mode)
    throw new Error('The storyboard task does not match its selected backend starter.');
  const create = (key: string, x = 80, y = 120) => {
    const node = createNodeFromRegistry(key, registry, { x, y });
    if (!node) throw new Error(`The backend registry is missing ${key}.`);
    return node;
  };
  const set = (node: CustomNodeType, field: string, value: unknown) => {
    if (!node.data.params[field] || node.data.params[field]!.display === 'output')
      throw new Error(`The sequence field ${node.data.label}.${field} is unavailable.`);
    node.data.params[field]!.value = structuredClone(value);
  };
  const wire = (
    graph: OperationGraph,
    source: CustomNodeType,
    output: string,
    target: CustomNodeType,
    input: string,
  ) => {
    const from = source.data.params[output],
      to = target.data.params[input];
    if (
      from?.display !== 'output' ||
      !to ||
      to.display === 'output' ||
      !connectionTypesAreCompatible(from.type, to.type)
    )
      throw new Error(
        `The sequence connection ${source.data.label}.${output} → ${target.data.label}.${input} is incompatible.`,
      );
    if (graph.edges.some((edge) => edge.target === target.id && edge.targetHandle === input))
      throw new Error(`The sequence field ${target.data.label}.${input} already has a supplier.`);
    to.isInput = true;
    graph.edges.push({
      id: `edge-${nanoid()}`,
      source: source.id,
      sourceHandle: output,
      target: target.id,
      targetHandle: input,
      type: 'default',
    });
  };
  const storyboard = create('modules.VideoConditioning.Storyboard', 500, 120);
  // Storyboard owns text and seed inheritance. Render timing and conditioning
  // live on each real Generate stage, so editing those controls cannot be
  // silently superseded by a second value in the JSON record.
  set(storyboard, 'shots_json', JSON.stringify(shots.map(({ title, prompt, seed }) => ({ title, prompt, seed }))));
  set(storyboard, 'base_seed', { value: form.seed, isRandom: form.randomSeed });
  const result: OperationGraph = { nodes: [storyboard], edges: [] };
  const list = create('modules.Primitive.ToList', 2700, 120);
  list.data.label = 'Ordered shots';
  result.nodes.push(list);
  let sharedSetup: CustomNodeType[] | undefined;
  let setupEdges: OperationGraph['edges'] = [];
  let referenceOffset = 0;
  for (const [index, shot] of shots.entries()) {
    const blocks = (template.workflowBlocks ?? []).filter(
      (block) => !['video_sequence', 'quality_video_sequence'].includes(block) && (quality || block !== 'upscaler'),
    );
    const seed = shot.seed ?? form.seed + index;
    const referenceCount = shot.reference_count ?? 1;
    if (!Number.isInteger(referenceCount) || referenceCount < 1 || referenceCount > 8)
      throw new Error('Each image-conditioned shot needs one to eight ordered reference slots.');
    const referenceImages =
      template.executionSelection?.task === 'image_to_video'
        ? form.referenceImages.slice(referenceOffset, referenceOffset + referenceCount)
        : form.referenceImages;
    referenceOffset += referenceCount;
    const raw = single(
      { ...template, workflowBlocks: blocks },
      {
        ...values,
        seed,
        randomSeed: false,
        prompt: shot.prompt,
        referenceImages,
        strength: shot.conditioning_strength ?? plan?.conditioningStrength ?? form.strength,
      },
    );
    const owner = raw.nodes.find((node) => operationOwnsModel(operationAuthoring(node)?.operation));
    if (!owner) throw new Error('The shot needs its resolved primary model owner.');
    const setupIds = new Set(operationStageMemberIds(raw, owner.id, 'setup'));
    // Repeated operation IDs describe the same contracts, but each shot has
    // its own encoding/sampling value relationship under the shared loader.
    for (const node of raw.nodes)
      for (const binding of node.data.operationAuthoring?.sharedInputs ?? [])
        binding.scopeNodeIds = raw.nodes
          .filter((member) =>
            member.data.operationAuthoring?.sharedInputs?.some(
              (other) => other.groupId === binding.groupId && other.loaderId === binding.loaderId,
            ),
          )
          .map((member) => member.id);
    const setup = raw.nodes.filter((node) => setupIds.has(node.id));
    if (!sharedSetup) {
      sharedSetup = structuredClone(setup);
      setupEdges = structuredClone(raw.edges.filter((edge) => setupIds.has(edge.source) && setupIds.has(edge.target)));
    }
    const replacements = new Map<string, string>();
    for (const node of setup) {
      const matches = sharedSetup.filter(
        (other) => other.data.module === node.data.module && other.data.action === node.data.action,
      );
      if (
        matches.length !== 1 ||
        canonicalBlockStringifyV2(matches[0]!.data.params) !== canonicalBlockStringifyV2(node.data.params)
      )
        throw new Error('Every shot must share the same exact primary setup and resource controls.');
      replacements.set(node.id, matches[0]!.id);
    }
    raw.nodes = [
      ...structuredClone(sharedSetup),
      ...raw.nodes
        .filter((node) => !setupIds.has(node.id))
        .map((node) => {
          const hint = remapOperationAuthoring(node.data.operationAuthoring, (id) => replacements.get(id) ?? id);
          return hint ? { ...node, data: { ...node.data, operationAuthoring: hint } } : node;
        }),
    ];
    raw.edges = raw.edges
      .filter((edge) => !setupIds.has(edge.target))
      .map((edge) => ({ ...edge, source: replacements.get(edge.source) ?? edge.source }));
    const collectionField = index === 0 ? 'item' : `item>>>shot-${String(index + 1).padStart(2, '0')}`;
    list.data.params[collectionField] = structuredClone(list.data.params.item!);
    list.data.params[collectionField]!.label = `Shot ${index + 1}`;
    raw.nodes.push(structuredClone(storyboard), structuredClone(list));
    const encoder = raw.nodes.find((node) => operationAuthoring(node)?.operation.nodeType === 'video_encoder');
    const sampler = raw.nodes.find(
      (node) => node.data.module === 'modules.DiffusersVideo' && node.data.action === 'Denoise',
    );
    const decoder = raw.nodes.find(
      (node) => node.data.module === 'modules.DiffusersVideo' && node.data.action === 'DecodeLatents',
    );
    const exporter = raw.nodes.find((node) => node.data.module === 'modules.Video' && node.data.action === 'Export');
    if (!encoder || !sampler || !decoder || !exporter)
      throw new Error('The shot must retain real encoding, sampling, decode and delivery.');
    if (
      shot.duration_seconds !== undefined &&
      (typeof shot.duration_seconds !== 'number' ||
        !Number.isFinite(shot.duration_seconds) ||
        shot.duration_seconds <= 0)
    )
      throw new Error(`Shot ${index + 1} needs a finite positive duration.`);
    const durationFrames =
      shot.duration_seconds === undefined
        ? form.numFrames
        : Math.max(1, Math.round(shot.duration_seconds * values.fps));
    const shotFrames =
      shot.duration_seconds === undefined
        ? durationFrames
        : (durationFrames - 1) % 4
          ? durationFrames + 4 - ((durationFrames - 1) % 4)
          : durationFrames;
    set(sampler, 'num_frames', shotFrames);
    const prompt = create('modules.VideoConditioning.ShotPrompt');
    const controls = create('modules.VideoConditioning.ShotInputs');
    set(prompt, 'index', index);
    set(controls, 'index', index);
    prompt.data.params.index!.hidden = true;
    controls.data.params.index!.hidden = true;
    for (const [field, value] of Object.entries({
      width: values.width,
      height: values.height,
      num_frames: form.numFrames,
      fps: values.fps,
      steps: values.steps,
      guidance_scale: values.guidanceScale,
      secondary_guidance_scale: plan?.secondaryGuidanceScale ?? form.guidanceScale2,
      conditioning_strength: shot.conditioning_strength ?? plan?.conditioningStrength ?? form.strength,
    }))
      if (value !== undefined) set(controls, field, value);
    set(controls, 'seed_override', { value: seed, isRandom: false });
    for (const field of [
      'prompt_override',
      'negative_prompt',
      'width',
      'height',
      'steps',
      'guidance_scale',
      'secondary_guidance_scale',
      'num_frames',
      'conditioning_strength',
    ])
      controls.data.params[field]!.hidden = true;
    raw.nodes.push(prompt, controls);
    wire(raw, storyboard, 'storyboard', prompt, 'storyboard');
    wire(raw, storyboard, 'storyboard', controls, 'storyboard');
    wire(raw, storyboard, 'seed', controls, 'base_seed');
    wire(raw, prompt, 'prompt', encoder, 'prompt');
    for (const [output, input] of [
      ['seed', 'seed'],
      ['fps_out', 'frame_rate'],
    ] as const)
      wire(raw, controls, output, sampler, input);
    const video = raw.edges.find((edge) => edge.target === exporter.id && edge.targetHandle === 'video');
    if (!video) throw new Error('The shot delivery lost its actual generated frames.');
    const rendered = raw.nodes.find((node) => node.id === video.source)!;
    const save = create('modules.Video.ExportAsset');
    save.data.label = 'Save Shot';
    set(save, 'quality', 10);
    set(save, 'pin', true);
    set(save, 'fps', values.fps);
    raw.nodes = raw.nodes.filter((node) => node.id !== exporter.id);
    raw.edges = raw.edges.filter((edge) => edge.target !== exporter.id && edge.source !== exporter.id);
    raw.nodes.push(save);
    wire(raw, rendered, video.sourceHandle!, save, 'video');
    wire(raw, controls, 'fps_out', save, 'fps');
    for (const [field, param] of Object.entries(controls.data.params))
      if (
        param.display === 'output' &&
        !raw.edges.some((edge) => edge.source === controls.id && edge.sourceHandle === field)
      )
        param.hidden = true;
    wire(
      raw,
      quality ? save : decoder,
      quality ? 'asset' : 'video_out',
      raw.nodes.find((node) => node.id === list.id)!,
      collectionField,
    );
    for (const node of raw.nodes) if (node.data.module === 'modules.Spandrel') node.data.label = 'Upscale';
    let grouped = groupVisualStages(raw, [encoder.id, prompt.id], 'inputs', undefined, {
      implicitScalarControlNodeIds: [prompt.id],
    });
    grouped = groupVisualStages(grouped, [sampler.id, decoder.id, controls.id], 'generate');
    // Group source images only; their picker belongs to this shot.
    const inputIds = grouped.nodes
      .filter((node) => node.data.module === 'modules.Image' && node.data.action === 'Load')
      .map((node) => node.id);
    if (inputIds.length) grouped = groupVisualStages(grouped, inputIds, 'imageInput');
    const outside = new Set([...sharedSetup.map((node) => node.id), storyboard.id, list.id]);
    const title = typeof shot.title === 'string' && shot.title.trim() ? shot.title.trim() : undefined;
    const wrapped = createStoryboardShotBlock(
      grouped,
      new Set(grouped.nodes.filter((node) => !outside.has(node.id)).map((node) => node.id)),
      title ? `Shot ${index + 1} · ${title}` : `Shot ${index + 1}`,
      // Match canonical storyboards: distinct authored rows keep shot order
      // stable when the layered arranger breaks ties between parallel branches.
      { x: 1000, y: 120 + index * 720 },
    );
    const root = wrapped.root;
    result.nodes.push(root);
    result.edges.push(...wrapped.graph.edges.filter((edge) => edge.source === root.id || edge.target === root.id));
  }
  if (!sharedSetup) throw new Error('The sequence has no primary setup.');
  result.nodes.unshift(...sharedSetup);
  result.edges.push(...setupEdges);
  const compose = create(quality ? 'modules.Video.ConcatenateAssets' : 'modules.Video.Concatenate', 3100, 120);
  compose.data.label = quality ? 'Assemble & Export' : 'Assemble';
  set(compose, 'transition_seconds', settings.transitionSeconds);
  if (compose.data.params.fps) set(compose, 'fps', values.fps);
  if (compose.data.params.pin) set(compose, 'pin', true);
  result.nodes.push(compose);
  // Retained quality shots preserve the historical file-backed assembly.
  // Ordinary sequences assemble native in-memory frame collections.
  wire(result, list, 'list', compose, 'clips');
  const assemblyIds = new Set([list.id, compose.id]);
  if (!quality) {
    let source = compose,
      output = 'output';
    const trimFrames = template.workflowBlockSettings?.videoSequence?.trimFrames;
    if (trimFrames !== undefined) {
      const trim = create('modules.Video.Trim', 3300, 120);
      set(trim, 'range_mode', 'frames');
      set(trim, 'fps', values.fps);
      set(trim, 'start', 0);
      set(trim, 'end', trimFrames);
      result.nodes.push(trim);
      assemblyIds.add(trim.id);
      wire(result, source, output, trim, 'video');
      source = trim;
      output = 'output';
    }
    if (template.workflowBlocks?.includes('upscaler')) {
      const upscale = create('modules.Spandrel.Upscaler', 3500, 120);
      upscale.data.label = 'Upscale';
      for (const { fields, value } of upscaleWorkflowFieldValues(template.workflowBlockSettings?.upscaler, form.device))
        set(upscale, fields[0]!, value);
      result.nodes.push(upscale);
      wire(result, source, output, upscale, 'image');
      source = upscale;
      output = 'output';
    }
    const exporter = create('modules.Video.Export', 3900, 120);
    set(exporter, 'fps', values.fps);
    result.nodes.push(exporter);
    wire(result, source, output, exporter, 'video');
  }
  // Ordering is assembly bookkeeping, kept inside the ordinary Assemble
  // Block. Its real shot sockets, timing controls and outputs remain public.
  const assembly = createUserBlockDraftV2(
    {
      nodes: result.nodes.map((node) => ({ ...node, selected: assemblyIds.has(node.id) })),
      edges: result.edges,
    },
    [],
  );
  if (!assembly.ok) throw new Error(`The assembly stage could not be grouped: ${assembly.reason}`);
  const assembled = prepareUserBlockCreationV2(assembly, {
    ...assembly.block,
    name: quality ? 'Assemble & Export' : 'Assemble',
  });
  return groupNewOperationGraph(assembled.graph);
}
