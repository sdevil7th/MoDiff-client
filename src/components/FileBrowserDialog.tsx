import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Folder, Home, LoaderCircle, Search } from 'lucide-react';

import config from '../../app.config';
import { useDebounce } from '../utils/useDebounce';

import { useFlowStore } from '../stores/useFlowStore';
import { fileBrowserParams } from '../stores/useSettingsStore';
import { ModiffButton } from '../ui';
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
    className="cursor-pointer border-b border-modiff-border hover:bg-white/10"
    onClick={() => onPathChange(file.path)}
  >
    <td className="w-8 p-0 text-center">
      <Folder size={16} className="mx-auto text-hf-yellow" />
    </td>
    <td className="px-2 py-1 text-sm text-modiff-text">{file.name}</td>
    <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-gray-400" />
    <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-gray-400">{formatDate(file.modified)}</td>
  </tr>
));

const FileRow = memo(
  ({
    file,
    isSelected,
    onFileClick,
  }: {
    file: FileItem;
    isSelected: boolean;
    onFileClick: (file: FileItem, e: MouseEvent) => void;
  }) => (
    <tr
      className={cx('cursor-pointer border-b border-modiff-border hover:bg-white/10', isSelected && 'bg-modiff-panel')}
      onClick={(e) => onFileClick(file, e)}
    >
      <td className="w-8 p-0 text-center">
        <input type="checkbox" checked={isSelected} tabIndex={-1} readOnly className="size-4 accent-hf-yellow" />
      </td>
      <td className="break-all px-2 py-1 text-sm text-modiff-text">{file.name}</td>
      <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-gray-400">
        {file.size ? formatFileSize(file.size) : '-'}
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right text-sm text-gray-400">{formatDate(file.modified)}</td>
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
  const setParam = useFlowStore((state) => state.setParam);

  const [currentPath, setCurrentPath] = useState<string>('.');
  const [directoryListing, setDirectoryListing] = useState<DirectoryListing | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const debouncedSearch = useDebounce(search, 250);
  const multiple = opener?.multiple ?? false;
  const fileTypes = opener?.fileTypes.join(',') ?? '';

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
    (file: FileItem, e: MouseEvent) => {
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

  if (!opener) {
    return null;
  }

  const selectedFile = selectedFiles[selectedFiles.length - 1];
  const pathSegments = currentPath.split('/');
  const closeAndReset = () => {
    onClose();
    setCurrentPath('.');
    setSearch('');
  };

  return (
    <div className="relative z-50">
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label="File browser"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeAndReset();
        }}
      >
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-modiff-panel border border-modiff-border bg-modiff-surface shadow-modiff-node">
          <header className="border-b border-modiff-border bg-modiff-panel px-4 py-3">
            <nav className="flex flex-wrap items-center gap-1 text-sm text-modiff-text">
              <button
                type="button"
                className="grid size-7 place-items-center rounded-modiff-compact text-hf-yellow hover:bg-white/10"
                onClick={() => {
                  setCurrentPath('.');
                  setSelectedFiles([]);
                }}
                aria-label="Home"
              >
                <Home size={16} />
              </button>
              {pathSegments.map((segment, index) => {
                const path = pathSegments.slice(0, index + 1).join('/');
                const isLast = index === pathSegments.length - 1;
                return isLast ? (
                  <span key={index} className="px-1 text-gray-300">
                    {segment}
                  </span>
                ) : (
                  <button
                    key={index}
                    type="button"
                    className="rounded-modiff-compact px-1 text-gray-400 hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      setCurrentPath(path);
                      setSelectedFiles([]);
                    }}
                  >
                    {segment}
                  </button>
                );
              })}
            </nav>
          </header>
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
                        <input
                          type="checkbox"
                          className="size-4 accent-hf-yellow"
                          aria-checked={
                            selectedFiles.length > 0 && selectedFiles.length < files.length ? 'mixed' : undefined
                          }
                          checked={files.length > 0 && selectedFiles.length === files.length}
                          onChange={(event) => {
                            if (event.target.checked) {
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
                        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-modiff-compact border border-modiff-border bg-modiff-bg px-2 text-sm text-modiff-text focus-within:border-hf-yellow">
                          <Search size={15} className="shrink-0 text-gray-400" />
                          <input
                            placeholder="Filter"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-500"
                          />
                        </label>
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
              <div className="mt-2 space-y-1 text-sm text-gray-300">
                <div className="font-bold text-modiff-text">{selectedFile ? selectedFile.name : ''}</div>
                <div>Size: {selectedFile?.size ? formatFileSize(selectedFile.size) : '-'}</div>
                <div>Modified: {selectedFile?.modified ? formatDate(selectedFile.modified) : '-'}</div>
                <div>Type: {selectedFile?.type ?? ''}</div>
              </div>
            </aside>
          </div>
          <footer className="flex justify-end gap-2 border-t border-modiff-border bg-modiff-panel px-4 py-3">
            <ModiffButton onClick={closeAndReset}>Cancel</ModiffButton>
            <ModiffButton
              tone="primary"
              onClick={() => {
                if (opener) {
                  setParam(
                    opener.nodeId,
                    opener.fieldKey,
                    selectedFiles.map((file) => file.path),
                  );
                }
                onSelect?.(selectedFiles.map((file) => file.path));
                onClose();
              }}
              disabled={selectedFiles.length === 0}
            >
              Select
            </ModiffButton>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default FileBrowserDialog;
