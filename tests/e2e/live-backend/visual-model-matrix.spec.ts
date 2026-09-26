import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

type Selection = { pipelineClass: string; task: string; executionProfileId?: string; repository?: string };
type MatrixCase = { key: string; selection: Selection; groups?: unknown[]; weights: string; status: string };
const root = process.env.MODIFF_VISUAL_MODEL_MATRIX;
const sourceImage = process.env.MODIFF_NODE_UX_IMAGE;
const mode = process.env.MODIFF_VISUAL_MODE || 'baseline';
const summary: { cases: MatrixCase[] } = root
  ? JSON.parse(readFileSync(`${root}/summary.json`, 'utf8'))
  : { cases: [] };
const selected = new Map<string, MatrixCase>();
// New groups are image-stage presentations. Do not run video or unaffected whole pipelines here.
const imageTasks = [
  ...(mode === 'images' ? [] : ['text_to_image']),
  'image_to_image',
  'edit_image',
  'multi_image_reference_edit',
  'layer_decomposition',
];
for (const task of imageTasks) {
  for (const item of summary.cases) {
    if (
      item.status !== 'passed' ||
      !item.groups?.length ||
      item.weights !== 'cache-reports-complete' ||
      item.selection.task !== task
    )
      continue;
    const key = `${item.selection.executionProfileId}/${item.selection.repository}`;
    if (!selected.has(key)) selected.set(key, item);
  }
}
// Fast routes first. SDXL baseline already has retained live evidence; exact PAG/Turbo are new.
const order = [
  'sdxl-turbo:modular',
  'sdxl-pag:modular',
  'z-image:modular',
  'flux2-klein:modular',
  'flux-schnell:modular',
];
const cases = [...selected.values()]
  .filter((c) => c.selection.executionProfileId !== 'sdxl-base:modular')
  .filter((c) => mode !== 'turbo-disabled' || c.selection.executionProfileId === 'sdxl-turbo:modular')
  .filter(
    (c) =>
      mode !== 'images' ||
      !['flux2:modular', 'qwen-layered:modular', 'qwen-edit-plus:modular'].includes(
        c.selection.executionProfileId || '',
      ),
  )
  .sort((a, b) => {
    const rank = (id?: string) => {
      const index = order.indexOf(id || '');
      return index < 0 ? 100 : index;
    };
    return rank(a.selection.executionProfileId) - rank(b.selection.executionProfileId);
  });

