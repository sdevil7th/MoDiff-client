import { useMemo, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  ArrowLeftRight,
  Copy,
  Download,
  GitBranch,
  Grid2X2,
  Heart,
  Info,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useStudioStore } from '../stores/useStudioStore';
import { useWebsocketStore } from '../stores/useWebsocketStore';
import { STUDIO_MODE_LABELS } from '../studio/modelProfiles';
import { validateCurrentRun } from '../studio/runReadiness';
import { coordinateGraphRun } from '../studio/runCoordinator';
import { ensureStudioAutoPlanReadyForRun } from '../studio/useStudioRunActions';
import type { StudioImportedAsset, StudioModelType, StudioOutput } from '../studio/types';
import {
  buildOutputWorkflowPackage,
  downloadJson,
  downloadPngWithWorkflowMetadata,
  readWorkflowPackageFile,
} from '../studio/workflowPackage';
import { ImageFrame, ModiffButton } from '../ui';
import { cx } from '../utils/classNames';

type FilterId = 'all' | 'favorites' | StudioModelType;
type GalleryView = 'grid' | 'inspect' | 'compare' | 'lineage';
type GalleryAssetKind = 'generated' | 'imported';

function copyMetadata(output: StudioOutput) {
  void navigator.clipboard.writeText(JSON.stringify(output, null, 2));
  enqueueSnackbar('Metadata copied', { variant: 'success', autoHideDuration: 1800 });
}

function downloadImage(output: StudioOutput) {
  const anchor = document.createElement('a');
  anchor.href = output.url;
  anchor.download = `modiff-${output.modelType}-${output.id}${isAudioOutput(output) ? '.wav' : isVideoOutput(output) ? '.mp4' : '.png'}`;
  anchor.click();
}

function downloadOutputPackage(output: StudioOutput) {
  downloadJson(`modiff-${output.modelType}-${output.id}-workflow.json`, buildOutputWorkflowPackage(output));
}

async function downloadOutputPngPackage(output: StudioOutput) {
  await downloadPngWithWorkflowMetadata(
    `modiff-${output.modelType}-${output.id}-workflow.png`,
    output.url,
    buildOutputWorkflowPackage(output),
  );
}

function outputSubtitle(output: StudioOutput) {
  const template = output.templateLabel ? ` | ${output.templateLabel}` : '';
  const audioDuration =
    output.mediaItems?.find((item) => item.durationSeconds)?.durationSeconds ?? output.formSnapshot.audioDuration;
  const media = isAudioOutput(output)
    ? ` | ${audioDuration ? `${audioDuration.toFixed(1)} sec` : 'audio'}`
    : isVideoOutput(output)
      ? ` | ${output.width}x${output.height} | ${output.formSnapshot.numFrames} frames | ${output.formSnapshot.fps}fps`
      : ` | ${output.width}x${output.height}`;
  return `${output.modelLabel}${template} | ${STUDIO_MODE_LABELS[output.mode]}${media} | Seed ${output.seed}`;
}

function isAudioOutput(output: StudioOutput) {
  return output.displayType === 'audio' || /\.(wav|mp3|flac|ogg|m4a|aac)(\?.*)?$/i.test(output.url);
}

function isVideoOutput(output: StudioOutput) {
  return output.displayType === 'video' || /\.(mp4|webm|mov|mkv|m4v)(\?.*)?$/i.test(output.url);
}

