# MoDiff Client Architecture

This document describes the current frontend structure, ownership boundaries, data flow, persistence, and extension points. Update it in the same change when a subsystem moves or a public contract changes.

## System Boundary

MoDiff Client is a browser application. It does not execute model pipelines itself.

```text
React/Vite client
  |-- HTTP requests: registry, files, models, queue, graphs, outputs, setup
  |-- Websocket: node definitions, values, task state, progress, failures
  `-- Static assets: built bundle and template Gallery
          |
          v
MoDiff Python backend
  |-- node registry and graph executor
  |-- reviewed Hugging Face model-library adapters
  |-- model/artifact/optional-runtime management
  |-- files, previews, uploads, workflows, and Studio outputs
  `-- integrated static-file host
```

`app.config.ts` chooses the HTTP origin. In an integrated build it defaults to `window.location.origin`. In development, Vite proxies the paths listed in `vite.config.ts` to `VITE_BACKEND_PROXY_TARGET` (default `http://127.0.0.1:8088`). `VITE_SERVER_ADDRESS` bypasses that same-origin default and should be used only with deliberate cross-origin backend configuration.

The frontend treats backend responses, websocket messages, local storage, dynamic node definitions, and imported packages as untrusted data at their boundaries. Use parsers/type guards before storing or rendering them.

The backend may use official model libraries maintained and published by Hugging Face, but the client remains runtime-agnostic. It renders backend-declared task inputs, parameters, outputs, missing optional runtimes, and readiness instead of selecting library classes or maintaining model-specific execution branches. The browser never loads a model runtime or invokes a hosted inference provider.

## Technology

- React 19 and TypeScript
- Vite 8 and Tailwind CSS 4
- `@xyflow/react` for graph rendering/editing
- Zustand for client stores and persistence
- Headless UI through local wrappers where focus/keyboard semantics are nontrivial
- Lucide React icons
- Local MoDiff toast/snackbar provider
- Node's test runner for unit/contract tests
- Playwright for mocked browser flows

`src/theme` owns visual constants; `src/ui` owns reusable presentation primitives. Feature code should not create a parallel design system or state framework.

## Bootstrap And App Shell

- `src/main.tsx` mounts the app inside `ModiffSnackbarProvider`, `WebsocketProvider`, and `ReactFlowProvider`.
- `src/App.tsx` owns the top bar, left rail/panels, central canvas, workflow tabs, right workspace, and app-level Gallery/issues dialogs.
- `src/components/TopBar.tsx` owns New, workflow Save/Save as, Export, graph-fix review, Auto/Expert, Run mode,
  context-aware Run/Queue, Stop, runtime-resource status, model/template/settings/Gallery openers, progress, and connection controls.
- `src/components/Workflow.tsx` owns the React Flow canvas, graph/node drops, node search, connections, selection, and canvas-level dialogs.
- `src/components/WorkflowTabsBar.tsx` presents local workflow snapshots managed by `useStudioStore`.
- `src/components/WorkspacePanel.tsx` owns the right-side Studio, Queue, Setup, and conditional Run-as-app tabs.
- `src/components/GraphFixDialog.tsx` presents deterministic repairs produced by `src/studio/graphFix.ts`; fixes remain
  explicit user-reviewed graph mutations.
- `src/components/RuntimeResourceMonitor.tsx` reads the bounded `/runtime/resources` snapshot for top-bar monitoring.
- `src/components/RuntimeOptimizationsCard.tsx` owns the Setup UI for optimization catalog, jobs, receipts,
  qualification, isolated-environment activation, and rollback.
- `src/components/LeftLibraryPanels.tsx` implements template, Gallery/media, model, and related left-rail libraries; node and workflow lists have dedicated components.

The app shell is responsible for arranging features, not duplicating their domain state.

## Graph State And Mutations

`src/stores/useFlowStore.ts` is the source of truth for:

- Nodes, edges, and viewport
- Node selection/cache/execution presentation state
- Graph history/undo-redo
- Visual-to-API graph export
- Connection status and signal propagation

Mutation logic is split into:

- `flowNodeMutations.ts`
- `flowConnectionMutations.ts`
- `flowGraphMutations.ts`
- `flowGraphExport.ts`

The store persists only nodes, edges, and viewport under `modiff.flow`. Runtime, history, and in-flight state are not persisted. A legacy `reactflow` key is migrated when present.

Connections are validated against handle/input rules. A normal input accepts one incoming edge unless the backend definition exposes spawn/multi-input behavior. `exportGraph(sid, targetNodeId?)` converts the visible graph into the backend graph payload.

All execution surfaces, including Studio and Run as app, must submit this graph representation. Do not add a second hidden workflow model.

## Registry And Model State

`src/stores/useNodeStore.ts` owns backend discovery:

