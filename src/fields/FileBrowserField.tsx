// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { useState, useRef } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';

import { FieldProps } from '../components/NodeContent';

import { FolderOpen, X } from 'lucide-react';
import config from '../../app.config';
import { useSettingsStore } from '../stores/useSettingsStore';
import InputField from './InputField';
import { FieldFrame, FileDropFrame } from '../ui';
import { uploadBackendFile } from '../utils/backendUpload';
import { GraphControlInput, GraphIconButton } from '../ui/GraphControls';
import { bundledPublicAssetUrl } from '../studio/outputUtils';
import { inferImportedMediaKind, mediaAcceptString } from '../studio/mediaImport';
import { enqueueSnackbar } from '../ui/snackbar';
import { MEDIA_PLACEHOLDER_DATA_URL } from '../utils/mediaViewer';
import {
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
} from '../stores/useStudioStore';

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

export default function FileBrowserField(props: FieldProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setFileBrowserOpener = useSettingsStore((state) => state.setFileBrowserOpener);
  const [isDropActive, setIsDropActive] = useState(false);
  const updateNodeInternals = useUpdateNodeInternals();
  const currentValues = asStringArray(props.value);
  const currentPath = currentValues.length > 0 ? String(currentValues[0]).split(/[/\\]/).slice(0, -1).join('/') : '.';

  const fieldTypes = asStringArray(props.fieldOptions?.fileTypes);
  const allowedFieldTypes = fieldTypes.length > 0 ? fieldTypes : ['image'];
  const multiple = Boolean(props.fieldOptions?.multiple);
  const allowImages = allowedFieldTypes.includes('image');
  const allowVideos = allowedFieldTypes.includes('video');
  const allowAudio = allowedFieldTypes.includes('audio');

  const allowedMediaKinds = [
    ...(allowImages ? (['image'] as const) : []),
    ...(allowVideos ? (['video'] as const) : []),
    ...(allowAudio ? (['audio'] as const) : []),
  ];
  const getAcceptString = () => mediaAcceptString(allowedMediaKinds);

  const isImage = (file: string) => allowImages && Boolean(file.match(/\.(jpe?g|png|webp|avif|gif|bmp|ico|tiff?)$/i));
  const isVideo = (file: string) =>
    allowVideos && Boolean(file.match(/\.(mp4|m4v|mov|webm|mkv|avi|mpeg|mpg|ts|mts|m2ts|wmv|flv)$/i));
  const isAudio = (file: string) =>
    allowAudio &&
    !isVideo(file) &&
    Boolean(file.match(/\.(wav|wave|bwf|aiff?|flac|mp3|m4a|aac|ogg|oga|opus|wma|mp4)$/i));
  const isUrl = (file: string) => file.startsWith('http://') || file.startsWith('https://');
  const imagePreviewUrl = (file: string) =>
    bundledPublicAssetUrl(file) ??
    (isUrl(file) ? file : `${config.serverAddress}/preview?file=${encodeURIComponent(file)}`);
  const videoPreviewUrl = (file: string) =>
    bundledPublicAssetUrl(file) ??
    (isUrl(file) ? file : `${config.serverAddress}/media/preview?file=${encodeURIComponent(file)}&media_kind=video`);
  const audioPreviewUrl = (file: string) =>
    bundledPublicAssetUrl(file) ??
    (isUrl(file) ? file : `${config.serverAddress}/media/preview?file=${encodeURIComponent(file)}&media_kind=audio`);

  // if none of the values is empty, add an empty string to allow adding more files
  const baseFieldValue =
    multiple && allowImages && currentValues.length > 0 && !currentValues.includes('')
      ? [...currentValues, '']
      : currentValues;
  const fieldValue = baseFieldValue.length > 0 ? baseFieldValue : [''];
  const displayValue = fieldValue.filter((file: string) => isImage(file) || isVideo(file) || isAudio(file)) || [];
  const isTextFieldEditable = props.fieldOptions?.editable !== false;

  async function uploadFile(file: File) {
    const context = captureWorkflowOperationContext();
    const mediaKind = inferImportedMediaKind(file, allowedMediaKinds);
    if (!mediaKind) {
      enqueueSnackbar('That file is not a supported media type for this input.', {
        variant: 'error',
        autoHideDuration: 5000,
      });
      return;
    }
    const fileType = mediaKind === 'image' ? 'images' : mediaKind === 'audio' ? 'audio' : 'videos';
    try {
      const newFiles = await uploadBackendFile(file, fileType);
      assertWorkflowOperationContext(context, { includeForm: false });
      let updatedFiles;
      if (fileType === 'videos' || fileType === 'audio') {
        // Video and audio inputs are always single.
        updatedFiles = newFiles;
      } else {
        updatedFiles = multiple
          ? Array.from(new Set([...currentValues.filter((f: string) => f), ...newFiles]))
          : newFiles;
      }
      props.updateStore(props.fieldKey, updatedFiles);
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(error instanceof Error ? error.message : 'The media file could not be imported.', {
        variant: 'error',
        autoHideDuration: 6000,
      });
    }
  }

  async function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDropActive(false);
    const files = [...e.dataTransfer.files].filter((file) => inferImportedMediaKind(file, allowedMediaKinds));
    if (files.length > 0) {
      const firstFile = files[0];
      if (!firstFile) return;
      const firstKind = inferImportedMediaKind(firstFile, allowedMediaKinds);
      if (firstKind === 'video' || firstKind === 'audio') {
        await uploadFile(firstFile);
      } else {
        // Handle multiple image uploads if enabled
        if (multiple && allowImages) {
          //const currentImages = props.value?.filter(isImage) || [];
          const newImages = files.map((f) => f);
          for (const file of newImages) {
            await uploadFile(file);
          }
        } else {
          await uploadFile(firstFile);
        }
      }
    }
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files.item(0);
      if (!file) return;
      if (inferImportedMediaKind(file, allowedMediaKinds)) {
        await uploadFile(file);
      }
    }
  }

  const handleMediaLoad = () => {
    // Update node internals after the image/video has loaded and the node has re-rendered
    setTimeout(() => {
      updateNodeInternals(props.nodeId);
    }, 100);
  };

  const updateArrayValues = (value: string, key?: number) => {
    const newValues = currentValues ? [...currentValues] : [];
    if (key !== undefined) {
      newValues[key] = value;
    } else {
      newValues.push(value);
    }
    props.updateStore(props.fieldKey, Array.from(new Set(newValues.filter((f) => f))));
  };

  const getGridColumns = (count: number) => {
    if (count <= 1) return 1;
    const maxCols = 4;
    const cols = Math.ceil(Math.sqrt(count));
    return Math.min(cols, maxCols);
  };

  const removeMedia = (fileToRemove: string) => {
    const newValues = currentValues.filter((file: string) => file !== fileToRemove) || [];
    if (newValues.length === 0) {
      props.updateStore(props.fieldKey, ['']);
    } else {
      props.updateStore(props.fieldKey, newValues);
    }
    queueMicrotask(() => {
      updateNodeInternals(props.nodeId);
    });
  };

  return (
    <FieldFrame
      dataKey={props.fieldKey}
      hidden={props.hidden}
      disabled={props.disabled}
      layoutStyle={props.style}
      className="modiff-field flex flex-col items-center justify-between"
    >
      <div className="flex w-full flex-row items-center">
        <div className="flex w-full flex-col gap-1">
          {isTextFieldEditable
            ? fieldValue.map((file: string, index: number) => (
                <InputField
                  key={index}
                  {...props}
                  value={file}
                  updateStore={(_, file) => updateArrayValues(String(file), index)}
                />
              ))
            : fieldValue.map((file: string, index: number) => (
                <div
                  key={index}
                  className="flex-grow break-all rounded-modiff-compact bg-modiff-bg px-2 py-1 text-sm text-modiff-subtle-text"
                >
                  {file}
                </div>
              ))}
        </div>
        <GraphIconButton
          label="Open file browser"
          size="dense"
          className="ml-1 shrink-0 hover:text-hf-yellow"
          disabled={props.disabled}
          onClick={() => {
            const context = captureWorkflowOperationContext();
            setFileBrowserOpener({
              workflowTabId: context.workflowTabId,
              workflowCanvasEpoch: context.canvasEpoch,
              nodeId: props.nodeId,
              fieldKey: props.fieldKey,
              fileTypes: allowedFieldTypes,
              path: currentPath,
              multiple,
              initialValues: currentValues,
            });
          }}
        >
          <FolderOpen size={16} />
        </GraphIconButton>
      </div>

      {/* Hidden file input for OS file dialog */}
      <GraphControlInput
        ref={fileInputRef}
        type="file"
        accept={getAcceptString()}
        hidden
        onChange={handleFileInputChange}
        multiple={multiple && allowImages}
      />

      {/** File drop area */}
      <FileDropFrame
        activationLabel="Upload files"
        disabled={props.disabled}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDropActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDropActive(false);
        }}
        onDrop={handleFileDrop}
        isActive={isDropActive}
        gridColumns={getGridColumns(displayValue.length)}
      >
        {displayValue && displayValue.length > 0 ? (
          displayValue.map((file: string, index: number) => (
            <div key={index} className="relative">
              {isImage(file) ? (
                <img
                  className="mx-auto block h-auto max-h-[1024px] w-full max-w-[360px] object-contain"
                  src={imagePreviewUrl(file)}
                  alt={file}
                  onLoad={handleMediaLoad}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = MEDIA_PLACEHOLDER_DATA_URL;
                  }}
                />
              ) : isVideo(file) ? (
                <video
                  className="pointer-events-auto mx-auto block h-auto max-h-[1080px] w-full max-w-[1920px] object-contain"
                  src={videoPreviewUrl(file)}
                  //src={`${config.serverAddress}/cache/${props.nodeId}/${props.fieldKey}`}
                  controls
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  onLoadedData={(e) => {
                    (e.currentTarget as HTMLVideoElement).poster = '';
                    handleMediaLoad();
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLVideoElement).poster = MEDIA_PLACEHOLDER_DATA_URL;
                  }}
                />
              ) : isAudio(file) ? (
                <audio
                  className="pointer-events-auto mx-auto block min-w-64 max-w-full"
                  src={audioPreviewUrl(file)}
                  controls
                  preload="metadata"
                  onClick={(event) => event.stopPropagation()}
                  onLoadedMetadata={handleMediaLoad}
                />
              ) : null}
              <GraphIconButton
                label="Remove media"
                onClick={(e) => {
                  e.stopPropagation();
                  removeMedia(file);
                }}
                className="pointer-events-auto absolute right-1 top-1 bg-modiff-media-backdrop/40 text-modiff-text hover:bg-modiff-media-backdrop/70 hover:text-modiff-red"
              >
                <X size={14} />
              </GraphIconButton>
            </div>
          ))
        ) : (
          <div className="text-sm text-modiff-subtle-text">Drop files here to upload</div>
        )}
      </FileDropFrame>
    </FieldFrame>
  );
}
