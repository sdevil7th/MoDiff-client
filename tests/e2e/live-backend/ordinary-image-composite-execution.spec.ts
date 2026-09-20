import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { backendSourceIdentity } from '../../../scripts/live-proof-provenance.mjs';
import type { BlockJsonValue } from '../../../src/studio/blockSchemaV2';
import { waitForRecursiveDomGeometry } from './blockDomGeometry';
import { decodedImageStatistics } from './imageProofStatistics';
import { addImagePromptAdapter } from './imagePromptAdapterGestures';
import { addControlComponents } from './controlComponentGestures';
import { addJsonInputs } from './jsonInputGestures';
import { attentionUserNodeLifecycle } from './attentionUserNodeLifecycle';

// Explicit opt-in: uses real local models and writes an isolated saved workflow.
// Media/resource values are fixtures, not a claim of native file-picker coverage.
const proofKind =
  process.env.MODIFF_IMAGE_COMPOSITE_ATTENTION_USER_NODE_ONLY === '1' ? 'User Node reuse' : 'generation';
test(`ordinary image composite preserves edited values through native Save, expansion and ${proofKind}`, async ({
  page,
}) => {
  const pipelineClass = process.env.MODIFF_IMAGE_COMPOSITE_CLASS;
  test.skip(!pipelineClass, 'Select an exact ordinary pipeline for model qualification.');
  const workflow = process.env.MODIFF_IMAGE_COMPOSITE_MODE ?? 'control_image';
  const output = process.env.MODIFF_REVIEW_OUTPUT_DIR;
  if (!output) throw new Error('A private review output directory is required.');
  const prompt = process.env.MODIFF_IMAGE_COMPOSITE_PROMPT;
  if (!prompt) throw new Error('Provide the assessment prompt explicitly.');
  const values = JSON.parse(process.env.MODIFF_IMAGE_COMPOSITE_VALUES ?? '{}') as Record<string, unknown>;
  const expectedDefaults = JSON.parse(process.env.MODIFF_IMAGE_COMPOSITE_EXPECTED_DEFAULTS ?? '{}') as Record<
    string,
    unknown
  >;
  const preprocessControl = process.env.MODIFF_IMAGE_COMPOSITE_CANNY === '1';
  const secondPrompt = process.env.MODIFF_IMAGE_COMPOSITE_PROMPT_2;
  const generatorSeed = process.env.MODIFF_IMAGE_COMPOSITE_GENERATOR_SEED;
  const attentionScale = process.env.MODIFF_IMAGE_COMPOSITE_ATTENTION_SCALE;
  const attentionBuilder = process.env.MODIFF_IMAGE_COMPOSITE_ATTENTION_BUILDER === '1';
  const attentionUserNodeOnly = process.env.MODIFF_IMAGE_COMPOSITE_ATTENTION_USER_NODE_ONLY === '1';
  const controlModes = process.env.MODIFF_IMAGE_COMPOSITE_CONTROL_MODES;
  const latentRoundtrip = process.env.MODIFF_IMAGE_COMPOSITE_LATENT_ROUNDTRIP === '1';
  const ipAdapterReference = process.env.MODIFF_IMAGE_COMPOSITE_IP_REFERENCE;
  const multipleControlComponents = process.env.MODIFF_IMAGE_COMPOSITE_MULTI_CONTROL === '1';
  const unionControl = process.env.MODIFF_IMAGE_COMPOSITE_UNION_CONTROL === '1';
  const jsonInputs: Record<string, unknown> = JSON.parse(process.env.MODIFF_IMAGE_COMPOSITE_JSON_INPUTS ?? '{}');
  const pickerSources: string[] = JSON.parse(process.env.MODIFF_IMAGE_COMPOSITE_PICKER_IMAGES ?? '[]');
  if (!Array.isArray(pickerSources) || pickerSources.some((value) => typeof value !== 'string'))
    throw new Error('Picker images must be an ordered list of existing backend image paths.');
  if ([secondPrompt, generatorSeed, attentionScale, controlModes].filter(Boolean).length > 1)
    throw new Error('Select one optional native producer per proof.');
  if (attentionScale && !Number.isFinite(Number(attentionScale))) throw new Error('Attention scale must be finite.');
  if (attentionBuilder && !attentionScale) throw new Error('The attention builder proof requires an explicit scale.');
  if (attentionUserNodeOnly && !attentionBuilder)
    throw new Error('Select the attention builder for its User Node proof.');
  const optionalInput = secondPrompt
    ? {
        label: 'Text Value',
        action: 'TextValue',
        row: 'node-row-modules-Primitive-TextValue',
        field: 'text',
        fieldLabel: 'Text',
        value: secondPrompt,
        output: 'output',
        target: 'prompt_2',
      }
    : generatorSeed
      ? {
          label: 'Seeded Generator',
          action: 'SeededGenerator',
          row: 'node-row-modules-Tensor-SeededGenerator',
          field: 'seed',
          fieldLabel: 'Seed',
          value: generatorSeed,
          output: 'generator',
          target: 'generator',
        }
      : attentionBuilder
        ? {
            label: 'Attention Arguments',
            action: 'AttentionArguments',
            row: 'node-row-modules-Tensor-AttentionArguments',
            field: 'lora_scale',
            fieldLabel: 'LoRA Scale',
            value: attentionScale!,
            output: 'options',
            target: pipelineClass!.startsWith('Flux2') ? 'attention_kwargs' : 'joint_attention_kwargs',
          }
        : attentionScale || controlModes
          ? {
              label: 'Process Text/Data',
              action: 'ProcessText',
              row: 'node-row-modules-Text-ProcessText',
              field: 'source',
              fieldLabel: 'Source',
              value: controlModes ?? JSON.stringify({ scale: Number(attentionScale) }),
              output: 'output',
              target: controlModes
                ? 'control_mode'
                : pipelineClass!.startsWith('Flux2')
                  ? 'attention_kwargs'
                  : 'joint_attention_kwargs',
            }
          : null;
  const generationMinutes = Number(process.env.MODIFF_IMAGE_COMPOSITE_TIMEOUT_MINUTES ?? 50);
  if (!Number.isFinite(generationMinutes) || generationMinutes < 5 || generationMinutes > 120)
    throw new Error('Select a bounded 5–120 minute generation budget.');
  test.setTimeout((generationMinutes + 10) * 60_000);
  page.setDefaultTimeout(15_000);
  await mkdir(output, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('ordinary-image-proof')) return;
    localStorage.clear();
    sessionStorage.setItem('ordinary-image-proof', '1');
  });
  const readinessServer = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  await expect
    .poll(
      async () => {
        try {
          return (await page.request.get(`${readinessServer}/queue`, { timeout: 5_000 })).status();
        } catch {
          return 0;
        }
      },
      { timeout: 120_000 },
    )
    .toBe(200);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__MODIFF_E2E__), null, { timeout: 120_000 });
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  const advanced = page.getByRole('button', { name: /Advanced workflow/u });
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  await page.getByTestId('workflow-tab-new').click();
  if (await advanced.isVisible().catch(() => false)) await advanced.click();
  const entry = await page.evaluate(
    async ({ pipelineClass, workflow }) => {
      const { useHuggingFaceNodeLibraryStore } = await import('/src/stores/useHuggingFaceNodeLibraryStore.ts');
      const { buildHuggingFaceCatalogSections } = await import('/src/studio/huggingFaceNodeCatalog.ts');
      await useHuggingFaceNodeLibraryStore.getState().fetchLibrary();
      const library = useHuggingFaceNodeLibraryStore.getState().library!;
      const id = `diffusers.composite:${pipelineClass}:${workflow}`;
      const result = buildHuggingFaceCatalogSections(library)
        .find((section) => section.id === 'diffusers_cluster_nodes')!
        .entries.find((candidate) => candidate.id === id);
      if (!result?.insertable) throw new Error(`No current insertable composite: ${id}`);
      return { id, label: result.label };
    },
    { pipelineClass, workflow },
  );
  if (
    !(await page
      .getByLabel('Search nodes')
      .isVisible()
      .catch(() => false))
  )
    await page.getByTestId('left-tab-nodes').click();
  await page.getByLabel('Search nodes').fill(entry.label);
  const group = page.getByTestId('node-group-Diffusers-Cluster-Nodes').getByRole('button').first();
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click();
  const slug = entry.id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  await page.getByTestId(`hugging-face-node-row-${slug}`).click();
  const root = page.locator('[data-block-source="diffusers_catalog"][data-block-schema-version="2"]');
  await expect(root).toHaveCount(1, { timeout: 45_000 });
  const rootId = (await root.getAttribute('data-testid'))!.replace(/^user-block-/u, '');
  // This qualification deliberately selects a fixed resource recipe. Make
  // Expert an explicit native user choice, not a store injection or accidental
  // reliance on Auto choosing the same offload/quantization configuration.
  const autoSwitch = page.getByRole('radio', { name: 'Creator', exact: true });
  if ((await autoSwitch.getAttribute('aria-checked')) === 'true')
    await page.getByRole('radio', { name: 'Developer', exact: true }).click();
  await expect(autoSwitch).toHaveAttribute('aria-checked', 'false');
  const originals = await page.evaluate(
    async ({ rootId, values, preprocessControl }) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const runtime = await import('/src/studio/blockRuntimeV2.ts');
      const flow = useFlowStore.getState();
      let instance = flow.nodes.find((node) => node.id === rootId)!.data.blockInstanceV2!;
      const originals = { values: instance.values, definition: instance.definitionSnapshot };
      for (const [key, value] of Object.entries(values))
        instance = runtime.setBlockInstanceValueV2(instance, key, value as BlockJsonValue);
      flow.replaceGraph(
        { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
        {
          historyLabel: 'Set explicit image qualification fixtures',
          clearRemovedCache: false,
        },
      );
      if (preprocessControl) {
        instance = runtime.setBlockPresentationV2(instance, { expanded: true });
        useFlowStore
          .getState()
          .replaceGraph(runtime.materializeBlockProjectionV2(runtime.createBlockRootNodeV2(instance)), {
            historyLabel: 'Expand the test Block before adding its preprocessor',
            clearRemovedCache: false,
          });
        const { useNodesStore } = await import('/src/stores/useNodeStore.ts');
        const { createNodeFromRegistry } = await import('/src/workflow/nodeFactory.ts');
        const registry = useNodesStore.getState().nodesRegistry;
        const key = Object.keys(registry).find(
          (id) => registry[id].module === 'modules.ImageFilters' && registry[id].action === 'Canny',
        );
        if (!key) throw new Error('The ordinary Canny node is missing from the registry.');
        const node = createNodeFromRegistry(key, registry, { x: 600, y: 500 })!;
        node.data.params.output_mode.value = 'RGB';
        node.data.params.device.value = 'cpu:0';
        useFlowStore.getState().addNode(node);
        useFlowStore.getState().adoptNodeIntoBlockV2(node.id, rootId);
        instance = useFlowStore.getState().nodes.find((candidate) => candidate.id === rootId)!.data.blockInstanceV2!;
        const edge = instance.effectiveGraph.edges.find((candidate) => candidate.targetPortId === 'control_image');
        if (!edge) throw new Error('No control image connection to preprocess.');
        const executionOrder = instance.effectiveGraph.executionOrder.filter((id) => id !== node.id);
        executionOrder.splice(executionOrder.indexOf(edge.targetNodeId), 0, node.id);
        instance = runtime.replaceBlockEffectiveGraphV2(instance, {
          ...instance.effectiveGraph,
          executionOrder,
          edges: [
            ...instance.effectiveGraph.edges.filter((candidate) => candidate.edgeId !== edge.edgeId),
            { ...edge, targetNodeId: node.id, targetPortId: 'image' },
            {
              edgeId: `${edge.edgeId}-preprocessed`,
              sourceNodeId: node.id,
              sourcePortId: 'output',
              targetNodeId: edge.targetNodeId,
              targetPortId: edge.targetPortId,
            },
          ],
        });
        instance = runtime.setBlockPresentationV2(instance, { expanded: false });
        useFlowStore.getState().replaceGraph(
          { nodes: [runtime.createBlockRootNodeV2(instance)], edges: [] },
          {
            historyLabel: 'Reconnect the added Canny control preprocessor',
            clearRemovedCache: false,
          },
        );
      }
      return originals;
    },
    { rootId, values, preprocessControl },
  );
  const promptField = root.locator('[data-key="prompt"] textarea').first();
  for (const [key, value] of Object.entries(expectedDefaults)) expect(originals.values[key], key).toEqual(value);
  await promptField.fill(prompt);
  await promptField.blur();
  const snapshot = () =>
    page.evaluate(async (id) => {
      const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
      const { buildApiGraphExport } = await import('/src/stores/flowGraphExport.ts');
      const { expandBlockGraphV2ForExecution } = await import('/src/studio/blockRuntimeV2.ts');
      const flow = useFlowStore.getState();
      const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
      const execution = expandBlockGraphV2ForExecution(flow.nodes, flow.edges);
      return {
        values: instance.values,
        definition: instance.definitionSnapshot,
        graph: instance.effectiveGraph,
        exported: buildApiGraphExport({
          nodes: execution.nodes,
          edges: execution.edges,
          sid: 'image-composite-proof',
          setParam: () => {},
        }),
      };
    }, rootId);
  await expect.poll(async () => (await snapshot()).values.prompt).toBe(prompt);
  if (pickerSources.length) {
    const backend = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
    const files = [];
    const manifest = [];
    for (const [index, source] of pickerSources.entries()) {
      const response = await page.request.get(`${backend}/file?file=${encodeURIComponent(source)}`);
      expect(response.ok(), `Reference ${index + 1} must exist`).toBe(true);
      const buffer = await response.body();
      const extension = /\.(png|jpe?g|webp)$/i.exec(source)?.[1]?.toLowerCase();
      if (!extension) throw new Error(`Unsupported reference image extension: ${source}`);
      files.push({
        name: `flux-kv-reference-${index + 1}.${extension}`,
        mimeType: /jpe?g/.test(extension) ? 'image/jpeg' : `image/${extension}`,
        buffer,
      });
      manifest.push({ source, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
    }
    await root.locator('input[type="file"]').first().setInputFiles(files);
    await expect
      .poll(async () => (await snapshot()).values.image, { timeout: 60_000 })
      .toHaveLength(pickerSources.length);
    const stored = (await snapshot()).values.image as string[];
    for (const [index, path] of stored.entries()) {
      const response = await page.request.get(`${backend}/file?file=${encodeURIComponent(path)}`);
      expect(response.ok()).toBe(true);
      expect(
        createHash('sha256')
          .update(await response.body())
          .digest('hex'),
      ).toBe(manifest[index].sha256);
    }
    await writeFile(`${output}/reference-inputs.json`, JSON.stringify({ manifest, stored }, null, 2));
  }
  if (optionalInput) {
    await root.getByLabel('Expand block', { exact: true }).click();
    await page.getByTestId('arrange-graph').click();
    await page.getByLabel('Search nodes').fill(optionalInput.label);
    const primitive = page.getByTestId(
      (attentionScale && !attentionBuilder) || controlModes ? 'node-group-text' : 'node-group-primitive',
    );
    if ((await primitive.getByRole('button').first().getAttribute('aria-expanded')) !== 'true')
      await primitive.getByRole('button').first().click();
    const rootBox = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
    const pane = page.locator('.react-flow__pane');
    const paneBox = await pane.boundingBox();
    if (!rootBox || !paneBox) throw new Error('No visible root drop area.');
    // The expanded root's empty body is pointer-transparent. Drop on its actual
    // pane hit target, at coordinates inside the Block, without forced events.
    await page.getByTestId(optionalInput.row).dragTo(pane, {
      targetPosition: { x: rootBox.x + 8 - paneBox.x, y: rootBox.y + 35 - paneBox.y },
    });
    const inspectOptional = () =>
      page.evaluate(
        async ({ id, optionalInput }) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
          const source = instance.effectiveGraph.nodes.find((node) => node.data.action === optionalInput.action);
          const target = instance.effectiveGraph.nodes.find(
            (node) => node.data.module === 'modules.DiffusersImage' && node.data.action !== 'LoadPipeline',
          );
          const projection = flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
          const sourceView = projection.find((node) => node.data.blockProjectionNodeId === source?.nodeId);
          const targetView = projection.find((node) => node.data.blockProjectionNodeId === target?.nodeId);
          const targetSocket =
            Object.entries(targetView?.data.blockProjectionPortBindings ?? {}).find(
              ([, binding]) => binding.fieldOrPortId === optionalInput.target && binding.direction === 'input',
            )?.[0] ??
            (targetView?.data.params?.[optionalInput.target]?.display === 'input' ? optionalInput.target : undefined);
          return {
            sourceId: source?.nodeId,
            sourceView: sourceView?.id,
            targetView: targetView?.id,
            targetSocket,
            value: source?.data.params?.[optionalInput.field]?.value,
            connected: instance.effectiveGraph.edges.some(
              (edge) =>
                edge.sourceNodeId === source?.nodeId &&
                edge.targetNodeId === target?.nodeId &&
                edge.targetPortId === optionalInput.target,
            ),
          };
        },
        { id: rootId, optionalInput },
      );
    await expect.poll(async () => (await inspectOptional()).sourceId).toBeTruthy();
    let state = await inspectOptional();
    await page
      .getByTestId(`rf__node-${state.sourceView}`)
      .getByLabel(optionalInput.fieldLabel, { exact: true })
      .fill(optionalInput.value);
    await page
      .getByTestId(`rf__node-${state.sourceView}`)
      .getByLabel(optionalInput.fieldLabel, { exact: true })
      .press('Tab');
    await expect.poll(async () => String((await inspectOptional()).value)).toBe(optionalInput.value);
    if (attentionBuilder) {
      await page
        .getByTestId(`rf__node-${state.sourceView}`)
        .getByRole('switch', { name: 'Set LoRA Scale', exact: true })
        .click();
      await expect
        .poll(async () =>
          page.evaluate(
            async ({ id, nodeId }) => {
              const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
              const instance = useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
              return instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId)!.data.params!
                .enable_lora_scale.value;
            },
            { id: rootId, nodeId: state.sourceId },
          ),
        )
        .toBe(true);
    }
    if ((attentionScale && !attentionBuilder) || controlModes) {
      await page.getByTestId(`rf__node-${state.sourceView}`).getByLabel('Operation', { exact: true }).click();
      await page.getByRole('option', { name: 'Convert Data', exact: true }).click();
      await expect
        .poll(async () =>
          page.evaluate(
            async ({ id, nodeId }) => {
              const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
              const instance = useFlowStore.getState().nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
              const params = instance.effectiveGraph.nodes.find((node) => node.nodeId === nodeId)!.data.params!;
              return {
                operation: params.operation.value,
                target: params.target_type.value ?? params.target_type.default,
              };
            },
            { id: rootId, nodeId: state.sourceId },
          ),
        )
        .toEqual({ operation: 'data_conversion', target: 'json' });
    }
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    state = await inspectOptional();
    expect(state.targetSocket).toBeTruthy();
    const sourceHandle = page.getByTestId(`node-handle-${state.sourceView}-${optionalInput.output}`);
    const targetHandle = page.getByTestId(`node-handle-${state.targetView}-${state.targetSocket}`);
    const from = await sourceHandle.boundingBox(),
      to = await targetHandle.boundingBox();
    if (!from || !to) throw new Error('Optional input connection has no visible endpoints.');
    await writeFile(
      `${output}/optional-connection-before.json`,
      JSON.stringify(
        await page.evaluate(
          ({ from, to }) => {
            const hit = (box: { x: number; y: number; width: number; height: number }) => {
              const element = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return { html: element?.outerHTML, parent: element?.parentElement?.outerHTML.slice(0, 3000) };
            };
            return { from: hit(from), to: hit(to) };
          },
          { from, to },
        ),
        null,
        2,
      ),
    );
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 18 });
    await page.mouse.up();
    await writeFile(
      `${output}/optional-connection-after.json`,
      JSON.stringify(
        await page.evaluate(async (id) => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          const flow = useFlowStore.getState();
          const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
          return { edges: instance.effectiveGraph.edges, projected: flow.edges };
        }, rootId),
        null,
        2,
      ),
    );
    await expect.poll(async () => (await inspectOptional()).connected).toBe(true);
    await root.getByLabel('Collapse block', { exact: true }).click();
  }
  if (ipAdapterReference) await addImagePromptAdapter(page, rootId, ipAdapterReference, output);
  if (multipleControlComponents || unionControl) await addControlComponents(page, rootId, output, unionControl);
  if (Object.keys(jsonInputs).length) await addJsonInputs(page, rootId, jsonInputs, output);
  if (latentRoundtrip) {
    await root.getByLabel('Expand block', { exact: true }).click();
    await page.getByTestId('arrange-graph').click();
    const inspect = () =>
      page.evaluate(async (id) => {
        const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
        const { blockContainerFieldValueV1 } = await import('/src/studio/blockContainerInterfaceV1.ts');
        const flow = useFlowStore.getState();
        const instance = flow.nodes.find((node) => node.id === id)!.data.blockInstanceV2!;
        const generated = instance.effectiveGraph.nodes.filter(
          (node) =>
            node.data.module === 'modules.DiffusersImage' &&
            ['Generate', 'DecodeLatents'].includes(String(node.data.action)),
        );
        const views = flow.nodes.filter((node) => node.data.blockProjectionOwnerId === id);
        const view = (semantic: string) => views.find((node) => node.data.blockProjectionNodeId === semantic)!;
        const socket = (semantic: string, field: string, direction: 'input' | 'output') => {
          const node = view(semantic);
          return {
            view: node.id,
            handle:
              Object.entries(node.data.blockProjectionPortBindings ?? {}).find(
                ([, binding]) => binding.fieldOrPortId === field && binding.direction === direction,
              )?.[0] ?? field,
          };
        };
        const source = generated.find((node) => node.nodeId === 'diffusersImageGenerate')!;
        const copy = generated.find((node) => node.nodeId !== source.nodeId);
        return {
          source: view(source.nodeId).id,
          copy: copy ? view(copy.nodeId).id : null,
          sourceOutput: blockContainerFieldValueV1(instance, source.nodeId, 'output_type'),
          copyOutput: copy ? blockContainerFieldValueV1(instance, copy.nodeId, 'output_type') : null,
          copyPrompt: copy ? blockContainerFieldValueV1(instance, copy.nodeId, 'prompt') : null,
          count: generated.length,
          edges: instance.effectiveGraph.edges,
          sockets: copy
            ? {
                pipeline: socket('diffusersImagePipeline', 'pipeline', 'output'),
                consumerPipeline: socket(copy.nodeId, 'pipeline', 'input'),
                latent: socket(source.nodeId, 'latents_out', 'output'),
                consumerLatent: socket(copy.nodeId, 'latents', 'input'),
                images: socket(copy.nodeId, 'images', 'output'),
                preview: socket('preview', 'image', 'input'),
              }
            : null,
        };
      }, rootId);
    let state = await inspect();
    expect(state.count).toBe(1);
    await page.getByTestId(`rf__node-${state.source}`).locator('header').first().click();
    await page.getByTestId('selection-toolbar-duplicate').click();
    await expect.poll(async () => (await inspect()).count).toBe(2);
    state = await inspect();
    expect(state.copyOutput).toBe('pil');
    expect(state.copyPrompt).toBe(prompt);
    await page.getByTestId(`rf__node-${state.copy}`).locator('header').first().click();
    await page.getByTestId('selection-toolbar-delete').click();
    await expect.poll(async () => (await inspect()).count).toBe(1);
    await page.getByLabel('Search nodes').fill('Decode Image Latents');
    const decoderRow = page.getByTestId('node-row-modules-DiffusersImage-DecodeLatents');
    const decoderGroup = page.getByTestId('node-group-Diffusers-Image').getByRole('button').first();
    if ((await decoderGroup.getAttribute('aria-expanded')) !== 'true') await decoderGroup.click();
    const rootBounds = await page.getByTestId(`rf__node-${rootId}`).boundingBox();
    const pane = page.locator('.react-flow__pane');
    const paneBounds = await pane.boundingBox();
    if (!rootBounds || !paneBounds) throw new Error('No native Block insertion target.');
    await page.evaluate(() => {
      const events: unknown[] = [];
      Object.assign(window, { __latentDropEvents: events });
      for (const name of ['dragstart', 'dragover', 'drop'])
        document.addEventListener(
          name,
          (raw) => {
            const event = raw as DragEvent;
            events.push({
              type: event.type,
              x: event.clientX,
              y: event.clientY,
              types: [...(event.dataTransfer?.types ?? [])],
              target: (event.target as HTMLElement)?.outerHTML.slice(0, 500),
            });
          },
          { capture: true },
        );
    });
    const rowBounds = await decoderRow.boundingBox();
    if (!rowBounds) throw new Error('No palette drag source.');
    await page.mouse.move(rowBounds.x + rowBounds.width / 2, rowBounds.y + rowBounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(rowBounds.x + rowBounds.width / 2 + 10, rowBounds.y + rowBounds.height / 2, { steps: 3 });
    await page.mouse.move(rootBounds.x + 8, rootBounds.y + 35, { steps: 20 });
    await page.mouse.move(rootBounds.x + 9, rootBounds.y + 36);
    await page.mouse.up();
    await writeFile(
      `${output}/decoder-drop.json`,
      JSON.stringify(
        await page.evaluate(async () => {
          const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
          return {
            events: (window as unknown as { __latentDropEvents: unknown[] }).__latentDropEvents,
            nodes: useFlowStore.getState().nodes.map((node) => ({
              id: node.id,
              action: node.data.action,
              owner: node.data.blockProjectionOwnerId,
            })),
          };
        }),
        null,
        2,
      ),
    );
    await expect.poll(async () => (await inspect()).count).toBe(2);
    state = await inspect();
    const source = page.getByTestId(`rf__node-${state.source}`);
    const advancedFields = source.getByRole('button', { name: 'Advanced', exact: true });
    if (await advancedFields.count()) {
      if ((await advancedFields.getAttribute('aria-expanded')) !== 'true') await advancedFields.click();
    }
    await source.getByLabel('Output type', { exact: true }).click();
    await page.getByRole('option', { name: 'latent', exact: true }).click();
    await expect.poll(async () => (await inspect()).sourceOutput).toBe('latent');
    await page.getByTestId('arrange-graph').click();
    await waitForRecursiveDomGeometry(page);
    const sockets = (await inspect()).sockets!;
    for (const [from, to] of [
      [sockets.pipeline, sockets.consumerPipeline],
      [sockets.latent, sockets.consumerLatent],
      [sockets.images, sockets.preview],
    ]) {
      const sourceHandle = page.getByTestId(`node-handle-${from!.view}-${from!.handle}`);
      const targetHandle = page.getByTestId(`node-handle-${to!.view}-${to!.handle}`);
      const a = await sourceHandle.boundingBox(),
        b = await targetHandle.boundingBox();
      if (!a || !b) throw new Error('Latent roundtrip requires visible native sockets.');
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
      await page.mouse.up();
    }
    await expect
      .poll(
        async () =>
          (await inspect()).edges.filter(
            (edge) => edge.sourcePortId === 'latents_out' && edge.targetPortId === 'latents',
          ).length,
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await inspect()).edges.filter(
            (edge) => edge.targetNodeId === 'preview' && edge.sourceNodeId !== 'diffusersImageGenerate',
          ).length,
      )
      .toBe(1);
    await writeFile(`${output}/latent-native-wiring.json`, JSON.stringify(await inspect(), null, 2));
    await root.getByLabel('Collapse block', { exact: true }).click();
  }
  const before = await snapshot();
  const outpaintCanvas = before.graph.nodes.find((node) => node.data.action === 'OutpaintCanvas');
  if (workflow === 'outpaint' && !outpaintCanvas) {
    // Prepared-canvas admissions require source + mask instead of an automatic
    // OutpaintCanvas node. Verify that exact fixture before spending GPU time;
    // do not weaken the generated-border assertions below.
    const prepared = [];
    for (const field of ['image', 'mask_image']) {
      const source = before.values[field];
      expect(typeof source, `Prepared outpaint ${field}`).toBe('string');
      const response = await page.request.get(`${readinessServer}/file?file=${encodeURIComponent(String(source))}`);
      expect(response.ok()).toBe(true);
      const bytes = await response.body();
      const full = await decodedImageStatistics(page, bytes);
      expect([full.width, full.height]).toEqual([before.values.width, before.values.height]);
      const borders = [];
      for (const x of [0, full.width - 128]) {
        const statistics = await decodedImageStatistics(page, bytes, { x, y: 0, width: 128, height: full.height });
        expect(statistics.mean, `${field} preparation margin`).toBe(field === 'mask_image' ? 255 : 0);
        expect(statistics.standardDeviation).toBe(0);
        borders.push(statistics);
      }
      if (field === 'mask_image') {
        const center = await decodedImageStatistics(page, bytes, {
          x: Math.floor(full.width / 2) - 256,
          y: Math.floor(full.height / 2) - 256,
          width: 512,
          height: 512,
        });
        // This prepared mask also feathers the top/bottom edges; the central
        // 512-square original scene, not the entire vertical strip, is protected.
        expect(center.mean, 'The original central scene must be protected').toBe(0);
      }
      prepared.push({ field, source, sha256: createHash('sha256').update(bytes).digest('hex'), full, borders });
    }
    await writeFile(`${output}/prepared-outpaint-inputs.json`, JSON.stringify(prepared, null, 2));
  }
  expect(before.definition).toEqual(originals.definition);
  for (const [key, value] of Object.entries(originals.values))
    if (
      key !== 'prompt' &&
      !(pickerSources.length && key === 'image') &&
      !(latentRoundtrip && key === 'output_type') &&
      !Object.hasOwn(values, key)
    )
      expect(before.values[key]).toEqual(value);
  if (latentRoundtrip) expect(before.values.output_type).toBe('latent');
  await root.getByLabel('Expand block', { exact: true }).click();
  await page.getByTestId('arrange-graph').click();
  await waitForRecursiveDomGeometry(page);
  expect((await snapshot()).exported).toEqual(before.exported);
  const promptOwner = await page.evaluate(async (rootId) => {
    const { useFlowStore } = await import('/src/stores/useFlowStore.ts');
    return useFlowStore
      .getState()
      .nodes.find(
        (node) =>
          node.data.blockProjectionOwnerId === rootId &&
          node.data.params.prompt?.display === 'textarea' &&
          !node.data.params.prompt?.hidden,
      )?.id;
  }, rootId);
  expect(promptOwner, 'The expanded action must expose its editable Prompt').toBeTruthy();
  const internalBody = page.getByTestId(`node-scroll-body-${promptOwner}`);
  expect(await internalBody.evaluate((body) => body.clientHeight)).toBeGreaterThanOrEqual(96);
  const internalPrompt = internalBody.locator('[data-key="prompt"] textarea').first();
  await internalPrompt.fill(`${prompt} Internal editing check.`);
  await internalPrompt.blur();
  await expect.poll(async () => (await snapshot()).values.prompt).toBe(`${prompt} Internal editing check.`);
  await internalPrompt.fill(prompt);
  await internalPrompt.blur();
  await expect.poll(async () => (await snapshot()).values).toEqual(before.values);
  expect((await snapshot()).definition).toEqual(before.definition);
  expect((await snapshot()).exported).toEqual(before.exported);
  await page.screenshot({ path: `${output}/expanded.png` });
  await root.getByLabel('Collapse block', { exact: true }).click();
  await page.getByTestId('topbar-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toBeVisible();
  await page.getByTestId('save-workflow-name').fill(`${entry.label} model qualification ${Date.now()}`);
  await page.getByTestId('confirm-save-workflow').click();
  await expect(page.getByTestId('save-workflow-dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('startup-workspace-gate')).toHaveCount(0, { timeout: 120_000 });
  await expect.poll(async () => (await snapshot()).values).toEqual(before.values);
  expect((await snapshot()).graph).toEqual(before.graph);
  await writeFile(`${output}/before.json`, JSON.stringify({ originals, before }, null, 2));
  if (attentionUserNodeOnly) {
    await attentionUserNodeLifecycle(page, rootId, output);
    return;
  }
  const backendRoot = process.env.MODIFF_BACKEND_ROOT ?? resolve(process.cwd(), '..', 'MoDiff');
  const sourceBefore = backendSourceIdentity(backendRoot);
  await writeFile(`${output}/backend-source-before.json`, JSON.stringify(sourceBefore, null, 2));
  const healthBeforeResponse = await page.request.get(`${readinessServer}/health`, { timeout: 30_000 });
  expect(healthBeforeResponse.ok()).toBe(true);
  const healthBefore = await healthBeforeResponse.json();
  const workerBefore = { instance: healthBefore.instance, backendSource: healthBefore.backend_source };
  await writeFile(`${output}/worker-source-before.json`, JSON.stringify(workerBefore, null, 2));
  expect(workerBefore.backendSource?.fingerprint, 'The worker must have started from the tested source').toBe(
    sourceBefore.fingerprint,
  );
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/graph' && response.request().method() === 'POST',
    { timeout: 120_000 },
  );
  await root.locator('header').first().click();
  await page.getByTestId('selection-toolbar-run-from-node').click();
  const response = await submitted;
  expect(response.ok(), await response.text()).toBe(true);
  const { task_id: taskId } = (await response.json()) as { task_id: string };
  await writeFile(
    `${output}/submitted.json`,
    JSON.stringify({ taskId, graph: response.request().postDataJSON() }, null, 2),
  );
  console.log(`Image composite task ${taskId}: ${entry.id}`);
  const server = process.env.MODIFF_LIVE_BACKEND_URL ?? 'http://127.0.0.1:8088';
  const deadline = Date.now() + generationMinutes * 60_000;
  let run: {
    task?: { status?: string; message?: string };
    outputs?: Array<{ taskId: string; displayType: string; url: string }>;
  } = {};
  const statusSamples: Array<{ elapsedMs: number; status?: string; step?: number }> = [];
  while (Date.now() < deadline) {
    // The UI's queue endpoint is the live-status contract. /runs includes full
    // saved workflow/output history and takes the Gallery writer lock: polling
    // that every two seconds adds unnecessary work during final media storage.
    // Keep the status deadline strict, then fetch exact provenance once terminal.
    const started = Date.now();
    const result = await page.request.get(`${server}/queue`, { timeout: 5_000 });
    expect(result.ok()).toBe(true);
    const queue = await result.json();
    const task = [queue.current, ...Object.values(queue.queued ?? {}), ...(queue.recent ?? [])].find(
      (candidate) => candidate?.task_id === taskId,
    );
    expect(task, 'The submitted task must remain present in live queue/recent status').toBeTruthy();
    statusSamples.push({ elapsedMs: Date.now() - started, status: task.status, step: task.current_step });
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(task.status ?? '')) break;
    await page.waitForTimeout(2_000);
  }
  await writeFile(`${output}/status-responsiveness.json`, JSON.stringify(statusSamples, null, 2));
  const completedResponse = await page.request.get(`${server}/runs/${encodeURIComponent(taskId)}`, { timeout: 15_000 });
  expect(completedResponse.ok()).toBe(true);
  run = await completedResponse.json();
  await writeFile(`${output}/run.json`, JSON.stringify(run, null, 2));
  const sourceAfter = backendSourceIdentity(backendRoot);
  await writeFile(`${output}/backend-source-after.json`, JSON.stringify(sourceAfter, null, 2));
  expect(sourceAfter.fingerprint, 'Application source changed during inference').toBe(sourceBefore.fingerprint);
  const healthAfterResponse = await page.request.get(`${readinessServer}/health`, { timeout: 30_000 });
  expect(healthAfterResponse.ok()).toBe(true);
  const healthAfter = await healthAfterResponse.json();
  const workerAfter = { instance: healthAfter.instance, backendSource: healthAfter.backend_source };
  await writeFile(`${output}/worker-source-after.json`, JSON.stringify(workerAfter, null, 2));
  expect(workerAfter, 'The generation proof must retain the same source-attested worker').toEqual(workerBefore);
  expect(run.task?.status, run.task?.message).toBe('completed');
  const media = run.outputs?.find((item) => item.taskId === taskId && item.displayType === 'image');
  expect(media).toBeTruthy();
  const loader = before.graph.nodes.find(
    (node) => node.data.module === 'modules.DiffusersImage' && node.data.action === 'LoadPipeline',
  );
  const loaderParams = loader?.data.params as Record<string, { value?: unknown; default?: unknown }> | undefined;
  const runtimeClass = loaderParams?.pipeline_class?.value ?? loaderParams?.pipeline_class?.default;
  expect(typeof runtimeClass).toBe('string');
  // Catalog artifact aliases (Schnell/Krea/Depth/Canny) are not upstream class
  // names. Verify the exact compiled loader AND pinned repository instead of
  // incorrectly demanding that the receipt use a UI/catalog alias.
  expect(media).toMatchObject({
    modelType: runtimeClass,
    prompt,
    width: Number(before.values.width ?? 1024),
    height: Number(before.values.height ?? 1024),
    resolvedExecutionInputs: {
      summary: {
        modelType: runtimeClass,
        repo: before.definition.source.repository,
        revision: before.definition.source.repositoryRevision,
      },
    },
  });
  if (ipAdapterReference)
    expect(media).toMatchObject({
      resolvedExecutionInputs: {
        summary: {
          ipAdapterRepo: 'XLabs-AI/flux-ip-adapter',
          ipAdapterRevision: '18f6940238ab5dc3744df7a8e30315892279d5f9',
          ipAdapterEncoderRepo: 'openai/clip-vit-large-patch14',
          ipAdapterScale: 0.65,
        },
      },
    });
  if (multipleControlComponents || unionControl)
    expect(media).toMatchObject({
      resolvedExecutionInputs: {
        summary: {
          controlComponentRepo: unionControl
            ? 'InstantX/FLUX.1-dev-Controlnet-Union'
            : 'InstantX/FLUX.1-dev-Controlnet-Canny',
          controlComponentRevision: unionControl
            ? '4f32d6f2b220f8873d49bb8acc073e1df180c994'
            : 'e7cee4b2afa335bf8f913f2b044764b1a1b01881',
          controlComponentSharedConditions: unionControl,
          conditioningScale: values.conditioning_scale,
          controlMode: unionControl ? JSON.parse(controlModes!) : [-1, -1],
        },
      },
    });
  if (jsonInputs.prompt_embeds_scale || jsonInputs.pooled_prompt_embeds_scale)
    expect(media).toMatchObject({
      resolvedExecutionInputs: {
        summary: {
          reduxPromptEmbedsScale: jsonInputs.prompt_embeds_scale,
          reduxPooledPromptEmbedsScale: jsonInputs.pooled_prompt_embeds_scale,
        },
      },
    });
  const asset = await page.request.get(new URL(media!.url, server).toString());
  expect(asset.ok()).toBe(true);
  const assetBytes = await asset.body();
  await writeFile(`${output}/generated.webp`, assetBytes);
  const imageStatistics = await decodedImageStatistics(page, assetBytes);
  await writeFile(`${output}/image-statistics.json`, JSON.stringify(imageStatistics, null, 2));
  // These explicit qualification prompts request detailed photographs. A black
  // NaN-conversion image is not a pass merely because the pipeline returned it.
  // This is a harness assertion, not a ban on intentionally flat user artwork.
  expect(imageStatistics.maximum - imageStatistics.minimum).toBeGreaterThan(16);
  expect(imageStatistics.standardDeviation).toBeGreaterThan(2);
  if ((workflow === 'outpaint' && !outpaintCanvas) || jsonInputs._auto_resize === false)
    expect([imageStatistics.width, imageStatistics.height]).toEqual([before.values.width, before.values.height]);
  if (workflow === 'outpaint') {
    // These explicit fixtures expand both sides of a detailed photograph.
    // Global contrast alone passes an unchanged canvas with black margins.
    if (outpaintCanvas) {
      const params = outpaintCanvas.data.params as Record<string, { value?: unknown; default?: unknown }>;
      for (const side of ['left', 'right'])
        expect(
          Number(params?.[side]?.value ?? params?.[side]?.default),
          `${side} assessment margin`,
        ).toBeGreaterThanOrEqual(128);
    }
    const borders = {} as Record<string, Awaited<ReturnType<typeof decodedImageStatistics>>>;
    for (const [side, x] of [
      ['left', 0],
      ['right', imageStatistics.width - 64],
    ] as const) {
      borders[side] = await decodedImageStatistics(page, assetBytes, {
        x,
        y: 0,
        width: 64,
        height: imageStatistics.height,
      });
    }
    await writeFile(`${output}/outpaint-border-statistics.json`, JSON.stringify(borders, null, 2));
    for (const [side, statistics] of Object.entries(borders)) {
      expect(statistics.mean, `${side} must not remain the black preparation canvas`).toBeGreaterThan(3);
      expect(statistics.standardDeviation, `${side} must contain photographic detail`).toBeGreaterThan(2);
    }
  }
  expect((await snapshot()).values).toEqual(before.values);
  expect((await snapshot()).graph).toEqual(before.graph);
  expect(errors).toEqual([]);
  await page.screenshot({ path: `${output}/generated.png` });
});
