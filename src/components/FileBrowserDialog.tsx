// Derived from cubiq/Mellon-client and modified by the MoDiff project.

import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Folder, Home, LoaderCircle } from 'lucide-react';

import config from '../../app.config';
import { useDebounce } from '../utils/useDebounce';

import { useFlowStore } from '../stores/useFlowStore';
import { useStudioStore } from '../stores/useStudioStore';
import { fileBrowserParams } from '../stores/useSettingsStore';
import { ModiffButton, ModiffCheckbox, ModiffDialog, ModiffIconButton, ModiffSearchInput } from '../ui';
import { cx } from '../utils/classNames';
import { createLatestRequestGate, requestJson } from '../utils/requestJson';

export interface FileItem {
  is_dir: boolean;
  is_hidden: boolean;
  name: string;
  path: string;
  modified: number;
  size: number | null;
  ext: string | null;
  type: string | null;
}

interface DirectoryListing {
  files: FileItem[];
  path: string;
  abs_path: string;
}

const directoryRequestGate = createLatestRequestGate<'directory'>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseDirectoryListing(value: unknown): DirectoryListing {
  if (
    !isRecord(value) ||
    !Array.isArray(value.files) ||
    typeof value.path !== 'string' ||
    typeof value.abs_path !== 'string'
  ) {
    throw new Error('The directory listing response is invalid.');
  }
  const files = value.files.map((file, index) => {
    if (
      !isRecord(file) ||
      typeof file.is_dir !== 'boolean' ||
      typeof file.is_hidden !== 'boolean' ||
      typeof file.name !== 'string' ||
      typeof file.path !== 'string' ||
      typeof file.modified !== 'number'
    ) {
      throw new Error(`Directory entry ${index + 1} is invalid.`);
    }
    return file as unknown as FileItem;
  });
  return { files, path: value.path, abs_path: value.abs_path };
}

function formatDate(date: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: '2-digit',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(date * 1000));
}

