import { canonicalBlockStringifyV2 } from './blockSchemaV2';
import { parseLayoutConditioning, type LayoutConditioning } from './layoutConditioning';

/** Transport observations only. Parsing or matching hashes never authorizes Apply. */
export type PromptEnhancementMode = 't2i' | 'i2i' | 't2i_bbox' | 'i2i_bbox';
export type SummarySha256 = `sha256:${string}`;
export type PromptEnhancementControls = {
  max_new_tokens: number;
  min_new_tokens: number;
  do_sample: false;
  num_beams: 1;
  repetition_penalty: 1;
  return_dict_in_generate: false;
  use_chat_template: true;
};
export type PromptEnhancementProducer = {
  taskId: string;
  attemptIndex: number;
  node: { id: string; module: 'modules.HuggingFaceTransformers'; action: 'GenerateImageVideoText' };
  sid: string | null;
  workerInstance: string;
  backendSourceFingerprint: string;
  graphHash: string;
  recipe: null;
  uiContext: {
    clientRunId: string | null;
    runInputHash: string | null;
    workflowTabId: string | null;
    workflowCanvasEpoch: number | null;
    workflowFormEpoch: number | null;
  };
};
export type NativeEnhancementModelReceipt = {
  schemaVersion: 1;
  library: 'transformers';
  task: 'image-video-to-text';
  source: { kind: 'hub'; repository: string; revision: string };
  loader: { preprocessorAutoClass: 'AutoProcessor'; modelAutoClass: 'AutoModelForImageTextToText' };
  security: { localFilesOnly: true; trustRemoteCode: false; safetensorsOnly: true; hostedInference: false };
  runtime: {
    transformersVersion: string;
    dtype: 'float32' | 'float16' | 'bfloat16';
    device: string;
    preprocessorClass: string;
    modelClass: string;
    modelType: string | null;
    architectures: string[];
    quantization:
      | { mode: 'none' }
      | {
          mode: 'bnb_4bit';
          quantType: 'nf4';
          doubleQuant: true;
          computeDtype: 'bfloat16';
          skipModules: ['lm_head', 'model.visual'];
        };
  };
  receiptDigest: SummarySha256;
};
export type EnhancementReference = { index: number; mode: 'RGB'; width: number; height: number; sha256: SummarySha256 };
export type EnhancementConsumedInput = {
  schemaVersion: 1;
  renderedPrompt: string;
  references: EnhancementReference[];
  processedImageGrid: [number, number, number][];
  fingerprints: {
    operation: 'enhance_prompt' | 'enhance_prompt_append_details';
    enhancement_max_new_tokens: number;
    prompt_adapter_id: string;
    system_prompt_mode: PromptEnhancementMode;
    system_prompt_sha256: string;
    rendered_prompt_sha256: SummarySha256;
    rendered_prompt_utf8_bytes: number;
    rendered_input_ids_sha256: SummarySha256;
    reference_source_sha256: SummarySha256[];
    processed_pixel_sha256?: SummarySha256;
    processed_grid_sha256?: SummarySha256;
    processed_pixel_shape?: [number, number];
    processed_grid_shape?: [number, 3];
  };
};
export type EnhancementTargetRow =
  | { id: string; bbox: [number, number, number, number]; desc: string }
  | { id: string; from: string; src_bbox: number[] | null; tgt_bbox: number[] | null; desc: string };
type NativeStructuredProposal = {
  schemaVersion: 1 | 2;
  caption: string;
  rawCaption?: string;
  layoutConditioning: LayoutConditioning;
  rawTable: EnhancementTargetRow[];
};
export type ComposedEnhancementProposal = {
  schemaVersion: 3;
  kind: 'caption-append-preserve-layout-v1';
  caption: string;
  layoutConditioning: LayoutConditioning;
  nativeText: string;
};
export type EnhancementStructuredProposal = NativeStructuredProposal | ComposedEnhancementProposal;
type EnhancementCompletion = {
  finishReason: 'stop' | 'length';
  inputTokens: number;
  generatedTokens: number;
  applyRequired: true;
  semanticFidelityVerified: false;
};
export type EnhancementProposal = EnhancementCompletion &
  (
    | {
        mode: 't2i' | 'i2i';
        text: string;
        structuredProposal: null;
        applicationAllowed: true;
        layoutOutputValidated: null;
        applicationBlockedReason: null;
      }
    | {
        mode: 't2i_bbox' | 'i2i_bbox';
        text: null;
        structuredProposal: NativeStructuredProposal;
        applicationAllowed: true;
        layoutOutputValidated: true;
        applicationBlockedReason: null;
      }
    | {
        mode: 't2i' | 'i2i';
        text: null;
        structuredProposal: ComposedEnhancementProposal;
        applicationAllowed: true;
        layoutOutputValidated: true;
        applicationBlockedReason: null;
      }
    | {
        mode: PromptEnhancementMode;
        text: null;
        structuredProposal: null;
        applicationAllowed: false;
        layoutOutputValidated: false;
        applicationBlockedReason: string;
      }
  );
export type PromptEnhancementSummary = {
  schemaVersion: 1;
  kind: 'prompt-enhancement-proposal';
  producer: PromptEnhancementProducer;
  adapter: { id: string; declarationSha256: SummarySha256 };
  request: {
    authoredPromptSha256: SummarySha256;
    authoredLayoutKind: 'none' | 'object';
    authoredLayoutSha256: SummarySha256 | null;
    controls: PromptEnhancementControls;
    consumedInputSha256: SummarySha256;
  };
  modelReceipt: NativeEnhancementModelReceipt;
  consumedInput: EnhancementConsumedInput;
  proposal: EnhancementProposal;
};

