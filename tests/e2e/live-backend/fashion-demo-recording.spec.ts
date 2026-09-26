import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { add, field, graph, node, settle, wire } from './fashionDemoGestures';
import { save } from './qwenDemoGestures';

// Presentation overlay only. Every app mutation below is a visible UI gesture;
// the development hook is used only to inspect the resulting graph.
test.use({
  viewport: { width: 1920, height: 1080 },
  video: { mode: 'on', size: { width: 1920, height: 1080 } },
  trace: 'off',
});

const chapters = [
  [
    '01 · THE FOUNDATION',
    'One detailed SoHo photograph gives every later edit a clear purpose.',
    'Z-Image Turbo: text encoding → denoising → image decoding.',
    'An ivory suit, burgundy bag and yellow taxi establish the visual baseline.',
  ],
  [
    '02 · USER-CODED ART DIRECTION',
    'Add a custom node to the decoded-image branch—not just another prompt.',
    'Editorial Regions combines polygon masks and linear-light color processing.',
    'Warm light on the left, cool light on the right: a visible, adjustable treatment.',
  ],
  [
    '03 · A SECOND GENERATIVE STAGE',
    'The larger graph now earns its complexity: replace the wardrobe.',
    'A Klein reference edit turns the ivory suit into an emerald silk gown.',
    'The compositor preserves original pixels wherever the custom mask is black.',
  ],
  [
    '04 · A PRECISE OBJECT EDIT',
    'Load the previous approved image as an explicit checkpoint.',
    'The burgundy handbag becomes metallic gold.',
    'Checkpointing avoids rerunning every earlier model stage.',
  ],
  [
    '05 · REBUILD THE STOREFRONT',
    'A broader polygon selects the left-hand architecture.',
    'A flower arch and illuminated boutique reshape the street.',
    'The subject and unselected street remain outside the protected edit region.',
  ],
  [
    '06 · REPLACE THE VEHICLE',
    'The mask must cover the new object—not just the old taxi’s outline.',
    'A cherry-red vintage convertible replaces the yellow taxi.',
    'Subtracting the subject region protects the woman during compositing.',
  ],
  [
    '07 · CHANGE THE SEASON',
    'Several polygons describe one coordinated environment edit.',
    'Golden branches and fallen leaves turn the scene into autumn.',
    'One reusable custom node handles the region algebra.',
  ],
  [
    '08 · CHANGE THE WEATHER',
    'A global image-conditioned edit transforms materials and atmosphere.',
    'Rain, mist and wet-street reflections change the entire mood.',
    'Global generation may change details; this is not exact pixel preservation.',
  ],
  [
    '09 · SWITCH NATIVE FAMILIES',
    'The editing stage changes from Klein to native FLUX Kontext.',
    'Cobalt twilight and amber shop windows create a blue-hour editorial.',
    'The model and brief both changed: this is not a controlled model-only comparison.',
  ],
  [
    '10 · RETURN TO KLEIN',
    'The same generic image connections support another native model change.',
    'Magenta and cyan practical lights create a neon-night scene.',
    'Custom processing stays connected at the decoded-image boundary.',
  ],
  [
    '11 · NO DIFFUSION REQUIRED',
    'A small graph is enough when deterministic processing solves the task.',
    'Saturation zero and a small exposure lift create a monochrome editorial.',
    'Load Image → Editorial Regions → Preview: custom code through the normal executor.',
  ],
  [
    '12 · WHOLE-PIPELINE COMPATIBILITY',
    'Qwen Image 2.1 uses a whole-pipeline implementation here.',
    'The image-boundary custom node and protected compositor still work.',
    'The new brief restores color and changes the gown to sapphire blue.',
  ],
  [
    '13 · NATIVE RETURN',
    'Return to Klein and give the final scene a rose-gold sunrise.',
    'Native and whole-pipeline routes share images—not interchangeable internal latents.',
    'Save, refresh and reopen: prompts, custom values, connections and results remain.',
  ],
] as const;

type Entry = { title: string; path: string; mediaChecks: Array<{ nodeId: string; url: string; sha256: string }> };

