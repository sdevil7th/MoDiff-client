import { useState, type ReactNode } from 'react';
import { Blocks, Expand, ImagePlus, ImageUp, Layers, Paintbrush, SlidersHorizontal } from 'lucide-react';

import { useNodesStore } from '../stores/useNodeStore';
import { createOrUpdateStudioGraph } from '../studio/graphBridge';
import {
  CONTROLLED_WORKFLOW_NODE_KEYS,
  addLoraWorkflowBlock,
  addUpscaleWorkflowBlock,
} from '../studio/controlledWorkflows';
import { QWEN_OUTPAINT_CANVAS_NODE_KEY, STUDIO_MODEL_PROFILES } from '../studio/modelProfiles';
import type { StudioFormState, StudioMode, StudioModelType } from '../studio/types';
import { enqueueSnackbar, SectionHeader, Spinner, StudioButton, StudioChip } from '../ui';
import { cx } from '../utils/classNames';

type ControlledActionId = 'control' | 'lora' | 'upscale' | 'outpaint' | 'inpaint' | 'strength' | 'multi-reference';

type StudioControlledWorkflowsProps = {
  disabled?: boolean;
  form: StudioFormState;
  onChange: (values: Partial<StudioFormState>) => void;
};

type WorkflowRow = {
  id: ControlledActionId;
  title: string;
  detail: string;
  status: 'ready' | 'draft' | 'blocked' | 'needs-registry';
  icon: ReactNode;
  button: string;
  onClick?: () => Promise<void>;
};

function statusTone(status: WorkflowRow['status']) {
  if (status === 'ready') return 'success';
  if (status === 'blocked') return 'error';
  return 'default';
}

function statusLabel(status: WorkflowRow['status']) {
  if (status === 'ready') return 'Ready';
  if (status === 'draft') return 'Draft';
  if (status === 'blocked') return 'Blocked';
  return 'Registry';
}