export const MAX_ENHANCEMENT_SUMMARY_BYTES = 2 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]{0,255}$/u;
const ADAPTER_ID = /^[a-z][a-z0-9-]{0,127}$/u;
const MODES = ['t2i', 'i2i', 't2i_bbox', 'i2i_bbox'] as const;

function invalid(detail: string): never {
  throw new Error(`Invalid prompt enhancement summary: ${detail}`);
}

function unicode(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 0x7f && code <= 0x9f))
      invalid('text contains unsupported controls.');
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('text contains an unpaired surrogate.');
    } else if (code >= 0xdc00 && code <= 0xdfff) invalid('text contains an unpaired surrogate.');
  }
  return value;
}

function utf8(value: string) {
  return new TextEncoder().encode(unicode(value));
}

function text(value: unknown, maximumBytes: number, maximumCharacters = maximumBytes, human = false): string {
  if (typeof value !== 'string') invalid('expected nonempty text.');
  if (value.length > maximumBytes) invalid('text exceeds its limit.');
  let characters = 0;
  let present = false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    characters++;
    if (!/\p{White_Space}/u.test(character) && !(code >= 0x1c && code <= 0x1f)) present = true;
    if (human && ((code <= 0x1f && code !== 9 && code !== 10 && code !== 13) || (code >= 0x7f && code <= 0x9f)))
      invalid('human text contains unsupported controls.');
  }
  if (!present) invalid('expected nonempty text.');
  if (utf8(value).byteLength > maximumBytes || characters > maximumCharacters) invalid('text exceeds its limit.');
  return value;
}

function object(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected a JSON object.');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !required.includes(key) && !optional.includes(key))) invalid('unknown keys.');
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(item, key))) invalid('missing keys.');
  return item;
}

function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid('invalid collection size.');
  return value;
}

function integer(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum)
    invalid('expected a bounded integer.');
  return value;
}

function hash(value: unknown): SummarySha256 {
  if (typeof value !== 'string' || !SHA256.test(value)) invalid('invalid SHA256.');
  return value as SummarySha256;
}

function jsonBudget(value: unknown, maximum: number) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || utf8(encoded).byteLength > maximum) invalid('JSON sub-budget exceeded.');
}

/** Bounded lexical preflight, not a second JSON grammar implementation.
 * JSON.parse validates grammar after duplicate decoded keys and depth are checked. */
function rawJson(value: unknown, maximumBytes = MAX_ENHANCEMENT_SUMMARY_BYTES): unknown {
  if (typeof value !== 'string') invalid('expected raw JSON text.');
  if (value.length > maximumBytes || utf8(value).byteLength > maximumBytes)
    invalid(
      maximumBytes === MAX_ENHANCEMENT_SUMMARY_BYTES ? 'wire exceeds 2 MiB.' : 'envelope exceeds its byte limit.',
    );
  // Count only the two historical ensure_ascii/default-separator guards.
  // Native producer numeric lexemes stay intact; this does not reconstruct
  // Python numeric identity from arbitrarily respelled caller JSON.
  let asciiOffset = 0;
  const stack: Array<{
    close: string;
    keys: Set<string> | null;
    pendingKey: string | null;
    asciiStart: number;
    legacyGuard: boolean;
  }> = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      let end = index + 1;
      for (; end < value.length; end++) {
        if (value[end] === '\\') end++;
        else if (value[end] === '"') break;
      }
      if (end >= value.length) invalid('unterminated JSON string.');
      const decoded: unknown = JSON.parse(value.slice(index, end + 1));
      if (typeof decoded !== 'string') invalid('invalid JSON string.');
      unicode(decoded);
      asciiOffset += receiptCanonical(decoded).length;
      let next = end + 1;
      while (/\s/u.test(value[next] ?? '') && next < value.length) next++;
      const scope = stack[stack.length - 1];
      if (scope?.keys && value[next] === ':') {
        if (scope.keys.has(decoded)) invalid('duplicate JSON key.');
        scope.keys.add(decoded);
        scope.pendingKey = decoded;
        if (scope.keys.size > 32) invalid('object exceeds 32 keys.');
      }
      index = end;
    } else if (character === '{' || character === '[') {
      const parent = stack[stack.length - 1];
      const name = parent?.pendingKey;
      if (parent) parent.pendingKey = null;
      const asciiStart = asciiOffset++;
      stack.push({
        close: character === '{' ? '}' : ']',
        keys: character === '{' ? new Set() : null,
        pendingKey: null,
        asciiStart,
        legacyGuard: character === '{' && (name === 'consumedInput' || name === 'structuredProposal'),
      });
      if (stack.length > 17) invalid('JSON depth exceeds 16.');
    } else if (character === '}' || character === ']') {
      asciiOffset++;
      const scope = stack.pop();
      if (scope?.close !== character) invalid('unbalanced JSON delimiters.');
      if (scope.legacyGuard && asciiOffset - scope.asciiStart > 262144)
        invalid('existing ASCII projection guard exceeded.');
    } else if (character === ',' || character === ':') asciiOffset += 2;
    else if (character !== ' ' && character !== '\t' && character !== '\r' && character !== '\n') asciiOffset++;
  }
  if (stack.length) invalid('unbalanced JSON delimiters.');
  const parsed: unknown = JSON.parse(value);
  const pending = [{ value: parsed, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (++entries > 8192) invalid('JSON entries exceed 8192.');
    if (depth > 16) invalid('JSON depth exceeds 16.');
    if (typeof item === 'number' && !Number.isFinite(item)) invalid('nonfinite number.');
    if (typeof item === 'string') unicode(item);
    else if (Array.isArray(item)) {
      if (item.length > 8192) invalid('JSON entries exceed 8192.');
      pending.push(...item.map((value) => ({ value, depth: depth + 1 })));
    } else if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item))
        pending.push({ value: key, depth: depth + 1 }, { value, depth: depth + 1 });
    }
  }
  return parsed;
}