async function overlay(page: Page) {
  await page.addStyleTag({
    content: `
    #root > .h-screen { height: calc(100vh - 132px) !important; }
    [role="dialog"] > .fixed.inset-0 { bottom: 132px !important; }
    [role="dialog"] [data-headlessui-state] { max-height: calc(100vh - 170px); }
    #demo-captions { position: fixed; inset: auto 0 0; height: 132px; z-index: 2147483647;
      pointer-events: none; box-sizing: border-box; padding: 20px 56px;
      background: var(--color-modiff-surface); color: var(--color-modiff-text);
      border-top: 1px solid var(--color-modiff-border); font-family: var(--font-sans); }
    #demo-captions::before { content: ''; position: absolute; top: 0; left: 56px; width: 112px;
      height: 3px; background: var(--color-hf-yellow); }
    #demo-kicker { display:flex; align-items:center; justify-content:space-between;
      font-size: 15px; font-weight: 600; letter-spacing: 2px; color: var(--color-hf-yellow); }
    #demo-status { color: var(--color-modiff-subtle-text); letter-spacing: .6px; font-weight:400; }
    #demo-line { margin-top: 12px; font-size: 29px; line-height: 1.25; font-weight: 600; }
  `,
  });
  await page.evaluate(() => {
    document.getElementById('demo-captions')?.remove();
    const root = document.createElement('aside');
    root.id = 'demo-captions';
    root.innerHTML =
      '<div id="demo-kicker"><span id="demo-chapter"></span><span id="demo-status"></span></div><div id="demo-line"></div>';
    document.body.append(root);
    window.dispatchEvent(new Event('resize'));
  });
}

