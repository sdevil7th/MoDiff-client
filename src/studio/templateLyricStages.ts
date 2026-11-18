import { nanoid } from 'nanoid';
import type { CustomNodeType } from '../stores/useFlowStore';
import type { NodeData } from '../stores/useNodeStore';
import type { OperationGraph } from '../workflow/operationAuthoring';
import { groupNewOperationGraph, unpackVisualOperationGroups } from '../workflow/visualOperationGroups';
import { visualOperationGroup } from '../workflow/visualOperationGroupProjection';
import { createNodeFromRegistry } from '../workflow/nodeFactory';
import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';
import { audioFitWorkflowFieldValues, lyricVideoWorkflowFieldValues } from './controlledWorkflowValues';
import type { StudioFormState, StudioTemplate } from './types';
import type { TemplateSecondaryVideo } from './templateSecondaryStages';

/** Author the two ordinary branches, then join their real media outputs. */
export function createTemplateLyricStages(
  template: StudioTemplate,
  form: StudioFormState,
  registry: Record<string, NodeData>,
  secondary: TemplateSecondaryVideo | undefined,
  audio: (template: StudioTemplate, form: StudioFormState) => OperationGraph,
  video: (template: StudioTemplate, form: StudioFormState, context: TemplateSecondaryVideo) => OperationGraph,
): OperationGraph {
  const settings = template.workflowBlockSettings?.lyricVideo;
  if (!settings || settings.recipeVersion !== 'nine-scenes:v2' || !settings.visualModel.revision || !secondary)
    throw new Error('The nine-scene recipe needs its resolved secondary video stages.');
  const graph = audio({ ...template, workflowBlocks: [] }, form);
  const generator = graph.nodes.find(
    (node) => node.data.module === 'modules.DiffusersAudio' && node.data.action === 'Generate',
  );
  if (!generator) throw new Error('The song needs its actual audio generator.');
  const set = (node: CustomNodeType, field: string, value: unknown) => {
    const param = node.data.params[field];
    if (!param || param.display === 'output')
      throw new Error(`The music-video field ${node.data.label}.${field} is unavailable.`);
    param.value = structuredClone(
      param.display === 'random' && typeof value === 'number' ? { value, isRandom: false } : value,
    );
  };
  for (const { fields, value } of lyricVideoWorkflowFieldValues(settings, form).audioGenerate)
    set(generator, fields[0]!, value);
  const visualTemplate: StudioTemplate = {
    ...template,
    modelType: secondary.capability.modelType,
    mode: 'image_to_video',
    category: 'video_generation',
    modelArtifact: settings.visualModel,
    executionSelection: settings.visualExecutionSelection,
    workflowBlocks: ['video_sequence', 'upscaler'],
    workflowBlockSettings: {
      videoSequence: { promptsJson: settings.promptsJson, transitionSeconds: 0, trimFrames: 720 },
      upscaler: {
        model: {
          source: 'hub',
          value: 'nateraw/real-esrgan/RealESRGAN_x2plus.pth',
          revision: '42efb9c3eeed1f5c0c8a626cf5f7f4481dfbb094',
          sha256: '49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb',
          byteSize: 67061725,
        },
        downscale: 1,
      },
    },
    example: template.example && {
      ...template.example,
      mediaType: 'video',
      modelRevision: settings.visualModel.revision,
    },
  };
  const branch = video(
    visualTemplate,
    {
      ...form,
      prompt: '',
      negativePrompt: '',
      seed: 1201047366,
      randomSeed: false,
      width: 768,
      height: 512,
      numFrames: 81,
      fps: 16,
      steps: 8,
      guidanceScale: 1,
      strength: 1,
    },
    secondary,
  );
  const visual = unpackVisualOperationGroups(
    branch,
    new Set(branch.nodes.filter((node) => visualOperationGroup(node) !== 'assemble').map((node) => node.id)),
  ).graph;
  const exporter = visual.nodes.find((node) => node.data.module === 'modules.Video' && node.data.action === 'Export');
  const supplied = visual.edges.find((edge) => edge.target === exporter?.id && edge.targetHandle === 'video');
  if (!exporter || !supplied) throw new Error('The scene branch lost its assembled video.');
  graph.nodes.push(...visual.nodes.filter((node) => node.id !== exporter.id));
  graph.edges.push(...visual.edges.filter((edge) => edge.source !== exporter.id && edge.target !== exporter.id));
  const utility = (key: string, label: string, y: number) => {
    const node = createNodeFromRegistry(key, registry, { x: 4300, y });
    if (!node) throw new Error(`The backend registry is missing ${key}.`);
    node.data.label = label;
    graph.nodes.push(node);
    return node;
  };
  const wire = (source: CustomNodeType, output: string, target: CustomNodeType, input: string) => {
    const from = source.data.params[output],
      to = target.data.params[input];
    if (
      from?.display !== 'output' ||
      !to ||
      to.display === 'output' ||
      !connectionTypesAreCompatible(from.type, to.type)
    )
      throw new Error('The music-video branches have incompatible media boundaries.');
    to.isInput = true;
    graph.edges.push({
      id: `edge-${nanoid()}`,
      source: source.id,
      sourceHandle: output,
      target: target.id,
      targetHandle: input,
    });
  };
  const lyrics = utility('modules.Video.LyricOverlay', 'Lyrics · optional', 120);
  for (const [field, value] of Object.entries({
    enabled: false,
    lrc: settings.lrc,
    fps: 16,
    font_size: settings.fontSize ?? 58,
    bottom_margin: settings.bottomMargin ?? 70,
  }))
    set(lyrics, field, value);
  const fit = utility('modules.Audio.FitDuration', 'Fit Audio', 700);
  for (const { fields, value } of audioFitWorkflowFieldValues(settings.audioFit)) set(fit, fields[0]!, value);
  const mux = utility('modules.Video.ExportWithAudio', 'Video Output', 1200);
  set(mux, 'fps', 16);
  wire(
    graph.nodes.find((node) => node.id === supplied.source)!,
    supplied.sourceHandle!,
    lyrics,
    'video',
  );
  wire(generator, 'audio', fit, 'audio');
  wire(lyrics, 'output', mux, 'video');
  wire(fit, 'output', mux, 'audio');
  return groupNewOperationGraph(graph);
}