/** A JSON response wraps/re-escapes the original summary string. The inner
 * summary and observation receive their own smaller limits before use. */
export const MAX_ENHANCEMENT_ENVELOPE_BYTES = 2 * MAX_ENHANCEMENT_SUMMARY_BYTES + 65536;
export function parsePromptEnhancementEnvelopeJson(value: unknown): unknown {
  return rawJson(value, MAX_ENHANCEMENT_ENVELOPE_BYTES);
}

export function parsePromptEnhancementProducerObservation(value: unknown): PromptEnhancementProducer {
  return parseProducer(expectedSnapshot(value));
}

function parseControls(value: unknown): PromptEnhancementControls {
  const item = object(value, [
    'max_new_tokens',
    'min_new_tokens',
    'do_sample',
    'num_beams',
    'repetition_penalty',
    'return_dict_in_generate',
    'use_chat_template',
  ]);
  const maximum = integer(item.max_new_tokens, 1, 3584);
  integer(item.min_new_tokens, 0, maximum);
  if (
    item.do_sample !== false ||
    item.num_beams !== 1 ||
    item.repetition_penalty !== 1 ||
    item.return_dict_in_generate !== false ||
    item.use_chat_template !== true
  )
    invalid('unsupported generation controls.');
  return item as PromptEnhancementControls;
}

function parseProducer(value: unknown): PromptEnhancementProducer {
  const item = object(value, [
    'taskId',
    'attemptIndex',
    'node',
    'sid',
    'workerInstance',
    'backendSourceFingerprint',
    'graphHash',
    'recipe',
    'uiContext',
  ]);
  text(item.taskId, 128);
  integer(item.attemptIndex, 0, 1000);
  const node = object(item.node, ['id', 'module', 'action']);
  text(node.id, 512);
  if (node.module !== 'modules.HuggingFaceTransformers' || node.action !== 'GenerateImageVideoText')
    invalid('foreign producer action.');
  if (item.sid !== null) text(item.sid, 512);
  text(item.workerInstance, 128);
  if (
    typeof item.backendSourceFingerprint !== 'string' ||
    !/^sha256:backend-source-v1:[0-9a-f]{64}$/u.test(item.backendSourceFingerprint)
  )
    invalid('invalid backend source fingerprint.');
  if (typeof item.graphHash !== 'string' || !/^sha256:workflow-auto-v1:[0-9a-f]{64}$/u.test(item.graphHash))
    invalid('invalid graph hash.');
  if (item.recipe !== null) invalid('this transport has no resolved recipe authority.');
  const ui = object(item.uiContext, [
    'clientRunId',
    'runInputHash',
    'workflowTabId',
    'workflowCanvasEpoch',
    'workflowFormEpoch',
  ]);
  for (const key of ['clientRunId', 'runInputHash', 'workflowTabId']) if (ui[key] !== null) text(ui[key], 512);
  for (const key of ['workflowCanvasEpoch', 'workflowFormEpoch'])
    if (ui[key] !== null) integer(ui[key], 0, Number.MAX_SAFE_INTEGER);
  jsonBudget(item, 4096);
  return item as PromptEnhancementProducer;
}

function parseModelReceipt(value: unknown): NativeEnhancementModelReceipt {
  const item = object(value, [
    'schemaVersion',
    'library',
    'task',
    'source',
    'loader',
    'security',
    'runtime',
    'receiptDigest',
  ]);
  if (item.schemaVersion !== 1 || item.library !== 'transformers' || item.task !== 'image-video-to-text')
    invalid('foreign model receipt.');
  const source = object(item.source, ['kind', 'repository', 'revision']);
  if (
    source.kind !== 'hub' ||
    typeof source.repository !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(source.repository) ||
    source.repository.length > 256 ||
    typeof source.revision !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(source.revision)
  )
    invalid('invalid immutable model source.');
  const loader = object(item.loader, ['preprocessorAutoClass', 'modelAutoClass']);
  if (loader.preprocessorAutoClass !== 'AutoProcessor' || loader.modelAutoClass !== 'AutoModelForImageTextToText')
    invalid('foreign model loader.');
  const security = object(item.security, ['localFilesOnly', 'trustRemoteCode', 'safetensorsOnly', 'hostedInference']);
  if (
    security.localFilesOnly !== true ||
    security.trustRemoteCode !== false ||
    security.safetensorsOnly !== true ||
    security.hostedInference !== false
  )
    invalid('invalid model security observations.');
  const runtime = object(item.runtime, [
    'transformersVersion',
    'dtype',
    'device',
    'preprocessorClass',
    'modelClass',
    'modelType',
    'architectures',
    'quantization',
  ]);
  text(runtime.transformersVersion, 128);
  if (runtime.dtype !== 'float32' && runtime.dtype !== 'float16' && runtime.dtype !== 'bfloat16')
    invalid('invalid model dtype.');
  if (typeof runtime.device !== 'string' || !/^(?:cpu|cuda|xpu|mps)(?::[0-9]{1,5})?$/u.test(runtime.device))
    invalid('invalid native device.');
  for (const key of ['preprocessorClass', 'modelClass'])
    if (typeof runtime[key] !== 'string' || !IDENTIFIER.test(runtime[key])) invalid('invalid native class.');
  if (runtime.modelType !== null && (typeof runtime.modelType !== 'string' || !IDENTIFIER.test(runtime.modelType)))
    invalid('invalid native model type.');
  for (const architecture of list(runtime.architectures, 32))
    if (typeof architecture !== 'string' || !IDENTIFIER.test(architecture)) invalid('invalid architecture class.');
  const quantization = runtime.quantization;
  if (quantization && typeof quantization === 'object' && 'mode' in quantization && quantization.mode === 'none') {
    object(quantization, ['mode']);
  } else {
    const quantized = object(quantization, ['mode', 'quantType', 'doubleQuant', 'computeDtype', 'skipModules']);
    if (
      quantized.mode !== 'bnb_4bit' ||
      quantized.quantType !== 'nf4' ||
      quantized.doubleQuant !== true ||
      quantized.computeDtype !== 'bfloat16' ||
      !Array.isArray(quantized.skipModules) ||
      quantized.skipModules.length !== 2 ||
      quantized.skipModules[0] !== 'lm_head' ||
      quantized.skipModules[1] !== 'model.visual'
    )
      invalid('quantized provider differs from the declared native recipe.');
  }
  hash(item.receiptDigest);
  jsonBudget(item, 16384);
  return item as NativeEnhancementModelReceipt;
}

