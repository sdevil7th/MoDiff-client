import BlockFieldPickerV2 from './BlockFieldPickerV2';
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import type { BlockInstanceV2, BlockPreviewBindingV2 } from '../studio/blockSchemaV2';
import { blockPreviewOptionKeyV2, blockPreviewOptionsV2 } from '../studio/blockPreviewOptionsV2';
import { ModiffIconButton } from '../ui';

export default function BlockInterfacePreviewsEditorV2({
  snapshot,
  subtreeId,
  previews,
  onChange,
}: {
  snapshot: BlockInstanceV2;
  subtreeId: string;
  previews: BlockPreviewBindingV2[];
  onChange: (previews: BlockPreviewBindingV2[]) => void;
}) {
  const options = useMemo(() => blockPreviewOptionsV2(snapshot, subtreeId), [snapshot, subtreeId]);
  const [selected, setSelected] = useState('');
  const available = options.filter(
    ({ binding }) =>
      !previews.some((preview) => preview.nodeId === binding.nodeId && preview.outputPortId === binding.outputPortId),
  );
  const labels = new Map(options.map(({ key, label }) => [key, label]));
  const labelFor = (binding: BlockPreviewBindingV2) =>
    labels.get(blockPreviewOptionKeyV2(binding)) ??
    `${binding.nodeId} / ${binding.outputPortId} (${binding.mediaType})`;
  const move = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= previews.length) return;
    const next = [...previews];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  const primary = previews.find((binding) => binding.primary);
  return (
    <section className="grid gap-2" data-testid="block-interface-previews">
      <h3 className="text-sm font-semibold text-modiff-text">Collapsed previews</h3>
      <p className="text-xs text-modiff-subtle-text">
        Choose outputs from this Block's own nodes. This changes its preview surface only, not connections, generation
        settings, or the root Block's previews. Existing generated files are not deleted.
      </p>
      {previews.map((binding, index) => (
        <div
          key={blockPreviewOptionKeyV2(binding)}
          className="flex min-w-0 items-center gap-2 rounded-modiff-compact border border-modiff-border-subtle p-2"
        >
          <span className="min-w-0 flex-1 break-words text-sm text-modiff-text">{labelFor(binding)}</span>
          <ModiffIconButton
            label={`Move preview ${labelFor(binding)} up`}
            size="compact"
            disabled={index === 0}
            onClick={() => move(index, -1)}
          >
            <ChevronUp size={14} />
          </ModiffIconButton>
          <ModiffIconButton
            label={`Move preview ${labelFor(binding)} down`}
            size="compact"
            disabled={index === previews.length - 1}
            onClick={() => move(index, 1)}
          >
            <ChevronDown size={14} />
          </ModiffIconButton>
          <ModiffIconButton
            label={`Remove preview ${labelFor(binding)}`}
            size="compact"
            onClick={() => onChange(previews.filter((_, candidate) => candidate !== index))}
          >
            <Trash2 size={14} />
          </ModiffIconButton>
        </div>
      ))}
      {!previews.length ? (
        <p className="text-xs text-modiff-subtle-text">No previews selected for this Block.</p>
      ) : null}
      <BlockFieldPickerV2
        aria-label="Primary collapsed preview"
        value={primary ? blockPreviewOptionKeyV2(primary) : 'none'}
        options={[
          { value: 'none', label: 'No primary preview' },
          ...previews.map((binding) => ({ value: blockPreviewOptionKeyV2(binding), label: labelFor(binding) })),
        ]}
        onValueChange={(key) =>
          onChange(
            previews.map((binding) => {
              const next = { ...binding };
              delete next.primary;
              return blockPreviewOptionKeyV2(next) === key ? { ...next, primary: true } : next;
            }),
          )
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <BlockFieldPickerV2
          aria-label="Internal preview source"
          value={selected}
          onValueChange={setSelected}
          options={available.map(({ key, label }) => ({ value: key, label }))}
          placeholder="Choose an internal media or text output"
          disabled={!available.length}
        />
        <ModiffIconButton
          label="Add collapsed preview"
          size="compact"
          disabled={!available.some(({ key }) => key === selected)}
          onClick={() => {
            const option = available.find(({ key }) => key === selected);
            if (!option) return;
            onChange([...previews, { ...option.binding, ...(!previews.length ? { primary: true } : {}) }]);
            setSelected('');
          }}
        >
          <Plus size={14} />
        </ModiffIconButton>
      </div>
      {!options.length ? (
        <p className="text-xs text-modiff-subtle-text">
          No compatible media or text outputs are declared inside this Block.
        </p>
      ) : null}
    </section>
  );
}
