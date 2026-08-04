# Contributing To MoDiff Client

Thank you for helping improve MoDiff Client. This guide covers development setup, architecture and UI rules, testing, documentation, and pull-request expectations.

By submitting a contribution, you agree that it can be distributed under the repository's [Apache License 2.0](LICENSE). You are responsible for ensuring that contributed code, assets, prompts, media, model references, and generated examples can legally be included.

## Before You Start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue to discuss large features, backend contract changes, new model families, dependency/framework changes, or behavior that changes stored/exported data.
- Use [SECURITY.md](SECURITY.md) for vulnerabilities. Never put exploit details or secrets in a public issue.
- Keep a pull request focused on one coherent outcome. Separate unrelated refactors, dependency updates, and product changes.
- Preserve legacy graph, storage, endpoint, and websocket compatibility unless the accepted change includes a migration plan.

Good first contributions include reproducible bug fixes, accessibility improvements, tests for current behavior, durable documentation corrections, and small UI improvements that extend existing patterns.

## Fork, Branch, And Submit

1. Fork the public repository, then clone your fork.
2. Add the canonical repository as an `upstream` remote so you can keep the branch current.
3. Create a short-lived branch from the latest `upstream/main`.
4. Use the development installer for integrated work, or `npm ci` for UI-only
   work against an already-running compatible backend, and reproduce the issue
   before changing code.
5. Make the smallest coherent change, including tests and docs.
6. Run the required checks and review the complete diff.
7. Rebase or merge the current `upstream/main` according to the repository's accepted workflow; resolve conflicts without discarding unrelated work.
8. Push the branch to your fork and open a pull request against `main`.

Example:

```bash
git clone https://github.com/<your-account>/MoDiff-client.git
cd MoDiff-client
git remote add upstream https://github.com/<project-owner>/MoDiff-client.git
git fetch upstream
git switch -c fix/concise-description upstream/main
npm ci
```

Use clear commit messages that describe the outcome. Maintainers may squash a pull request when merging, so keep the branch reviewable rather than manufacturing a particular final history.

## Development Environment

Required client versions:

- Node.js `24.12.0` (`.nvmrc`)
- npm `11.6.2` (`packageManager` and `engines` in `package.json`)

For integrated development with sibling repositories, install the reviewed
backend profile, backend test requirements, and exact client lockfile through
the development installer:

```powershell
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
```

```bash
chmod +x install-dev.sh run-dev.sh stop-dev.sh
./install-dev.sh --accelerator auto
```

For UI-only work against an already-installed backend, install only the client
dependencies exactly from the lockfile:

```bash
npm ci
```

Run the client against a compatible sibling backend:

```powershell
.\run-dev.ps1
```

```bash
chmod +x run-dev.sh stop-dev.sh
./run-dev.sh
```

For UI-only work, run Vite against an already-running backend:

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088 npm run dev -- --host 127.0.0.1 --port 5173
```

The [README](README.md) and [troubleshooting guide](docs/troubleshooting.md) cover backend paths, ports, preflight, and platform details.

## Project Map

Read [the architecture guide](docs/modiff-client-architecture.md) before changing graph, runtime, Studio, persistence, or network behavior.

| Path                      | Responsibility                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/components`          | Feature and app-shell React components                                                                         |
| `src/fields`              | Backend-defined node parameter/output fields                                                                   |
| `src/stores`              | Zustand graph, settings, registry, task, websocket, Studio, and user-block state                               |
| `src/studio`              | Model/task profiles, templates, graph bridge, readiness, Auto planning, run attribution, outputs, and packages |
| `src/theme`               | Visual tokens, colors, backend style sanitizer, and React Flow style helpers                                   |
| `src/ui`                  | Shared UI primitives and toast provider                                                                        |
| `src/utils`               | Request, graph-run, server action, upload, field-action, and general helpers                                   |
| `src/workflow`            | Canvas connection/drop/interaction hooks                                                                       |
| `scripts`                 | Unit/contract, Gallery, style, and bundle tooling                                                              |
| `tests/e2e`               | Playwright browser coverage                                                                                    |
| `config`                  | Versioned Gallery storage manifest and other source contracts                                                  |
| `public/template-gallery` | Ignored local/offline Gallery cache; only explicitly retained small metadata belongs in Git                    |