function parseConsumed(
  value: unknown,
  controls: PromptEnhancementControls,
  adapterId: string,
): EnhancementConsumedInput {
  const item = object(value, ['schemaVersion', 'renderedPrompt', 'references', 'processedImageGrid', 'fingerprints']);
  if (item.schemaVersion !== 1) invalid('unsupported consumed input.');
  text(item.renderedPrompt, 524288, 131072);
  if ((item.renderedPrompt as string).includes('\0')) invalid('rendered prompt contains NUL.');
  const references = list(item.references, 10);
  let totalPixels = 0;
  for (const [index, value] of references.entries()) {
    const reference = object(value, ['index', 'mode', 'width', 'height', 'sha256']);
    if (reference.index !== index || reference.mode !== 'RGB') invalid('reference order or mode changed.');
    totalPixels += integer(reference.width, 1, 4096) * integer(reference.height, 1, 4096);
    hash(reference.sha256);
  }
  if (totalPixels > 67108864) invalid('reference pixel budget exceeded.');
  const processed = [
    'processed_pixel_sha256',
    'processed_grid_sha256',
    'processed_pixel_shape',
    'processed_grid_shape',
  ];
  const fingerprint = object(item.fingerprints, [
    'operation',
    'enhancement_max_new_tokens',
    'prompt_adapter_id',
    'system_prompt_mode',
    'system_prompt_sha256',
    'rendered_prompt_sha256',
    'rendered_prompt_utf8_bytes',
    'rendered_input_ids_sha256',
    'reference_source_sha256',
    ...(references.length ? processed : []),
  ]);
  if (
    (fingerprint.operation !== 'enhance_prompt' && fingerprint.operation !== 'enhance_prompt_append_details') ||
    fingerprint.enhancement_max_new_tokens !== controls.max_new_tokens ||
    fingerprint.prompt_adapter_id !== adapterId ||
    !MODES.some((mode) => mode === fingerprint.system_prompt_mode)
  )
    invalid('consumed operation differs from this request.');
  if (typeof fingerprint.system_prompt_sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(fingerprint.system_prompt_sha256))
    invalid('invalid system prompt digest.');
  hash(fingerprint.rendered_prompt_sha256);
  hash(fingerprint.rendered_input_ids_sha256);
  if (fingerprint.rendered_prompt_utf8_bytes !== utf8(item.renderedPrompt as string).byteLength)
    invalid('rendered prompt byte count differs.');
  const hashes = list(fingerprint.reference_source_sha256, 10);
  if (
    hashes.length !== references.length ||
    hashes.some((value, index) => hash(value) !== (references[index] as EnhancementReference).sha256)
  )
    invalid('reference fingerprints differ from ordered sources.');
  const grids = list(item.processedImageGrid, 10);
  if (grids.length !== references.length) invalid('image grid count differs.');
  let patches = 0;
  for (const grid of grids) {
    const values = list(grid, 3);
    if (values.length !== 3) invalid('invalid image grid.');
    const product = values.reduce<number>((count, value) => count * integer(value, 1, 268435456), 1);
    if (!Number.isSafeInteger(product) || product > 268435456) invalid('image grid exceeds tensor bounds.');
    patches += product;
  }
  if (references.length) {
    hash(fingerprint.processed_pixel_sha256);
    hash(fingerprint.processed_grid_sha256);
    const pixels = list(fingerprint.processed_pixel_shape, 2),
      grid = list(fingerprint.processed_grid_shape, 2);
    if (
      pixels.length !== 2 ||
      grid.length !== 2 ||
      grid[0] !== references.length ||
      grid[1] !== 3 ||
      integer(pixels[0], 1, 268435456) !== patches ||
      patches * integer(pixels[1], 1, 268435456) > 268435456
    )
      invalid('processed tensor shapes differ from the image grids.');
  }
  const imageMode = fingerprint.system_prompt_mode === 'i2i' || fingerprint.system_prompt_mode === 'i2i_bbox';
  if (imageMode !== references.length > 0) invalid('mode differs from the actual image count.');
  jsonBudget(item, 262144);
  return item as EnhancementConsumedInput;
}

/** Match the backend's Decimal(str(coordinate))*1000 without rounding. */
function integerGridCoordinate(value: number) {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient!.split('.');
  const digits = BigInt(whole! + fraction);
  const power = Number(exponent) - fraction.length + 3;
  const denominator = power < 0 ? 10n ** BigInt(-power) : 1n;
  if (digits % denominator !== 0n) invalid('target box does not map exactly to the integer grid.');
  return Number(power < 0 ? digits / denominator : digits * 10n ** BigInt(power));
}

function upstreamBox(box: readonly number[]) {
  return [box[1]!, box[0]!, box[3]!, box[2]!].map(integerGridCoordinate);
}