- `/nodes` registry definitions
- `/hf_cache?compact=1` Hugging Face cache view
- `/local_models` local model index
- `/model_cache/diagnostics` cache paths, completeness, and external-package discovery
- `/runtime/status` runtime/package/device information
- `/model_capabilities` Studio profile compatibility
- `/hf_download` install/repair tasks

Registry keys use `module.action`. Node creation and Studio graph reconciliation must verify the live key and parameter schema before wiring a node.

An optional runtime requirement is discovery data, not permission to mutate the Python environment. Template browsing/opening, registry refresh, and Auto planning must remain non-installing. Installation begins only from an explicit user action against a reviewed backend runtime profile, and the client keeps Run blocked until a later backend status confirms the compatible installation.

Model visibility, artifact presence, and Auto readiness are separate concepts.
`src/studio/modelCache.ts` and `artifactRequirements.ts` describe local artifact
state. The backend `/auto_resource/plan` response is the sole Auto compatibility
authority; `src/studio/autoResource.ts` validates its versioned
`compatibility` assessment and UI surfaces render that assessment without
re-evaluating GPU, platform, OS, or memory thresholds. A missing plan is
presented as **Checking compatibility**, never as a client-side hardware guess.
Schema-v2 selected candidates also carry an exact loader module/action and
execution path. Before any candidate values reach the form or graph, the
client verifies the unique same-ID candidate and the executable managed loader
on the visible canvas. Unrelated or disabled loaders do not satisfy that check,
and a mismatch remains a blocking readiness issue.

Reviewed model usage notices live in `src/studio/modelUsagePolicies.ts`.
Template and model-manager components consume that registry generically. Only
dependencies with `acknowledgementRequired` alter template-card UX; the stored
acknowledgement key includes repository, revision, policy version, and terms
URL so changed terms are shown again. Hugging Face gating remains an upstream
account action and install recovery uses the backend's structured error code.

## Websocket And Task State

- `src/stores/useWebsocketStore.ts` owns connection/session identity, reconnect state, and loop timers.
- `src/components/WebsocketProvider.tsx` connects the store to React lifecycle.
- `src/stores/websocketMessageHandler.ts` validates/routes runtime messages.
- `src/stores/useTaskStore.ts` owns the queue snapshot, current task, count, and progress presentation.

Important message families include:

- `welcome`: session/backend identity and queue hydration
- `node_definition`: dynamic parameter/schema replacement
- `update_value`: backend output values written into node fields and Studio output attribution
- task/graph lifecycle: queued, started, progress, completed, cancelled, and failed
- model/cache updates: refresh affected discovery stores
- resource planning/retry: disclose selected Auto plan, fallback, and cleanup
- notification/error: user-visible state with bounded detail

Run updates carry task/client-run/attempt identity. Workflow-owned dynamic
field/schema messages and queued field-action completion also carry the
originating WebSocket session, workflow tab, and canvas epoch. Handlers must
reject late or unrelated updates that would overwrite another workflow tab,
replacement canvas, or newer attempt. Identity-less legacy field messages are
accepted only when a single open workflow leaves no tab ambiguity.

## Studio Domain

The `src/studio` directory contains domain logic rather than one monolithic component:

- `types.ts`: forms, modes, model profiles, graph bindings, tabs, outputs, templates, and run context
- `modelProfiles.ts`: model/task capabilities, defaults, artifact notes, and Auto requirement metadata
- `templates.ts`: curated workflow recipes and Gallery metadata
- `graphBridge.ts`: create/reconcile a managed graph from a Studio form
- `resourcePlanner.ts` and `autoResource.ts`: form normalization and the versioned backend Auto plan contract
- `modelUsagePolicies.ts`: reviewed dependency usage/access notices and acknowledgement fingerprints
- `runReadiness.ts` and `useRunReadinessIssues.ts`: graph/model/input/runtime validation
- `runPreparation.ts` and `runCoordinator.ts`: submission metadata, deterministic identity, runtime hints, and response attachment
- `outputContracts.ts`, `outputApi.ts`, `outputUtils.ts`, and `previewState.ts`: validate, persist, classify, and present generated outputs
- `workflowPackage.ts`: portable JSON/PNG workflow metadata
- `templateReadiness.ts`, `templateExactness.ts`, and `templateQuality.ts`: publication/readiness rules
- `workflowInference.ts`: infer Studio context from imported/custom graphs

`src/stores/useStudioStore.ts` persists stable authoring state under `modiff.studio`: form values, prompt/snippet data, imported assets, workflow tabs, app-mode configs, blueprints, and pinned inputs. Output history and preview-slot state are backend-owned, hydrated from `/studio_outputs`, and deliberately excluded from local storage. Live graph binding, graph-finalization status, Auto request state, and active run contexts remain volatile unless restored from a package/output snapshot.