for (const item of cases) {
  test(`grouped real model: ${item.selection.executionProfileId} ${item.selection.repository}`, async ({ page }) => {
    test.skip(
      process.env.MODIFF_NODE_UX_ISOLATED !== '1' || !root || !sourceImage,
      'Explicit isolated live campaign only',
    );
    test.setTimeout(8 * 60_000);
    page.setDefaultTimeout(20_000);
    const first = await readFile(`${root}/live/${item.key}/result.json`, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    const resume = process.env.MODIFF_VISUAL_RESUME_UNSUBMITTED === '1';
    test.skip(resume && Boolean(first?.admission), 'Already submitted; retain original evidence without another run');
    const directory =
      mode === 'images'
        ? 'live-images'
        : mode === 'turbo-disabled'
          ? 'live-turbo-disabled'
          : resume
            ? 'live-unsubmitted-v2'
            : 'live';
    const output = `${root}/${directory}/${item.key}`;
    await mkdir(output, { recursive: true });
    const old = await readFile(`${output}/result.json`, 'utf8')
      .then(JSON.parse)
      .catch(() => null);
    test.skip(Boolean(old), 'Retained terminal result; no unchanged inference retry');
    const result: Record<string, unknown> = {
      selection: item.selection,
      mode,
      workload: 'explicit 512px / at most8step compatibility smoke; creator defaults unchanged',
      started: new Date().toISOString(),
    };
    let taskId: string | undefined;
    const save = () => writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
    try {
      const queue = await (
        await page.request.get(`${process.env.MODIFF_LIVE_BACKEND_URL}/queue`, { timeout: 10000 })
      ).json();
      const production = await (await page.request.get('http://127.0.0.1:8088/queue', { timeout: 10000 })).json();
      if (
        queue.current ||
        Object.keys(queue.queued).length ||
        production.current ||
        Object.keys(production.queued).length
      ) {
        result.status = 'blocked-busy-no-interference';
        await save();
        test.skip(true, 'An existing run owns the accelerator');
      }
      await page.setViewportSize({ width: 1920, height: 1200 });
      await page.goto('/');
      await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120000 });
      const launcher = page.getByTestId('task-launcher');
      if (await launcher.isVisible()) await launcher.getByRole('button', { name: 'Close', exact: true }).click();
      const controls = await page.evaluate(
        async ({ selection, image, phase }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
          const { parseOperationStarter } = await import('/src/workflow/operationStarterRequest.ts');
          const { createOperationStarter } = await import('/src/workflow/operationAuthoring.ts');
          const { groupNewOperationGraph, visualOperationGroup } =
            await import('/src/workflow/visualOperationGroups.ts');
          const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
          const { prepareWorkflowForManualInsertion } = await import('/src/studio/manualGraphInsertion.ts');
          const { mediaAttachmentChoices, planMediaAttachment } = await import('/src/workflow/mediaAttachment.ts');
          const registry = useNodesStore.getState();
          const response = await fetch('/operations/starter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selection),
          });
          if (!response.ok) throw new Error(await response.text());
          const starter = parseOperationStarter(
            await response.json(),
            selection.pipelineClass,
            selection.task,
            registry.operationContracts,
          );
          let graph = createOperationStarter(starter, { x: 40, y: 80 });
          // Explicit test values: no product/default recipe changes or automatic fallback on failure.
          for (const node of graph.nodes) {
            if (phase === 'turbo-disabled' && node.data.action === 'Guider') node.data.params.enabled.value = false;
            for (const [name, param] of Object.entries(node.data.params)) {
              if (name === 'width' || name === 'height') param.value = Math.max(512, Number(param.min) || 0);
              if (name === 'num_inference_steps')
                param.value = Math.max(Number(param.min) || 1, Math.min(8, Number(param.value ?? param.default) || 8));
              if (name === 'seed') param.value = { value: 8241, isRandom: false };
            }
          }
          const owner = graph.nodes.find((node) => node.data.action === 'ModelsLoader')!;
          for (const choice of mediaAttachmentChoices(
            starter.nodes.map((n) => n.operation),
            starter.pipelineClass,
          ).filter((c) => c.kind === 'image' && (phase !== 'images' || !c.role.includes('mask')))) {
            graph = planMediaAttachment(graph, owner.id, starter, choice, registry.nodesRegistry);
          }
          for (const node of graph.nodes)
            if (node.data.module === 'modules.Image' && node.data.action === 'Load')
              node.data.params.file.value = image;
          const decoder = graph.nodes.find((node) =>
            node.data.operationAuthoring?.operation.ports.some(
              (port) =>
                port.direction === 'output' && port.name === 'images' && port.types.includes('image') && !port.hidden,
            ),
          )!;
          if (!decoder) throw new Error('No reviewed decoded-image output');
          const preview = createNodeFromRegistry('modules.Image.Preview', registry.nodesRegistry, { x: 2600, y: 100 })!;
          graph.nodes.push(preview);
          graph.edges.push({
            id: 'matrix-preview',
            source: decoder.id,
            sourceHandle: 'images',
            target: preview.id,
            targetHandle: 'image',
            type: 'default',
          });
          graph = groupNewOperationGraph(graph);
          prepareWorkflowForManualInsertion();
          useFlowStore.getState().replaceGraph(graph);
          const input = graph.nodes.find((node) => visualOperationGroup(node) === 'inputs')!;
          return {
            input: input.id,
            preview: preview.id,
            nodes: graph.nodes.length,
            prompt: input.data.blockInstanceV2!.effectiveInterface.controls.some((c) => c.binding.fieldId === 'prompt'),
          };
        },
        { selection: item.selection, image: sourceImage!, phase: mode },
      );
      result.controls = controls;
      await page.getByRole('button', { name: 'Arrange graph', exact: true }).click();
      if (controls.prompt) {
        const prompt = page.locator(`.react-flow__node[data-id="${controls.input}"] textarea`).first();
        await prompt.fill(
          mode === 'images'
            ? 'An elegant woman wearing an emerald green tailored coat walking along a rain-soaked New York avenue at night, detailed stone architecture and warm shop windows, cinematic fashion editorial photograph'
            : 'An elegant woman wearing a crimson tailored coat walking along a rain-soaked New York avenue, detailed stone architecture and warm shop windows, cinematic fashion editorial photograph',
        );
        await prompt.press('Tab');
      }
      const automatic = page.getByRole('button', { name: 'Memory policy: Automatic. Click to switch.', exact: true });
      if (await automatic.count()) await automatic.click();
      result.graph = await page.evaluate(() => window.__MODIFF_E2E__!.exportWorkflowGraph());
      const submission = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/graph' && r.request().method() === 'POST',
        { timeout: 45000 },
      );
      await page.getByTestId('studio-run').click();
      const response = await submission;
      result.request = response.request().postDataJSON();
      const admission = await response.json();
      result.admission = admission;
      if (!response.ok() || !admission.task_id) throw new Error(JSON.stringify(admission));
      taskId = admission.task_id;
      // Write immediately so interruption cannot cause an accidental duplicate run.
      result.status = 'submitted';
      await save();
      const deadline = Date.now() + 5 * 60_000;
      let terminal;
      while (Date.now() < deadline) {
        const q = await (await page.request.get('/queue', { timeout: 15000 })).json();
        terminal = [q.current, ...Object.values(q.queued), ...q.recent].find((r) => r?.task_id === taskId);
        result.terminal = terminal;
        await save();
        if (['completed', 'failed', 'cancelled'].includes(terminal?.status)) break;
        await page.waitForTimeout(3000);
      }
      if (!['completed', 'failed', 'cancelled'].includes(terminal?.status))
        throw new Error('Owned task exceeded five-minute smoke deadline');
      result.run = await (await page.request.get(`/runs/${taskId}`, { timeout: 20000 })).json();
      const run = result.run as {
        outputs: Array<{ backendProvenance?: { mediaItems?: Array<{ url: string; displayType: string }> } }>;
      };
      if (terminal.status !== 'completed') throw new Error(JSON.stringify(result.run).slice(0, 3000));
      const images = run.outputs
        .flatMap((o) => o.backendProvenance?.mediaItems ?? [])
        .filter((m) => m.displayType === 'image');
      expect(images.length).toBeGreaterThan(0);
      const media = await page.request.get(images[0].url, { timeout: 20000 });
      expect(media.ok()).toBe(true);
      await writeFile(`${output}/output.webp`, await media.body());
      await expect(page.locator(`.react-flow__node[data-id="${controls.preview}"] img`).first()).toHaveJSProperty(
        'complete',
        true,
      );
      expect(
        await page
          .locator(`.react-flow__node[data-id="${controls.preview}"] img`)
          .first()
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      await page.screenshot({ path: `${output}/canvas.png` });
      result.status = 'completed';
      await save();
    } catch (error) {
      if (result.status === 'blocked-busy-no-interference') throw error;
      result.status = taskId ? 'execution-failed-or-deadline' : 'blocked-before-submission';
      result.error = String(error);
      await save();
      await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
      // Stop only the exact owned task, and only without other queued work.
      const q = await page.request
        .get('/queue', { timeout: 10000 })
        .then((r) => r.json())
        .catch(() => null);
      if (taskId && q?.current?.task_id === taskId && !Object.keys(q.queued).length) {
        result.stop = await page.request
          .post('/stop', { timeout: 10000 })
          .then((r) => r.json())
          .catch(String);
        await save();
      }
      throw error;
    }
  });
}