function GalleryMedia({
  output,
  aspectRatio,
  maxHeight,
  onImageClick,
}: {
  output: StudioOutput;
  aspectRatio?: string;
  maxHeight?: number;
  onImageClick?: () => void;
}) {
  if (isAudioOutput(output)) {
    return (
      <div
        className={cx(
          'grid min-h-24 w-full place-items-center border border-modiff-border bg-modiff-surface p-3',
          aspectRatio === '1 / 1' && 'aspect-square',
        )}
      >
        <audio src={output.url} controls className="w-full" />
      </div>
    );
  }

  if (isVideoOutput(output)) {
    return (
      <div className={cx('border border-transparent bg-modiff-surface', aspectRatio === '1 / 1' && 'aspect-square')}>
        <video
          src={output.url}
          controls
          className={cx('block h-full w-full bg-black object-contain', maxHeight ? 'max-h-[460px]' : false)}
        />
      </div>
    );
  }

  if (output.mediaItems && output.mediaItems.length > 1 && output.displayType === 'image_collection') {
    return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-1 bg-modiff-surface">
        {output.mediaItems.slice(0, 12).map((item) => (
          <ImageFrame
            key={`${item.index}-${item.url}`}
            src={item.url}
            alt={item.label || `${output.id} item ${item.index + 1}`}
            onClick={onImageClick}
            aspectRatio={aspectRatio ?? '1 / 1'}
            maxHeight={maxHeight}
            bordered={false}
          />
        ))}
      </div>
    );
  }

  return (
    <ImageFrame
      src={output.url}
      alt={output.prompt || output.id}
      onClick={onImageClick}
      aspectRatio={aspectRatio}
      maxHeight={maxHeight}
      bordered={false}
    />
  );
}