`src/studio/workflowFileSave.ts` and the workflow request helpers persist named snapshots through the backend workflow
API. Local tabs remain the editing surface; a successful explicit Save creates or replaces a backend library file,
while Save JSON copy is a browser download.

`src/components/StudioPanel.tsx` is a UI composition layer over those modules. It must not become the owner of graph execution, network parsing, or long-lived domain state.

## Guided Graph Reconciliation

Studio graph updates follow this rule:

1. Resolve the selected task/model/profile and live registry requirements.
2. Inspect the current graph binding.
3. Reuse compatible managed nodes with stable identifiers.
4. Add missing task-specific nodes/edges.
5. Remove obsolete Studio-owned nodes/edges when the task changes.
6. Preserve unrelated manual nodes and user layout choices.
7. Apply dynamic field actions and wait for graph finalization.
8. Store the new binding and synchronize form values.

Repeated reconciliation with the same inputs must be idempotent. If a user changes a managed graph until its binding diverges, clear the binding and treat it as a custom graph rather than silently rebuilding over their work.

Managed graph finalization proofs are consistency checks, not authorization tokens. The current proof schema binds the resolved graph shape, authoritative field schemas, and the sorted source/target handle specification. Restoring a proof also revalidates the exact live managed-edge set and executable dynamic field groups; a preserved edge ID with changed endpoints, an incomplete dynamic route, or a recomputed checksum over a malformed contract remains non-runnable until reconciliation produces a fresh proof.

## Run Flow

```text
User selects Run
  -> validate connection, graph, output reachability, and Studio inputs
  -> if Auto, fetch/confirm accepted candidate proof
  -> verify the candidate's exact target against the visible managed loader
  -> reconcile/finalize managed graph
  -> export visible graph with websocket session id
  -> apply deterministic/runtime/candidate metadata
  -> capture run context and input hash
  -> POST /graph
  -> attach task response and accepted preview-slot state to client-run identity
  -> consume websocket progress/output/failure
  -> persist attributable Studio output
```

`src/studio/runCoordinator.ts` owns submission identity and output attribution. `src/utils/runGraph.ts` owns transport. Callers own readiness and user feedback.

`POST /graph` is always queue admission. The toolbar labels the one-shot action **Run** while the queue is idle and **Queue** while work is active or waiting; both paths use the same coordinator and never invoke cancellation. A queued context is indexed immediately for attribution but does not replace the active canvas owner until its exact `task_started` event arrives for the same workflow tab and canvas epoch.

## Fields And Dynamic Actions

- `src/components/NodeContent.tsx` turns backend node parameters into field props and selects a field implementation.
- `src/fields/` contains built-in parameter and output fields.
- `src/ui/FieldFrame.tsx` (exported from `src/ui`) preserves common layout and graph interaction behavior.
- `src/utils/fieldAction.ts` handles backend-defined `onChange`/`onSignal` actions.
- `src/utils/useInitialFieldAction.ts` handles required initial dynamic-field synchronization.

Fields must preserve `data-key`, `modiff-field`, `nodrag`, `nowheel`, hidden, disabled, and backend-action contracts. Backend-provided styles are sanitized to safe layout properties by `src/theme/modiffStyle.ts`; visual styling from dynamic payloads is not trusted.

Managed dynamic fields may opt into the versioned `fieldOptions.studioBinding`
contract. Version 1 is intentionally small: an `identity` binding reads only
the allowlisted `maxSequenceLength` form field, while
`nearest-option-to-long-edge` reads width and height and selects the nearest
numeric option declared by that backend field. Direct dimension identity
bindings are rejected. Long-edge options must be unique integer dimensions in
the reviewed 16-through-2048 Studio execution envelope. A group synchronizes fields that
publish the exact same binding signature. Unknown versions, transforms, form
fields, extra properties, malformed or out-of-envelope options, and partially
matching group declarations are inert; the client does not infer a fallback
from model, repository, class, label, or field name. This metadata changes
values in the existing visible graph only and is not another workflow or
execution representation.

Durable snapshots never retain `onChange` or `onSignal` behavior. Restored and imported nodes remain inert while the registry is unavailable, then rebase the current registry's behavior onto matching stored fields, remove actions that are absent from the current contract, restore missing live hidden fields, and preserve stored values. This lets the backend evolve a generic node contract without adding model-name branches, executing behavior from an untrusted workflow, or silently dropping an execution-critical field from an older workflow.

Backend-issued execution identities are opaque client values. The durable copy lives in a normal hidden parameter, so workflow snapshots, exports, and run-input hashes include it. A matching output `signal` may carry the identity across connected generic nodes while the graph is live; signal values are deliberately removed from durable snapshots and must be reconstructed by the backend after restore. The client transports and reconciles these values but does not parse repository names, pipeline classes, or identity fields to select behavior.

