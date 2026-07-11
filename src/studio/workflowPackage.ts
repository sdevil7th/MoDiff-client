import type {
  StudioFormState,
  StudioGraphBinding,
  StudioGraphSnapshot,
  StudioOutput,
  StudioTemplateId,
  WorkflowTabSnapshot,
} from './types';
import {
  coerceStudioFormState,
  coerceStudioGraphBinding,
  coerceStudioGraphSnapshot,
  coerceStudioOutput,
  coerceStudioTemplateId,
  isRecord,
  safeCloneJson,
} from './outputContracts';
import { requestArrayBuffer } from '../utils/requestJson';

export const MODIFF_PNG_METADATA_KEY = 'modiff.workflow';

export type ModiffWorkflowPackage = {
  manifest: {
    schemaVersion: 1;
    exportedAt: string;
    packageType: 'modiff-workflow-share' | 'modiff-output-package';
    media: {
      url: string;
      displayType?: StudioOutput['displayType'];
      backendImagePath?: string;
      backendMediaPath?: string;
      mediaHash?: string;
      mediaCollectionHash?: string;
      mediaItems?: StudioOutput['mediaItems'];
    } | null;
    template: {
      templateId?: StudioTemplateId;
      templateLabel?: string;
      templateLockHash?: string;
      promptSettingsHash?: string;
      exactTemplateCompatible?: boolean;
    } | null;
    provenance: {
      frontend: StudioOutput['provenance'] | null;
      backend: StudioOutput['backendProvenance'] | null;
    } | null;
  };
  metadata: {
    exportedAt: string;
    studio: StudioFormState;
    preview: string | null;
  };
  graph: unknown;
  apiGraph: unknown;
  latestOutput: StudioOutput | null;
  restore: {
    formSnapshot: StudioFormState;
    graphSnapshot?: StudioGraphSnapshot;
    graphBindingSnapshot?: StudioGraphBinding | null;
    apiGraphSnapshot?: unknown;
  } | null;
};