## Core Architecture Rules

- `useFlowStore` and the visible canvas are the single graph execution source of truth.
- Studio must create/reconcile that graph; do not add a second hidden workflow format.
- Keep Zustand. Use typed selectors and `useShallow` when reading multiple values.
- Treat network, websocket, localStorage, imported package, and backend dynamic-node values as `unknown` until narrowed.
- Keep request parsing, timeout, stale-response, and mutation ordering explicit.
- Preserve run/task/client-run/attempt attribution across workflow tabs and asynchronous updates.
- Keep backend endpoint and websocket field names stable unless a coordinated client/backend migration is part of the change.
- Keep localStorage migrations from legacy keys; do not strand existing user workflows.
- A model profile, registry key, cached directory, mocked test, and live model output are different proof levels. Document them separately.

For a large component, extract domain behavior into hooks/modules before adding another responsibility. `StudioPanel`, `Workflow`, flow mutations, websocket handling, graph export, and Studio contracts already use that pattern.

## Stack And Dependency Policy

MoDiff Client uses React 19, TypeScript, Vite, Tailwind CSS, Headless UI, Lucide React, Zustand, and `@xyflow/react`.

- The local toast provider in `src/ui` replaces `notistack`.
- Do not reintroduce MUI, Emotion, styled-components, CSS modules, Redux, or another broad UI/state framework without an accepted proposal, bundle measurement, migration scope, and regression plan.
- Prefer platform/browser APIs and existing dependencies for small needs.
- Keep dependencies tied to a documented product or technical requirement.
- Review lockfile changes, licenses, install scripts, bundle impact, and browser support.
- Do not run `npm audit fix --force` or broad dependency upgrades as part of an unrelated change.

## Design Tokens And Theme

Use `src/theme` as the source of visual constants:

- `src/theme/modiff.css`: Tailwind theme tokens
- `src/theme/designTokens.ts`: TypeScript values for code that cannot use classes
- `src/theme/categoryColors.ts`: React Flow category and handle colors
- `src/theme/modiffStyle.ts`: sanitizer for backend-provided layout styles
- `src/theme/reactFlowStyles.ts`: generated React Flow style helpers

Primary brand tokens:

| Token                                            | Value     | Use                                            |
| ------------------------------------------------ | --------- | ---------------------------------------------- |
| `hf-yellow` / `modiffColors.primary`             | `#FFD21E` | Primary actions, selected tabs, and highlights |
| `hf-orange` / `modiffColors.primaryGradientEnd`  | `#FF9D00` | Warning/accent states and gradients            |
| `modiff-subtle-text` / `modiffColors.subtleText` | `#94A3B8` | Muted labels, metadata, and helper text        |

Core dark tokens:

| Token            | Value     | Use                             |
| ---------------- | --------- | ------------------------------- |
| `modiff-bg`      | `#0B0F19` | App background                  |
| `modiff-surface` | `#101623` | Panels, dialogs, and menus      |
| `modiff-panel`   | `#141C2E` | Secondary grouped surfaces      |
| `modiff-border`  | `#1E2939` | Borders and dividers            |
| `modiff-text`    | `#F9FAFB` | Primary text                    |
| `modiff-blue`    | `#3080FF` | Informational and graph accents |
| `modiff-red`     | `#FB2C36` | Errors and destructive actions  |
| `modiff-green`   | `#00BAA7` | Success and valid connections   |

Fonts are Source Sans Pro for UI and IBM Plex Mono for monospaced text. Use compact project radii such as `rounded-modiff-compact` and `rounded-modiff-panel`.

The palette is part of MoDiff's design language. Do not add Hugging Face logos, mascots, or brand assets.

## Styling Rules

