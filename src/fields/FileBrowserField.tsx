import { useState, useRef } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';

import { FieldProps } from '../components/NodeContent';

import { FolderOpen, X } from 'lucide-react';
import config from '../../app.config';
import { useSettingsStore } from '../stores/useSettingsStore';
import InputField from './InputField';
import { FieldFrame, FileDropFrame } from '../ui';
import { uploadBackendFile } from '../utils/backendUpload';

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

  const getAcceptString = () => {
    const accepts = [];
    if (allowImages) accepts.push('image/*');
    if (allowVideos) accepts.push('video/*');
    return accepts.join(',');
  };

  const isImage = (file: string) => file.match(/\.(jpe?g|a?png|webp|gif|bmp|ico|tiff|svg)$/i);
  const isVideo = (file: string) => file.match(/\.(mp4|webm|ogg)$/i);
  const isUrl = (file: string) => file.startsWith('http://') || file.startsWith('https://');

  // if none of the values is empty, add an empty string to allow adding more files
  const baseFieldValue =
    multiple && allowImages && currentValues.length > 0 && !currentValues.includes('')
      ? [...currentValues, '']
      : currentValues;
  const fieldValue = baseFieldValue.length > 0 ? baseFieldValue : [''];
  const displayValue = fieldValue.filter((file: string) => isImage(file) || isVideo(file)) || [];
  const isTextFieldEditable = props.fieldOptions?.editable !== false;

  async function uploadFile(file: File) {
    const fileType = file.type.startsWith('image/') ? 'images' : 'videos';
    try {
      const newFiles = await uploadBackendFile(file, fileType);
      let updatedFiles;
      if (fileType === 'videos') {
        // Videos are always single
        updatedFiles = newFiles;
      } else {
        updatedFiles = multiple
          ? Array.from(new Set([...currentValues.filter((f: string) => f), ...newFiles]))
          : newFiles;
      }
      props.updateStore(props.fieldKey, updatedFiles);
    } catch (error) {
      console.error(error);
    }
  }

  async function handleFileDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDropActive(false);
    const files = [...e.dataTransfer.files].filter(
      (file) => (allowImages && file.type.startsWith('image/')) || (allowVideos && file.type.startsWith('video/')),
    );
    if (files.length > 0) {
      const firstFile = files[0];
      if (!firstFile) return;
      if (firstFile.type.startsWith('video/')) {
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
      if ((allowImages && file.type.startsWith('image/')) || (allowVideos && file.type.startsWith('video/'))) {
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
                  className="flex-grow break-all rounded-modiff-compact bg-modiff-bg px-2 py-1 text-sm text-gray-400"
                >
                  {file}
                </div>
              ))}
        </div>
        <button
          type="button"
          className="ml-1 grid size-8 shrink-0 place-items-center rounded-modiff-compact text-gray-300 transition hover:bg-white/10 hover:text-hf-yellow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow disabled:pointer-events-none disabled:opacity-40"
          title="Open file browser"
          aria-label="Open file browser"
          disabled={props.disabled}
          onClick={() =>
            setFileBrowserOpener({
              nodeId: props.nodeId,
              fieldKey: props.fieldKey,
              fileTypes: allowedFieldTypes,
              path: currentPath,
              multiple,
              initialValues: currentValues,
            })
          }
        >
          <FolderOpen size={16} />
        </button>
      </div>

      {/* Hidden file input for OS file dialog */}
      <input
        ref={fileInputRef}
        type="file"
        accept={getAcceptString()}
        hidden
        onChange={handleFileInputChange}
        multiple={multiple && allowImages}
      />

      {/** File drop area */}
      <FileDropFrame
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
                  src={isUrl(file) ? file : `${config.serverAddress}/preview?file=${encodeURIComponent(file)}`}
                  alt={file}
                  onLoad={handleMediaLoad}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src =
                      "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Image not found</text></svg>";
                  }}
                />
              ) : isVideo(file) ? (
                <video
                  className="mx-auto block h-auto max-h-[1080px] w-full max-w-[1920px] object-contain"
                  src={isUrl(file) ? file : `${config.serverAddress}/stream?file=${encodeURIComponent(file)}`}
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
                    (e.currentTarget as HTMLVideoElement).poster =
                      "data:image/svg+xml;utf8,<svg width='512' height='512' xmlns='http://www.w3.org/2000/svg'><defs><pattern id='checker' width='32' height='32' patternUnits='userSpaceOnUse'><rect width='32' height='32' fill='%23ffffff11'/><rect x='0' y='0' width='16' height='16' fill='%23ffffff33'/><rect x='16' y='16' width='16' height='16' fill='%23ffffff33'/></pattern></defs><rect width='512' height='512' fill='url(%23checker)'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='24' fill='%23FAFAFA' font-family='IBM Plex Mono, monospace'>Video not found</text></svg>";
                  }}
                />
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeMedia(file);
                }}
                title="Remove image"
                className="absolute right-1 top-1 grid size-7 place-items-center rounded-modiff-compact bg-black/40 text-gray-200 transition hover:bg-black/70 hover:text-modiff-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hf-yellow"
              >
                <X size={14} />
              </button>
            </div>
          ))
        ) : (
          <div className="text-sm text-gray-400">Drop files here to upload</div>
        )}
      </FileDropFrame>
    </FieldFrame>
  );
}