test('record the complete fashion demo with theme-matched captions', async ({ page }, testInfo) => {
  const manifest = process.env.MODIFF_FASHION_RECORD;
  test.skip(!manifest, 'Opt in with a reviewed local chapter manifest. No model installation is performed.');
  test.setTimeout(15 * 60_000);
  page.setDefaultTimeout(30_000);
  const smoke = process.env.MODIFF_RECORD_SMOKE === '1';
  const output = resolve(process.env.MODIFF_REVIEW_OUTPUT_DIR!);
  await mkdir(output, { recursive: true });
  const entries = JSON.parse(await readFile(manifest!, 'utf8')) as Entry[];
  expect(entries).toHaveLength(13);
  const catalog = await (await page.request.get('/workflows')).json();
  const ids = entries.map((entry) => {
    const matches = catalog.workflows.filter((record: { title: string }) => record.title === entry.title);
    expect(matches).toHaveLength(1);
    return matches[0].id as string;
  });
  const cues: Array<{ start: number; end: number; chapter: string; text: string; status: string }> = [];
  const start = Date.now();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  async function cue(chapter: string, text: string, status = 'Previously generated · retained result', hold = true) {
    const now = (Date.now() - start) / 1000;
    if (cues.length) cues[cues.length - 1].end = now;
    cues.push({ start: now, end: now, chapter, text, status });
    await page.evaluate(
      ({ chapter, text, status }) => {
        document.getElementById('demo-chapter')!.textContent = chapter;
        document.getElementById('demo-line')!.textContent = text;
        document.getElementById('demo-status')!.textContent = status;
      },
      { chapter, text, status },
    );
    if (hold) await page.waitForTimeout(smoke ? 150 : 7_000);
  }
  async function open(index: number) {
    if (!(await page.getByRole('button', { name: 'My workflows', exact: true }).isVisible()))
      await page.getByTestId('left-tab-workflows').click();
    await page.getByRole('button', { name: 'My workflows', exact: true }).click();
    await page.getByLabel('Search workflows').fill('Fashion Demo');
    await page.getByTestId(`saved-workflow-${ids[index]}`).getByRole('button').first().click();
    await page.getByTestId('arrange-graph').click();
    const clear = page.getByTestId('run-session-shelf').getByRole('button', { name: 'Clear', exact: true });
    if ((await clear.isVisible()) && (await clear.isEnabled())) await clear.click();
    await settle(page);
  }
  async function preview(index: number) {
    const current = await graph(page);
    // The last preview in an export may be the mask, not the final photograph.
    const last = entries[index].mediaChecks
      .filter((media) => current.edges.some((edge) => edge.target === media.nodeId && edge.sourceHandle !== 'mask'))
      .at(-1)!;
    const img = page.getByTestId(`node-preview-image-${last.nodeId}-preview-0`).locator('img').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(1024);
    await img.click();
    await expect(page.getByRole('button', { name: 'Close preview', exact: true })).toBeVisible();
  }
  async function switchTo(repository: string) {
    const before = await graph(page);
    const owner = before.nodes.find((item) => ['ModelsLoader', 'LoadPipeline'].includes(item.data.action))!;
    const prompt = before.nodes.find((item) => item.data.params.prompt)?.data.params.prompt.value;
    const custom = before.nodes.filter((item) => item.data.module.startsWith('custom.'));
    await node(page, owner.id).getByRole('button', { name: 'Choose model', exact: true }).click();
    const picker = page.getByRole('dialog', { name: /Choose model for/u });
    await picker.getByRole('searchbox', { name: 'Search compatible models' }).fill(repository);
    await picker.getByRole('button').filter({ hasText: repository }).first().click();
    await expect(picker.getByTestId('model-selection-review')).toBeVisible({ timeout: 60_000 });
    await cue(
      'MODEL CHANGE · REVIEW FIRST',
      'Review replacement stages and retained values before applying the change.',
      'Live UI · no generation submitted',
    );
    await picker.getByRole('button', { name: 'Apply model change', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await settle(page);
    const after = await graph(page);
    expect(after.nodes.find((item) => item.data.params.prompt)?.data.params.prompt.value).toEqual(prompt);
    for (const original of custom) {
      const restored = after.nodes.find((item) => item.id === original.id)!;
      expect(restored).toBeTruthy();
      for (const [key, param] of Object.entries(original.data.params))
        expect(restored.data.params[key]?.value).toEqual(param.value);
      expect(after.edges.filter((edge) => edge.target === original.id || edge.source === original.id).length).toBe(
        before.edges.filter((edge) => edge.target === original.id || edge.source === original.id).length,
      );
    }
    await page.getByTestId('arrange-graph').click();
  }
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated), null, {
      timeout: 120_000,
    });
    await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0);
    const empty = page.getByRole('button', { name: 'Empty workflow', exact: true });
    if (await empty.isVisible()) await empty.click();
    await page.getByRole('radio', { name: 'Developer', exact: true }).check();
    await overlay(page);
    await open(0);
    await cue(
      'MoDiff · SOHO EDITORIAL',
      'Thirteen purposeful transformations. Generic nodes. Real custom code.',
      'Screen recording · captions only',
    );
    await cue(
      'WHAT YOU WILL SEE',
      'Live authoring and a live CPU run, alongside clearly labelled retained model results.',
      'No generation waits are presented as instant results',
    );
    for (let index = 0; index < chapters.length; index++) {
      await open(index);
      const [title, overview, image, detail] = chapters[index];
      await cue(title, overview);
      if (index === 2 || index === 5) {
        const current = await graph(page);
        const region = current.nodes.filter((item) => item.data.action === 'EditorialRegions').at(-1)!;
        const box = await node(page, region.id).boundingBox();
        expect(box).toBeTruthy();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.wheel(0, -480);
        await cue(
          title,
          index === 2
            ? 'Inspect the region controls: the mask and generated image meet at the protected compositor.'
            : 'Add the vehicle region, then subtract the subject: the mask controls the final blend.',
          'Live canvas · custom region controls',
        );
        await page.getByTestId('arrange-graph').click();
        await settle(page);
      }
      if (index === 1) {
        await open(0);
        await save(page, `Fashion Recording - Custom authoring ${testInfo.workerIndex}-${start}`);
        await page.getByTestId('left-tab-nodes').click();
        await cue(
          title,
          'Find the enabled Editorial Regions node in the ordinary node library.',
          'Live UI · presentation copy',
          false,
        );
        const decode = (await graph(page)).nodes.find((item) => item.data.action === 'DecodeLatents')!;
        const director = await add(page, 'custom.FashionEditorialRegions.EditorialRegions');
        await cue(
          title,
          'Connect the decoded image to user code through a normal image socket.',
          'Live UI · actual connection gesture',
          false,
        );
        await wire(page, decode.id, 'images', director.id, 'image');
        await field(page, director.id, 'temperature', '0.8');
        await field(page, director.id, 'exposure', '-0.3');
        const display = await add(page, 'modules.Image.Preview');
        await wire(page, director.id, 'out_image', display.id, 'image');
        await save(page, `Fashion Recording - Custom authoring ${testInfo.workerIndex}-${start}`);
        await cue(
          title,
          'The new branch is wired and saved. Now inspect its previously generated result.',
          'Live authoring complete · switching to retained chapter',
        );
        await open(index);
      }
      await preview(index);
      await cue(title, image);
      await cue(title, detail);
      await page.screenshot({ path: resolve(output, `chapter-${index + 1}.png`) });
      await page.getByRole('button', { name: 'Close preview', exact: true }).click();
      if (index === 10 && !smoke) {
        const queue = await (await page.request.get('/queue')).json();
        expect(queue.current).toBeFalsy();
        expect(Object.keys(queue.queued || {})).toHaveLength(0);
        await save(page, `Fashion Recording - Live CPU ${start}`);
        const custom = (await graph(page)).nodes.find((item) => item.data.action === 'EditorialRegions')!;
        await field(page, custom.id, 'exposure', '0.35');
        await cue(
          title,
          'Change exposure and run the custom graph live—no diffusion weights are needed.',
          'LIVE EXECUTION · CPU image processing',
          false,
        );
        const submitted = page.waitForResponse(
          (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
        );
        await page.getByTestId('studio-run').click();
        const response = await submitted;
        expect(response.ok()).toBe(true);
        const { task_id: taskId } = await response.json();
        await expect
          .poll(
            async () => {
              const queue = await (await page.request.get('/queue')).json();
              const task =
                queue.current?.task_id === taskId
                  ? queue.current
                  : queue.recent?.find((item: { task_id: string }) => item.task_id === taskId);
              if (['failed', 'cancelled'].includes(task?.status))
                throw new Error(`Live CPU task ${taskId}: ${task.status}`);
              return task?.status;
            },
            { timeout: 120_000, intervals: [1000] },
          )
          .toBe('completed');
        await writeFile(
          resolve(output, 'live-cpu-receipt.json'),
          JSON.stringify({ taskId, run: await (await page.request.get(`/runs/${taskId}`)).json() }, null, 2),
        );
        await cue(
          title,
          'Completed through the normal graph executor with the new exposure value.',
          'LIVE EXECUTION · completed',
        );
      }
      if (index === 11) {
        await save(page, `Fashion Recording - Model round trip ${start}`);
        await cue(
          title,
          'Now switch this whole-pipeline graph back to native Klein without rewriting the brief.',
          'Live UI · model-change rehearsal',
        );
        await switchTo('black-forest-labs/FLUX.2-klein-4B');
        await cue(
          title,
          'Native stages return; the authored prompt and connected custom values survive.',
          'Live UI · retention assertions passed',
        );
        await switchTo('Qwen/Qwen-Image-2.1');
        await cue(
          title,
          'And back to Qwen: custom processing remains useful outside the whole pipeline.',
          'Live UI · round trip complete',
        );
      }
      if (index === 12) {
        const before = await graph(page);
        await cue(
          title,
          'Refresh the browser, reopen the final chapter, and verify the saved graph.',
          'Live UI · persistence check',
          false,
        );
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => Boolean(window.__MODIFF_E2E__?.getState().studio.workflowCanvasHydrated),
          null,
          { timeout: 120_000 },
        );
        await overlay(page);
        await open(index);
        const after = await graph(page);
        expect(after.edges).toEqual(before.edges);
        for (const original of before.nodes) {
          const restored = after.nodes.find((item) => item.id === original.id)!;
          for (const [key, param] of Object.entries(original.data.params))
            if (param.display !== 'output' && !param.display?.startsWith('ui_'))
              expect(restored.data.params[key]?.value).toEqual(param.value);
        }
        await preview(index);
        await cue(
          'READY TO EXPLORE',
          'The final image and saved graph survive refresh. Every chapter remains separately inspectable.',
          'Persistence check passed · retained final result',
        );
        await cue(
          'MoDiff · YOUR WORKFLOW, YOUR CODE',
          'Start on Windows with CPU processing, then Z-Image Turbo and Klein 4B.',
          'RTX 4080: larger recipes require separate memory qualification',
        );
      }
    }
    expect(errors).toEqual([]);
  } finally {
    if (cues.length) cues[cues.length - 1].end = (Date.now() - start) / 1000;
    await writeFile(resolve(output, 'captions.json'), JSON.stringify(cues, null, 2));
    const timestamp = (seconds: number) =>
      new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23).replace('.', ',');
    await writeFile(
      resolve(output, 'captions.srt'),
      cues
        .map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n`)
        .join('\n'),
    );
    await writeFile(
      resolve(output, 'recording.json'),
      JSON.stringify(
        { smoke, sourceManifest: manifest, video: await page.video()?.path(), browserErrors: errors },
        null,
        2,
      ),
    );
  }
});
