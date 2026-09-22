import { Settings } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import {
  FileDropFrame,
  ImageCompareFrame,
  ImageFrame,
  ModiffBadge,
  ModiffButton,
  ModiffCheckbox,
  ModiffChip,
  ModiffCombobox,
  ModiffDialog,
  ModiffDisclosure,
  ModiffFieldShell,
  ModiffFileInput,
  ModiffIconButton,
  ModiffInput,
  ModiffMenu,
  ModiffMenuItem,
  ModiffMultiSelect,
  ModiffNumberInput,
  ModiffPasswordInput,
  ModiffPopover,
  ModiffProgress,
  ModiffRadioGroup,
  ModiffRadioCardGroup,
  ModiffSearchInput,
  ModiffSelect,
  ModiffSlider,
  ModiffSwitch,
  ModiffTab,
  ModiffTabList,
  ModiffTextarea,
  RangeSliderFrame,
  enqueueSnackbar,
  type ModiffControlSize,
} from '.';

const matrixImage =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 180%22%3E%3Crect width=%22320%22 height=%22180%22 fill=%22%23141c2e%22/%3E%3Ccircle cx=%22160%22 cy=%2290%22 r=%2252%22 fill=%22%23ffd21e%22/%3E%3C/svg%3E';

function SizeExamples({ size }: { size: ModiffControlSize }) {
  const [value, setValue] = useState('one');

  return (
    <section
      data-testid={`size-${size}`}
      className="grid gap-3 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4"
    >
      <h2 className="text-modiff-card-title font-semibold capitalize text-modiff-text">{size} controls</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ModiffButton size={size} tone="primary">
          Primary
        </ModiffButton>
        <ModiffButton size={size}>Secondary</ModiffButton>
        <ModiffIconButton label={`${size} settings`} size={size}>
          <Settings size={15} />
        </ModiffIconButton>
        <ModiffInput aria-label={`${size} text input`} controlSize={size} defaultValue="Text value" />
        <ModiffSearchInput
          aria-label={`${size} search`}
          controlSize={size}
          value=""
          onChange={() => undefined}
          placeholder="Search"
        />
        <ModiffSelect
          aria-label={`${size} select`}
          size={size}
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'one', label: 'First option' },
            { value: 'two', label: 'Second option' },
          ]}
        />
      </div>
    </section>
  );
}

