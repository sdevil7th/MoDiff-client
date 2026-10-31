# Contributing To MoDiff Client

Thank you for helping improve MoDiff Client. This guide covers development setup, architecture and UI rules, testing, documentation, and pull-request expectations.

By submitting a contribution, you agree that it can be distributed under the repository's [Apache License 2.0](LICENSE). You are responsible for ensuring that contributed code, assets, prompts, media, model references, and generated examples can legally be included.

Before changing nodes, Blocks, graph persistence/execution, model qualification or
integrating another machine's work, read and follow
[Cluster engineering lessons and required procedure](docs/cluster-engineering-lessons.md).

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
4. Set up the compatible backend with native uv commands and this client with
   `npm ci`, then reproduce the issue before changing code. UI-only work can use
   an already-running compatible backend.
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

For the interim Windows candidate, use the published branch and exact paired
application revisions in the [quick start](README.md#developer-setup-with-uv-and-npm).
They have not been released on `main`; do not assume a checkout of `main` contains
the candidate's setup or workflow changes.

Required client versions:

- Node.js `24.12.0` (`.nvmrc`)
- npm `11.6.2` (`packageManager` and `engines` in `package.json`)

Use native uv and npm commands with the sibling backend and client checkouts.
In the backend terminal, run:

```text
uv sync --extra cpu
uv run --extra cpu python -m modiff.preflight --json --check-port 8088 --fail-on-error
uv run --extra cpu python main.py
```

For NVIDIA, use `--extra cuda` in each command; for Intel, use `--extra xpu`.
On Apple Silicon, omit the extra. Keep the same extra on sync and run. Use a
separate checkout to try another accelerator; native sync reconciles `.venv`.
AMD vendor-wheel environments use the backend's specialist
[accelerator setup](https://github.com/sdevil7th/MoDiff/blob/codex/windows-delivery-20261026/docs/accelerator-installation.md).

In the client terminal, run:

```text
npm ci
npm run dev
```

Open the URL printed by Vite and leave the backend running. Transformers and
PEFT are installed during backend setup; normal image and LoRA workflows need
no separate package activation. These commands work on Linux and Windows
PowerShell. The backend's
[developer guide](https://github.com/sdevil7th/MoDiff/blob/codex/windows-delivery-20261026/docs/developer-setup.md)
and the [Windows guide](docs/windows-support.md#developer-setup-with-uv-and-npm)
cover explicit `uv pip` setup, upgrades, repair, and platform details.

For UI-only work against an already-running backend, the same `npm ci` and
`npm run dev` commands are sufficient. To use another backend port:

```bash
VITE_BACKEND_PROXY_TARGET=http://127.0.0.1:8088 npm run dev -- --host 127.0.0.1 --port 5173
```

The repository launchers are optional convenience tools for integrated setup
or specialist reviewed profiles:

```powershell
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
```

```bash
chmod +x install-dev.sh run-dev.sh stop-dev.sh
./install-dev.sh --accelerator auto
```

Start the optional integrated launcher after setup:

```powershell
.\run-dev.ps1
```

```bash
chmod +x run-dev.sh stop-dev.sh
./run-dev.sh
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

The compatible backend may integrate model libraries officially maintained and published by Hugging Face. The browser does not run those libraries or a hosted inference provider. It consumes task-generic execution specifications from the backend and must not select Python classes or duplicate model-specific parameter logic. Hub hosting alone does not establish that a package or repository implementation is an official Hugging Face library.

Transformers and PEFT are required backend dependencies installed during ordinary setup. A verified base runtime must be runnable without a separate install or activation step. Template browsing, registry discovery, and Auto planning must not install packages. Additional optional runtimes still require an explicit backend installation action and verification before Run.

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

The standalone, model-backed canonical execution recorder is separate from public
templates. Its native integration remains incomplete; the command below does not
establish that an unchanged canonical workflow can yet produce an accepted receipt:

```bash
MODIFF_CANONICAL_WORKFLOW_EVIDENCE=/absolute/path/evidence.json node scripts/template-qualification.mjs --workflow ModelPipeline:text_to_image
```

The descriptor uses `schemaVersion: 1`, format
`modiff.canonical-workflow-evidence.v1`, and the exact `workflowId`. Its
`creatorPackage`, `outputPackage`, `runDetail`, `nodes`, `backendSourceBefore`,
`backendSourceAfter`, and `modelObservations` entries reference original observed
files using `{path, bytes, sha256}`. Paths must be relative, canonical, contained,
and free of symlinks. Source observations contain their actual `identity`; model
observations retain the ordinary model-list response. `outputs` contains ordered
`{backendPath, mediaType, file}` entries for the unchanged durable media. Retain
the original browser downloads and raw task body; do not reconstruct their
fields from a catalog or replace defaults, paths, prompts, or model pins.

For the initial hinted DDIM accounting route, also retain `graphCompleted` as a
`{path, bytes, sha256}` reference to the **original** `graph_completed` WebSocket
JSON frame (at most 16 MiB). Public run-detail GET responses deliberately omit
`runtimeHints`; do not add invented hints to them. The shared factory and reader
join the submitted hints, frame, raw task, output and consumed receipt by
task/session/client-run/input-hash/workflow/canvas epoch, attempt zero, complete
runtime/source identity and measurement. The frame has no attempt index or
completion timestamp; those remain bound to the original raw task.

This initial path supports input-free execution only (`inputs: []`). Every
submitted literal must have matching native consumed-input evidence; omissions,
overrides, unsupported scalar connections, unresolved model components, retries,
and fallback attempts remain held. Input-backed workflows need a durable,
execution-bound input-byte receipt: a post-run file copy or a current cache hash
alone is insufficient. The existing normal exporter must be able to export the
unchanged canonical graph without an inferred execution scope. Deterministic
builtin workflows remain explicitly unsupported because model identity is not
applicable; do not invent a model for them.

The optional native `fieldAccounting` extension preserves requested literals,
actual call controls, explicit inactive/superseded controls, and bounded recipe
projections separately from legacy v1 fields and summaries. The client parser
retains its completeness/truncation status without changing v1 normalization.
Parsing a projection hash is not cryptographic verification. The independent
canonical accounting join verifies metadata hashes, connected producer ports,
disabled quantization and the unique executed loader for the unchanged five-node
DDIM workflow. Preview's CPU setting does not describe model placement. The shared
provenance factory accepts an optional canonical proof from the existing reader:
the trusted current canonical export, actual original task/output and complete
native accounting. It derives the plan itself and binds task, attempt, output,
model and completion identities without adding runtime hints or rewriting proofs.
The optional hinted policy accepts only the existing ordinary five-node,
unquantized float32 resident DDIM CIFAR-10 graph, either correlation-only or the
actual Studio Expert producer payload. It rejects unknown hints, coercions,
Auto, nonempty retry plans/history, offload, model variants and unsupported
execution authority. It accounts for the full saved observation form and the
actual advisory CUDA reset decision; `fraction: 1` alone does not prove that a
reset succeeded. Hinted and unhinted accounting also check the complete current,
submitted and creator API envelopes: only `sid`, `nodes`, `paths`, the reviewed
`runtimeHints`, and an optional empty `loops` array are admitted. Nonempty or
malformed loops, service execution, deterministic/provenance routes and unknown
top-level authority need separate accounting; the historical canonical identity
alone does not cover them. Submitted and original completion hashes become part of the
derived plan. The recorder retains the original frame unchanged, and the release
projection repeats the same closed validation. Valid legacy unhinted descriptors and
the default factory path remain unchanged. Input files, builtins, quantized
configurations and other accounting policies remain unsupported by this initial
join. A genuine unchanged native DDIM run is still required before a usability
claim. Mocked protocol checks are not native, quality, hardware or release evidence.

The recorder copies original evidence under the backend's ignored
`data/qualification/release/canonical-workflow-evidence/` directory and records
`canonical-workflow-run-receipts.v1.json`. Release-contract generation repeats the
same validation against current canonical source and retained bytes. A verified
receipt is **execution evidence only**: quality, rights, hardware qualification,
and release approval remain false. It does not make standalone workflows release
eligible, promote local review receipts, or change ordinary template recording
and Gallery publication policy.

The optional native `appliedAdapters` receipt records the owning ModelsLoader's
observed ordered adapter names, numeric scales, immutable artifact identities,
opaque descriptor hashes and explicit scheduler override digest. It carries a
fresh application identity after activation/removal; valid owner reuse retains
that identity with a `reused` observation. Missing or unavailable evidence is not
an empty adapter set. The history parser only checks the bounded schema. The
shared provenance factory verifies and locks present observations against the
original task/attempt, output snapshot and executed ancestor owner.
`validateAppliedAdapterProof(provenance, {required: true})` additionally requires
complete evidence matched to the ordered native Lora chain and model pins for
explicit adapter-order acceptance. Its initial strict scope
is pinned Hub adapters with explicit names and no scheduler override. Submitted
LoRA scale controls may be numeric or bounded decimal text accepted by the
backend's finite float conversion, including decimal exponents. Only that scale
comparison uses numeric normalization; original graph/export bytes and hashes
remain unchanged. Empty or padded strings, non-decimal syntax, non-finite or
out-of-range values, and coercible booleans/objects are rejected. Native observed
scales must still be numbers, and mismatched applied scales remain failures. Ordinary
template recording does not acquire this new requirement: historical absent-field
proofs retain their original submitted-graph proof level. This extension grants
no style, quality, hardware, rights or publication approval.

## Custom extension changes

Keep Add custom node, the strict response parser and backend hash-bound imports in sync. Intentional Add/Load/Reload is consent; discovery and graph import are not. Test import failure, changed source, missing dependencies, typed search and registry refresh. Use the normal graph executor. See the backend `docs/custom-nodes.md`.

## Testing

Run the complete local CI-equivalent gate before requesting review:

```bash
npx playwright install chromium
npm run check
```

This runs formatting, lint, type checking, style audit, unit/contract tests, production build, and bundle budget.
The request/proxy regression tests also launch Chromium. On a fresh Linux host,
install its system dependencies with `npx playwright install-deps chromium`
using an account with administrator access before running the gate.

The Linux CI quality and browser jobs check out this client and an immutable,
compatible `sdevil7th/MoDiff` backend revision as sibling directories. Both install
the backend with `uv sync --extra cpu --locked`, install test dependencies, and
run preflight and the tiny native image/LoRA smoke. The quality job runs the
client gate; the browser job builds the production client and runs the complete
browser gate within its own job budget.
This setup does not download model weights or qualify accelerator execution;
platform smoke jobs remain client-only.

For a coordinated change, commit and review the backend first, then replace the
backend `ref` in both jobs in `.github/workflows/ci.yml` with that actual compatible
40-character commit SHA and run the paired gates. Keep both refs immutable and
equal. The selected backend must contain its reviewed native setup contract and
`uv.lock`; the workflow
checks these before setup. Do not substitute a mutable branch or an invented
future SHA for the paired commit.

The registered Block catalog audit uses a fixed Linux runtime target and mocked
device/package probes to reproduce the reviewed catalog on any host. Backend
schemas, field actions, capability generation, and compiler validation remain real;
the audit checks the existing definition hashes and complete decoded catalog bytes
(gzip packaging varies across operating systems and zlib versions). This
is contract evidence, not live hardware or model qualification. Python catalog and
starter-fixture subprocesses suppress custom-extension discovery: they must not
execute or change the operator’s installed source approvals.

Mocked operation-authoring tests generate backend starter schemas once per test
worker and use deep copies per scenario. Keep source contracts fixed during a
run; never share mutable fixture objects or reuse this cache across test runs.

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

Local `reviews/`, `checkpoints/`, and `maintenance/` directories are ignored.
Keep handoff notes and raw proof bundles there or outside the checkout. Review
`git status --short`, `git diff --cached --stat`, and `git diff --cached --check`
before committing, then inspect staged content: ignore rules do not remove
already tracked files. Retain source fixtures, generated contract bindings, and
intentional UI assets that the application uses.

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
