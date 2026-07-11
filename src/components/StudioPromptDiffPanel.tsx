import { ClipboardCopy } from 'lucide-react';
import { useMemo, useState } from 'react';

import { enqueueSnackbar } from '../ui/snackbar';
import { buildPromptDiff, type DiffToken } from '../studio/promptDiff';
import { SectionHeader, StudioButton, StudioChip, StudioSelect } from '../ui';
import { cx } from '../utils/classNames';

type PromptDiffSource = {
  id: string;
  label: string;
  prompt: string;
};

type StudioPromptDiffPanelProps = {
  currentPrompt: string;
  promptHistory: string[];
  savedSnippets: string[];
  onApplyPrompt: (prompt: string) => void;
};

function copyText(value: string, label: string) {
  void navigator.clipboard.writeText(value);
  enqueueSnackbar(`${label} copied`, { variant: 'success', autoHideDuration: 1800 });
}

function buildPromptDiffSummary(basePrompt: string, currentPrompt: string, diff: DiffToken[]) {
  const added = diff
    .filter((token) => token.kind === 'added')
    .map((token) => token.text)
    .join(' ');
  const removed = diff
    .filter((token) => token.kind === 'removed')
    .map((token) => token.text)
    .join(' ');

  return [
    'Prompt diff',
    '',
    'Base:',
    basePrompt,
    '',
    'Current:',
    currentPrompt,
    '',
    'Added:',
    added || 'None',
    '',
    'Removed:',
    removed || 'None',
  ].join('\n');
}

export function StudioPromptDiffPanel({
  currentPrompt,
  promptHistory,
  savedSnippets,
  onApplyPrompt,
}: StudioPromptDiffPanelProps) {
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const diffSources = useMemo<PromptDiffSource[]>(
    () =>
      [
        ...savedSnippets.map((prompt, index) => ({ id: `snippet-${index}`, label: `Snippet ${index + 1}`, prompt })),
        ...promptHistory.map((prompt, index) => ({ id: `history-${index}`, label: `History ${index + 1}`, prompt })),
      ].filter((source) => source.prompt.trim() && source.prompt !== currentPrompt),
    [currentPrompt, promptHistory, savedSnippets],
  );
  const selectedSource = diffSources.find((source) => source.id === selectedSourceId) || diffSources[0];
  const diff = useMemo(
    () => (selectedSource ? buildPromptDiff(selectedSource.prompt, currentPrompt) : []),
    [currentPrompt, selectedSource],
  );
  const addedCount = diff.filter((token) => token.kind === 'added').length;
  const removedCount = diff.filter((token) => token.kind === 'removed').length;

  if (diffSources.length === 0) {
    return null;
  }

  return (
    <div>
      <SectionHeader
        title="Prompt diff"
        action={
          <div className="flex gap-1">
            <StudioChip tone={addedCount ? 'success' : 'default'}>{`+${addedCount}`}</StudioChip>
            <StudioChip tone={removedCount ? 'error' : 'default'}>{`-${removedCount}`}</StudioChip>
          </div>
        }
      />
      <StudioSelect
        value={selectedSource?.id || ''}
        onChange={(event) => setSelectedSourceId(event.target.value)}
        className="mb-2 w-full"
      >
        {diffSources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.label}
          </option>
        ))}
      </StudioSelect>
      <div className="max-h-40 overflow-y-auto border border-modiff-border bg-modiff-bg p-2">
        {diff.map((token, index) => (
          <span
            key={`${token.text}-${index}`}
            className={cx(
              'mb-1 mr-1 inline-block rounded-modiff-compact px-1 text-xs',
              token.kind === 'same' && 'text-gray-400',
              token.kind === 'added' && 'bg-modiff-green/10 text-modiff-green',
              token.kind === 'removed' && 'bg-modiff-red/10 text-modiff-red line-through',
            )}
          >
            {token.text}
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <StudioButton
          tone="ghost"
          icon={<ClipboardCopy size={15} />}
          onClick={() =>
            selectedSource &&
            copyText(buildPromptDiffSummary(selectedSource.prompt, currentPrompt, diff), 'Prompt diff')
          }
        >
          Copy diff
        </StudioButton>
        <StudioButton tone="ghost" onClick={() => selectedSource && onApplyPrompt(selectedSource.prompt)}>
          Use baseline
        </StudioButton>
      </div>
    </div>
  );
}
