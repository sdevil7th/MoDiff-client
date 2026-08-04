import { ArrowDown, ArrowUp, FolderOpen, ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  advanceWorkflowOperationContext,
  assertWorkflowOperationContext,
  captureWorkflowOperationContext,
  isWorkflowOperationCancelled,
  useStudioStore,
} from '../stores/useStudioStore';
import { syncStudioGraphValues } from '../studio/graphBridge';
import { resolveStudioImageUrl } from '../studio/outputUtils';
import type { StudioFormState } from '../studio/types';
import { enqueueSnackbar } from '../ui/snackbar';
import {
  ImageFrame,
  ModiffFileInput,
  SectionHeader,
  Spinner,
  StudioIconButton,
  StudioSelect,
  StudioTextInput,
} from '../ui';
import { formatRequestError } from '../utils/requestJson';
import { uploadBackendFile } from '../utils/backendUpload';
import { mediaAcceptString } from '../studio/mediaImport';

export function StudioImageReferenceTray() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pathValue, setPathValue] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const {
    referenceImages,
    addReferenceImage,
    replaceReferenceImage,
    removeReferenceImage,
    moveReferenceImage,
    setReferenceImages,
    alphaMode,
    updateForm,
  } = useStudioStore(
    useShallow((state) => ({
      referenceImages: state.form.referenceImages,
      alphaMode: state.form.alphaMode,
      addReferenceImage: state.addReferenceImage,
      replaceReferenceImage: state.replaceReferenceImage,
      removeReferenceImage: state.removeReferenceImage,
      moveReferenceImage: state.moveReferenceImage,
      setReferenceImages: state.setReferenceImages,
      updateForm: state.updateForm,
    })),
  );

  const handleAddPath = () => {
    addReferenceImage(pathValue);
    setPathValue('');
    queueMicrotask(() => syncStudioGraphValues());
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const context = captureWorkflowOperationContext();
    setIsUploading(true);
    try {
      const uploadedPaths: string[] = [];
      for (const file of Array.from(files)) {
        uploadedPaths.push(...(await uploadBackendFile(file, 'images')));
        assertWorkflowOperationContext(context);
      }
      setReferenceImages([...useStudioStore.getState().form.referenceImages, ...uploadedPaths]);
      advanceWorkflowOperationContext(context);
      syncStudioGraphValues();
    } catch (error) {
      if (isWorkflowOperationCancelled(error)) return;
      enqueueSnackbar(formatRequestError(error, 'Could not upload the reference image.'), {
        variant: 'error',
        autoHideDuration: 5000,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Image input workspace"
        action={
          <StudioIconButton title="Upload images" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
            {isUploading ? <Spinner size={18} /> : <FolderOpen size={16} />}
          </StudioIconButton>
        }
      />
      <ModiffFileInput
        ref={fileInputRef}
        aria-label="Upload reference images"
        accept={mediaAcceptString(['image'])}
        multiple
        hidden
        onChange={(event) => {
          void handleUpload(event.target.files);
        }}
      />
      <div className="mb-2 flex gap-2">
        <StudioTextInput
          aria-label="Reference image path or URL"
          value={pathValue}
          onChange={(event) => setPathValue(event.target.value)}
          placeholder="Image path or URL"
          className="flex-1"
        />
        <StudioIconButton title="Add image" onClick={handleAddPath} disabled={!pathValue.trim()}>
          <ImagePlus size={17} />
        </StudioIconButton>
      </div>
      <StudioSelect
        aria-label="Reference image alpha handling"
        value={alphaMode}
        onValueChange={(value) => {
          updateForm({ alphaMode: value as StudioFormState['alphaMode'] });
          queueMicrotask(() => syncStudioGraphValues());
        }}
        options={[
          { value: 'ignore', label: 'Alpha: ignore' },
          { value: 'add alpha', label: 'Alpha: add alpha' },
          { value: 'remove alpha', label: 'Alpha: remove alpha' },
        ]}
        className="mb-2 w-full"
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(86px,1fr))] gap-2">
        {referenceImages.map((image, index) => (
          <div key={`${image}-${index}`} className="border border-modiff-border bg-modiff-bg">
            <ImageFrame
              src={resolveStudioImageUrl(image)}
              alt={image}
              fit="cover"
              aspectRatio="1 / 1"
              bordered={false}
            />
            <StudioTextInput
              aria-label={`Reference image ${index + 1} path`}
              value={image}
              onChange={(event) => {
                replaceReferenceImage(index, event.target.value);
                queueMicrotask(() => syncStudioGraphValues());
              }}
              className="h-7 w-full border-0 bg-transparent px-1 text-xs"
            />
            <div className="flex justify-between">
              <StudioIconButton
                title="Move up"
                disabled={index === 0}
                onClick={() => {
                  moveReferenceImage(index, -1);
                  queueMicrotask(() => syncStudioGraphValues());
                }}
              >
                <ArrowUp size={15} />
              </StudioIconButton>
              <StudioIconButton
                title="Move down"
                disabled={index === referenceImages.length - 1}
                onClick={() => {
                  moveReferenceImage(index, 1);
                  queueMicrotask(() => syncStudioGraphValues());
                }}
              >
                <ArrowDown size={15} />
              </StudioIconButton>
              <StudioIconButton
                title="Remove"
                onClick={() => {
                  removeReferenceImage(index);
                  queueMicrotask(() => syncStudioGraphValues());
                }}
              >
                <Trash2 size={15} />
              </StudioIconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