export type ParsedWorkflowPackage = {
  packageData: unknown;
  output?: StudioOutput;
  snapshot: WorkflowTabSnapshot;
  title: string;
  sourceLabel: string;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
let crcTable: Uint32Array | null = null;

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

export function buildWorkflowPackage({
  apiGraph,
  form,
  graph,
  latestOutput = null,
  packageType = 'modiff-workflow-share',
}: {
  apiGraph?: unknown;
  form: StudioFormState;
  graph: unknown;
  latestOutput?: StudioOutput | null;
  packageType?: ModiffWorkflowPackage['manifest']['packageType'];
}): ModiffWorkflowPackage {
  const exportedAt = new Date().toISOString();
  return {
    manifest: {
      schemaVersion: 1,
      exportedAt,
      packageType,
      media: latestOutput
        ? {
            url: latestOutput.url,
            displayType: latestOutput.displayType,
            backendImagePath: latestOutput.backendImagePath,
            backendMediaPath: latestOutput.backendMediaPath,
            mediaHash: latestOutput.mediaHash,
            mediaCollectionHash: latestOutput.mediaCollectionHash,
            mediaItems: latestOutput.mediaItems,
          }
        : null,
      template: latestOutput
        ? {
            templateId: latestOutput.templateId,
            templateLabel: latestOutput.templateLabel,
            templateLockHash: latestOutput.templateLockHash,
            promptSettingsHash: latestOutput.promptSettingsHash,
            exactTemplateCompatible: latestOutput.exactTemplateCompatible,
          }
        : null,
      provenance: latestOutput
        ? {
            frontend: latestOutput.provenance ?? null,
            backend: latestOutput.backendProvenance ?? null,
          }
        : null,
    },
    metadata: {
      exportedAt,
      studio: safeCloneJson(latestOutput?.formSnapshot ?? form) as StudioFormState,
      preview: latestOutput?.url ?? null,
    },
    graph: safeCloneJson(graph),
    apiGraph: safeCloneJson(apiGraph ?? null),
    latestOutput: latestOutput ? (safeCloneJson(latestOutput) as StudioOutput) : null,
    restore: latestOutput
      ? {
          formSnapshot: safeCloneJson(latestOutput.formSnapshot) as StudioFormState,
          graphSnapshot: latestOutput.graphSnapshot
            ? (safeCloneJson(latestOutput.graphSnapshot) as StudioGraphSnapshot)
            : undefined,
          graphBindingSnapshot: latestOutput.graphBindingSnapshot
            ? (safeCloneJson(latestOutput.graphBindingSnapshot) as StudioGraphBinding)
            : null,
          apiGraphSnapshot: safeCloneJson(latestOutput.apiGraphSnapshot ?? null),
        }
      : null,
  };
}

export function buildOutputWorkflowPackage(output: StudioOutput): ModiffWorkflowPackage {
  return buildWorkflowPackage({
    form: output.formSnapshot,
    graph: output.graphSnapshot ?? { nodes: [], edges: [], viewport: undefined },
    apiGraph: output.apiGraphSnapshot ?? null,
    latestOutput: output,
    packageType: 'modiff-output-package',
  });
}

function getNestedRecord(root: Record<string, unknown>, key: string) {
  return isRecord(root[key]) ? root[key] : {};
}

function titleForImportedPackage(output: StudioOutput | undefined, form: StudioFormState) {
  if (output?.templateLabel) return output.templateLabel;
  const prompt = output?.prompt || form.prompt;
  return prompt ? prompt.slice(0, 28) : 'Imported workflow';
}

export function parseWorkflowPackage(value: unknown): ParsedWorkflowPackage | null {
  if (!isRecord(value)) return null;

  const output =
    coerceStudioOutput(value.latestOutput) ?? coerceStudioOutput(value.output) ?? coerceStudioOutput(value);
  const metadata = getNestedRecord(value, 'metadata');
  const manifest = getNestedRecord(value, 'manifest');
  const manifestTemplate = getNestedRecord(manifest, 'template');
  const restore = getNestedRecord(value, 'restore');
  const fallbackGraph = isRecord(value.graph) ? value.graph : undefined;

  const form = output?.formSnapshot ?? coerceStudioFormState(restore.formSnapshot ?? metadata.studio);
  const graphSnapshot = output?.graphSnapshot ??
    coerceStudioGraphSnapshot(restore.graphSnapshot) ??
    coerceStudioGraphSnapshot(fallbackGraph) ?? { nodes: [], edges: [], viewport: undefined };
  const graphBinding = output?.graphBindingSnapshot ?? coerceStudioGraphBinding(restore.graphBindingSnapshot);
  const activeTemplateId =
    output?.templateId ??
    coerceStudioTemplateId(restore.activeTemplateId) ??
    coerceStudioTemplateId(manifestTemplate.templateId) ??
    null;

  const snapshot: WorkflowTabSnapshot = {
    nodes: graphSnapshot.nodes,
    edges: graphSnapshot.edges,
    viewport: graphSnapshot.viewport,
    studioForm: form,
    studioGraphBinding: graphBinding,
    selectedMode: output?.mode ?? form.mode,
    activeTemplateId,
    sourceOutputId: output?.sourceOutputId ?? output?.parentId ?? null,
  };

  if (!output && snapshot.nodes.length === 0 && !isRecord(value.restore) && !isRecord(value.graph)) {
    return null;
  }

  return {
    packageData: value,
    output,
    snapshot,
    title: titleForImportedPackage(output, form),
    sourceLabel: output?.id ?? String(metadata.exportedAt ?? manifest.exportedAt ?? 'workflow-package'),
  };
}

function assertPng(bytes: Uint8Array) {
  const valid = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!valid) throw new Error('Expected a PNG image for embedded workflow metadata.');
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset + 3 >= bytes.length) throw new Error('PNG chunk extends past the image boundary.');
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(bytes: Uint8Array) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  bytes.forEach((byte) => {
    crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

function base64EncodeUtf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64DecodeUtf8(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function makeTextChunk(keyword: string, text: string) {
  const encoder = new TextEncoder();
  const keywordBytes = encoder.encode(keyword);
  const textBytes = encoder.encode(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);

  const type = encoder.encode('tEXt');
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(type.length + data.length);
  crcInput.set(type, 0);
  crcInput.set(data, type.length);
  writeUint32(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function findIendOffset(bytes: Uint8Array) {
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IEND') return offset;
    offset += length + 12;
  }
  throw new Error('PNG is missing an IEND chunk.');
}

export function embedWorkflowPackageInPngBytes(bytes: Uint8Array, packageData: unknown) {
  assertPng(bytes);
  const textChunk = makeTextChunk(MODIFF_PNG_METADATA_KEY, base64EncodeUtf8(JSON.stringify(packageData)));
  const insertAt = findIendOffset(bytes);
  const next = new Uint8Array(bytes.length + textChunk.length);
  next.set(bytes.slice(0, insertAt), 0);
  next.set(textChunk, insertAt);
  next.set(bytes.slice(insertAt), insertAt + textChunk.length);
  return next;
}

export async function createPngWithWorkflowMetadata(sourceUrl: string, packageData: unknown) {
  const bytes = new Uint8Array(await requestArrayBuffer(sourceUrl));
  const png = embedWorkflowPackageInPngBytes(bytes, packageData);
  return new Blob([png], { type: 'image/png' });
}

export function extractWorkflowPackageFromPngBytes(bytes: Uint8Array) {
  assertPng(bytes);
  const decoder = new TextDecoder();
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === 'tEXt') {
      const data = bytes.slice(dataStart, dataEnd);
      const separator = data.indexOf(0);
      if (separator > 0) {
        const keyword = decoder.decode(data.slice(0, separator));
        if (keyword === MODIFF_PNG_METADATA_KEY) {
          const payload = decoder.decode(data.slice(separator + 1));
          return JSON.parse(base64DecodeUtf8(payload)) as unknown;
        }
      }
    }
    offset = dataEnd + 4;
  }
  return null;
}

export async function readWorkflowPackageFile(file: File) {
  if (file.type === 'application/json' || file.name.toLowerCase().endsWith('.json')) {
    return parseWorkflowPackage(JSON.parse(await file.text()));
  }

  if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
    const payload = extractWorkflowPackageFromPngBytes(new Uint8Array(await file.arrayBuffer()));
    return payload ? parseWorkflowPackage(payload) : null;
  }

  throw new Error('Import a MoDiff workflow JSON package or PNG with embedded workflow metadata.');
}

export async function downloadPngWithWorkflowMetadata(filename: string, sourceUrl: string, packageData: unknown) {
  const png = await createPngWithWorkflowMetadata(sourceUrl, packageData);
  downloadBlob(filename, png);
}