function formatFileSize(size: number | null): string {
  if (size === 0 || size === null) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(1024));
  return `${(size / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

const DirectoryRow = memo(({ file, onPathChange }: { file: FileItem; onPathChange: (path: string) => void }) => (
  <tr
    role="button"
    tabIndex={0}
    className="cursor-pointer border-b border-modiff-border hover:bg-modiff-surface-hover"
    onClick={() => onPathChange(file.path)}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      onPathChange(file.path);
    }}
  >
    <td className="w-8 p-0 text-center">
      <Folder size={16} className="mx-auto text-hf-yellow" />
    </td>
    <td className="px-2 py-1 text-sm text-modiff-text">{file.name}</td>
    <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-modiff-subtle-text" />
    <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-modiff-subtle-text">
      {formatDate(file.modified)}
    </td>
  </tr>
));

type FileRowActivationEvent = Pick<MouseEvent, 'shiftKey' | 'target'>;

const FileRow = memo(
  ({
    file,
    isSelected,
    onFileClick,
    onFileToggle,
  }: {
    file: FileItem;
    isSelected: boolean;
    onFileClick: (file: FileItem, event: FileRowActivationEvent) => void;
    onFileToggle: (file: FileItem, checked: boolean) => void;
  }) => (
    <tr
      role="button"
      tabIndex={0}
      className={cx(
        'cursor-pointer border-b border-modiff-border hover:bg-modiff-surface-hover',
        isSelected && 'bg-modiff-selected-surface',
      )}
      onClick={(e) => onFileClick(file, e)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onFileClick(file, event);
      }}
    >
      <td className="w-8 p-0 text-center">
        <span
          className="inline-flex"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ModiffCheckbox
            checked={isSelected}
            label={<span className="sr-only">{`Select ${file.name}`}</span>}
            onCheckedChange={(checked) => onFileToggle(file, checked)}
          />
        </span>
      </td>
      <td className="break-all px-2 py-1 text-sm text-modiff-text">{file.name}</td>
      <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-modiff-subtle-text">
        {file.size ? formatFileSize(file.size) : '-'}
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-modiff-subtle-text">
        {formatDate(file.modified)}
      </td>
    </tr>
  ),
);

function FileBrowserDialog({
  opener,
  onClose,
  onSelect,
}: {
  opener: fileBrowserParams | null;
  onClose: () => void;
  onSelect?: (files: string[]) => void;
}) {
  const setParam = useFlowStore((state) => state.setParamWithHistory);
  const activeWorkflowTabId = useStudioStore((state) => state.activeWorkflowTabId);
  const workflowCanvasEpoch = useStudioStore((state) => state.workflowCanvasEpoch);
  const ownsCurrentCanvas = Boolean(
    opener && opener.workflowTabId === activeWorkflowTabId && opener.workflowCanvasEpoch === workflowCanvasEpoch,
  );

  const [currentPath, setCurrentPath] = useState<string>('.');
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 250);
  const multiple = opener?.multiple ?? false;
  const fileTypes = opener?.fileTypes.join(',') ?? '';

  useEffect(() => {
    if (opener && !ownsCurrentCanvas) onClose();
  }, [onClose, opener, ownsCurrentCanvas]);

  const fetchDirectoryListing = useCallback(
    async (path: string) => {
      const ticket = directoryRequestGate.begin('directory');
      setIsLoading(true);
      try {
        const data = await requestJson(
          `${config.serverAddress}/listdir?path=${encodeURIComponent(path)}&type=${fileTypes}`,
          { signal: ticket.signal, parse: parseDirectoryListing },
        );
        if (ticket.isLatest()) setDirectoryListing(data);
      } catch (error) {
        if (ticket.isLatest()) {
          console.error('Error fetching directory listing:', error);
          setDirectoryListing({ files: [], path, abs_path: path });
        }
      } finally {
        if (ticket.isLatest()) setIsLoading(false);
        ticket.finish();
      }
    },
    [fileTypes],
  );

  const { directories, files } = useMemo(() => {
    const allFiles = directoryListing?.files || [];
    const filtered = debouncedSearch
      ? allFiles.filter((file) => file.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
      : allFiles;

    return {
      directories: filtered.filter((file) => file.is_dir).sort((a, b) => a.name.localeCompare(b.name)),
      files: filtered.filter((file) => !file.is_dir).sort((a, b) => a.name.localeCompare(b.name)),
    };
  }, [directoryListing, debouncedSearch]);

  const handleFileClick = useCallback(
    (file: FileItem, e: FileRowActivationEvent) => {
      const target = e.target as HTMLElement;
      const isCheckbox = target.tagName === 'INPUT' && target.getAttribute('type') === 'checkbox';

      setSelectedFiles((prev) => {
        const isSelected = prev.some((f) => f.path === file.path);

        if (!multiple) {
          return isSelected ? [] : [file];
        }

        if (isCheckbox || e.shiftKey) {
          if (isSelected) {
            return prev.filter((f) => f.path !== file.path);
          }
          return [...prev, file];
        }

        return [file];
      });
    },
    [multiple],
  );

  const handleFileToggle = useCallback(
    (file: FileItem, checked: boolean) => {
      setSelectedFiles((previous) => {
        if (!checked) return previous.filter((candidate) => candidate.path !== file.path);
        if (!multiple) return [file];
        return previous.some((candidate) => candidate.path === file.path) ? previous : [...previous, file];
      });
    },
    [multiple],
  );

  useEffect(() => {
    if (opener) {
      fetchDirectoryListing(currentPath);
    }
  }, [currentPath, fetchDirectoryListing, opener]);

  useEffect(() => {
    setCurrentPath(opener?.path || '.');
    setSearch('');

    if (opener?.initialValues && opener.initialValues.length > 0) {
      const preSelectedFiles = opener.initialValues.map(
        (path) =>
          ({
            is_dir: false,
            is_hidden: false,
            name: path.split(/[/\\]/).pop() || path,
            path: path,
            modified: 0,
            size: null,
            ext: null,
            type: null,
          }) as FileItem,
      );
      setSelectedFiles(preSelectedFiles);
    } else {
      setSelectedFiles([]);
    }
  }, [opener]);

  const selectedFile = selectedFiles[selectedFiles.length - 1];
  const pathSegments = currentPath.split('/');
  const closeAndReset = () => {
    onClose();
    setCurrentPath('.');
    setSearch('');
  };

  return (
    <ModiffDialog
      open={Boolean(opener)}
      onClose={closeAndReset}
      title="File browser"
      panelClassName="max-w-6xl"
      bodyClassName="!max-h-[78vh] min-h-[60vh] !p-0"
      footer={
        <>
          <ModiffButton onClick={closeAndReset}>Cancel</ModiffButton>
          <ModiffButton
            tone="primary"
            onClick={() => {
              if (opener && ownsCurrentCanvas) {
                setParam(
                  opener.nodeId,
                  opener.fieldKey,
                  selectedFiles.map((file) => file.path),
                );
              }
              if (ownsCurrentCanvas) onSelect?.(selectedFiles.map((file) => file.path));
              closeAndReset();
            }}
            disabled={selectedFiles.length === 0}
          >
            Select
          </ModiffButton>
        </>
      }
    >
      <div className="flex min-h-[60vh] flex-col">
        <nav
          className="flex flex-wrap items-center gap-1 border-b border-modiff-border bg-modiff-panel px-4 py-3 text-sm text-modiff-text"
          aria-label="Current folder"
        >
          <ModiffIconButton
            label="Home"
            size="compact"
            className="text-hf-yellow"
            onClick={() => {
              setCurrentPath('.');
              setSelectedFiles([]);
            }}
          >
            <Home size={16} />
          </ModiffIconButton>
          {pathSegments.map((segment, index) => {
            const path = pathSegments.slice(0, index + 1).join('/');
            const isLast = index === pathSegments.length - 1;
            return isLast ? (
              <span key={index} className="px-1 text-modiff-text">
                {segment}
              </span>
            ) : (
              <ModiffButton
                key={index}
                tone="ghost"
                size="compact"
                className="h-7 px-1 font-normal"
                onClick={() => {
                  setCurrentPath(path);
                  setSelectedFiles([]);
                }}
              >
                {segment}
              </ModiffButton>
            );
          })}
        </nav>
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_384px]">
          <div className="relative min-h-0 select-none overflow-auto">
            {isLoading && (
              <div className="absolute inset-0 z-[2] grid place-items-center bg-modiff-panel/90">
                <LoaderCircle className="animate-spin text-hf-yellow" size={28} />
              </div>
            )}
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-[1] bg-modiff-panel">
                <tr className="border-b border-modiff-border">
                  <th className="w-8 p-0 text-center">
                    {multiple && (
                      <ModiffCheckbox
                        checked={files.length > 0 && selectedFiles.length === files.length}
                        indeterminate={selectedFiles.length > 0 && selectedFiles.length < files.length}
                        label={<span className="sr-only">Select all files</span>}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedFiles(files);
                          } else {
                            setSelectedFiles([]);
                          }
                        }}
                      />
                    )}
                  </th>
                  <th className="px-2 py-2">
                    <div className="flex w-full items-center gap-2">
                      <span className="text-sm font-semibold text-modiff-text">Name</span>
                      <ModiffSearchInput
                        aria-label="Filter files"
                        className="min-w-0 flex-1"
                        placeholder="Filter"
                        value={search}
                        onChange={(event) => setSearch(event.currentTarget.value)}
                        onClear={() => setSearch('')}
                      />
                    </div>
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right text-sm font-semibold text-modiff-text">
                    Size
                  </th>
                  <th className="whitespace-nowrap px-2 py-2 text-right text-sm font-semibold text-modiff-text">
                    Modified
                  </th>
                </tr>
              </thead>
              <tbody>
                {directories.map((file) => (
                  <DirectoryRow
                    key={file.path}
                    file={file}
                    onPathChange={(path) => {
                      setCurrentPath(path);
                      setSelectedFiles([]);
                      setSearch('');
                    }}
                  />
                ))}
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    isSelected={selectedFiles.some((f) => f.path === file.path)}
                    onFileClick={handleFileClick}
                    onFileToggle={handleFileToggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <aside className="min-h-0 overflow-hidden">
            {selectedFile && (
              <img
                src={`${config.serverAddress}/preview?file=${encodeURIComponent(selectedFile.path)}&width=384&height=384`}
                alt={selectedFile.name}
                className="w-full rounded-modiff-compact border border-modiff-border object-contain"
              />
            )}
            <div className="mt-2 space-y-1 text-sm text-modiff-subtle-text">
              <div className="font-bold text-modiff-text">{selectedFile ? selectedFile.name : ''}</div>
              <div>Size: {selectedFile?.size ? formatFileSize(selectedFile.size) : '-'}</div>
              <div>Modified: {selectedFile?.modified ? formatDate(selectedFile.modified) : '-'}</div>
              <div>Type: {selectedFile?.type ?? ''}</div>
            </div>
          </aside>
        </div>
      </div>
    </ModiffDialog>
  );
}

export default FileBrowserDialog;
