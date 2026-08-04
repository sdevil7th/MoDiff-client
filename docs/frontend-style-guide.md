# Frontend Style Guide

MoDiff Client is a dense graph-first tool. New UI should be Tailwind/headless-first, compact, accessible, and practical. `CONTRIBUTING.md` is the source of truth for repo-wide rules; this document explains the design-system details.

## Source Of Truth

- `src/theme/modiff.css` owns Tailwind theme tokens.
- `src/theme/designTokens.ts` owns TypeScript design tokens.
- `src/theme/categoryColors.ts` owns graph category and handle colors.
- `src/theme/modiffStyle.ts` owns backend style sanitizers.
- `src/ui` owns reusable visual primitives.
- `src/App.css` is only for global browser styling, React Flow internals, and behavior hooks.

## Graph-First UX Guardrails

MoDiff is a graph editor first. The canvas and nodes own graph editing; panels should make common actions faster without becoming a second copy of the graph.

- Studio is the quick-action surface. It should show the current task, one compact readiness state, and the controls needed to run or edit the selected thing.
- Setup is the diagnostic surface. Missing models, backend problems, device issues, and detailed remediation belong there or in focused dialogs.
- The graph and nodes are the source of truth for node params. Side panels may inspect or edit the selected node, but should not mirror every graph parameter by default.
- The model library should launch work on the canvas. Clicking an installed model should create the matching loader node with that model selected.
- Prefer progressive disclosure: show the next useful action now, keep explanations behind tooltips, dialogs, Setup, or details views.
- Keep visible text compact. A readiness row should say `Ready`, `Blocked`, or `Setup needed`; it should not explain hardware plans or model rationale inline.

## Graph-First Interaction Patterns

Use these patterns when adding or changing Studio, Setup, graph, library, or model UI:

- Use an action row when a state expects a user decision. `Run blocked` should be the clickable row, not a passive card with a hidden-looking button inside it.
- Put the direct fix in the row. A missing model row should show `Install`; backend trouble should show `Refresh` or `Open setup`; node trouble should show `Select node`.
- Show selected-node editing before graph-wide editing. If a node is selected, Studio should inspect that node. If nothing is selected, Studio may show only pinned graph inputs.
- Pin graph inputs deliberately. Default pins should be common run controls such as prompt, model, seed, steps, size, guidance, and media inputs; avoid showing every node parameter by default.
- Treat Templates as starters. Template entry points belong in an empty-graph state or a global launcher, not inside the active graph inspector.
- Keep diagnostics collapsed until requested. Paths, package scans, repo ids, node ids, and hardware rationale are useful for support, not for the default task flow.
- Libraries create graph objects. Node, model, workflow, and user-block libraries should add or open things on the canvas rather than acting as passive inventories.
- Toolbars should be icon-first with fast tooltips. Use text only when the command is unclear without it or when the action is destructive/irreversible.
- Ready states should usually disappear. If everything is fine, leave room for the user's graph instead of filling panels with success badges.

Avoid these anti-patterns:

- Paragraph-heavy readiness cards in Studio.
- Repeated badge clusters for the same backend/model/graph/device state.
- Decorative status colors that do not change the next action.
- Badges inside a section that already communicates the same status, such as `Ready` inside an installed-model list.
- Disabled-looking controls that do not perform a visible action.
- Duplicating graph state in side panels instead of selecting or editing nodes on the canvas.
- Showing legacy or advanced surfaces as primary tabs when the user has not intentionally opened that feature.
- A separate button inside a status card when the whole card should be the button.
- Showing the same model under both installed and supported lists.
- Always-visible starter/template actions in a non-empty workflow.
- Side-panel all-param dumps for large graphs.
- Error text without a visible action the user can take.

## Theme Tokens

Use token classes such as `bg-modiff-bg`, `bg-modiff-surface`, `border-modiff-border`, `text-modiff-text`, `bg-hf-yellow`, and `text-hf-orange` instead of literal values in feature code.

| Token                | Value     | Purpose                                 |
| -------------------- | --------- | --------------------------------------- |
| `hf-yellow`          | `#FFD21E` | Primary action and selected state       |
| `hf-orange`          | `#FF9D00` | Accent, warning, gradient end           |
| `modiff-subtle-text` | `#94A3B8` | Muted labels, metadata, and helper text |
| `modiff-bg`          | `#0B0F19` | App background                          |
| `modiff-surface`     | `#101623` | Panels, dialogs, menus                  |
| `modiff-panel`       | `#141C2E` | Secondary panels and grouped controls   |
| `modiff-border`      | `#1E2939` | Borders and dividers                    |
| `modiff-text`        | `#F9FAFB` | Primary text                            |
| `modiff-blue`        | `#3080FF` | Info and graph accents                  |
| `modiff-red`         | `#FB2C36` | Errors and destructive actions          |
| `modiff-green`       | `#00BAA7` | Success and valid connection states     |

The Hugging Face-inspired colors are palette tokens only. Do not use Hugging Face logos, mascots, or brand assets.