function targetLayout(value: unknown): LayoutConditioning {
  const parsed = parseLayoutConditioning(value);
  if (!parsed || parsed.regions.length === 0) invalid('expected authored target regions.');
  for (const region of parsed.regions) {
    if (region.targetBox) upstreamBox(region.targetBox);
    if (region.source) upstreamBox(region.source.box);
  }
  return parsed;
}

/** Detect only a bounded, genuine trailing dictionary table, matching the producer. */
function decodeAppendTable(value: string): unknown {
  // Match the producer's duplicate-key decoder without applying summary-envelope
  // entry/key budgets to plain native text embedded inside a JSON string.
  const stack: (Set<string> | null)[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '"') {
      let end = index + 1;
      for (; end < value.length; end++) {
        if (value[end] === '\\') end++;
        else if (value[end] === '"') break;
      }
      const decoded: unknown = JSON.parse(value.slice(index, end + 1));
      let next = end + 1;
      while (next < value.length && /\s/u.test(value[next]!)) next++;
      const keys = stack[stack.length - 1];
      if (keys && value[next] === ':') {
        if (typeof decoded !== 'string' || keys.has(decoded)) throw new Error('Duplicate native table key.');
        keys.add(decoded);
      }
      index = end;
    } else if (character === '{' || character === '[') stack.push(character === '{' ? new Set() : null);
    else if (character === '}' || character === ']') stack.pop();
  }
  return JSON.parse(value);
}