export function StudioControlledWorkflows({ disabled = false, form, onChange }: StudioControlledWorkflowsProps) {
  const [busyAction, setBusyAction] = useState<ControlledActionId | null>(null);
  const nodesRegistry = useNodesStore((state) => state.nodesRegistry);
  const registryLoaded = Object.keys(nodesRegistry).length > 0;
  const profile = STUDIO_MODEL_PROFILES[form.modelType];
  const loraAvailable = Boolean(nodesRegistry[CONTROLLED_WORKFLOW_NODE_KEYS.lora]);
  const upscalerAvailable = Boolean(nodesRegistry[CONTROLLED_WORKFLOW_NODE_KEYS.upscaler]);
  const outpaintAvailable = Boolean(nodesRegistry[QWEN_OUTPAINT_CANVAS_NODE_KEY]);

  const applyMode = async (
    actionId: ControlledActionId,
    values: Partial<StudioFormState> & { mode: StudioMode; modelType: StudioModelType },
  ) => {
    const nextForm = { ...form, ...values };
    setBusyAction(actionId);
    try {
      onChange(values);
      await createOrUpdateStudioGraph(nextForm);
      enqueueSnackbar('Controlled workflow prepared', { variant: 'success', autoHideDuration: 1800 });
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6500 });
    } finally {
      setBusyAction(null);
    }
  };

  const runBlockAction = async (actionId: ControlledActionId, action: () => Promise<unknown>) => {
    setBusyAction(actionId);
    try {
      await action();
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6500 });
    } finally {
      setBusyAction(null);
    }
  };

  const rows: WorkflowRow[] = [
    {
      id: 'control',
      title: 'ControlNet control image',
      detail: 'Qwen Image plus Qwen ControlNet Union.',
      status: 'ready',
      icon: <ImagePlus size={15} />,
      button: 'Use control',
      onClick: () =>
        applyMode('control', {
          mode: 'control_image',
          modelType: 'QwenImageModularPipeline',
          controlImage: form.controlImage || form.referenceImages[0] || '',
        }),
    },
    {
      id: 'lora',
      title: 'LoRA adapter',
      detail: profile.supportsLora
        ? 'Adds Lora -> ModelsLoader lora_list.'
        : 'Current model metadata does not support LoRA.',
      status: profile.supportsLora ? (loraAvailable || !registryLoaded ? 'ready' : 'needs-registry') : 'blocked',
      icon: <Blocks size={15} />,
      button: 'Add block',
      onClick: profile.supportsLora ? () => runBlockAction('lora', () => addLoraWorkflowBlock()) : undefined,
    },
    {
      id: 'upscale',
      title: 'Upscale finish',
      detail: 'Adds Spandrel Upscaler and a second Preview.',
      status: upscalerAvailable || !registryLoaded ? 'ready' : 'needs-registry',
      icon: <ImageUp size={15} />,
      button: 'Add block',
      onClick: () => runBlockAction('upscale', () => addUpscaleWorkflowBlock()),
    },
    {
      id: 'inpaint',
      title: 'Inpaint mask draft',
      detail: 'Source image, mask image, Apply Mask, and image encode.',
      status: 'draft',
      icon: <Paintbrush size={15} />,
      button: 'Prepare draft',
      onClick: () =>
        applyMode('inpaint', {
          mode: 'inpaint',
          modelType: 'QwenImageEditModularPipeline',
          referenceImages: form.referenceImages,
          maskImage: form.maskImage,
        }),
    },
    {
      id: 'strength',
      title: 'Image-to-image strength sweep',
      detail: 'Use edit mode, then run the sweep grid.',
      status: 'ready',
      icon: <SlidersHorizontal size={15} />,
      button: 'Edit sweep',
      onClick: () =>
        applyMode('strength', {
          mode: 'edit_image',
          modelType: 'QwenImageEditModularPipeline',
          strength: form.strength || 0.65,
          randomSeed: false,
        }),
    },
    {
      id: 'multi-reference',
      title: 'Multi-reference edit',
      detail: 'Qwen Edit Plus with multiple source images.',
      status: 'ready',
      icon: <Layers size={15} />,
      button: 'Use refs',
      onClick: () =>
        applyMode('multi-reference', {
          mode: 'multi_image_reference_edit',
          modelType: 'QwenImageEditPlusModularPipeline',
          referenceImages: form.referenceImages,
        }),
    },
    {
      id: 'outpaint',
      title: 'Outpaint canvas',
      detail: 'Expands the source image, generates a boundary mask, and feeds Qwen inpaint.',
      status: outpaintAvailable || !registryLoaded ? 'ready' : 'needs-registry',
      icon: <Expand size={15} />,
      button: 'Use outpaint',
      onClick: () =>
        applyMode('outpaint', {
          mode: 'outpaint',
          modelType: 'QwenImageEditModularPipeline',
          referenceImages: form.referenceImages,
          aspectRatio: '16:9',
          width: 1344,
          height: 768,
          outpaintLeft: form.outpaintLeft || 256,
          outpaintRight: form.outpaintRight || 256,
          outpaintTop: form.outpaintTop || 0,
          outpaintBottom: form.outpaintBottom || 0,
          outpaintOverlap: form.outpaintOverlap || 24,
          outpaintFeather: form.outpaintFeather || 8,
        }),
    },
  ];

  return (
    <section data-testid="studio-controlled-workflows">
      <SectionHeader title="Controlled workflows" />
      <div className="grid gap-2">
        {rows.map((row) => {
          const isBusy = busyAction === row.id;
          const blocked = disabled || busyAction !== null || row.status === 'blocked' || !row.onClick;
          return (
            <article key={row.id} className="border border-modiff-border bg-modiff-bg p-2">
              <div className="flex items-start gap-2">
                <div className="grid size-8 shrink-0 place-items-center rounded-modiff-compact bg-modiff-panel text-hf-yellow">
                  {row.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="text-xs font-bold text-modiff-text">{row.title}</h4>
                    <StudioChip tone={statusTone(row.status)}>{statusLabel(row.status)}</StudioChip>
                  </div>
                  <p
                    className={cx(
                      'mt-1 text-xs',
                      row.status === 'blocked' ? 'text-hf-orange' : 'text-modiff-subtle-text',
                    )}
                  >
                    {row.detail}
                  </p>
                </div>
                <StudioButton
                  tone={row.status === 'blocked' ? 'ghost' : 'secondary'}
                  icon={isBusy ? <Spinner size={14} /> : row.icon}
                  disabled={blocked}
                  onClick={() => {
                    void row.onClick?.();
                  }}
                >
                  {row.button}
                </StudioButton>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
