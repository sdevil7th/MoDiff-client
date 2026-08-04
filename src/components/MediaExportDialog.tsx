import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useSettingsStore } from '../stores/useSettingsStore';
import {
  exportMedia,
  canTranscodeMediaSource,
  loadMediaCapabilities,
  mediaExportFilename,
  savedMediaExportSettings,
  saveMediaExportSettings,
  type MediaCapabilities,
  type MediaExportSettings,
  type MediaFormatDescriptor,
} from '../studio/mediaCapabilities';
import { ModiffButton, ModiffDialog, ModiffFieldShell, ModiffSelect } from '../ui';
import { enqueueSnackbar } from '../ui/snackbar';
import { formatRequestError } from '../utils/requestJson';

const ORIGINAL_FORMAT: MediaFormatDescriptor = {
  value: 'original',
  label: 'Original file',
  extension: '',
  mimeType: 'application/octet-stream',
  preset: 'Original',
};

function defaultFormat(kind: 'audio' | 'image' | 'text' | 'video') {
  if (kind === 'audio') return 'wav';
  if (kind === 'image') return 'png';
  if (kind === 'video') return 'mp4';
  return 'original';
}

export default function MediaExportDialog() {
  const opener = useSettingsStore((state) => state.mediaExportOpener);
  const setOpener = useSettingsStore((state) => state.setMediaExportOpener);
  const [capabilities, setCapabilities] = useState<MediaCapabilities | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('original');
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState(16);
  const [bitrate, setBitrate] = useState(256);
  const [quality, setQuality] = useState(90);
  const [gifFps, setGifFps] = useState(12);
  const [gifWidth, setGifWidth] = useState(640);

  useEffect(() => {
    if (!opener) return;
    const saved = savedMediaExportSettings(opener.kind);
    setFormat(saved.format || opener.defaultFormat || defaultFormat(opener.kind));
    setSampleRate(opener.defaultSampleRate || saved.sampleRate || 48000);
    setBitDepth(saved.bitDepth || 16);
    setBitrate(saved.bitrate || 256);
    setQuality(saved.quality || 90);
    setGifFps(saved.fps || 12);
    setGifWidth(saved.width || 640);
    setError('');
    let alive = true;
    void loadMediaCapabilities()
      .then((value) => {
        if (alive) setCapabilities(value);
      })
      .catch((reason) => {
        if (alive) setError(formatRequestError(reason, 'Media export options could not be loaded.'));
      });
    return () => {
      alive = false;
    };
  }, [opener]);

  const formats = useMemo(
    () =>
      opener && capabilities
        ? [
            ORIGINAL_FORMAT,
            ...(canTranscodeMediaSource(opener.source) ? capabilities.media[opener.kind].exportFormats : []),
          ]
        : [],
    [capabilities, opener],
  );
  const selected =
    formats.find((candidate) => candidate.value === format) ??
    formats.find((candidate) => candidate.value === 'original') ??
    null;

  useEffect(() => {
    if (formats.length === 0 || formats.some((candidate) => candidate.value === format)) return;
    setFormat(formats[0]?.value ?? 'original');
  }, [format, formats]);

  useEffect(() => {
    if (!selected?.sampleRates?.length || selected.sampleRates.includes(sampleRate)) return;
    setSampleRate(selected.sampleRates[0] ?? 48000);
  }, [sampleRate, selected]);

  if (!opener) return null;
  const settings: MediaExportSettings = {
    format: selected?.value ?? 'original',
    sampleRate: opener.kind === 'audio' && selected?.value !== 'original' ? sampleRate : undefined,
    bitDepth: selected?.value === 'wav' ? bitDepth : undefined,
    bitrate: ['mp3', 'm4a', 'aac', 'opus'].includes(selected?.value ?? '') ? bitrate : undefined,
    quality: opener.kind === 'image' && ['jpeg', 'webp', 'avif'].includes(selected?.value ?? '') ? quality : undefined,
    fps: selected?.value === 'gif' ? gifFps : undefined,
    width: selected?.value === 'gif' ? gifWidth : undefined,
  };
  const outputFilename = mediaExportFilename(opener.filename, opener.kind, selected, settings);
  const close = () => {
    if (!loading) setOpener(null);
  };
  const download = async () => {
    if (!selected || loading) return;
    setLoading(true);
    setError('');
    try {
      const downloaded = await exportMedia(opener.source, opener.filename, opener.kind, selected, settings);
      if (!downloaded) return;
      saveMediaExportSettings(opener.kind, settings);
      setOpener(null);
      enqueueSnackbar(`${selected.label} download ready`, { variant: 'success', autoHideDuration: 1800 });
    } catch (reason) {
      setError(formatRequestError(reason, `Could not create the ${selected.label} download.`));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModiffDialog
      open
      onClose={close}
      title={opener.title || `Download ${opener.kind}`}
      testId="media-export-dialog"
      panelClassName="max-w-xl"
      footer={
        <>
          <ModiffButton tone="secondary" disabled={loading} onClick={close}>
            Cancel
          </ModiffButton>
          <ModiffButton tone="primary" disabled={!selected || loading} onClick={() => void download()}>
            <Download size={16} />
            {loading ? 'Preparing…' : 'Download'}
          </ModiffButton>
        </>
      }
    >
      <div className="grid gap-4">
        <ModiffFieldShell label="Format">
          <ModiffSelect
            aria-label="Download format"
            value={selected?.value ?? ''}
            onValueChange={setFormat}
            options={formats.map((descriptor) => ({
              value: descriptor.value,
              label: descriptor.label,
              group: descriptor.preset,
            }))}
            placeholder={capabilities ? 'Select format' : 'Loading formats…'}
            disabled={!capabilities}
          />
        </ModiffFieldShell>

        {opener.kind === 'audio' && selected?.sampleRates && selected.sampleRates.length > 1 ? (
          <ModiffFieldShell label="Sample rate">
            <ModiffSelect
              aria-label="Audio sample rate"
              value={String(sampleRate)}
              onValueChange={(value) => setSampleRate(Number(value))}
              options={selected.sampleRates.map((rate) => ({
                value: String(rate),
                label: `${rate / 1000} kHz`,
              }))}
            />
          </ModiffFieldShell>
        ) : null}

        {selected?.value === 'wav' ? (
          <ModiffFieldShell label="Bit depth">
            <ModiffSelect
              aria-label="WAV bit depth"
              value={String(bitDepth)}
              onValueChange={(value) => setBitDepth(Number(value))}
              options={[
                { value: '16', label: '16-bit PCM' },
                { value: '24', label: '24-bit PCM' },
              ]}
            />
          </ModiffFieldShell>
        ) : null}

        {['mp3', 'm4a', 'aac', 'opus'].includes(selected?.value ?? '') ? (
          <ModiffFieldShell label="Bitrate">
            <ModiffSelect
              aria-label="Audio bitrate"
              value={String(bitrate)}
              onValueChange={(value) => setBitrate(Number(value))}
              options={[128, 192, 256, 320].map((value) => ({
                value: String(value),
                label: `${value} kbps`,
              }))}
            />
          </ModiffFieldShell>
        ) : null}

        {opener.kind === 'image' && ['jpeg', 'webp', 'avif'].includes(selected?.value ?? '') ? (
          <ModiffFieldShell label="Quality">
            <ModiffSelect
              aria-label="Image export quality"
              value={String(quality)}
              onValueChange={(value) => setQuality(Number(value))}
              options={[
                { value: '100', label: 'Maximum · 100' },
                { value: '90', label: 'High · 90' },
                { value: '80', label: 'Balanced · 80' },
                { value: '65', label: 'Small · 65' },
              ]}
            />
          </ModiffFieldShell>
        ) : null}

        {selected?.value === 'gif' ? (
          <div className="grid grid-cols-2 gap-3">
            <ModiffFieldShell label="Frame rate">
              <ModiffSelect
                aria-label="GIF frame rate"
                value={String(gifFps)}
                onValueChange={(value) => setGifFps(Number(value))}
                options={[8, 12, 16, 24].map((value) => ({ value: String(value), label: `${value} fps` }))}
              />
            </ModiffFieldShell>
            <ModiffFieldShell label="Width">
              <ModiffSelect
                aria-label="GIF width"
                value={String(gifWidth)}
                onValueChange={(value) => setGifWidth(Number(value))}
                options={[480, 640, 960, 1280].map((value) => ({ value: String(value), label: `${value} px` }))}
              />
            </ModiffFieldShell>
          </div>
        ) : null}

        <div className="rounded-modiff-compact border border-modiff-border bg-modiff-bg px-3 py-2 text-modiff-metadata text-modiff-subtle-text">
          {outputFilename}
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-modiff-compact border border-modiff-invalid bg-modiff-invalid/10 px-3 py-2 text-sm text-modiff-invalid"
          >
            {error}
          </div>
        ) : null}
      </div>
    </ModiffDialog>
  );
}