export function ControlStateMatrix() {
  const textId = useId();
  const numberId = useId();
  const textareaId = useId();
  const fileId = useId();
  const [search, setSearch] = useState('preview');
  const [number, setNumber] = useState<number | ''>(4);
  const [select, setSelect] = useState('recommended');
  const [multiSelect, setMultiSelect] = useState(['image']);
  const [comboboxQuery, setComboboxQuery] = useState('Model');
  const [comboboxValue, setComboboxValue] = useState<string | null>('model');
  const [checked, setChecked] = useState(false);
  const [switched, setSwitched] = useState(false);
  const [radio, setRadio] = useState('balanced');
  const [radioCard, setRadioCard] = useState('direct');
  const [slider, setSlider] = useState(5);
  const [range, setRange] = useState<number | number[]>([2, 8]);
  const [chip, setChip] = useState(false);
  const [tab, setTab] = useState('appearance');
  const [comparison, setComparison] = useState(50);
  const [dropActivations, setDropActivations] = useState(0);
  const [imageActivations, setImageActivations] = useState(0);
  const [formResult, setFormResult] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [menuResult, setMenuResult] = useState('No menu action');
  const popoverAnchorRef = useRef<HTMLButtonElement>(null);

  return (
    <main className="mx-auto grid max-w-6xl gap-5 p-6 font-sans text-modiff-text" data-testid="control-state-matrix">
      <header>
        <h1 className="text-modiff-modal-title font-bold">Shared control state matrix</h1>
        <p className="mt-1 text-sm text-modiff-subtle-text">
          Visual and interaction fixture for compact, dense, normal, and prominent shared controls.
        </p>
      </header>

      {new URLSearchParams(window.location.search).has('large-options') ? (
        <section className="grid gap-3" aria-label="Large option lists">
          <ModiffSelect
            aria-label="Long select"
            value={select}
            onValueChange={setSelect}
            options={Array.from({ length: 1000 }, (_, i) => ({ value: String(i), label: `Model ${i}` }))}
          />
          <ModiffCombobox
            aria-label="Long combobox"
            value={comboboxValue}
            onValueChange={(value) => setComboboxValue(typeof value === 'string' ? value : null)}
            query={comboboxQuery}
            onQueryChange={setComboboxQuery}
            options={Array.from({ length: 1000 }, (_, i) => ({ value: String(i), label: `Model ${i}` }))}
          />
          <ModiffMultiSelect
            aria-label="Long multiselect"
            value={multiSelect}
            onValueChange={setMultiSelect}
            options={Array.from({ length: 1000 }, (_, i) => ({ value: String(i), label: `Model ${i}` }))}
          />
        </section>
      ) : null}

      <div className="grid gap-4">
        <SizeExamples size="compact" />
        <SizeExamples size="normal" />
      </div>

      <section className="grid gap-4 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4">
        <h2 className="text-modiff-card-title font-semibold">Button states</h2>
        <div className="flex flex-wrap items-center gap-2">
          <ModiffButton data-testid="button-default">Default</ModiffButton>
          <ModiffButton data-testid="button-loading" loading>
            Loading
          </ModiffButton>
          <ModiffButton data-testid="button-disabled" disabled>
            Disabled
          </ModiffButton>
          <ModiffButton tone="danger">Danger</ModiffButton>
          <ModiffButton tone="ghost">Ghost</ModiffButton>
          <ModiffIconButton label="Matrix settings">
            <Settings size={15} />
          </ModiffIconButton>
        </div>
      </section>

      <section
        data-testid="specialized-controls"
        className="grid gap-4 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4"
      >
        <h2 className="text-modiff-card-title font-semibold">Media and specialized controls</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid content-start gap-2">
            <FileDropFrame
              activationLabel="Activate upload"
              gridColumns={1}
              onClick={() => setDropActivations((value) => value + 1)}
            >
              <span className="p-4 text-modiff-metadata text-modiff-subtle-text">Drop or choose a file</span>
            </FileDropFrame>
            <output data-testid="drop-result" className="text-modiff-metadata text-modiff-subtle-text">
              Upload activations: {dropActivations}
            </output>
          </div>
          <div className="grid content-start gap-2">
            <ImageFrame
              actionLabel="Open matrix image"
              alt="Matrix preview"
              aspectRatio="16 / 9"
              src={matrixImage}
              onClick={() => setImageActivations((value) => value + 1)}
            />
            <output data-testid="image-result" className="text-modiff-metadata text-modiff-subtle-text">
              Image activations: {imageActivations}
            </output>
          </div>
          <div className="h-40">
            <ImageCompareFrame
              aria-label="Matrix comparison"
              imageFrom={matrixImage}
              imageTo={matrixImage}
              sliderPosition={comparison}
              onSliderPositionChange={setComparison}
              onError={() => undefined}
              onMouseDown={() => undefined}
              onMouseMove={() => undefined}
              onMouseUp={() => undefined}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4">
        <h2 className="text-modiff-card-title font-semibold">Fields</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <ModiffFieldShell htmlFor={textId} label="Text" required description="Shared helper text">
            <ModiffInput id={textId} defaultValue="Editable value" />
          </ModiffFieldShell>
          <ModiffFieldShell label="Read-only" readOnly description="Managed by the workflow">
            <ModiffInput aria-label="Read-only field" value="Locked value" />
          </ModiffFieldShell>
          <ModiffFieldShell label="Disabled" disabled>
            <ModiffInput aria-label="Disabled field" value="Unavailable" />
          </ModiffFieldShell>
          <ModiffFieldShell label="Invalid" error="Enter a valid value">
            <ModiffInput aria-label="Invalid field" value="Invalid value" readOnly />
          </ModiffFieldShell>
          <ModiffFieldShell label="Search">
            <ModiffSearchInput
              aria-label="Search matrix"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              onClear={() => setSearch('')}
            />
          </ModiffFieldShell>
          <ModiffFieldShell label="Password">
            <ModiffPasswordInput aria-label="Password field" defaultValue="secret" autoComplete="off" />
          </ModiffFieldShell>
          <ModiffFieldShell label="Disabled search" disabled>
            <ModiffSearchInput
              aria-label="Disabled search"
              disabled
              value="Cannot clear"
              onChange={() => undefined}
              onClear={() => undefined}
            />
          </ModiffFieldShell>
          <ModiffFieldShell htmlFor={numberId} label="Number">
            <ModiffNumberInput
              id={numberId}
              min={0}
              max={10}
              step={1}
              value={number}
              onValueChange={(value) => setNumber(value ?? '')}
            />
          </ModiffFieldShell>
          <ModiffFieldShell htmlFor={textareaId} label="Textarea" error="Example validation message">
            <ModiffTextarea
              id={textareaId}
              defaultValue="Longer prompt text"
              maxLength={120}
              invalid
              showCharacterCount
            />
          </ModiffFieldShell>
          <ModiffFieldShell label="Select">
            <ModiffSelect
              aria-label="Sort order"
              data-testid="matrix-select"
              value={select}
              onValueChange={setSelect}
              options={[
                { value: 'recommended', label: 'Recommended', group: 'General' },
                { value: 'task', label: 'Task', group: 'General' },
                { value: 'model', label: 'Model', group: 'Technical' },
                { value: 'runtime', label: 'Runtime', group: 'Technical', disabled: true },
              ]}
            />
          </ModiffFieldShell>
          <ModiffFieldShell label="Multi-select">
            <ModiffMultiSelect
              aria-label="Media types"
              data-testid="matrix-multi-select"
              value={multiSelect}
              onValueChange={setMultiSelect}
              options={[
                { value: 'image', label: 'Image', group: 'Visual' },
                { value: 'video', label: 'Video', group: 'Visual' },
                { value: 'audio', label: 'Audio', group: 'Sound' },
              ]}
            />
          </ModiffFieldShell>
          <ModiffFieldShell label="Combobox">
            <ModiffCombobox
              aria-label="Model combobox"
              data-testid="matrix-combobox"
              query={comboboxQuery}
              value={comboboxValue}
              onQueryChange={setComboboxQuery}
              onValueChange={(value) => setComboboxValue(typeof value === 'string' ? value : null)}
              options={[
                { value: 'model', label: 'Model' },
                { value: 'runtime', label: 'Runtime' },
                { value: 'disabled', label: 'Disabled option', disabled: true },
              ]}
              placeholder="Find an option"
            />
          </ModiffFieldShell>
          <ModiffFieldShell htmlFor={fileId} label="Media picker">
            <ModiffFileInput id={fileId} aria-label="Choose media" accept="image/*,video/*,audio/*" />
          </ModiffFieldShell>
          <form
            data-testid="select-form"
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setFormResult(String(new FormData(event.currentTarget).get('readonly-sort') ?? ''));
            }}
          >
            <ModiffFieldShell label="Read-only select" readOnly>
              <ModiffSelect
                aria-label="Read-only sort"
                name="readonly-sort"
                readOnly
                value="model"
                onValueChange={() => undefined}
                options={[
                  { value: 'task', label: 'Task' },
                  { value: 'model', label: 'Model' },
                ]}
              />
            </ModiffFieldShell>
            <div className="flex items-center gap-2">
              <ModiffButton type="submit">Submit form</ModiffButton>
              <output data-testid="select-form-result" className="text-modiff-metadata text-modiff-subtle-text">
                {formResult || 'Not submitted'}
              </output>
            </div>
          </form>
        </div>
      </section>

      <section className="grid gap-4 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4">
        <h2 className="text-modiff-card-title font-semibold">Choices and navigation</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-3">
            <ModiffCheckbox checked={checked} label="Checkbox" onCheckedChange={setChecked} />
            <ModiffCheckbox
              checked={false}
              indeterminate
              data-testid="checkbox-indeterminate"
              label="Indeterminate checkbox"
              onCheckedChange={() => undefined}
            />
            <ModiffCheckbox
              checked
              invalid
              readOnly
              label="Invalid read-only checkbox"
              onCheckedChange={() => undefined}
            />
            <ModiffCheckbox checked label="Disabled checkbox" disabled onCheckedChange={() => undefined} />
            <ModiffSwitch checked={switched} label="Switch" onCheckedChange={setSwitched} />
            <ModiffSwitch checked label="Read-only switch" readOnly onCheckedChange={() => undefined} />
            <ModiffSwitch checked={false} label="Disabled switch" disabled onCheckedChange={() => undefined} />
            <ModiffRadioGroup
              aria-label="Performance profile"
              invalid
              value={radio}
              onValueChange={setRadio}
              options={[
                { value: 'quality', label: 'Quality' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'fast', label: 'Fast', disabled: true },
              ]}
            />
            <ModiffRadioCardGroup
              aria-label="Repair choice"
              value={radioCard}
              onValueChange={setRadioCard}
              options={[
                {
                  value: 'direct',
                  label: 'Direct repair',
                  description: 'Use the deterministic connection.',
                  meta: 'Direct',
                },
                {
                  value: 'choice',
                  label: 'Reviewed choice',
                  description: 'Choose a compatible alternative.',
                  meta: 'Choice',
                },
              ]}
            />
          </div>
          <div className="grid content-start gap-3">
            <label className="grid gap-1 text-sm text-modiff-text">
              <span>Slider: {slider}</span>
              <ModiffSlider
                aria-label="Matrix slider"
                min={0}
                max={10}
                step={1}
                value={slider}
                onValueChange={setSlider}
              />
            </label>
            <ModiffSlider
              aria-label="Read-only slider"
              min={0}
              max={10}
              value={4}
              readOnly
              invalid
              onValueChange={() => undefined}
            />
            <RangeSliderFrame aria-label="Matrix range" min={0} max={10} value={range} onChange={setRange} invalid />
            <div className="flex flex-wrap gap-2">
              <ModiffBadge>Passive badge</ModiffBadge>
              <ModiffBadge tone="success">Ready</ModiffBadge>
              <ModiffChip active={chip} onClick={() => setChip((value) => !value)}>
                Interactive chip
              </ModiffChip>
            </div>
            <ModiffTabList aria-label="Matrix sections">
              {[
                { value: 'appearance', label: 'Appearance', disabled: false },
                { value: 'behavior', label: 'Behavior', disabled: false },
                { value: 'disabled', label: 'Disabled', disabled: true },
              ].map((option) => (
                <div key={option.value} className="rounded-modiff-compact border border-transparent">
                  <ModiffTab
                    id={`matrix-tab-${option.value}`}
                    aria-controls={`matrix-panel-${option.value}`}
                    disabled={option.disabled}
                    selected={tab === option.value}
                    onSelect={() => setTab(option.value)}
                  >
                    {option.label}
                  </ModiffTab>
                </div>
              ))}
            </ModiffTabList>
            {['appearance', 'behavior', 'disabled'].map((panel) => (
              <div
                key={panel}
                id={`matrix-panel-${panel}`}
                role="tabpanel"
                aria-labelledby={`matrix-tab-${panel}`}
                hidden={tab !== panel}
                className="rounded-modiff-compact border border-modiff-border bg-modiff-bg p-2 text-modiff-metadata"
              >
                {panel === 'appearance' ? 'Appearance panel' : 'Behavior panel'}
              </div>
            ))}
            <ModiffDisclosure label="Disclosure" data-testid="matrix-disclosure" panelClassName="p-2 text-sm">
              Keyboard-operable disclosure content.
            </ModiffDisclosure>
            <ModiffProgress value={64} label="Matrix progress" />
          </div>
        </div>
      </section>

      <section className="grid gap-4 rounded-modiff-panel border border-modiff-border bg-modiff-surface p-4">
        <h2 className="text-modiff-card-title font-semibold">Portalled surfaces</h2>
        <div className="flex flex-wrap items-center gap-3">
          <ModiffMenu label="Actions">
            <ModiffMenuItem onClick={() => setMenuResult('Duplicate selected')}>Duplicate</ModiffMenuItem>
            <ModiffMenuItem active onClick={() => setMenuResult('Current selected')}>
              Current
            </ModiffMenuItem>
          </ModiffMenu>
          <ModiffButton data-testid="open-matrix-dialog" onClick={() => setDialogOpen(true)}>
            Open dialog
          </ModiffButton>
          <ModiffButton
            ref={popoverAnchorRef}
            aria-controls="matrix-popover"
            aria-expanded={popoverOpen}
            data-testid="open-matrix-popover"
            onClick={() => setPopoverOpen((value) => !value)}
          >
            Open popover
          </ModiffButton>
          <ModiffButton
            onClick={() =>
              enqueueSnackbar('Status notification', { variant: 'success', autoHideDuration: null, persist: true })
            }
          >
            Show status
          </ModiffButton>
          <ModiffButton
            onClick={() =>
              enqueueSnackbar('Error notification', { variant: 'error', autoHideDuration: null, persist: true })
            }
          >
            Show error
          </ModiffButton>
          <output className="text-sm text-modiff-subtle-text">{menuResult}</output>
        </div>
      </section>

      <ModiffPopover
        anchorRef={popoverAnchorRef}
        ariaLabel="Shared popover"
        onClose={() => setPopoverOpen(false)}
        open={popoverOpen}
        panelClassName="w-56 p-3 text-sm"
        panelId="matrix-popover"
        placement="bottom-end"
        testId="matrix-popover"
      >
        Portalled, collision-aware shared surface.
      </ModiffPopover>

      <ModiffDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Shared dialog"
        testId="matrix-dialog"
        footer={
          <>
            <ModiffButton onClick={() => setDialogOpen(false)}>Cancel</ModiffButton>
            <ModiffButton tone="primary" onClick={() => setDialogOpen(false)}>
              Confirm
            </ModiffButton>
          </>
        }
      >
        <p className="text-sm text-modiff-text">Focus is trapped and restored by the shared dialog primitive.</p>
      </ModiffDialog>
    </main>
  );
}