- Prefer Tailwind utility classes and MoDiff tokens.
- Use `src/ui` primitives before writing repeated visual structure.
- Do not add raw hex colors, `rgb()`/`rgba()`, direct `fontSize`, direct `borderRadius`, one-off `boxShadow`, or JSX `style={...}` in feature components.
- Add a reusable visual constant to `src/theme` first.
- Keep `src/App.css` limited to browser globals, React Flow internals, and behavior hooks such as `modiff-field`, `nodrag`, and `nowheel`.
- Keep panels dense and practical; this is an operational graph tool, not a marketing landing page.
- Run `npm run style:audit` after any visual change.

Raw visual literals are allowed only in approved visual source areas such as `src/theme` and `src/ui`. The style audit prevents new unmanaged literals elsewhere.

See the [frontend style guide](docs/frontend-style-guide.md) for the current primitive catalog and examples.

## Component Rules

Feature components should describe behavior and layout. Reusable presentation belongs in `src/ui`.

Create or extend a shared primitive when a pattern appears more than once, especially for:

- Buttons, icon buttons, menus, tabs, dialogs, popovers, and anchored panels
- Inputs, selects, sliders, checkboxes, chips, progress, status, and toolbars
- Field shells, node frames, media frames, file drops, option grids, and tree rows

Prefer composition over a new one-off component system. A feature component can own domain-specific copy and state, but should not recreate shared button, panel, field, or status styling.

Use explicit Lucide imports:

```tsx
import { Play, Settings } from 'lucide-react';
```

Do not add dynamic icon registries or broad namespace imports.

## Headless UI And Accessibility

Use Headless UI through `src/ui` wrappers when it provides meaningful behavior:

- Dialog/menu focus management and Escape handling
- Keyboard-accessible tabs, listboxes, or comboboxes
- Shared interactive primitives with nontrivial ARIA state

Simple static panels and native inputs should remain native when that is clearer and smaller.

Every interaction must preserve:

- Accessible name for icon-only buttons
- Keyboard and visible focus behavior
- Dialog title, close path, Escape/backdrop policy, and bounded scroll
- Non-hover-only access to essential actions
- Text fit at supported desktop/mobile widths
- Appropriate live/status semantics for progress and errors
- Reduced ambiguity between warnings, blockers, and runnable state

## Field Components

Fields bridge backend node definitions and React Flow behavior:

- Use `FieldFrame` for native fields.
- Preserve `data-key`, `modiff-field`, hidden, and disabled hooks.
- Preserve `nodrag` and `nowheel` where the canvas would otherwise intercept interaction.
- Apply backend-provided `props.style` only through the field root's sanitized layout path.
- Ignore backend visual styling; dynamic styles are layout-only.
- Preserve `onChange`/`onSignal` field actions and initial synchronization.

If a custom field becomes broadly useful, move it into the built-in field system and shared primitives instead of copying custom styling.

## Network, Persistence, And Security

- Use `requestJson` and provide a response parser for persistent, graph, model, or security-sensitive data.
- Use finite timeouts appropriate to the operation. Model-store inspection can legitimately need more time than a small UI request.
- Prevent delayed reads/mutations from overwriting newer state.
- Do not persist volatile dialog, request, graph-binding, websocket, or active-run state without a documented recovery reason.
- Never commit tokens, account information, private media, machine paths, cache inventories, or environment dumps.
- Treat model repositories, custom modules, and custom fields as trusted operator-selected code/content; document new trust implications.
- Review exported/public provenance for local paths, source commits, and sensitive metadata.

Read [Privacy and security](docs/privacy-and-security.md) before changing uploads, outputs, storage, exports, provenance, remote URLs, model install, or deployment behavior.

## Templates, Models, And Gallery

When adding or changing a template:

1. Use a concrete task-specific production brief, not placeholder quality words.
2. Declare model/task compatibility and required input media.
3. Keep generation defaults compatible with the selected model family.
4. Keep blocked backend/artifact requirements explicit.
5. Add/update template and quality tests.
6. Update Gallery coverage and evidence only when the publication contract is met.

When adding a model or mode, follow the checklist in [Auto mode design](docs/auto-mode-design.md). Do not mark a profile Auto-ready from schema or mocked UI evidence alone.

