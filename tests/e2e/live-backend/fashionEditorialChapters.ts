import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { add, configure, field, graph, node, settle, starter, wire } from './fashionDemoGestures';

const moduleName = 'FashionEditorialRegions';
const all = '[{"operation":"add","points":[[0,0],[1,0],[1,1],[0,1]]}]';

async function switchModel(page: Page, repository: string) {
  const before = await graph(page);
  const owner = before.nodes.find((item) => ['ModelsLoader', 'LoadPipeline'].includes(item.data.action))!;
  const authoredPrompt = before.nodes.find((item) => item.data.params.prompt)?.data.params.prompt.value;
  const custom = before.nodes.filter((item) => item.data.module === `custom.${moduleName}`);
  await page.getByTestId('arrange-graph').click();
  await settle(page);
  await node(page, owner.id).getByRole('button', { name: 'Choose model', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /Choose model for/u });
  await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill(repository);
  await picker.getByRole('button').filter({ hasText: repository }).first().click();
  let review = false;
  await expect
    .poll(
      async () => {
        if (await picker.getByTestId('model-selection-review').isVisible()) {
          review = true;
          return true;
        }
        return (await page.locator('[role="dialog"]').count()) === 0;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  if (review) await picker.getByRole('button', { name: 'Apply model change', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await settle(page);
  const after = await graph(page);
  expect(
    after.nodes.find((item) => item.data.params.prompt)?.data.params.prompt.value,
    'Prove prompt retention BEFORE intentionally changing the creative brief.',
  ).toEqual(authoredPrompt);
  for (const original of custom) {
    const restored = after.nodes.find((item) => item.id === original.id)!;
    expect(restored).toBeTruthy();
    for (const [key, param] of Object.entries(original.data.params))
      expect(restored.data.params[key]?.value).toEqual(param.value);
    expect(after.edges.filter((edge) => edge.target === original.id || edge.source === original.id).length).toBe(
      before.edges.filter((edge) => edge.target === original.id || edge.source === original.id).length,
    );
  }
  const loader = after.nodes.find((item) => ['ModelsLoader', 'LoadPipeline'].includes(item.data.action))!;
  expect(loader.data.module).toBe(
    repository === 'Qwen/Qwen-Image-2.1' ? 'modules.DiffusersImage' : 'modules.ModularDiffusers',
  );
}

export async function editorialChapter(page: Page, chapter: number): Promise<string> {
  const sourcePath = process.env.MODIFF_FASHION_IMAGE;
  expect(sourcePath, 'Later chapters use an explicit retained image checkpoint.').toBeTruthy();
  let current = await graph(page);
  let load = current.nodes.find((item) => item.data.module === 'modules.Image' && item.data.action === 'Load');
  if (!load) load = await add(page, 'modules.Image.Load');
  // Load Image supports batches; remove the prior selection through the UI so
  // uploading a checkpoint replaces it instead of silently appending a batch.
  const remove = node(page, load.id).getByRole('button', { name: 'Remove media', exact: true });
  while (await remove.count()) await remove.first().click();
  await node(page, load.id)
    .locator('input[type="file"]')
    .setInputFiles({
      name: `fashion-chapter-${chapter - 1}.png`,
      mimeType: 'image/png',
      buffer: await readFile(sourcePath!),
    });
  await expect
    .poll(
      async () => {
        const saved = (await graph(page)).nodes.find((item) => item.id === load!.id)!;
        const value = saved.data.params.file?.value;
        return Array.isArray(value) && value.filter(Boolean).length === 1;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  let director = current.nodes.find((item) => item.data.action === 'EditorialRegions');
  if (!director) {
    director = await add(page, `custom.${moduleName}.EditorialRegions`);
    await wire(page, load.id, 'image', director.id, 'image');
    const originalPreview = await add(page, 'modules.Image.Preview');
    await wire(page, load.id, 'image', originalPreview.id, 'image');
    const maskPreview = await add(page, 'modules.Image.Preview');
    await wire(page, director.id, 'mask', maskPreview.id, 'image');
  }
  if (chapter === 11) {
    await field(page, director.id, 'regions', all);
    await field(page, director.id, 'feather', '0');
    await field(page, director.id, 'saturation', '0');
    await field(page, director.id, 'exposure', '0.2');
    const display = await add(page, 'modules.Image.Preview');
    await wire(page, director.id, 'out_image', display.id, 'image');
    return display.id;
  }
  current = await graph(page);
  if (!current.nodes.some((item) => ['ModelsLoader', 'LoadPipeline'].includes(item.data.action))) {
    const pipeline = await starter(page, 'Flux2KleinModularPipeline', 'edit image');
    for (const consumer of pipeline.filter((item) => item.data.params.image?.display === 'input'))
      await wire(page, director.id, 'out_image', consumer.id, 'image');
    const composite = await add(page, `custom.${moduleName}.ProtectedComposite`);
    await wire(page, load.id, 'image', composite.id, 'original');
    await wire(page, director.id, 'mask', composite.id, 'mask');
    await wire(
      page,
      pipeline.find((item) => item.data.action === 'DecodeLatents')!.id,
      'images',
      composite.id,
      'edited',
    );
    const final = await add(page, 'modules.Image.Preview');
    await wire(page, composite.id, 'out_image', final.id, 'image');
  }
  if (process.env.MODIFF_FASHION_MODEL) await switchModel(page, process.env.MODIFF_FASHION_MODEL);
  // A new model can add an image-conditioned prompt encoder. Retained edges
  // cannot supply a port that did not exist in the previous native recipe.
  // Author that additional branch explicitly, with a real canvas gesture.
  const switched = await graph(page);
  for (const consumer of switched.nodes.filter(
    (item) => item.data.operationAuthoring && item.data.params.image?.display === 'input',
  )) {
    if (!switched.edges.some((edge) => edge.target === consumer.id && edge.targetHandle === 'image'))
      await wire(page, director.id, 'out_image', consumer.id, 'image');
  }
  await field(page, director.id, 'regions', process.env.MODIFF_FASHION_REGIONS || all);
  await field(page, director.id, 'feather', '0.008');
  const owned = (await graph(page)).nodes.filter((item) => item.data.operationAuthoring);
  await configure(
    page,
    new Set(owned.map((item) => item.id)),
    process.env.MODIFF_FASHION_EDIT_PROMPT!,
    Number(process.env.MODIFF_FASHION_STEPS || '4'),
    Number(process.env.MODIFF_FASHION_GUIDANCE || '1'),
  );
  const result = await graph(page);
  const composite = result.nodes.find((item) => item.data.action === 'ProtectedComposite')!;
  return result.edges.find((edge) => edge.source === composite.id && edge.sourceHandle === 'out_image')!.target;
}