function hasTrailingAppendTable(value: string): boolean {
  // The producer's existing competing-region detector accepts JSON duplicate
  // keys here, then its strict decoder handles other dictionary tables below.
  let attempts = 0;
  for (const match of value.matchAll(/\[\s*\{/gu)) {
    if (attempts++ >= 32) invalid('native details contain too many JSON candidates.');
    let rows: unknown;
    try {
      rows = JSON.parse(value.slice(match.index));
    } catch {
      continue;
    }
    if (
      Array.isArray(rows) &&
      rows.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          !Array.isArray(row) &&
          'id' in row &&
          ['bbox', 'src_bbox', 'tgt_bbox'].some((key) => key in row),
      )
    )
      return true;
  }
  attempts = 0;
  for (let index = 0; index < value.length; index++)
    if (value[index] === '[') {
      if (attempts++ >= 32) invalid('native details contain too many JSON candidates.');
      if (parseTrailingAppendTable(value.slice(index))) return true;
    }
  return false;
}

function parseTrailingAppendTable(value: string): boolean {
  let start: number | null = null,
    stack: string[] = [],
    quoted = false,
    escaped = false,
    attempts = 0;
  const decoded: { end: number; rows: unknown }[] = [];
  const end = value.trimEnd().length;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (start === null) {
      if (character === '[') {
        if (++attempts > 32) return false;
        start = index;
        stack = ['['];
        quoted = false;
        escaped = false;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[' || character === '{') {
      stack.push(character);
      if (stack.length > 8) return false;
    } else if (character === ']' || character === '}') {
      if (!stack.length || (stack[stack.length - 1] === '[' ? character !== ']' : character !== '}')) return false;
      stack.pop();
      if (!stack.length) {
        try {
          decoded.push({ end: index + 1, rows: decodeAppendTable(value.slice(start, index + 1)) });
        } catch {
          if (index + 1 === end) return false;
        }
        start = null;
      }
    }
  }
  if (start !== null || decoded.length !== 1 || decoded[0]!.end !== end) return false;
  const rows = decoded[0]!.rows;
  return (
    Array.isArray(rows) &&
    (!rows.length || rows.some((row) => row !== null && typeof row === 'object' && !Array.isArray(row)))
  );
}

function parseStructured(
  value: unknown,
  mode: PromptEnhancementMode,
  imageCount: number,
): EnhancementStructuredProposal {
  const version = value && typeof value === 'object' ? (value as Record<string, unknown>).schemaVersion : null;
  if (version === 3) {
    const item = object(value, ['schemaVersion', 'kind', 'caption', 'layoutConditioning', 'nativeText']);
    if (item.kind !== 'caption-append-preserve-layout-v1') invalid('unsupported composed proposal.');
    const caption = text(item.caption, 262144, 131072, true);
    const nativeText = text(item.nativeText, 262144, 131072, true);
    if (
      /[<>]/u.test(nativeText) ||
      nativeText.includes('```') ||
      nativeText.includes('~~~') ||
      hasTrailingAppendTable(nativeText)
    )
      invalid('appended wording must be plain text without tags, Markdown fences or a trailing table.');
    const layout = parseLayoutConditioning(item.layoutConditioning);
    if (!layout?.regions.length) invalid('composed wording requires authored regions.');
    const tags = [...caption.matchAll(/<([^<>]*)>/gu)].map((match) => match[1]!);
    if (/[<>]/u.test(caption.replace(/<[^<>]*>/gu, ''))) invalid('authored caption has malformed tags.');
    for (const region of layout.regions) {
      if (tags.filter((tag) => tag === region.id).length !== 1)
        invalid('authored caption must cite each region exactly once.');
      if (region.source && region.source.referenceIndex >= imageCount)
        invalid('authored source differs from actual references.');
    }
    for (const tag of tags) {
      if (layout.regions.some((region) => region.id === tag)) continue;
      const reference = /^ref_image_(0|[1-9][0-9]?)$/u.exec(tag);
      if (!reference || Number(reference[1]) >= imageCount) invalid('authored caption cites an unknown reference.');
    }
    jsonBudget(item, 262144);
    return {
      schemaVersion: 3,
      kind: 'caption-append-preserve-layout-v1',
      caption,
      layoutConditioning: layout,
      nativeText,
    };
  }
  const item = object(value, [
    'schemaVersion',
    'caption',
    'layoutConditioning',
    'rawTable',
    ...(version === 2 ? ['rawCaption'] : []),
  ]);
  if (item.schemaVersion !== 1 && item.schemaVersion !== 2) invalid('unsupported structured proposal.');
  const caption = text(item.caption, 262144, 131072, true);
  const rawCaption = item.schemaVersion === 2 ? text(item.rawCaption, 262144, 131072, true) : caption;
  if (caption.includes('```') || rawCaption.includes('```') || JSON.stringify(item.rawTable).includes('```'))
    invalid('structured output contains a Markdown fence.');
  const layout = targetLayout(item.layoutConditioning);
  if (item.schemaVersion === 1 && layout.regions.some((region) => region.source))
    invalid('source preservation requires a version two native-caption proposal.');
  const rows = list(item.rawTable, 32);
  if (rows.length !== layout.regions.length) invalid('target table differs from layout region count.');
  const seen = new Set<string>(),
    assigned = new Set<string>(),
    mapping = new Map<string, string>();
  const box = (value: unknown) => {
    const result = list(value, 4).map((coordinate) => integer(coordinate, 0, 1000));
    if (result.length !== 4 || result[0]! >= result[2]! || result[1]! >= result[3]!) invalid('invalid table box.');
    return result;
  };
  const signature = (region: LayoutConditioning['regions'][number]) =>
    canonicalBlockStringifyV2([
      region.source?.referenceIndex ?? null,
      region.source ? upstreamBox(region.source.box) : null,
      region.targetBox ? upstreamBox(region.targetBox) : null,
      region.action ?? (region.source ? 'relocate' : 'place'),
    ]);
  for (const raw of rows) {
    const row = object(
      raw,
      mode === 't2i_bbox' ? ['id', 'bbox', 'desc'] : ['id', 'from', 'src_bbox', 'tgt_bbox', 'desc'],
    );
    if (
      typeof row.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(row.id) ||
      /^ref_image_[0-9]+$/u.test(row.id) ||
      seen.has(row.id)
    )
      invalid('duplicate or unknown target row.');
    text(row.desc, 16384, 4096, true);
    seen.add(row.id);
    let expected: unknown[];
    if (mode === 't2i_bbox') expected = [null, null, box(row.bbox), 'place'];
    else {
      const reference = typeof row.from === 'string' ? /^ref_image_(0|[1-9][0-9]?)$/u.exec(row.from) : null;
      const index = reference ? Number(reference[1]) : null;
      if (!(row.from === 'target' && row.src_bbox === null) && !(index !== null && index < imageCount))
        invalid('source table mapping differs from actual supplied images.');
      const source = index === null ? null : box(row.src_bbox);
      const target = row.tgt_bbox === null ? null : box(row.tgt_bbox);
      if (index === null && target === null) invalid('placement requires target geometry.');
      expected = [index, source, target, index === null ? 'place' : target === null ? 'remove' : 'relocate'];
    }
    let candidates = layout.regions.filter((region) => signature(region) === canonicalBlockStringifyV2(expected));
    if (layout.regions.some((region) => region.id === row.id))
      candidates = candidates.filter((region) => region.id === row.id);
    const region = candidates[0];
    if (candidates.length !== 1 || !region || assigned.has(region.id))
      invalid('table has no unambiguous authored-region bijection.');
    if (row.desc !== region.description) invalid('table description differs from layout.');
    assigned.add(region.id);
    mapping.set(row.id, region.id);
  }
  const tags = [...rawCaption.matchAll(/<([^<>]*)>/gu)].map((match) => match[1]!);
  if (/[<>]/u.test(rawCaption.replace(/<[^<>]*>/gu, ''))) invalid('caption has malformed tags.');
  for (const identity of mapping.keys())
    if (tags.filter((tag) => tag === identity).length !== 1) invalid('caption must cite each target exactly once.');
  for (const tag of tags) {
    if (mapping.has(tag)) continue;
    const reference = /^ref_image_(0|[1-9][0-9]?)$/u.exec(tag);
    if (!reference || Number(reference[1]) >= imageCount) invalid('caption cites an unknown reference.');
  }
  if (
    rawCaption.replace(/<([^<>]*)>/gu, (_match, identity: string) => `<${mapping.get(identity) ?? identity}>`) !==
    caption
  )
    invalid('caption does not preserve the exact native-to-authored ID mapping.');
  jsonBudget(item, 262144);
  return {
    schemaVersion: item.schemaVersion,
    caption,
    ...(item.schemaVersion === 2 ? { rawCaption } : {}),
    layoutConditioning: layout,
    rawTable: rows as EnhancementTargetRow[],
  };
}

function parseProposal(value: unknown, consumed: EnhancementConsumedInput, controls: PromptEnhancementControls) {
  const item = object(value, [
    'mode',
    'text',
    'structuredProposal',
    'finishReason',
    'inputTokens',
    'generatedTokens',
    'applyRequired',
    'applicationAllowed',
    'layoutOutputValidated',
    'semanticFidelityVerified',
    'applicationBlockedReason',
  ]);
  if (item.mode !== consumed.fingerprints.system_prompt_mode) invalid('proposal mode differs from consumed input.');
  const mode = item.mode as PromptEnhancementMode;
  const append = consumed.fingerprints.operation === 'enhance_prompt_append_details';
  if (append && mode !== 't2i' && mode !== 'i2i') invalid('append-details requires a plain native prompt mode.');
  const generated = integer(item.generatedTokens, 1, controls.max_new_tokens);
  integer(item.inputTokens, 1, 32768);
  if (item.finishReason !== (generated === controls.max_new_tokens ? 'length' : 'stop'))
    invalid('finish reason differs from token count.');
  if (item.applyRequired !== true || item.semanticFidelityVerified !== false)
    invalid('proposal cannot assert implicit application or semantic fidelity.');
  if (append) {
    if (item.text !== null) invalid('composed public text must remain null.');
    if (item.layoutOutputValidated === true) {
      if (item.applicationAllowed !== true || item.applicationBlockedReason !== null)
        invalid('contradictory composed flags.');
      const structured = parseStructured(item.structuredProposal, mode, consumed.references.length);
      if (structured.schemaVersion !== 3) invalid('append-details requires its composed proposal kind.');
      item.structuredProposal = structured;
    } else {
      if (item.layoutOutputValidated !== false || item.applicationAllowed !== false || item.structuredProposal !== null)
        invalid('contradictory rejected composition flags.');
      text(item.applicationBlockedReason, 16384, 4096, true);
    }
  } else if (mode === 't2i' || mode === 'i2i') {
    text(item.text, 1048576, 262144, true);
    if (
      item.structuredProposal !== null ||
      item.layoutOutputValidated !== null ||
      item.applicationAllowed !== true ||
      item.applicationBlockedReason !== null
    )
      invalid('contradictory plain proposal flags.');
  } else {
    if (item.text !== null) invalid('structured text must remain null.');
    if (item.layoutOutputValidated === true) {
      if (item.applicationAllowed !== true || item.applicationBlockedReason !== null)
        invalid('contradictory valid layout flags.');
      const structured = parseStructured(item.structuredProposal, mode, consumed.references.length);
      if (structured.schemaVersion === 3) invalid('proposal kind differs from the consumed operation.');
      item.structuredProposal = structured;
    } else {
      if (item.layoutOutputValidated !== false || item.applicationAllowed !== false || item.structuredProposal !== null)
        invalid('contradictory invalid layout flags.');
      text(item.applicationBlockedReason, 16384, 4096, true);
    }
  }
  return item as PromptEnhancementSummary['proposal'];
}

export function parsePromptEnhancementSummary(raw: unknown): PromptEnhancementSummary {
  const item = object(rawJson(raw), [
    'schemaVersion',
    'kind',
    'producer',
    'adapter',
    'request',
    'modelReceipt',
    'consumedInput',
    'proposal',
  ]);
  if (item.schemaVersion !== 1 || item.kind !== 'prompt-enhancement-proposal') invalid('unsupported envelope.');
  const adapter = object(item.adapter, ['id', 'declarationSha256']);
  if (typeof adapter.id !== 'string' || !ADAPTER_ID.test(adapter.id)) invalid('invalid adapter ID.');
  hash(adapter.declarationSha256);
  jsonBudget(adapter, 1024);
  const request = object(item.request, [
    'authoredPromptSha256',
    'authoredLayoutKind',
    'authoredLayoutSha256',
    'controls',
    'consumedInputSha256',
  ]);
  hash(request.authoredPromptSha256);
  hash(request.consumedInputSha256);
  if (request.authoredLayoutKind !== 'none' && request.authoredLayoutKind !== 'object')
    invalid('unsupported authored layout representation.');
  if (request.authoredLayoutKind === 'none') {
    if (request.authoredLayoutSha256 !== null) invalid('absent layout has a digest.');
  } else hash(request.authoredLayoutSha256);
  const controls = parseControls(request.controls);
  jsonBudget(request, 4096);
  const consumed = parseConsumed(item.consumedInput, controls, adapter.id);
  return {
    schemaVersion: 1,
    kind: 'prompt-enhancement-proposal',
    producer: parseProducer(item.producer),
    adapter: adapter as PromptEnhancementSummary['adapter'],
    request: request as PromptEnhancementSummary['request'],
    modelReceipt: parseModelReceipt(item.modelReceipt),
    consumedInput: consumed,
    proposal: parseProposal(item.proposal, consumed, controls),
  };
}

/** Expectations must come from independently captured declarations/current state.
 * They are snapshots, not a live store, original terminal-run proof or Apply grant. */
export type ExpectedPromptEnhancementSummary = {
  producer: PromptEnhancementProducer;
  adapter: PromptEnhancementSummary['adapter'];
  modelReceipt: Omit<NativeEnhancementModelReceipt, 'receiptDigest'>;
  authoredPrompt: string;
  authoredLayout: LayoutConditioning | null;
  controls: PromptEnhancementControls;
  systemPromptSha256: string;
  references: EnhancementReference[];
  operation?: EnhancementConsumedInput['fingerprints']['operation'];
  layoutPolicy?: 'preserve-authored-v1' | 'append-details-preserve-layout-v1';
};

async function sha256(value: string): Promise<SummarySha256> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', utf8(value));
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Only the validated closed native receipt subset: no floats or arbitrary keys.
 * Python ensure_ascii=True spells DEL/non-ASCII as UTF-16 escapes. */
function receiptCanonical(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string')
    return JSON.stringify(unicode(value)).replace(
      /[\u007f-\uffff]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
  if (Array.isArray(value)) return `[${value.map(receiptCanonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${receiptCanonical(key)}:${receiptCanonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return invalid('unsupported native receipt value.');
}

/** Copy externally supplied plain data without invoking getters/toJSON. */
function expectedSnapshot(value: unknown, depth = 0, state = { entries: 0, bytes: 0 }): unknown {
  if (++state.entries > 8192 || depth > 16) invalid('expected binding snapshot exceeds limits.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_ENHANCEMENT_SUMMARY_BYTES) invalid('expected binding text exceeds limits.');
    state.bytes += utf8(value).byteLength;
    if (state.bytes > MAX_ENHANCEMENT_SUMMARY_BYTES) invalid('expected binding text exceeds limits.');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') invalid('expected bindings must be plain JSON.');
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (value.length > 8192) invalid('expected binding snapshot exceeds limits.');
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid('expected a dense binding array.');
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      if (!descriptor?.enumerable || !('value' in descriptor)) invalid('expected enumerable data bindings.');
      return expectedSnapshot(descriptor.value, depth + 1, state);
    });
  }
  if (prototype !== Object.prototype && prototype !== null) invalid('expected plain binding objects.');
  const result: Record<string, unknown> = Object.create(null);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32) invalid('expected binding snapshot exceeds limits.');
  for (const key of keys) {
    if (typeof key !== 'string') invalid('symbol binding keys are unsupported.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) invalid('expected enumerable data bindings.');
    expectedSnapshot(key, depth + 1, state);
    result[unicode(key)] = expectedSnapshot(descriptor.value, depth + 1, state);
  }
  return result;
}

function layoutGeometry(value: NonNullable<LayoutConditioning>) {
  return {
    ...value,
    regions: value.regions.map((region) => {
      const copy: Record<string, unknown> = { ...region };
      delete copy.description;
      return copy;
    }),
  };
}

function equal(actual: unknown, expected: unknown, label: string) {
  if (canonicalBlockStringifyV2(actual) !== canonicalBlockStringifyV2(expected))
    invalid(`${label} differs from independently captured state.`);
}

/** Verify consistency against external snapshots. This performs no task lookup,
 * current-document check, fetch, model work, graph edit, scheduling or Apply. */
export async function verifyPromptEnhancementSummaryBindings(
  raw: unknown,
  expectedValue: ExpectedPromptEnhancementSummary,
): Promise<PromptEnhancementSummary> {
  const summary = parsePromptEnhancementSummary(raw);
  const expected = object(
    expectedSnapshot(expectedValue),
    [
      'producer',
      'adapter',
      'modelReceipt',
      'authoredPrompt',
      'authoredLayout',
      'controls',
      'systemPromptSha256',
      'references',
    ],
    ['operation', 'layoutPolicy'],
  );
  const operation = expected.operation ?? 'enhance_prompt';
  if (
    (operation !== 'enhance_prompt' && operation !== 'enhance_prompt_append_details') ||
    (expected.layoutPolicy !== undefined &&
      expected.layoutPolicy !== 'preserve-authored-v1' &&
      expected.layoutPolicy !== 'append-details-preserve-layout-v1') ||
    (operation === 'enhance_prompt_append_details') !== (expected.layoutPolicy === 'append-details-preserve-layout-v1')
  )
    invalid('operation differs from the independently declared layout policy.');
  equal(summary.consumedInput.fingerprints.operation, operation, 'consumed operation');
  equal(summary.producer, parseProducer(expected.producer), 'producer');
  equal(summary.adapter, expected.adapter, 'adapter');
  equal(summary.request.controls, parseControls(expected.controls), 'controls');
  equal(summary.consumedInput.references, expected.references, 'references');
  equal(summary.consumedInput.fingerprints.system_prompt_sha256, expected.systemPromptSha256, 'system prompt');
  const unsignedReceipt = { ...summary.modelReceipt } as Partial<NativeEnhancementModelReceipt>;
  delete unsignedReceipt.receiptDigest;
  equal(unsignedReceipt, expected.modelReceipt, 'native model');
  const receiptBytes = receiptCanonical(summary.modelReceipt);
  if (utf8(receiptBytes).byteLength > 16384) invalid('existing native receipt budget exceeded.');
  if ((await sha256(receiptCanonical(unsignedReceipt))) !== summary.modelReceipt.receiptDigest)
    invalid('native receipt digest differs.');
  const prompt = text(expected.authoredPrompt, 262144, 65536);
  if (prompt.includes('\0')) invalid('authored prompt contains NUL.');
  if ((await sha256(prompt)) !== summary.request.authoredPromptSha256) invalid('authored prompt digest differs.');
  const layout = parseLayoutConditioning(expected.authoredLayout);
  const layoutKind = layout === null ? 'none' : 'object';
  if (summary.request.authoredLayoutKind !== layoutKind) invalid('authored layout representation differs.');
  const layoutDigest =
    layout === null
      ? null
      : await sha256(canonicalBlockStringifyV2({ kind: 'object', value: expected.authoredLayout }));
  if (layoutDigest !== summary.request.authoredLayoutSha256) invalid('authored layout digest differs.');
  const append = operation === 'enhance_prompt_append_details';
  const bbox = summary.proposal.mode.endsWith('_bbox');
  if (append ? bbox || !layout?.regions.length : bbox !== Boolean(layout?.regions.length))
    invalid('mode differs from the independently declared authored layout policy.');
  if (summary.proposal.structuredProposal) {
    const structured = summary.proposal.structuredProposal;
    if (structured.schemaVersion === 3) {
      if (expected.layoutPolicy !== 'append-details-preserve-layout-v1')
        invalid('composed wording has no current policy.');
      equal(structured.caption, prompt + '\n\n' + structured.nativeText, 'exact authored caption composition');
      equal(structured.layoutConditioning, expected.authoredLayout, 'complete authored layout');
    } else {
      targetLayout(layout);
      equal(layoutGeometry(structured.layoutConditioning), layoutGeometry(layout!), 'authored target geometry');
    }
  }
  if ((await sha256(canonicalBlockStringifyV2(summary.consumedInput))) !== summary.request.consumedInputSha256)
    invalid('consumed input digest differs.');
  if (
    (await sha256(summary.consumedInput.renderedPrompt)) !== summary.consumedInput.fingerprints.rendered_prompt_sha256
  )
    invalid('rendered prompt digest differs.');
  return summary;
}