Public Gallery changes must keep manifest paths, media types, reviews, and redacted provenance consistent. Run:

```bash
npm run gallery:verify
npm run gallery:coverage
```

Do not publish a local artifact, private input, personal path, access token, or source revision through a Gallery bundle.

## Testing

Run the complete local CI-equivalent gate before requesting review:

```bash
npm run check
```

This runs formatting, lint, type checking, style audit, unit/contract tests, production build, and bundle budget.

Run the mocked browser gate for behavior or layout-sensitive changes:

```bash
npx playwright install chromium
npm run check:ui
```

Use narrower commands while iterating:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run style:audit
npm run test:unit
npm run build
npm run bundle:check
```

Test expectations by change type:

| Change                        | Expected evidence                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Pure documentation            | Prettier/Markdown link validation and command cross-check                          |
| Utility/store/domain logic    | Focused unit/contract test plus `npm run check`                                    |
| UI behavior or layout         | Unit coverage where appropriate, `npm run check`, and relevant Playwright scenario |
| Request/websocket/persistence | Boundary parser, stale-order/migration test, and browser flow when user-visible    |
| Template/Gallery              | Template/quality tests plus Gallery verify/coverage                                |
| Real model claim              | Static/mocked gates plus separate live backend output evidence on the claimed path |

Do not claim a real model fix from inspection or mocked tests alone. Report implementation, automated UI evidence, backend schema/runtime evidence, and live output evidence separately.

## Documentation

- Update the README/user guide when setup, interface labels, support bounds, or commands change.
- Update architecture/style/Auto docs when their contracts change.
- Keep [the docs index](docs/README.md) current when adding or removing a durable guide.
- Use portable repository-relative paths and sanitized examples.
- Do not commit dated execution trackers, personal environment audits, or temporary handoff notes as permanent public guides.
- Verify local Markdown links and run Prettier.

For a docs-only change, run at minimum:

```bash
npm run format:check
```

Then verify that every repository-relative Markdown link resolves and that every command still exists in `package.json`, the launch scripts, or the compatible backend. Run the full `npm run check` when documentation changes package/config examples, generated public assets, TypeScript snippets, or behavior-sensitive claims.

## Generated And Local Files

- Do not commit `node_modules/`, `dist/`, `artifacts/`, `output/`, `playwright-report/`, `test-results/`, logs, `.env`/`.env.*` secrets, or `vite.config.local.ts`. A deliberately sanitized `.env.example` is the only environment-file exception.
- Do not commit copied backend `web/` output to this client repository.
- Commit `package-lock.json` only when the dependency manifest or resolved dependency graph intentionally changes; review install scripts and transitive changes.
- Do not commit Gallery media under `public/template-gallery/`. Publish reviewed
  files to the pinned public Hugging Face Dataset, and commit only the storage
  manifest, source descriptor, generated bindings, and explicitly retained
  small Gallery metadata described in the asset guide.
- Do not add large generated media, model weights, cache snapshots, or runtime evidence outside an accepted public-asset change.
- Keep screenshots/traces in pull-request attachments rather than the repository unless they are durable, licensed documentation assets.

## Pull Requests

A strong pull request includes:

- A concise problem and outcome
- User-visible behavior and how to use it
- Scope boundaries and compatibility impact
- Tests actually run with results
- Screenshots/video for meaningful visual changes, with sensitive data removed
- Model/backend proof level when relevant
- Documentation and migration notes
- Known limitations or follow-up work

Before submitting:

1. Review the complete diff, including lockfiles, generated/public assets, and deletions.
2. Remove debug logs, local config, test artifacts, personal paths, and credentials.
3. Run the required checks.
4. Complete the pull-request template honestly; explain every skipped gate.
5. Rebase or resolve conflicts without discarding unrelated upstream changes.

AI-assisted contributions are welcome, but the contributor remains responsible for understanding the change, verifying it, and responding to review. Do not submit generated code or documentation that has not been checked against the repository.

## Code Of Conduct

Participation in this project is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Be constructive, assume good intent, and focus review on the work and its impact.