Generic model selectors coalesce free-form repository edits through a short bounded debounce. Backend `onChange` work runs for the initial value and the latest repository selection or source switch; it must not run once per keystroke.
Their compatible choices come only from backend declarations. Hub entries apply the declared class/id filters. The current local-model index contains paths but no class metadata, so local ID-only filters remain usable while any declared local class filter fails closed with no candidates until the backend publishes metadata that can evaluate it. The generic model selector does not infer a model family from repository names, connected nodes, or the current Studio profile, and it does not rewrite backend repository defaults.

Custom React fields are dynamically imported from the `@custom-fields` Vite alias and served by the backend under `/user`. Treat custom fields as trusted operator-provided code, not untrusted data.

## Outputs, Gallery, And Packages

`update_value` messages that match recognized output fields are attributed to the active run context. The client stores a bounded output view and synchronizes through `/studio_outputs`. A backend preview slot, scoped by workflow/node/field, is the authority for the main preview: an accepted new run marks the slot pending, a generated output promotes its durable output ID, and tab changes or browser refreshes do not reclassify it. The Previous strip excludes that ID. Saved canvas values and current-run heuristics are compatibility fallbacks only when talking to an older backend that has no preview-slot contract.

An output can carry:

- Media URL/type and backend storage metadata
- Model/task/template identity
- Prompt and generation settings
- Form, visual graph, graph binding, and API graph snapshots
- Parent/source/variation lineage
- Task/client-run/input-hash identity

Gallery restore creates a workflow tab from the snapshot. Rerun recomputes current readiness and Auto state before submitting; persisted output metadata is not blindly trusted as current runtime proof.

Workflow packages are JSON. Image packages can also embed the `modiff.workflow` metadata key in PNG text chunks. Imported packages must be parsed/coerced at the boundary before they affect stores.

## Templates And Gallery Assets

Curated templates live in `src/studio/templates.ts`. Git stores their typed
definitions, asset identities, and small manifests. Published examples,
default-input media, and provenance records live in a public Hugging Face
Dataset pinned by immutable commit SHA. `src/studio/templateAssets.ts` is the
single URL resolver. Local mode exists for migration and verified offline
copies; release builds use remote mode and do not copy Gallery media into the
bundle.

Publication tooling in `scripts/` enforces:

- Template coverage
- File existence and media type
- Quality/review schema
- Provenance and duplicate-run rules
- Redaction of public local paths/source commits
- Manifest integrity

Keep recipe visibility separate from Exact/publication status. A template can be useful and visible while honestly blocked on an artifact or backend capability.

## Requests And Boundary Validation

Use `src/utils/requestJson.ts` for typed JSON requests. It provides timeout, status, parse, and error normalization. Domain modules should supply a parser when a response affects persistent state, graph execution, or security-sensitive UI.

Request owners also use latest-request/mutation guards so a delayed response cannot overwrite a later refresh/edit. When adding an endpoint:

1. Define the smallest response type.
2. Parse/narrow `unknown` at the boundary.
3. Add a finite timeout appropriate to the operation.
4. Make stale-response behavior explicit.
5. Normalize errors for the user without discarding useful developer evidence.
6. Add request contract tests.

## Styling And Accessibility

- `src/theme/modiff.css` defines Tailwind tokens.
- TypeScript-only visual constants live in `src/theme`.
- Reusable components live in `src/ui`.
- Feature components use tokens/primitives and describe domain behavior/layout.
- Dialogs, menus, tabs, and icon-only actions must retain focus, keyboard, label, dismissal, and scroll behavior.

See the [frontend style guide](frontend-style-guide.md). `npm run style:audit` prevents new raw visual literals outside approved source areas.

## Tests And Gates

- `scripts/*.test.mjs`: unit/contract tests for graphs, templates, requests, Gallery, styles, and coordination
- `tests/e2e/studio-mocked/`: deterministic browser coverage with mocked backend routes
- `npm run check`: format, lint, types, styles, unit tests, build, and bundle budget
- `npm run check:ui`: mocked Playwright Studio gate
- Gallery verify/coverage commands: public example and template publication gates

Mocked browser coverage proves client behavior. It does not prove model installation, GPU compatibility, output quality, or a live backend model path.

## Change Guardrails

- Preserve compatibility for existing graph JSON, local-storage migrations, backend endpoint names, and websocket message fields unless a coordinated migration is explicitly part of the change.
- Keep graph execution visible and single-sourced through `useFlowStore`.
- Keep network and persistence payloads guarded at their boundaries.
- Preserve workflow-tab/run attribution across asynchronous work.
- Document backend needs in the relevant public issue or cross-repository change; do not add workstation-specific handoff trackers to permanent docs.
- Pair runtime claims with the correct proof level.
- Update this document, user guides, tests, and backend contract documentation together when ownership or behavior changes.