export default function OutputGalleryPanel({ modalView = false }: { modalView?: boolean }) {
  const [assetKind, setAssetKind] = useState<GalleryAssetKind>('generated');
  const [filter, setFilter] = useState<FilterId>('all');
  const [view, setView] = useState<GalleryView>('grid');
  const [selectedOutputIds, setSelectedOutputIds] = useState<string[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const outputs = useStudioStore((state) => state.outputs);
  const importedAssets = useStudioStore((state) => state.importedAssets);
  const galleryBackendStatus = useStudioStore((state) => state.galleryBackendStatus);
  const galleryBackendError = useStudioStore((state) => state.galleryBackendError);
  const fetchBackendOutputs = useStudioStore((state) => state.fetchBackendOutputs);
  const toggleFavoriteOutput = useStudioStore((state) => state.toggleFavoriteOutput);
  const deleteOutput = useStudioStore((state) => state.deleteOutput);
  const deleteImportedAsset = useStudioStore((state) => state.deleteImportedAsset);
  const sendOutputToReference = useStudioStore((state) => state.useOutputAsReference);
  const sendImportedAssetToReference = useStudioStore((state) => state.useImportedAssetAsReference);
  const restoreWorkflowFromOutput = useStudioStore((state) => state.restoreWorkflowFromOutput);
  const createWorkflowTab = useStudioStore((state) => state.createWorkflowTab);
  const setRightPanelOpen = useSettingsStore((state) => state.setRightPanelOpen);
  const setRightPanelTab = useSettingsStore((state) => state.setRightPanelTab);
  const setGalleryLibraryOpen = useSettingsStore((state) => state.setGalleryLibraryOpen);
  const setLightboxOpener = useSettingsStore((state) => state.setLightboxOpener);
  const sid = useWebsocketStore((state) => state.sid);
  const isConnected = useWebsocketStore((state) => state.isConnected);

  const modelFilters = useMemo(() => {
    const byModel = new Map<StudioModelType, string>();
    outputs.forEach((output) => byModel.set(output.modelType, output.modelLabel));
    return Array.from(byModel.entries());
  }, [outputs]);

  const filteredOutputs = useMemo(() => {
    if (filter === 'favorites') return outputs.filter((output) => output.favorite);
    if (filter === 'all') return outputs;
    return outputs.filter((output) => output.modelType === filter);
  }, [filter, outputs]);
  const selectedOutputs = useMemo(() => {
    const selected = selectedOutputIds
      .map((id) => filteredOutputs.find((output) => output.id === id))
      .filter((output): output is StudioOutput => Boolean(output));
    return selected.length > 0 ? selected : filteredOutputs.slice(0, 2);
  }, [filteredOutputs, selectedOutputIds]);
  const inspectedOutput = selectedOutputs[0] ?? filteredOutputs[0];
  const compareLeft = selectedOutputs[0];
  const compareRight = selectedOutputs[1];

  const selectForCompare = (output: StudioOutput) => {
    setSelectedOutputIds((current) => {
      if (current.includes(output.id)) return current.filter((id) => id !== output.id);
      return [output.id, ...current].slice(0, 2);
    });
  };

  const handleRestore = (output: StudioOutput) => {
    restoreWorkflowFromOutput(output);
    setRightPanelTab('studio');
    setGalleryLibraryOpen(false);
    enqueueSnackbar('Workflow restored from gallery item', { variant: 'success', autoHideDuration: 2200 });
  };

  const handleImportWorkflowFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await readWorkflowPackageFile(file);
      if (!imported) throw new Error('No MoDiff workflow metadata was found in that file.');
      createWorkflowTab(imported.title, imported.snapshot, 'import', imported.sourceLabel);
      setRightPanelTab('studio');
      setGalleryLibraryOpen(false);
      enqueueSnackbar('Workflow package imported', { variant: 'success', autoHideDuration: 2200 });
      window.setTimeout(() => validateCurrentRun({ sid, isConnected, includeStudio: true, showDialog: true }), 0);
    } catch (error) {
      enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6000 });
    }
  };

  const importButton = (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json,image/png,.png"
        className="sr-only"
        data-testid="gallery-import-workflow-input"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void handleImportWorkflowFile(file);
        }}
      />
      <GalleryIconButton
        title="Import workflow package"
        data-testid="gallery-import-workflow"
        onClick={() => importInputRef.current?.click()}
      >
        <Upload size={15} />
      </GalleryIconButton>
    </>
  );

  const handleRerun = async (output: StudioOutput) => {
    if (!sid || !isConnected) {
      enqueueSnackbar('Connect to the MoDiff server before rerunning.', { variant: 'error', autoHideDuration: 4000 });
      return;
    }

    restoreWorkflowFromOutput(output);
    const autoReady = await ensureStudioAutoPlanReadyForRun();
    if (!autoReady) return;
    await coordinateGraphRun({ sid, studioContext: {} });
    setGalleryLibraryOpen(false);
    setRightPanelOpen(true);
    setRightPanelTab('queue');
  };

  const galleryStatusLabel =
    galleryBackendStatus === 'idle'
      ? 'Backend history'
      : galleryBackendStatus === 'syncing'
        ? 'Syncing history'
        : galleryBackendStatus === 'loading'
          ? 'Loading history'
          : 'History offline';
  const activeAssetKind: GalleryAssetKind =
    assetKind === 'generated' && outputs.length === 0 && importedAssets.length > 0 ? 'imported' : assetKind;

  if (outputs.length === 0 && importedAssets.length === 0) {
    return (
      <section className={cx('p-3', modalView && 'min-h-[520px]')} data-testid="gallery-panel">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-bold text-modiff-text">Gallery</h2>
          <GalleryPill
            active={galleryBackendStatus !== 'error'}
            error={galleryBackendStatus === 'error'}
            data-testid="gallery-backend-status"
          >
            {galleryStatusLabel}
          </GalleryPill>
          <GalleryIconButton
            title="Refresh history"
            data-testid="gallery-refresh-history"
            onClick={() => {
              void fetchBackendOutputs();
            }}
          >
            <RefreshCw size={15} />
          </GalleryIconButton>
          {importButton}
        </div>
        <p className="text-xs text-gray-400">Generated and imported media appear here.</p>
        {galleryBackendError && <p className="mt-1 text-xs text-modiff-red">{galleryBackendError}</p>}
      </section>
    );
  }

  return (
    <section className={cx('p-3', modalView && 'min-h-[520px]')} data-testid="gallery-panel">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <GalleryPill
          active={galleryBackendStatus !== 'error'}
          error={galleryBackendStatus === 'error'}
          data-testid="gallery-backend-status"
        >
          {galleryStatusLabel}
        </GalleryPill>
        <GalleryIconButton
          title="Refresh history"
          data-testid="gallery-refresh-history"
          onClick={() => {
            void fetchBackendOutputs();
          }}
        >
          <RefreshCw size={15} />
        </GalleryIconButton>
        {importButton}
        <GalleryPill
          active={activeAssetKind === 'generated'}
          onClick={() => setAssetKind('generated')}
          data-testid="gallery-kind-generated"
        >
          Generated {outputs.length}
        </GalleryPill>
        <GalleryPill
          active={activeAssetKind === 'imported'}
          onClick={() => setAssetKind('imported')}
          data-testid="gallery-kind-imported"
        >
          Imported {importedAssets.length}
        </GalleryPill>
        {activeAssetKind === 'generated' ? (
          <>
            <GalleryPill active={filter === 'all'} onClick={() => setFilter('all')} data-testid="gallery-filter-all">
              All
            </GalleryPill>
            <GalleryPill
              active={filter === 'favorites'}
              onClick={() => setFilter('favorites')}
              data-testid="gallery-filter-favorites"
            >
              Favorites
            </GalleryPill>
            {modelFilters.map(([modelType, label]) => (
              <GalleryPill
                key={modelType}
                active={filter === modelType}
                onClick={() => setFilter(modelType)}
                data-testid={`gallery-filter-${modelType}`}
              >
                {label}
              </GalleryPill>
            ))}
          </>
        ) : null}
      </div>
      {activeAssetKind === 'generated' ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <GalleryPill
            active={view === 'grid'}
            onClick={() => setView('grid')}
            data-testid="gallery-view-grid"
            icon={<Grid2X2 size={14} />}
          >
            Grid
          </GalleryPill>
          <GalleryPill
            active={view === 'inspect'}
            onClick={() => setView('inspect')}
            data-testid="gallery-view-inspect"
            icon={<Info size={14} />}
          >
            Inspect
          </GalleryPill>
          <GalleryPill
            active={view === 'compare'}
            onClick={() => setView('compare')}
            data-testid="gallery-view-compare"
            icon={<ArrowLeftRight size={14} />}
          >
            Compare
          </GalleryPill>
          <GalleryPill
            active={view === 'lineage'}
            onClick={() => setView('lineage')}
            data-testid="gallery-view-lineage"
            icon={<GitBranch size={14} />}
          >
            Lineage
          </GalleryPill>
        </div>
      ) : null}
      {galleryBackendError && <p className="mb-2 text-xs text-modiff-red">{galleryBackendError}</p>}

      {activeAssetKind === 'imported' ? (
        <ImportedAssetGrid
          assets={importedAssets}
          onDelete={deleteImportedAsset}
          onUse={(asset) => {
            sendImportedAssetToReference(asset);
            setRightPanelTab('studio');
            setGalleryLibraryOpen(false);
          }}
        />
      ) : filteredOutputs.length === 0 ? (
        <p className="text-xs text-gray-400">No gallery items match this filter.</p>
      ) : view === 'inspect' && inspectedOutput ? (
        <GalleryInspect output={inspectedOutput} />
      ) : view === 'compare' ? (
        <div data-testid="gallery-compare-view" className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedOutputs.slice(0, 2).map((output) => (
              <GalleryCompareCard key={`compare-${output.id}`} output={output} />
            ))}
          </div>
          {compareLeft && compareRight && <GallerySettingsDiff left={compareLeft} right={compareRight} />}
        </div>
      ) : view === 'lineage' ? (
        <div data-testid="gallery-lineage-view" className="grid gap-2">
          {outputs.slice(0, 24).map((output) => (
            <LineageButton
              key={`lineage-full-${output.id}`}
              output={output}
              onClick={() => {
                setSelectedOutputIds([output.id]);
                setView('inspect');
              }}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {filteredOutputs.map((output, index) => {
            const previous = filteredOutputs[index + 1];
            const selected = selectedOutputIds.includes(output.id);
            return (
              <article
                key={output.id}
                data-testid={`gallery-output-${index}`}
                className={cx('border bg-modiff-surface', selected ? 'border-hf-yellow' : 'border-modiff-border')}
              >
                <GalleryMedia
                  output={output}
                  maxHeight={420}
                  onImageClick={() => {
                    setSelectedOutputIds([output.id]);
                    setView('inspect');
                  }}
                />
                <div className="p-2">
                  <GalleryMeta output={output} />
                  <p className="mt-1 max-h-10 overflow-hidden text-sm text-modiff-text">
                    {output.prompt || 'No prompt recorded'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <GalleryIconButton
                      title={
                        isAudioOutput(output)
                          ? 'Inspect audio'
                          : isVideoOutput(output)
                            ? 'Inspect video'
                            : 'Open full size'
                      }
                      data-testid={`gallery-open-${index}`}
                      onClick={() => {
                        if (isVideoOutput(output) || isAudioOutput(output)) {
                          setSelectedOutputIds([output.id]);
                          setView('inspect');
                        } else {
                          setLightboxOpener({
                            images: [output.url],
                            currentIndex: 0,
                            dataType: 'image',
                            mimeType: null,
                          });
                        }
                      }}
                    >
                      <Search size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Compare with previous visible item"
                      disabled={
                        !previous ||
                        isVideoOutput(output) ||
                        isAudioOutput(output) ||
                        (previous ? isVideoOutput(previous) || isAudioOutput(previous) : false)
                      }
                      data-testid={`gallery-compare-${index}`}
                      onClick={() =>
                        previous &&
                        setLightboxOpener({
                          images: [previous.url, output.url],
                          currentIndex: 1,
                          dataType: 'image',
                          mimeType: null,
                        })
                      }
                    >
                      <Search size={15} />
                    </GalleryIconButton>
                    <ModiffButton
                      className="h-7 px-2 text-xs"
                      tone={selected ? 'primary' : 'secondary'}
                      onClick={() => selectForCompare(output)}
                    >
                      Select
                    </ModiffButton>
                    <GalleryIconButton
                      title="Favorite"
                      data-testid={`gallery-favorite-${index}`}
                      onClick={() => toggleFavoriteOutput(output.id)}
                    >
                      <Heart size={15} className={output.favorite ? 'fill-hf-yellow text-hf-yellow' : undefined} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title={
                        isAudioOutput(output)
                          ? 'Download audio'
                          : isVideoOutput(output)
                            ? 'Download video'
                            : 'Download image'
                      }
                      data-testid={`gallery-download-image-${index}`}
                      onClick={() => downloadImage(output)}
                    >
                      <Download size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Download metadata package"
                      data-testid={`gallery-download-package-${index}`}
                      onClick={() => downloadOutputPackage(output)}
                    >
                      <Download size={15} />
                    </GalleryIconButton>
                    {!isVideoOutput(output) && !isAudioOutput(output) && (
                      <GalleryIconButton
                        title="Download PNG package"
                        data-testid={`gallery-download-png-package-${index}`}
                        onClick={() => {
                          void downloadOutputPngPackage(output)
                            .then(() =>
                              enqueueSnackbar('PNG package exported', { variant: 'success', autoHideDuration: 1800 }),
                            )
                            .catch((error) =>
                              enqueueSnackbar(String(error), { variant: 'error', autoHideDuration: 6000 }),
                            );
                        }}
                      >
                        <Download size={15} />
                      </GalleryIconButton>
                    )}
                    <GalleryIconButton
                      title="Restore workflow"
                      data-testid={`gallery-restore-${index}`}
                      onClick={() => handleRestore(output)}
                    >
                      <RotateCcw size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Rerun this workflow"
                      data-testid={`gallery-rerun-${index}`}
                      onClick={() => {
                        void handleRerun(output);
                      }}
                    >
                      <Play size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Send to edit"
                      data-testid={`gallery-send-edit-${index}`}
                      onClick={() => {
                        sendOutputToReference(output);
                        setRightPanelTab('studio');
                        setGalleryLibraryOpen(false);
                      }}
                    >
                      <Pencil size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Copy metadata"
                      data-testid={`gallery-copy-metadata-${index}`}
                      onClick={() => copyMetadata(output)}
                    >
                      <Copy size={15} />
                    </GalleryIconButton>
                    <GalleryIconButton
                      title="Delete record"
                      data-testid={`gallery-delete-${index}`}
                      onClick={() => deleteOutput(output.id)}
                    >
                      <Trash2 size={15} />
                    </GalleryIconButton>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activeAssetKind === 'generated' ? (
        <div className="mt-4">
          <h2 className="mb-2 text-sm font-bold text-modiff-text">Version tree</h2>
          <div className="grid gap-1">
            {outputs.slice(0, 12).map((output) => (
              <LineageButton
                key={`lineage-${output.id}`}
                output={output}
                onClick={() => {
                  if (isVideoOutput(output) || isAudioOutput(output)) {
                    setSelectedOutputIds([output.id]);
                    setView('inspect');
                  } else {
                    setLightboxOpener({ images: [output.url], currentIndex: 0, dataType: 'image', mimeType: null });
                  }
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ImportedAssetMedia({ asset }: { asset: StudioImportedAsset }) {
  if (asset.displayType === 'audio') {
    return (
      <div className="grid min-h-24 w-full place-items-center border border-modiff-border bg-modiff-surface p-3">
        <audio src={asset.url} controls className="w-full" />
      </div>
    );
  }
  if (asset.displayType === 'video') {
    return (
      <video
        src={asset.url}
        controls
        className="block aspect-video w-full border border-modiff-border bg-black object-contain"
      />
    );
  }
  return <ImageFrame src={asset.url} alt={asset.name} aspectRatio="1 / 1" maxHeight={320} bordered={false} />;
}

function ImportedAssetGrid({
  assets,
  onDelete,
  onUse,
}: {
  assets: StudioImportedAsset[];
  onDelete: (id: string) => void;
  onUse: (asset: StudioImportedAsset) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="rounded-modiff-compact border border-modiff-border bg-modiff-surface p-3 text-xs text-gray-400">
        No imported media yet.
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="gallery-imported-grid">
      {assets.map((asset, index) => (
        <article
          key={asset.id}
          className="overflow-hidden border border-modiff-border bg-modiff-surface"
          data-testid={`gallery-imported-${index}`}
        >
          <ImportedAssetMedia asset={asset} />
          <div className="flex items-center justify-between gap-2 p-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-modiff-text">{asset.name}</p>
              <p className="flex min-w-0 items-center gap-1 text-xs text-gray-400">
                <span>{asset.displayType}</span>
                <GalleryPill
                  active={asset.storage === 'backend'}
                  data-testid={`gallery-imported-storage-${index}`}
                  title={
                    asset.storage === 'backend'
                      ? (asset.backendPath ?? 'Stored through backend')
                      : 'Stored in this browser'
                  }
                >
                  {asset.storage === 'backend' ? 'Backend' : 'Local'}
                </GalleryPill>
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <GalleryIconButton
                title="Use as input"
                data-testid={`gallery-imported-use-${index}`}
                onClick={() => onUse(asset)}
              >
                <Pencil size={15} />
              </GalleryIconButton>
              <GalleryIconButton
                title="Download asset"
                data-testid={`gallery-imported-download-${index}`}
                onClick={() => {
                  const anchor = document.createElement('a');
                  anchor.href = asset.url;
                  anchor.download = asset.name;
                  anchor.click();
                }}
              >
                <Download size={15} />
              </GalleryIconButton>
              <GalleryIconButton
                title="Remove imported asset"
                data-testid={`gallery-imported-delete-${index}`}
                onClick={() => onDelete(asset.id)}
              >
                <Trash2 size={15} />
              </GalleryIconButton>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function GalleryPill({
  active,
  children,
  error = false,
  icon,
  onClick,
  ...props
}: {
  active?: boolean;
  children: ReactNode;
  error?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
} & HTMLAttributes<HTMLButtonElement | HTMLSpanElement>) {
  const className = cx(
    'inline-flex min-h-6 items-center gap-1 rounded-modiff-compact border px-2 text-xs font-semibold',
    error
      ? 'border-modiff-red/70 bg-modiff-red/10 text-modiff-text'
      : active
        ? 'border-hf-yellow bg-hf-yellow text-black'
        : 'border-modiff-border bg-modiff-bg text-gray-300',
    onClick && 'cursor-pointer transition hover:border-hf-yellow hover:text-white',
  );
  if (!onClick) {
    return (
      <span className={className} {...props}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} {...props}>
      {icon}
      {children}
    </button>
  );
}

function GalleryIconButton({ children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        'grid size-7 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-hf-yellow disabled:pointer-events-none disabled:opacity-35',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function GalleryMeta({ output }: { output: StudioOutput }) {
  return (
    <>
      <p className="text-xs text-gray-400">{outputSubtitle(output)}</p>
      <p className="break-all text-xs text-gray-400">
        {new Date(output.createdAt).toLocaleString()} | Run {output.runId || 'untracked'} | Task{' '}
        {output.taskId || 'untracked'}
      </p>
      {output.backendImagePath && <p className="break-all text-xs text-gray-400">Stored: {output.backendImagePath}</p>}
      {output.backendMediaPath && <p className="break-all text-xs text-gray-400">Stored: {output.backendMediaPath}</p>}
      {output.mediaItems && output.mediaItems.length > 1 && (
        <p className="break-all text-xs text-gray-400">
          Media items: {output.mediaItems.length} | Hash: {output.mediaCollectionHash || output.mediaHash || 'pending'}
        </p>
      )}
      {output.variationGroupId && (
        <p className="break-all text-xs text-hf-orange">
          Sweep: {output.variationLabel || 'Variant'} | {output.variationGroupId}
        </p>
      )}
      {(output.sourceOutputId || output.referenceImages.length > 0) && (
        <p className="break-all text-xs text-gray-400">
          Source: {output.sourceOutputId || output.referenceImages.join(', ')}
        </p>
      )}
    </>
  );
}

function GalleryInspect({ output }: { output: StudioOutput }) {
  return (
    <article data-testid="gallery-inspect-view" className="border border-modiff-border bg-modiff-surface">
      <GalleryMedia output={output} maxHeight={460} />
      <div className="p-2">
        <h2 className="text-sm font-bold text-modiff-text">{outputSubtitle(output)}</h2>
        <p className="break-all text-xs text-gray-400">
          {new Date(output.createdAt).toLocaleString()} | Run {output.runId || 'untracked'} | Task{' '}
          {output.taskId || 'untracked'}
        </p>
        <p className="break-all text-xs text-gray-400">
          Repo: {output.repo} | Node: {output.nodeId}:{output.fieldKey}
        </p>
        <p className="mt-2 text-sm text-modiff-text">{output.prompt || 'No prompt recorded'}</p>
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 font-mono text-xs text-gray-300">
          {JSON.stringify(
            {
              seed: output.seed,
              size: `${output.width}x${output.height}`,
              steps: output.steps,
              guidanceScale: output.guidanceScale,
              templateLockHash: output.templateLockHash,
              promptSettingsHash: output.promptSettingsHash,
              exactTemplateCompatible: output.exactTemplateCompatible,
              mediaHash: output.mediaHash,
              mediaCollectionHash: output.mediaCollectionHash,
              mediaItems: output.mediaItems,
              variationGroupId: output.variationGroupId,
              variationLabel: output.variationLabel,
              provenance: output.provenance,
              sourceOutputId: output.sourceOutputId,
              referenceImages: output.referenceImages,
              sourceVideo: output.formSnapshot.sourceVideo,
              maskVideo: output.formSnapshot.maskVideo,
              controlVideo: output.formSnapshot.controlVideo,
              sourceAudio: output.formSnapshot.sourceAudio,
              referenceAudio: output.formSnapshot.referenceAudio,
              audioDuration: output.formSnapshot.audioDuration,
              numFrames: output.formSnapshot.numFrames,
              fps: output.formSnapshot.fps,
              backendImagePath: output.backendImagePath,
              backendMediaPath: output.backendMediaPath,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </article>
  );
}

function GallerySettingsDiff({ left, right }: { left: StudioOutput; right: StudioOutput }) {
  const rows = [
    ['Prompt', left.prompt || 'No prompt', right.prompt || 'No prompt'],
    ['Seed', String(left.seed), String(right.seed)],
    ['Model', left.modelLabel, right.modelLabel],
    ['Steps', String(left.steps), String(right.steps)],
    ['Guidance', String(left.guidanceScale), String(right.guidanceScale)],
    ['Size', `${left.width}x${left.height}`, `${right.width}x${right.height}`],
    ['Template', left.templateLabel || 'Manual', right.templateLabel || 'Manual'],
    [
      'Source',
      left.sourceOutputId || left.referenceImages.join(', ') || 'None',
      right.sourceOutputId || right.referenceImages.join(', ') || 'None',
    ],
  ];

  return (
    <article className="border border-modiff-border bg-modiff-surface p-2">
      <h3 className="mb-2 text-sm font-bold text-modiff-text">Settings diff</h3>
      <div className="grid gap-1">
        {rows.map(([label, leftValue, rightValue]) => {
          const changed = leftValue !== rightValue;
          return (
            <div
              key={label}
              className="grid gap-1 border border-modiff-border bg-modiff-bg p-2 text-xs sm:grid-cols-[90px_1fr_1fr]"
            >
              <span className={changed ? 'font-semibold text-hf-orange' : 'font-semibold text-hf-gray'}>{label}</span>
              <span className="min-w-0 break-words text-gray-300">{leftValue}</span>
              <span className="min-w-0 break-words text-gray-300">{rightValue}</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function GalleryCompareCard({ output }: { output: StudioOutput }) {
  return (
    <article className="border border-modiff-border bg-modiff-surface">
      <GalleryMedia output={output} aspectRatio="1 / 1" />
      <div className="p-2">
        <p className="text-xs text-gray-400">{outputSubtitle(output)}</p>
        {output.variationGroupId && (
          <p className="text-xs text-hf-orange">
            {output.variationLabel || 'Sweep variant'} | {output.variationGroupId}
          </p>
        )}
        <p className="max-h-16 overflow-hidden text-sm text-modiff-text">{output.prompt}</p>
      </div>
    </article>
  );
}

function LineageButton({ output, onClick }: { output: StudioOutput; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-modiff-compact border border-transparent px-2 py-1 text-left text-xs text-gray-300 transition hover:border-modiff-border hover:bg-white/10 hover:text-white"
      onClick={onClick}
    >
      {output.variationGroupId ? 'Sweep' : output.parentId ? 'Branch' : 'Root'} |{' '}
      {output.variationLabel || output.modelLabel} | {new Date(output.createdAt).toLocaleString()} |{' '}
      {output.prompt || output.id}
    </button>
  );
}
