import { CheckCircle2, Clock3, Image as ImageIcon, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { useFlowStore } from '../stores/useFlowStore';
import type { NodeParams } from '../stores/useNodeStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { graphImageSources } from '../studio/imageComparison';
import { GraphControlButton } from '../ui/GraphControls';
import { cx } from '../utils/classNames';

type EncodeSummary = {
  schemaVersion: 1;
  status: 'encoded';
  elapsedSeconds?: number;
  shape?: number[];
  dtype?: string;
  device?: string;
};

function parseEncodeSummary(value: unknown): EncodeSummary | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    const record = candidate as Record<string, unknown>;
    if (record.schemaVersion !== 1 || record.status !== 'encoded') return null;
    if (
      record.elapsedSeconds !== undefined &&
      (typeof record.elapsedSeconds !== 'number' ||
        !Number.isFinite(record.elapsedSeconds) ||
        record.elapsedSeconds < 0)
    ) {
      return null;
    }
    if (
      record.shape !== undefined &&
      (!Array.isArray(record.shape) ||
        record.shape.some(
          (dimension) => typeof dimension !== 'number' || !Number.isInteger(dimension) || dimension < 0,
        ))
    ) {
      return null;
    }
    if (record.dtype !== undefined && typeof record.dtype !== 'string') return null;
    if (record.device !== undefined && typeof record.device !== 'string') return null;
    return {
      schemaVersion: 1,
      status: 'encoded',
      elapsedSeconds: record.elapsedSeconds as number | undefined,
      shape: record.shape as number[] | undefined,
      dtype: record.dtype as string | undefined,
      device: record.device as string | undefined,
    };
  }
  if (typeof candidate !== 'string') return null;
  try {
    return parseEncodeSummary(JSON.parse(candidate));
  } catch {
    return null;
  }
}

export function EncodeImageSummary({
  nodeId,
  params,
  executionStatus,
  progressMessage,
}: {
  nodeId: string;
  params: Record<string, NodeParams>;
  executionStatus?: string;
  progressMessage?: string;
}) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const setLightboxOpener = useSettingsStore((state) => state.setLightboxOpener);
  const source = useMemo(
    () => graphImageSources(nodes, edges, nodeId).find((candidate) => candidate.url) ?? null,
    [edges, nodeId, nodes],
  );
  const summary = parseEncodeSummary(params.encode_summary?.value ?? params.encode_summary_data?.value);
  const failed = executionStatus === 'failed';
  const running = executionStatus === 'running';
  const cached = executionStatus === 'cached';
  const status = failed ? 'Failed' : running ? 'Encoding' : cached ? 'Cached' : summary ? 'Encoded' : 'Waiting';
  const description = failed
    ? progressMessage || 'Image encoding failed'
    : running
      ? progressMessage || 'Encoding the connected image into latents'
      : cached
        ? 'Reusing compatible cached image latents'
        : summary
          ? 'Image latents are ready'
          : source
            ? 'Ready to encode the connected input'
            : 'Connect an input image to encode';

  return (
    <section
      aria-label="Encode image status"
      className="mb-2 grid gap-2 rounded-modiff-compact border border-modiff-border-subtle bg-modiff-bg p-2"
      data-testid={`encode-image-summary-${nodeId}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {source?.url ? (
          <GraphControlButton
            type="button"
            className="relative size-14 shrink-0 overflow-hidden rounded-modiff-compact border border-modiff-border bg-modiff-surface p-0 focus-visible:ring-2 focus-visible:ring-modiff-focus"
            aria-label="Open input image full-resolution preview"
            onClick={() =>
              setLightboxOpener({
                images: [source.url as string],
                currentIndex: 0,
                dataType: 'url',
                mimeType: 'image/webp',
              })
            }
          >
            <img src={source.url} alt="Input" className="h-full w-full object-cover modiff-generated-image" />
            <span className="absolute bottom-0 left-0 bg-modiff-panel px-1 text-modiff-label font-semibold text-modiff-text">
              Input
            </span>
          </GraphControlButton>
        ) : (
          <div className="grid size-14 shrink-0 place-items-center rounded-modiff-compact border border-dashed border-modiff-border bg-modiff-surface text-modiff-subtle-text">
            <ImageIcon size={18} aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cx(
              'flex items-center gap-1.5 text-xs font-semibold',
              failed ? 'text-modiff-invalid' : running ? 'text-hf-yellow' : 'text-modiff-text',
            )}
          >
            {failed ? (
              <TriangleAlert size={13} aria-hidden="true" />
            ) : running ? (
              <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />
            ) : summary || cached ? (
              <CheckCircle2 size={13} className="text-modiff-green" aria-hidden="true" />
            ) : (
              <Clock3 size={13} aria-hidden="true" />
            )}
            {status}
          </div>
          <p className="mt-1 line-clamp-2 text-modiff-metadata text-modiff-subtle-text" title={description}>
            {description}
          </p>
        </div>
      </div>
      {summary ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-modiff-border-subtle pt-2 text-modiff-metadata">
          <div className="flex min-w-0 justify-between gap-2">
            <dt className="text-modiff-subtle-text">Latents</dt>
            <dd className="truncate font-mono text-modiff-text">
              {summary.shape?.length ? summary.shape.join('×') : 'Ready'}
            </dd>
          </div>
          <div className="flex min-w-0 justify-between gap-2">
            <dt className="text-modiff-subtle-text">Time</dt>
            <dd className="font-mono text-modiff-text">
              {typeof summary.elapsedSeconds === 'number' ? `${summary.elapsedSeconds.toFixed(2)}s` : '—'}
            </dd>
          </div>
          <div className="flex min-w-0 justify-between gap-2">
            <dt className="text-modiff-subtle-text">Dtype</dt>
            <dd className="truncate font-mono text-modiff-text">{summary.dtype || '—'}</dd>
          </div>
          <div className="flex min-w-0 justify-between gap-2">
            <dt className="text-modiff-subtle-text">Device</dt>
            <dd className="truncate font-mono text-modiff-text">{summary.device || '—'}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
