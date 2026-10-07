import type { StudioTemplateLoraSettings, StudioTemplateWorkflowBlockSettings } from './types';

export type ControlledFieldValue = { fields: string[]; value: unknown };

/** Exact settings shared by managed recipes and fresh operation graphs. */
export function loraWorkflowFieldValues(
  adapter: StudioTemplateLoraSettings | undefined,
  index: number,
): ControlledFieldValue[] {
  const values: ControlledFieldValue[] = [
    { fields: ['scale'], value: adapter?.scale ?? 1 },
    { fields: ['replace_existing'], value: index === 0 },
  ];
  if (adapter?.model)
    values.push(
      { fields: ['model', 'adapter_path'], value: { source: adapter.model.source, value: adapter.model.value } },
      { fields: ['revision'], value: adapter.model.revision ?? '' },
      { fields: ['expected_sha256'], value: adapter.model.sha256 ?? '' },
    );
  if (adapter?.weightName) values.push({ fields: ['weight_name'], value: adapter.weightName });
  if (adapter?.adapterName) values.push({ fields: ['adapter_name'], value: adapter.adapterName });
  if (index === 0 && adapter?.schedulerClass)
    values.push({ fields: ['scheduler_class'], value: adapter.schedulerClass });
  if (index === 0 && adapter?.schedulerConfig)
    values.push({ fields: ['scheduler_config'], value: JSON.stringify(adapter.schedulerConfig) });
  return values;
}

export function upscaleWorkflowFieldValues(
  settings: StudioTemplateWorkflowBlockSettings['upscaler'] | undefined,
  device: string,
): ControlledFieldValue[] {
  return [
    { fields: ['device'], value: device },
    ...(settings?.model ? [{ fields: ['model_id'], value: settings.model }] : []),
    ...(settings?.downscale !== undefined ? [{ fields: ['downscale'], value: settings.downscale }] : []),
  ];
}