Fonts are Source Sans Pro for UI and IBM Plex Mono for mono text. Use `rounded-modiff-compact`, `rounded-modiff-panel`, and `shadow-modiff-node` instead of direct radius or shadow values.

## Styling Rules

- Prefer Tailwind utilities and MoDiff tokens.
- Add new visual constants to `src/theme` before consuming them.
- Prefer a `src/ui` primitive when a style pattern appears more than once.
- Do not add raw hex colors, `rgb()` / `rgba()`, inline `style={...}`, direct `fontSize`, direct `borderRadius`, or one-off `boxShadow` in feature components.
- Keep global selectors out of feature work unless styling a third-party class that cannot be reached through component markup.
- Keep panels dense and work-focused. Avoid oversized hero layouts, marketing cards, decorative gradients, or purely illustrative UI.

## `src/ui` Primitive Catalog

Use or extend these before creating feature-local visual systems:

- General controls: `ModiffButton`, `ModiffIconButton`, `ModiffInput`, `ModiffSearchInput`, `ModiffNumberInput`, `ModiffTextarea`, and `ModiffFieldShell`.
- Choice and selection controls: `ModiffSelect`, `ModiffMultiSelect`, `ModiffCombobox`, `ModiffCheckbox`, `ModiffSwitch`, `ModiffRadioGroup`, `ModiffRadioCardGroup`, and `ModiffSlider`.
- Navigation and overlays: `ModiffTabs`, `ModiffTabList`, `ModiffTab`, `ModiffDialog`, compound `ModiffMenu*` primitives, `ModiffTooltip`, `ModiffPopover`, `ModiffDisclosure`, and `ModiffFileInput`.
- Metadata: `ModiffBadge` for passive state and `ModiffChip` for interactive filters; interactive chips expose `aria-pressed`.
- Panels and status: `StatusBox`, `ProgressBar`, `ModiffProgress`, `IssueCard`, `StatusActionChip`.
- Graph/node frames: `CustomNodeFrame`, `CustomNodeHeaderFrame`, `AnyNodeFrame`, `NodeResizeHandle`, `AnchoredPanel`, `TreeButtonRow`, `TreeStaticRow`.
- Fields and media: `FieldFrame`, `NumberFieldFrame`, `RangeSliderFrame`, `FileDropFrame`, `ImageFrame`, `ImageCompareFrame`, `SelectOptionGrid`.
- Studio-specific controls: `StudioButton`, `StudioIconButton`, `StudioInput`, `StudioTextInput`, `StudioSelect`, `StudioCheckbox`, `StudioSlider`, `StudioChip`, `SectionHeader`, `StatusLine`, `Spinner`.
- Notifications: `ModiffSnackbarProvider`, `enqueueSnackbar`, `closeSnackbar`, `useSnackbar`.

When a feature needs a repeated visual pattern that is not listed here, add a small primitive to `src/ui` and export it from `src/ui/index.ts`.

Shared primitives own focus, disabled/read-only/required/invalid state, label and description associations, portal layering, and selected-value behavior. Feature and graph wrappers may add domain actions and preserve `nodrag`/`nowheel`, but must not recreate those contracts or import the underlying Headless UI control directly. Standalone actions use the shared 28px compact, 32px dense, 36px normal, or 40px prominent sizes.

## Headless UI Policy

Headless UI should enter the app through `src/ui` wrappers. Use it when it provides meaningful accessibility or state behavior:

- Dialog focus trapping, escape handling, and backdrop behavior.
- Menus with keyboard navigation and focus state.
- Tabs or listbox/combobox-like controls with nontrivial keyboard state.

Do not import `@headlessui/react` directly in feature components unless the change is creating or extending a shared primitive. Do not replace simple native controls with Headless UI just for consistency; bundle size and clarity matter.

## Field Components

- Field roots must preserve `data-key` and behavior hooks that Workflow relies on.
- Use `FieldFrame` for all native fields.
- Keep `nodrag` and `nowheel` classes where they control React Flow interaction behavior.
- Apply backend-provided `props.style` only through `layoutStyle` at the root.
- Backend style objects are layout-only escape hatches. They may adjust sizing, layout, overflow, grid/flex placement, and spacing. They must not override colors, typography, borders, shadows, or radii.

Unsupported backend style keys are ignored in development with a console warning.

## Accessibility

- Icon-only buttons need an `aria-label`, `title`, or primitive prop that supplies both.
- Dialogs need a title, close path, bounded scroll area, and escape/backdrop behavior.
- Menus and tabs need keyboard/focus behavior when they are not simple static controls.
- Text must fit inside compact controls across supported viewport widths.
- Essential actions must not be hover-only.

## Enforcement

Use:

```powershell
npm run style:audit
npm run test:styles
```

The audit compares current visual-literal debt against `scripts/style-audit-baseline.json`. It fails when a file increases raw colors, inline styles, direct font sizes, direct radii, direct shadows, or global CSS selectors over the baseline.

The style test checks that backend-provided field/node styles stay layout-only and that global MoDiff behavior hooks remain present.

Only update the baseline when intentionally reclassifying debt or after reducing violations.
