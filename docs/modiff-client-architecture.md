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
- `src/components/TopBar.tsx` owns New, workflow Save/Save as, Export, graph-fix review, Creator/Developer, Memory, Run mode,
  context-aware Run/Queue, Stop, runtime-resource status, model/template/settings/Gallery openers, progress, and connection controls.
- `src/components/Workflow.tsx` owns the React Flow canvas, graph/node drops, node search, connections, selection, and canvas-level dialogs.
- `src/components/WorkflowTabsBar.tsx` presents local workflow snapshots managed by `useStudioStore`.
- `src/components/WorkspacePanel.tsx` owns the right-side Studio, Queue, Setup, and conditional Run-as-app tabs.
- `src/components/GraphFixDialog.tsx` presents deterministic repairs produced by `src/studio/graphFixer.ts`; fixes remain
  explicit user-reviewed graph mutations.
- `src/components/RuntimeResourceMonitor.tsx` reads the bounded `/runtime/resources` snapshot for top-bar monitoring.
  During execution its allocator counters may be explicitly paused to prevent native allocator probes from blocking
  the model worker. The popover explains this state; it does not substitute zero or cached readings for unavailable
  values. OS resource samples and the execution's final resource measurements remain separate contracts.
- `src/components/RuntimeOptimizationsCard.tsx` owns the Setup UI for optimization catalog, jobs, receipts,
  qualification, isolated-environment activation, and rollback.
- `src/components/LeftLibraryPanels.tsx` implements template, Gallery/media, model, and related left-rail libraries; node and workflow lists have dedicated components.

The app shell is responsible for arranging features, not duplicating their domain state.

Startup recovery preserves a selected nonempty, dirty, or backend-saved editing
document. If that document changes while recovery is pending, automatic navigation
is cancelled. The activity shelf still reports a running task and opens it on
explicit selection; a fresh empty session can recover its snapshot. Recovery
must not mutate the running graph or steal the user's editing tab.

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

`nodeConnectionMatching` shares direction and type matching between the drag-to-add
popup and the inserted connection. It uses the same normalized type compatibility
as ordinary wires, includes `isInput` controls, and respects direction even when
the dragged port is untyped. Suggestions retain installed custom nodes and
deduplicate exact registry aliases while excluding structural groups/loops.
The popup searches the executable registry independently of the left library's
view; it cannot infer semantic model compatibility from a tensor type. New node
data is cloned so edits cannot mutate a registry definition. Catalog enumeration
stays in the popup's lazy `nodeConnectionSearch` module, outside canvas startup.

Expert's Stages panel also resolves connected starters from `POST /operations/starter`.
The backend supplies ordinary node schemas and reviewed connections; the client
assigns canvas IDs through the normal node factory. The result is a normal graph,
with no template receipt or additional execution representation. Users can build
the same stages manually with native typed wires and add an output Preview, Save
or Export node. Plain scalar aliases such as `text`/`string` and `bool`/`boolean`
match in native connections; media collections and model objects remain distinct.

`operationAuthoring` is a versioned, advisory annotation on those ordinary nodes.
It stores the selected operation, initial visible defaults and retained unsupported
settings. It does not grant execution permission or replace node params.
Backend-declared `sharedInputs` bind seed controls of stages that continue one
generator. `operationSharedInputs` validates their loader scope and membership;
ordinary parameter edits update the group under one history transaction. Export
uses one random draw per group and rejects inconsistent literals or input sources.
New stages inherit the existing shared value; a connected custom source is wired
to every member. Distinct loader branches remain independent. No additional
execution representation or model-family dispatch is introduced. The lazy
`operationAuthoring` planner walks one loader's connected canonical stages,
retains compatible user overrides and custom branches, and previews incompatible
wires and retained settings. Required conditioning comes from the exact upstream
task; instruction editing and image-to-image remain distinct choices.
Changing a Python action assigns a fresh runtime ID and reconnects compatible
edges, while unchanged actions retain their IDs and positions. Unmatched canonical
stages remain disabled with their saved data. Existing nested Blocks are left
intact and use their composition inspector and structural editing commands.

The change applies through `operationGraphTransaction`, using the existing history
transaction, rollback and connection reconciliation. It rejects concurrent canvas
edits, tab changes, active gestures and ambiguous/shared loader ownership. One
Undo/Redo restores the complete edit. Imported hints are validated before use;
legacy graphs are not converted on open. Stage inspection shows defaults,
overrides, connected fallbacks and retained settings separately. Retained settings
are not automatically restored or included in execution parameters.

`blockControlConnectionsV2` resolves root and nested control aliases against the
owning effective graph and external public-input wires. Connected body controls
show their saved fallback read-only, with the source node/port and an explicit
notice; partially wired mirrored controls explain which targets still use that
fallback. Rendering never evaluates upstream nodes or replaces stored values.
Connection mutations reject competing internal/public drivers and sealed-control
bypasses before mutating either the old or proposed wire.

`nodeMeasurementDispatch` batches passive browser dimension reports outside the
ResizeObserver delivery, together with implicit parent expansion. User drags and
resizes remain synchronous; navigation, removals and unmount discard stale work.
This is not an error-suppression mechanism or a claim that all observer loops are
resolved. Selection-only toolbar code loads on the first actual selection and
then stays mounted so focus changes do not discard open dialog state.

Running from a V2 Block root or internal Block selects all enabled terminal
branches in that semantic scope and their contained upstream dependencies.
Outside suppliers are removed before validation and lowering, including public-input
suppliers; stored internal fallbacks remain available. Whole-workflow execution keeps
the crossing wires. Missing
previews never mean "run the whole workflow". Disabled descendants are excluded;
an entirely disabled/non-executable selection produces an actionable error.
The representative node used for run metadata still prefers a terminal media
preview over an intermediate diagnostic; that representative does not truncate
the actual multi-path execution selection.

All execution surfaces, including Studio and Run as app, must submit this graph representation. Do not add a second hidden workflow model.

Registered Clusters, Hub imports, and User Nodes persist one `BlockInstanceV2`
contract. A legacy registered-Cluster migration uses
`registeredClusterCompilerSupplement.ts` only after the backend supplies an
exact current-route or reviewed historical compiler authority. For a reviewed
historical mapping, the destination `BlockDefinitionV2`, effective graph, and
public interface are compiled from a clean current registered route, its
current profile defaults, and its current creator suggestions. Persisted
historical prompts and parameters never participate in dynamic-field
publication or definition hashing; they are copied afterward only into declared
`BlockInstanceV2.values`. Unknown IDs, incompatible concrete JSON/type pairs,
sealed/static graph rewrites, ambiguous semantic ownership, and stale mapping
hashes fail closed. Repeating generation from identical saved bytes is
deterministic, and each converted workflow instance owns an independent values
object.

`BlockDefinitionV2.graph` is the immutable reusable baseline;
`BlockInstanceV2.effectiveGraph` is the only workflow-local structural copy.
`BlockInstanceV2.values` is a sparse override map, not the complete effective
parameter set. After saving a User Node, a fresh insertion may have no overrides
because the saved control defaults already contain the chosen prompts/settings.
Readers and tests must use `blockInstanceValueV2` for effective values; an absent
override must not be confused with an explicitly empty prompt, zero or false.
Registered Diffusers Clusters, catalog-only reviewed Diffusers workflows, and
user-owned Blocks all use the same Block renderer. The pinned catalog currently
maps all 94 reviewed workflows into 1,794 active ordinary V2 graph nodes at a
maximum upstream depth of five. The unpruned source tree remains the discovery
authority, but a Conditional/Auto placement that owns no selected descendant is
not materialized as a portless active-graph node. It remains available in the
Modular Diffusers library for a route that selects it. Structural availability
does not grant Run, Auto, installation, or publication authority.

Exact Modular containment is semantic metadata, not a nested persistence
authority: `placementPath` and `parentPlacementPath` project recursive React
Flow `parentId` relationships, while the effective execution graph remains
flat. Every projected upstream placement uses the shared Block V2 frame and
ordinary node controls/connectors. Fresh instances start every placement that
owns descendants collapsed, so expanding the root reveals one level at a time.
Expansion choices are stored only in
`BlockInstanceV2.presentation.collapsedContainerNodeIds`; executable `custom`
placements and structural `group` placements are equally valid containers.
Saving any projected subtree creates an independent top-level User Node rather
than a nested `BlockInstanceV2`. Subtree extraction filters both public-input
and control `mirrorBindings` to retained descendants, promotes the first
surviving target to the primary binding, and removes `mirrorBindings` when only
one target remains. Crossing edges become explicit sockets; saved defaults use
the current instance values. Retained controls keep their relative order and
receive contiguous zero-based `order` values. No reference to an excluded node may survive in
the saved `BlockDefinitionV2`, and saving must not mutate the source instance.

`BlockSaveDialogV2` is shared by root headers, projected Modular headers and
the selection toolbar. It captures the workflow context when opened, then
`persistBlockSelectionV2Choice` validates that context and the selected
projection's deterministic owner/node identity before any library write.
Nested selections offer workflow-only or save-exact-subtree-as-new. They
cannot update their owner's reusable definition: a projection has no separate
definition identity. A reinserted saved subtree is an ordinary top-level User
Node and can explicitly update its own mutable library definition. Cancel and
workflow-only never write to the reusable library. This changes neither the
`BlockDefinitionV2` schema nor the single `BlockInstanceV2` persistence authority.

Declared controls are also projected onto every containing Modular Block,
including collapsed intermediate containers. Canvas-only `block-control:`
aliases carry the original `blockBindingV2.logicalId`; edits call the same
owning-instance value reducer as root and leaf fields. Mirror bindings are
deduplicated per ancestor. These aliases never enter execution exports,
definitions, graph hashes or saved workflow authority. Initial field actions
are suppressed on projection mount, just as for ordinary projected fields.

`BlockInterfaceDialogV2` shares the deferred Configure Interface editor between
root and internal Blocks. An internal entry point edits that semantic node's
optional, hash-covered `containerInterface: BlockContainerInterfaceV1`; it does
not edit the root `effectiveInterface`. The declaration owns explicit local
ports and controls whose complete primary/mirror target sets lie within that
exact placement subtree. It lives inside the single flat `effectiveGraph`, not
in a nested `BlockInstanceV2` or a second executor. The dialog captures workflow context and
instance state before lazy loading; changes to graph, interface, values or
definition while it is open reject Apply. Connected-port and sealed-control
checks remain in the store/domain reducer. Newly exposed controls inherit the
current effective field value, including explicit zero, false, null or empty
values. Local controls cannot declare independent `defaultValue` or `values`
storage: `blockContainerControlV1` canvas aliases edit the original bound fields
or existing root logical values. Shared root controls retain their complete
mirror semantics. Configure Interface changes only the selected declaration;
ordinary value edits never regenerate nodes, ports or sibling values.
For newly compiled reviewed routes, caller-control mirrors stop at the first
exact selected block declaring that field as both input and state output.
Later consumers inherit the derived Pipeline State value; requested controls
and creator defaults do not change. Existing `BlockDefinitionV2` snapshots and
instances are not migrated on load. `blockDerivedControlRepairV2` diagnoses
duplicate shared bindings using exact contracts and connected state ancestry;
an explicit Graph Fix retargets only verified shared ownership. Sealed,
independent or wired overrides fail closed. The immutable snapshot, logical
values and unrelated graph/presentation state survive repair and Undo/Redo.
`graphFixMaterialization` is loaded with the deferred Fix dialog; planning and
canvas previews stay synchronous without loading mutation-only code at startup.
Internal connection/removal repairs use the pure graph mutations shared with
native wiring gestures. They update the owning instance's effective graph and
rebuild its projection atomically; raw canvas edges are not durable repairs.
`reviewedValuePortsV2` exposes exact declared intermediate outputs using
`state_output__<name>` and collision-safe `state_input__<name>` inputs. Unconnected
inputs carry no literal/default override; adapted media sockets keep their
identity. Loop-member descriptors are not one-shot value producers. Compiled
definition hashes cover the new sockets; saved historical snapshots are not
silently rewritten.
`reviewedStateDiagnosticsV2` follows exact declared state writers and reports
missing inputs on the affected internal node (or its collapsed root). Unknown
ordinary processors stay opaque. Fix's explicit state reconnection rechecks
the graph hash and contracts, adds one edge, and supports Undo/Redo without
requiring unrelated draft errors to be repaired first. The Fix dialog loads
reviewed contracts even when the palette has not yet loaded them.
Boundary aliases expose resolved instance values, so Fix does not mistake a
filled prompt for a missing wire. Cross-boundary source/bridge additions require
explicit adoption or public-interface configuration, not illegal repair edges.
Undeclared descendants inherit the nearest containing local controls before
root controls. Mirrored inputs remain one logical socket with their exact
subtree-local fan-out, not duplicate labelled sockets. This inheritance is a
view only; editing a value does not manufacture another interface declaration.
`blockContainerInterfaceV1.ts` derives legacy surfaces and rebases durable
bindings; `blockContainerEditingV1.ts` validates connected-port/sealed-control
impacts before atomic edits. Save-as-subtree promotes a configured local
interface to the reusable User Node boundary and snapshots effective values.
Adoption rebases all local bindings with their semantic node IDs and validates
the whole incoming subtree atomically, including forward child references.

Optional `containerInterface.previews` binds descendant media/text outputs using
the same strict preview schema as the root. One owner inventory deduplicates
root and local preview sources; each view keeps its own primary/selection.
The nested Configure Interface editor can add/remove/reorder these bindings and
choose one primary. Its choices are filtered through that same schema validator,
including explicit URL/base64 preview widgets, rather than another type-guessing
implementation. Omitted previews in a programmatic interface edit preserve the
prior selection; explicit `[]` clears only that local surface. Root preview
bindings still belong to `BlockDefinitionV2`, so the root effective-interface
editor rejects a local-preview payload instead of silently dropping it. Preview
selection does not change prompts, parameters, connections, sibling declarations,
or media files. Save-as-User-Node promotes the local selection with the subtree.
`blockContainerPreviewViewsV2` reads current owner state without rebuilding the
projection on a run update. Backend preview slots remain the current-output
authority; persisted completed references are compatibility/move fallbacks.
Deletion/replacement protects retained local preview bindings. The shared
Python/TypeScript fixture is `block_container_previews_v1.json`.

Compatible replacement of a preview or sealed-control owner preserves the
target's semantic node ID. It replaces the implementation behind that role;
it does not rebind immutable definition previews or create another preview
authority. Every retained edge, root/local port and control must still resolve
to a compatible field, and preview fields retain their media and display role.
Sealed-control validation still applies to the replacement. Ordinary unprotected
replacements may use the dropped node's semantic ID and atomically rebase their
retained bindings. Neither path silently disconnects incompatible consumers or
updates the reusable library definition.

Root and local boundaries share the same explicit media/file-picker rules.
A matching file browser may carry an image/video/audio input as its path-valued
control; a video picker may decode a declared PIL-frame sequence. Other string
controls do not become media sockets. Preview widgets use their exact `ui_image`,
`ui_video`, `ui_audio` or `ui_text` display to qualify URL/base64 transport.
The earlier 90 compiled admissions have structural nesting/Save coverage in
both runtimes; this is not model-generation qualification. Four subsequently
added ACE-Step audio composites have separate acceptance tracking in the backend
audio completion plan. They reuse the same Block V2 and ordinary audio nodes,
not a fabricated Modular hierarchy. Their Studio model-type identifier is
`AceStepAudioPipeline`; the sealed implementation class is `AceStepPipeline`.
Standard-composite class checks compare the execution profile with `blocksClass`,
while model-type checks still compare with `pipelineClass`. Numeric literal
bindings remain safe integers except the explicit `boundaryFade001 = 0.01`
continuation seam constant. BPM normalization matches the native template path.

Whole multi-root Block drops create a generic non-executing wrapper, rebase all
children/edges/interfaces, bake effective fields, and retain the source public
surface as the wrapper's local interface. A distinct sole-child interface is
not overwritten. There is no nested instance or executor. Layout coordinates
are converted to parent-relative presentation, independently of semantic values.
The new wrapper starts collapsed. A move retains completed preview references,
not in-flight ownership; reusable definitions omit transient media. Nested Run
exports all terminal paths within that subtree and its contained upstream dependencies.
It excludes outside nodes and unrelated sibling branches. `flowGraphExport.ts` supports an internal
multi-target selection using the existing backend `paths` contract.

Ordinary dragging preserves ownership and grows/rebases the owning frame while
preserving world positions of unaffected nodes. Only Ctrl/Cmd drag or an explicit
selection-toolbar action reparents nodes/Blocks. Modifier-drag hit testing uses the
pre-drag frame bounds. Ordinary reparenting and whole-subtree detachment are separate
atomic edits: encoded semantic crossing endpoints preserve links without promoting
them into the reusable interface, and edited values survive without a library write.
React Flow geometry measurements and overlay observation registration are
scheduled outside the current native ResizeObserver delivery. Small ordinary
graphs and expanded composites remain mounted to avoid same-delivery sibling
mounts; large flat graphs retain viewport culling. Native resize errors are not
filtered in the strict diagnostic browser gate. Historical V1 User Blocks use a
lazy compatibility renderer within the shared Block canvas type; current V2
frames and sockets remain eager, and deferred dialogs capture their context
before loading.

Playwright frontends use a port-specific Vite dependency cache. Concurrent live
and mocked runs must not replace the same optimized dependency files beneath
each other's browsers. This isolates the harness, not product errors; native
resize, missing-handle, persistence and gesture assertions remain strict.

The exact Modular compiler verifies every edge endpoint against the actual
declared fields after hierarchy decomposition. Coarse decoder outputs map to
their final selected upstream writer, including `audio` to official `sound`.
The backend retains raw sound in PipelineState and exposes a sample-rate-bearing
audio object to the ordinary export node; missing rate and unsupported batches
fail explicitly, never silently default to 48 kHz or drop batch members.

`BlockDetailDialogV2` defers route-confirmation and composition details, including
recipe derivation, until requested. Node frames and sockets stay eager. A
composition request is cancelled when its recipe changes or the dialog closes;
an old response cannot qualify a newly edited recipe.

At run submission, `modularComposition.ts` reconstructs a structural
recipe against the pinned upstream hierarchy, not the saved User Node snapshot.
This keeps added/replaced/moved/removed upstream placements meaningful after
Save as User Node and reinsertion. Ordinary utility nodes remain ordinary graph
nodes. Unchanged graphs and parameter-only edits keep the original runtime
route. The edited recipe and full placement paths travel with each affected
`ReviewedModularWorkflowStep`; they do not mutate the durable Block definition.
API-graph and portable workflow exports use the same lowering as Run. Selected
workflow specializations (including required inputs) are restored from their
exact reviewed contracts before edits are applied to the unpruned tree.
Loop-member wires determine the ordered upstream loop. Disconnected or cyclic
member chains fail with a named correction instead of silently using the old
order. Exact upstream identities and loader/state ownership remain enforced.
The preview rebuild receipt is still structural evidence, not a model-output
qualification or publication approval.

Customized ownership is source-neutral: optional hash-covered
`BlockGraphNodeV2.parentNodeId` names an existing semantic container in the same
flat graph. Ordinary nodes inserted inside an upstream Block keep their real
module/action and have no fabricated `modularDiffusers` identity. Without this
field, exact upstream placement remains the parent source; explicit parents
may not contradict an existing upstream parent. Missing/non-container parents
and cycles fail strict frontend/backend validation. Shared parent resolution
drives disclosure, layout, local-interface scope, deletion/replacement and
subtree saving. Saved subtrees remove only parent references leaving their
copied scope. All other ownership and current field values remain intact.

`blockDropTargetsV2.ts` performs shared deepest-visible-container hit testing
in absolute graph coordinates. Ordinary palette nodes and exact Modular or
saved User subtrees use one insertion/adoption history transaction, including
rollback on failure; they cannot leave a detached canvas child. Saved User
subtrees carry baked current values and rebased local interface bindings.
Independent multi-root Blocks use their existing explicit public interface on
a generic wrapper; this path never guesses an interface or discards connected
external edges. `reviewedBlockContextV2` assesses pinned component requirements,
not membership in the destination's original tree. Semantic-invalid drafts may
be authored and saved; declared component conflicts appear as advisory findings
and runtime checks use the actual connected Python component types. Source
provenance stays immutable, while execution context is rebound **after** saved
values are baked. Tensor socket compatibility alone never authorizes foreign
Pipeline State transfer or an unreviewed class/revision.

`blockReparentingV2.ts` supports ordinary internal node/User-container moves
between visible expanded containers in the same instance, including back to
the root. Stable fields, semantic IDs and wires remain unchanged; canvas
parent-first ordering is never execution order. Cycles and local declarations
that would point outside their owner reject atomically with Configure Interface
guidance. Upstream placements can also move: retain their original source path
and definition, rebase execution paths, and lower the edit as a move rather than
an insertion—even after repeated Save as User Node. A new occupant of a vacated
path is not the original node. Moving a loop member outside its owning loop
retains the draft but produces a scope/calling-convention diagnostic.
Empty generic groups remain expandable insertion targets.

Reviewed loop sockets use explicit `iteration_input__`, `iteration_output__`
and `iteration_previous__` prefixes. These edges remain in the saved effective
graph, but `reviewedLoopConnectionsV2` lowers them to bounded
`iteration_bindings` descriptors before outer-DAG export. Both endpoints must
reach the same concrete loop owner through the Loop Members chain; matching
path strings alone are insufficient. The existing upstream loop owns timestep
iteration. Previous-iteration values require initial state, current producers
must precede consumers, and a wire cannot silently overwrite a constant.
Ordinary legacy loop-member fields remain inert unless explicitly bound.
New palette loop members expose only these consumed iteration bindings, not
duplicate ordinary step controls. Loading existing saved recipes does not rewrite
their fields or inject new constant values.

`reviewedLoopDiagnosticsV2` names empty loops, orphan/wrong-convention members,
forks, invalid order/scope/ports and competing constants. `reviewedLoopRepairV2`
offers only an unambiguous missing baseline descriptor link, with graph-hash
revalidation and the normal single Undo transaction. Fix retains explanations
even with no automatic candidate; it must not hide a problem because no safe
repair can be guessed. Component declaration warnings are non-blocking because
the user may have supplied a valid replacement component.

A complete internal subtree can be moved out as a workflow-owned User Block.
Current values, local interfaces, relative layout and completed preview
references are retained. It does not create a library entry or transfer an
in-flight run. Crossing wires need exact existing public ports on both sides
and complete mirror fan-out; retained root controls/previews must be rebound
explicitly. Undo restores the original ownership in one transaction.

Execution checks imported graphs too: duplicate internal/public drivers and
sealed-control wires fail visibly before dispatch, rather than relying only on
pointer-gesture validation. Disabled semantic ancestors propagate to their
execution descendants even though execution nodes have no canvas `parentId`.

Moving an exact Modular leaf back to the ordinary canvas retains its upstream
identity as `modularDiffusersCatalogNode`; projection ownership markers alone
are discarded. Reinsertions must not silently downgrade it to an anonymous
utility. Concurrent consumers of the Hub node-library endpoint share one
in-flight fetch so that every awaiting compiler receives the settled result;
an explicit refresh after settlement still fetches again and validates strictly.

Runtime public entry points validate and clone caller-owned V2 authority on
every call. Private helpers may reuse that already-validated clone within the
same operation, and visible-edge receipts are indexed once per owner per
operation. Do not substitute cross-call caches over mutable instance objects
or remove hash/receipt validation to improve responsiveness. Natural node
measurements must not drive larger textarea minima synchronously; explicit
user sizing may. Observer-triggered layout writes are coalesced to a frame
and cancelled after unmount/disclosure changes.
Client/backend strict validators and the shared
`tests/fixtures/block_container_interface_v1.json` contract must change together.
Absent optional declarations retain existing canonical bytes/hashes; old
readers reject new declarations rather than silently dropping them.

`BlockInstanceV2.presentation.internalLayout` stores each node's compact own
box relative to its immediate semantic parent. It must not store a recursively
expanded subtree size. At render time the projector measures visible children
bottom-up, derives expanded ancestor bounds with header/right/bottom padding,
and shifts colliding siblings without rewriting the saved preferred positions.
The same collision solver applies to root-relative (non-hierarchical) Blocks,
including standard-pipeline catalog routes. Root-relative coordinates are
converted only for projection; saved layouts and execution graphs are not
silently migrated. A node resize must therefore separate siblings in either
layout mode, not only in a Modular hierarchy.
If a control or connector tray changes a child's measured size, the complete
ancestor chain is rematerialized atomically. Collapse restores the compact own
box; it can never reuse or constrain an expanded descendant envelope.
Expanded bottom clearance includes the full public/derived connector tray, not
just a fixed gutter. The projector reserves each row using the shared tray's
20px line height, 4px row gap, padding and border, plus 28px of clear canvas.
Hidden optional sockets are counted conservatively. Both root and nested bounds
use this rule. Browser containment assertions compare children against the
parent header and tray boundaries, not merely the parent's outer rectangle;
keep those tests aligned with any future connector typography changes.
The production-browser geometry check inspects both projected Block frames and
ordinary internal node frames (their `data-node-parent-id` mirrors React Flow's
existing `parentId`, not a separate ownership model). It checks all visible
siblings, including loaders/previews, and exercises collapsed-root resizing and
ordinary-child resizing before rechecking every ancestor's content bounds.

Global **Arrange graph** treats each V2 root as one layout unit. Its recursive
projection is owned by the Block fitter and must not be resized or repositioned
independently by the legacy graph arranger. Arrangement persists the root's
new position in `BlockInstanceV2.presentation` in the same undo transaction;
internal layout, values, interface and execution hashes remain unchanged.
Click-inserting a saved User Node uses the same collision-free placement policy
as a registered Cluster and focuses the inserted node. If the bounded placement
search is full, placement continues beyond the occupied rightmost edge instead
of falling back onto an existing expanded Block. Explicit drag/drop keeps the
user's chosen target and its normal adoption/composition validation.

Every visible internal Block exposes a declared or derived connection surface. When a
semantic edge or public binding crosses a subtree boundary, the canvas projects
that exact descendant socket as a typed handle on the container whether the
container is collapsed or expanded. A collapsed edge uses the container handle;
an expanded edge remains attached to its visible leaf while the container keeps
the same interface for ordinary external connect/reconnect gestures. The
handle-to-leaf binding is runtime-only projection data: it is not written into
`BlockDefinitionV2`, `effectiveGraph`, persistence, or content hashes; the
underlying optional `containerInterface` declaration is durable and hash-covered. A
reconnect through the visible handle updates the original semantic leaf
endpoint. Edges wholly contained by one unopened subtree remain hidden, and
opening it restores the original endpoints. Execution always expands the full
flat `effectiveGraph`, independent of presentation collapse or node size.
Explicitly declared sockets remain available while their node and field exist with
the correct direction. Additional crossing sockets are derived only from live edges;
the last disconnection removes them. `blockCrossingConnectionsV2` encodes the leaf
endpoint in an ordinary durable workflow Edge handle, and `BlockCrossingPortsV2`
shows the separate collapsed tray. Rendering never promotes these sockets into
`effectiveInterface` or the saved User Node boundary. Declared mirrored inputs project one visible
socket and identical canvas wires coalesce with exact semantic edge receipts.
Connect/reconnect/delete operate on the complete receipt group atomically;
expanded leaves remain individually editable. No gesture invents execution
wires merely to display a socket. Connected local ports cannot be hidden or
rebound until their affected wires are disconnected.
Internal Block resize minimums include the shared header and connector tray so
shrinking a Block cannot clip its handles or make its crossing links disappear.

Repeated projected socket labels are qualified by their relative upstream
placement (for example `height · prepare latents`, omitting shared prefixes). Hovering the
label or handle reveals the exact placement and semantic field. Each mirror
consumer retains its own stable handle and exact endpoint; matching labels or
values never imply a merged fan-out port. This metadata is canvas-only and does
not change either V2 persistence schema, creator defaults or definition hashes.

Connection replacement resolves the semantic target before inspecting existing
wires: an expanded leaf and an ancestor socket are two views of the same input.
The reducer validates current durable source/target fields and commits one
replacement, retaining the edge ID, without first removing the old projection.
An identical wire/reconnection is a no-op. Missing/incompatible/stale endpoints
leave the original connection intact; errors are surfaced through the canvas
notification path. Reconnection reads the current edge by ID rather than trusting
captured projection metadata. Undo, persistence and execution use the same
effective graph. Tests cover these gestures on Qwen through the live frontend,
and label/endpoint stability across all 94 catalog hierarchy contracts; those
checks are not all-model execution qualification.

Every contextual upstream placement is searchable under **Modular Diffusers
Blocks**. Leaf entries insert as ordinary nodes. Container entries insert as
source-neutral V2 fragments and, when dropped into an expanded compatible
Block, are flattened and rebased into that root. The immutable
`sourceDefinitionId`/`sourcePlacementPath`/`sourceExecutionScope` triplet is
retained for exact backend composition lowering. Upstream Python identifiers
may begin with `_`; public connector/control IDs remain on the stricter public
ID grammar.

Fresh registered insertion fetches one build-time compiled, hash-pinned entry
from `/huggingface/registered-block-v2`. The entry is generated from the live
backend node schemas, schema-v6 definition/admission, route ledger, and exact
unpruned Modular hierarchy. Both runtimes validate the complete
`BlockDefinitionV2` and its canonical SHA-256. Insertion therefore performs no
hidden node materialization, dynamic field action, optional-runtime activation,
Hub access, or model load. `npm run catalog:block-v2:generate` regenerates the
compressed backend catalog; `npm run catalog:block-v2:check` recompiles all
entries in a disposable temporary directory and is required by the main
validation gates. The hidden dynamic-field compiler is retained only for
explicit, receipt-bound legacy V1 migration.

Values stored in a reviewed compiled catalog entry establish the initial
`BlockInstanceV2` baseline and MUST start with customization state
`unchanged`; they are not user edits merely because the compiler emits them
eagerly. A later value edit compares shared public-input/control values with
the reviewed control default, changes only `instance.values` plus the explicit
customization marker, and can return to `unchanged` when restored to that
default. Boundary-only inputs have no definition-owned default and become
workflow-local as soon as a value is supplied.
An explicitly reviewed `media_file_path` route may retain the publisher's
media-shaped public type while binding to an ordinary internal loader's file
browser. Execution validation recognizes only that narrow file-browser/media
boundary adaptation; arbitrary incompatible field types still fail closed.
Graph Fix validates the latter through the same execution expansion used by
Run. When a structural edit makes it invalid, the owning root receives an
explicit reviewed-structure recovery choice. Recovery restores baseline nodes
and edges while retaining only custom additions that keep the resulting graph
executable. It is never an automatic definition update or silent graph reset.

## Registry And Model State

`src/stores/useNodeStore.ts` owns backend discovery:

- `/nodes` registry definitions
- `/hf_cache?compact=1` Hugging Face cache view
- `/local_models` local model index
- `/model_cache/diagnostics` cache paths, completeness, and external-package discovery
- `/runtime/status` runtime/package/device information
- `/model_capabilities` Studio profile compatibility
- `/hf_download` install/repair tasks

The additive `operationContracts` catalog on `/model_capabilities` describes the
existing generic Modular stages and task-scoped standard image/video/audio/3D
adapters. `src/workflow/operationContracts.ts` validates versions 1, 2 and 3,
bounded identifiers/arrays, unique `(pipelineClass, operationId, task)` operations
and ports, and explicit declaration/decomposition states before `useNodesStore`
retains them. Version 1 is normalized with null tasks and visible ports. The parser loads on demand when capability discovery starts, keeping
it out of the static startup module graph. Unlike Studio model profiles, pipeline names are not narrowed through
a frontend family union. Older backends without this catalog produce an empty
list; failed discovery clears these declarations instead of reusing stale data.

Each port retains its pipeline scope, original semantic name, direction, declared
types, requiredness, visibility and value/component/pipeline roles. A conditioning
bundle can have both value and component roles on one socket. Whole-pipeline
actions and loaders are distinguished from Modular blocks/bundles; their task
identity preserves conditioning requirements and specialized outputs. Hidden
fields are presentation metadata, not execution permission. These are adapter
declarations, not compatibility verdicts,
runtime readiness, installation consent or graph recipes. Existing dynamic field
signals, graph validation, optional-runtime and resource planning remain their
respective authorities. Version 3 adds exact executable bindings and the task
support inventory. The Stages panel uses these contracts for ordinary node
insertion and reviewed starter/model/task changes, as described in the stage
authoring section above.

`runtimeCatalogNodes` suppresses raw discovery entries only when an exact bound
operation is present in the corresponding pipeline/task support record. Incomplete
or absent support preserves ordinary discovery; Advanced and the execution registry
remain intact. Text/primitive utilities and installed custom nodes stay accessible
in Stages. No label-based implementation deduplication or graph migration occurs.

`OperationStageInspector` is shared by the Stages panel and the lazy canvas
selection action. It is scoped to the opening workflow/epoch and selected node,
closes on invalidation or leaving Expert, and only reads local declarations,
parameters and edges. It does not require the pipeline picker to remain mounted.

Registered composition labels use Blocks; the reusable group displays Saved Blocks.
The persisted `User Nodes` group key, runtime categories and legacy `cluster`/`block`
identities remain unchanged. Names in saved definitions are never rewritten.
Distinct workflow stages and historical renderers remain compatibility paths;
`DiffusersVideo.GenerateLTX2` is already a hidden subclass of `GenerateVideoAudio`,
with the exact inherited callable and field contract verified in backend tests.
No further backend implementation is removed without execution equivalence.

Registry keys use `module.action`. Node creation and Studio graph reconciliation must verify the live key and parameter schema before wiring a node.

Node discovery uses a shared `NodeCatalogView` policy. Expert defaults to `stages`,
which includes existing generic Modular operations, essential operations, and
installed custom nodes. Auto uses `essential`. `NodeList` applies the effective
view to both ordinary registry entries and the separate Hugging Face catalog
before keyword search. HF Essentials includes only insertable, graph-qualified
task Blocks; HF implementation blocks and component references remain in
Advanced. Experimental is separate, and Saved Blocks remain accessible in
all views. These filters do not rewrite backend identities or add execution
support. Catalog-tab changes are local presentation state; the Creator/Developer
control updates the global `useSettingsStore.studioViewMode` and restores that
workspace’s panel preferences. Persistence derives `workspaceMode` from the
legacy view value; reload accepts either representation, preferring the new name.
The workflow's `useStudioStore.form.resourceMode` independently owns execution
planning, including registered-Block authority preparation and selected-node Run.
The top-bar Memory control is available in both workspaces. Managed resource-policy
edits use the existing form/graph synchronization; presentation changes never call
that path. `NodeContent` uses authoring mode for advanced-field disclosure and
resource policy for Auto-managed/override indicators. Field groups keep their
mounted identity across presentation changes and disclosure toggles, so revealing
an unchanged advanced control cannot repeat its initial backend schema action.
The permanently disabled
Studio resource header and its unused refresh handler were removed; the top bar
is the single policy selector.

Both storage keys and legacy normalizers remain unchanged. A restored workflow
keeps its own resource settings while tabs share the global editing preference.
Graph Fix and Run Issues may open Expert tools without changing execution policy.
Older clients can read the same workflow fields but still couple their controls;
independent behavior requires the matching updated client bundle.

An optional runtime requirement is discovery data, not permission to mutate the Python environment. Template browsing/opening, registry refresh, and Auto planning must remain non-installing. Installation begins only from an explicit user action against a reviewed backend runtime profile, and the client keeps Run blocked until a later backend status confirms the compatible installation.

The Setup surface renders install or repair only when the exact profile is
`qualified`, `cutoverReady`, and the backend advertises
`installActionAvailable`. It sends the profile ID, exact spec digest, and
literal consent by `POST`, polls only the returned bounded job ID, and exposes
cancellation while staging is active. Activation is a second confirmed `POST`
against the returned or cataloged environment ID and is shown only when
`activationAvailable`; rollback likewise requires confirmation and a backend
advertised previous environment. Browser reloads may show a cataloged
`staged_unchecked` environment, but activation still performs the backend's
full integrity verification. No template, discovery, or planning path invokes
these mutations automatically.

Model visibility, artifact presence, and Auto readiness are separate concepts.
User Nodes offer source/family and saved-workflow-context library views. Context is display-only,
derived from the existing `name — workflow` save convention; it is not `source.workflow`, which names
the upstream execution route. Legacy names without that convention appear under an explicit fallback.
The library shows actual V2 content revisions (or legacy save timestamps), never schema numbers as
revision numbers. Distinct definition IDs remain independently insertable even when their names or
contents match. Updating a definition replaces its library copy, not embedded workflow snapshots;
the list is not an archive of overwritten revisions. Grouping/search never modifies definition hashes.

`src/studio/modelCache.ts` and `artifactRequirements.ts` describe local artifact
state. The backend `/auto_resource/plan` response is the sole Auto compatibility
authority; `src/studio/autoResource.ts` validates its versioned
`compatibility` assessment and UI surfaces render that assessment without
re-evaluating GPU, platform, OS, or memory thresholds. A missing plan is
presented as **Checking compatibility**, never as a client-side hardware guess.
Schema-v2 selected candidates also carry an exact loader module/action,
execution-profile ID, and execution path. Before any candidate values reach the form or graph, the
client verifies the unique same-ID candidate and the executable managed loader
on the visible canvas. Unrelated or disabled loaders do not satisfy that check,
and a mismatch remains a blocking readiness issue.

Migrated exact pairs additionally carry a versioned backend Studio execution
specification. `src/studio/executionSpecs.ts` accepts only the bounded exact
schema, recomputes its canonical content hash, and binds it to the matching
execution profile. `graphBridge.ts` then creates the declared generic roles,
validates every node/parameter/typed handle against the live registry, applies
only declared form and Auto bindings, and seals the specification identity into
the graph binding and finalization proof. A malformed versioned response clears
specification authority and blocks managed reconciliation; it never silently
downgrades to the legacy schema-v2 recipe. Legacy responses with no new-schema
marker remain supported while exact pairs are migrated.

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

Rendered canvas fields retain the workflow context that owns their immutable
parameter schema. Before dispatch, a field action must still match that context
and a live node, module/action pair, and field. Delayed option updates and errors
also check ownership. This prevents an unmounting template control from sending
an empty request or changing controls in the incoming custom workflow.

## Studio Domain

The `src/studio` directory contains domain logic rather than one monolithic component:

- `types.ts`: forms, modes, model profiles, graph bindings, tabs, outputs, templates, and run context
- `modelProfiles.ts`: catalog presentation, form defaults, artifact notes, and legacy capability fallback; it must not select nodes or loaders for migrated pairs
- `executionSpecs.ts`: strict backend recipe parsing and runtime receipt construction; Flux Schnell, Dev, and Krea text-to-image, Flux Depth and Canny control-image, Flux Redux edit-image, Wan 2.2 I2V A14B image-to-video, and Wan 2.2 TI2V 5B text-to-video use this path
- `templates.ts`: curated workflow recipes and Gallery metadata
- `graphBridge.ts`: create/reconcile a managed graph from a Studio form
- `resourcePlanner.ts` and `autoResource.ts`: form normalization and the versioned backend Auto plan contract
- `modelUsagePolicies.ts`: reviewed dependency usage/access notices and acknowledgement fingerprints
- `runReadiness.ts` and `useRunReadinessIssues.ts`: graph/model/input/runtime validation
- `runPreparation.ts` and `runCoordinator.ts`: submission metadata, deterministic identity, runtime hints, and response attachment
- `blockResourceRouteBindingV2.ts`: fail-closed identity projection for one current registered admission; it binds the canonical `BlockDefinitionV2`, Studio execution specification, immutable primary artifact, and every pinned admission dependency without granting execution or Auto authority
- `outputContracts.ts`, `outputApi.ts`, `outputUtils.ts`, and `previewState.ts`: validate, persist, classify, and present generated outputs
- `workflowPackage.ts`: portable JSON/PNG workflow metadata
- `templateReadiness.ts`, `templateExactness.ts`, and `templateQuality.ts`: publication/readiness rules
- `workflowInference.ts`: infer Studio context from imported/custom graphs

`src/stores/useStudioStore.ts` persists stable authoring state under `modiff.studio`: form values, prompt/snippet data, imported assets, workflow tabs, app-mode configs, blueprints, and pinned inputs. Output history and preview-slot state are backend-owned, hydrated from `/studio_outputs`, and deliberately excluded from local storage. Live graph binding, graph-finalization status, Auto request state, and active run contexts remain volatile unless restored from a package/output snapshot.

`src/studio/workflowFileSave.ts` and the workflow request helpers persist named snapshots through the backend workflow
API. Local tabs remain the editing surface; a successful explicit Save creates or replaces a backend library file,
while Save JSON copy is a browser download.

`src/components/StudioPanel.tsx` is a UI composition layer over those modules. It must not become the owner of graph execution, network parsing, or long-lived domain state.

`graphNodeControls.ts` resolves inspector fields from ordinary parameters or the same `blockControlParamsV2`
contract used by the canvas. Inspector mounts suppress initial field actions: canvas insertion/finalization owns
schema discovery, while explicit field edits retain their normal actions. Writes check the originating workflow
ID and use existing history-aware flow mutations. Missing pinned projection nodes may be read from a temporary
fully expanded projection; revealing them changes presentation explicitly, never the execution graph or definition.
`updateFieldActionStore` keeps declared action writes separate from direct field edits: actions can reveal hidden
parameters and signal connectors omitted from the inspector, but both source and target must belong to the live node.
`GraphNodeInputs` remounts per workflow to avoid carrying field-local state across documents. `GraphArtifactActions`
uses graph readiness issues, including exact revision/file/repair options, and never reconciles a guided form when
an asynchronous download completes. `workspaceVisibility.ts` reopens a collapsed workspace for deliberate graph
editing without replacing an already-open tool. Creation opens Studio; refresh retains the persisted visibility.

Alternate control views supply `NodeContent.controlIdPrefix` for DOM input/label and radio-group identity.
The field's `nodeId` and `fieldKey` remain the graph/action identity; they must never be replaced with an inspector
DOM ID. Inspector field grids use one bounded column so native input widths cannot overflow a narrow workspace.

Registered-route metadata uses a reserved
`provenance.registeredBlockV2RouteBinding` field. `runCoordinator.ts` always
removes an inherited value first and attaches a replacement only after the
current embedded definition, graph/interface, library admission, canonical
SHA-256, artifact, and dependency list match. A prepared graph must also match
the current exported nodes and paths and already carry the identical binding;
otherwise the run remains valid in Expert mode but its publication proof is
explicitly unbound. Missing WebCrypto follows the same non-blocking/unbound
path.

The Node release scripts keep family resource coverage and exact-route
qualification separate. `live-proof-provenance.mjs` locks the route-binding
hash and full model-set hash. The standard `resource-qualification.mjs` lane
may qualify only a recipe explicitly declared by a release-contract template;
even when its retained proof carries an exact route binding, it cannot create
an exact-route qualification. Existing family history is emitted as
`legacy_unbound` and cannot authorize a sibling Cluster route.

Exact-route resource evidence has its own two-run lane:

- `current-resource-routes.mjs` asks the backend publication audit for the
  current reviewed definition/admission manifest. The manifest binds the
  canonical `BlockDefinitionV2` SHA-256, Studio spec, immutable primary
  artifact, and the complete sorted dependency set. Unknown, stale, sibling,
  duplicate, custom, or ambiguous routes fail closed.
- `route-resource-qualification.mjs` accepts exactly two completed V2 live
  proofs with distinct backend task IDs and capture times. Both proofs must
  have the same current route binding, canonical workload hash, full model-set
  hash, complete execution recipe, runtime lock, backend source/contract, and
  deterministic contract, plus positive measured duration/memory and retained
  output hashes.
- Backend-source identity is process-bound. The replaceable backend worker
  captures a canonical source fingerprint before importing executable backend
  and node modules, exposes that startup claim through `/health`, and includes
  it in the complete `graph_completed.runtimeFingerprint` receipt. The capture
  runner computes full source-file inventories before and after execution and
  requires both inventories to match the worker claim. Missing claims, changed
  source, malformed inventories, and reused workers started from older source
  fail closed. A reused worker is acceptable only while its startup identity
  still exactly matches both filesystem snapshots.
- V2 provenance created before process-start source attestation is not current
  qualification evidence. Offline repair may use only the original retained
  before/after inventories and completion receipt; it never substitutes the
  source currently present in a checkout.
- Run it with
  `MODIFF_ROUTE_RESOURCE_PROVENANCE_A=/absolute/proof-a.json MODIFF_ROUTE_RESOURCE_PROVENANCE_B=/absolute/proof-b.json npm run release:route-resource:qualify`.
  It copies both proofs into
  `data/qualification/release/route-resource-provenance/` and records their
  hashes in `route-resource-workload-receipts.v1.json`.
- `resource-qualification-report.mjs` reopens both retained proofs, checks
  their file hashes and every receipt field, resolves the route against the
  current backend manifest again, and only then adds a `routeQualifications`
  entry. This does not increment model-family recipe coverage.
  If receipts are invalid, it reports every rejected receipt (including the
  retained and current route identities for stale pins), exits nonzero and
  leaves the existing report and proofs unchanged. It never silently omits
  stale/corrupt receipts or rewrites their bindings to make coverage pass.

The route receipt explicitly records `familyCoverageDeclared: false`,
`publicationAuthority: false`, and `autoAuthority: false`. Therefore the lane
cannot promote `executable`, `autoEligible`, Gallery, or public flags. The
checked-in registry may remain absent/empty until two real current-V2 frontend
proofs exist; no baseline is inferred from standard-template evidence.

## Guided Graph Reconciliation

Studio graph updates follow this rule:

1. Resolve the selected task/model/profile and any exact backend execution specification against the live registry.
2. Inspect the current graph binding.
3. Reuse compatible managed nodes with stable identifiers.
4. Add missing task-specific nodes/edges.
5. Remove obsolete Studio-owned nodes/edges when the task changes.
6. Preserve unrelated manual nodes and user layout choices.
7. Apply dynamic field actions and wait for graph finalization.
8. Store the new binding and synchronize form values.

Capabilities with exact execution specifications also declare
`studioExecutionSpecModes`. The client requires that list to match the received
specification modes exactly. A declared mode with a missing or malformed recipe
blocks instead of falling back; an undeclared sibling mode continues through the
legacy reconciliation path until its own exact recipe is migrated.

Repeated reconciliation with the same inputs must be idempotent. If a user changes a managed graph until its binding diverges, clear the binding and treat it as a custom graph rather than silently rebuilding over their work.

For a migrated pair, the validated backend specification owns the loader node,
pipeline class, generic roles, positions, edges, form bindings, and Auto field
allowlist. The client may use an exact legacy execution profile while talking to
an older backend, but it must not restore a removed model-family switch. Flux
Krea text-to-image is the first P0.3e migration: its direct image facade and
`FluxPipeline` identity now come from the backend profile/specification. Flux
Depth and Canny control-image are the next migrated pairs: their loader,
control-image source, control generator, preview route, and
`FluxControlPipeline` identity are also backend-declared. Flux Redux edit-image
likewise receives its loader, reference-image source, edit generator, preview
route, and `FluxReduxPipeline` identity from the specification.
`modelProfiles.ts` retains presentation and form defaults only for all migrated
pairs. Wan 2.2 I2V A14B and TI2V 5B also use backend-owned video recipes. I2V
adds the generic image-loader route and dual-transformer bindings, while TI2V
declares scheduler flow shift; native-flash eligibility, VAE tiling, and export
frame rate are declarative bindings rather than model-name graph branches.

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

Every custom graph in Auto, including an untouched registered Cluster, plans its
lowered execution scope through `/auto_resource/workflow`. Source-authority
receipts do not replace that executable resource plan. A rejected plan prevents
submission; it cannot silently fall through to Expert. Planning preserves the
instance's creative settings and immutable source definition.

Session activity merges queue history by execution timestamps before applying
its 30-entry limit, retaining running work ahead of waiting tasks and finished history. Repeated or
reordered history snapshots must not evict a new submission or promote old runs.

Saved User Nodes retain model/prompt/settings provenance independently of
registered-route authority. For an unambiguous Modular Diffusers User Node,
`blockRunFormV2.ts` reads its expanded executable loader and parameter fields
for display and run-context attribution. It does not reuse the global Studio
form or issue an admission/Auto receipt. Conflicting parameter summaries,
multiple loaders, and unknown model/mode identities are not collapsed into a
claimed single-model summary. The complete submitted API graph remains the
execution record. Output hydration can recover a saved User Node's summary
from its immutable graph snapshot and exact preview-node ownership, including
outputs previously mislabeled using unrelated Studio state.

A Studio-owned run carries its exact resource receipt in both Auto and Expert
mode. The Expert overrides resource policy removes Auto admission requirements; it does not remove the
executed model, dtype, quantization, placement, or offload provenance. A raw or
imported graph without a Studio run context still receives correlation and
workflow-origin metadata only, so the client never labels an arbitrary manual
graph with the current Studio form.

Qualification capture treats `graph_completed.runtimeFingerprint` as the
terminal complete runtime receipt. Compact queue/output fingerprints are
corroborating scalar claims and cannot replace its packages, torch, and data
directory payload. Before inference, the Gallery harness persists the backend
source identity; after inference it persists and compares a second identity.
Offline repair may use only those original source snapshots plus the retained
node contract, model fingerprint, executed graph, completion receipt, and
decoded media. Missing or disagreeing evidence remains blocked instead of
being filled from the current filesystem or a later backend response.

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

Registry `hidden` defaults must not overwrite an existing workflow's dynamic
visibility, required sockets or bounds. A field hidden in text generation may
be required in an edit mode. Missing hidden metadata is filled from the live
registry; existing schema and values remain intact. UI-only preview contracts
still refresh from the registry. Audio contract finalization compares effective
values (explicit override or declared default), matching the field-action request.
An exact audio recipe uses its own role/edge proof, never an image-embedding check.
Standard audio composite admissions also declare the generator's form action.
The pinned pipeline class and exact task resolve backend-owned field visibility
before compilation, so inactive music controls cannot appear on sound-effect
nodes. This metadata action does not load weights or authorize execution; the
connected pipeline remains the runtime authority. Native-rate and waveform-count
constants are explicitly parsed and pinned, not inferred from a family label.

Backend-issued execution identities are opaque client values. The durable copy lives in a normal hidden parameter, so workflow snapshots, exports, and run-input hashes include it. A matching output `signal` may carry the identity across connected generic nodes while the graph is live; signal values are deliberately removed from durable snapshots and must be reconstructed by the backend after restore. The client transports and reconciles these values but does not parse repository names, pipeline classes, or identity fields to select behavior.

Generic model selectors coalesce free-form repository edits through a short bounded debounce. Backend `onChange` work runs for the initial value and the latest repository selection or source switch; it must not run once per keystroke.
Their compatible choices come only from backend declarations. Hub entries apply the declared class/id filters. The current local-model index contains paths but no class metadata, so local ID-only filters remain usable while any declared local class filter fails closed with no candidates until the backend publishes metadata that can evaluate it. The generic model selector does not infer a model family from repository names, connected nodes, or the current Studio profile, and it does not rewrite backend repository defaults.

Custom React fields are dynamically imported from the `@custom-fields` Vite alias and served by the backend under `/user`. Treat custom fields as trusted operator-provided code, not untrusted data.

## Outputs, Gallery, And Packages

Backend `resolvedExecutionInputs` receipts are bounded local plaintext history.
The client validates identity, allowlisted scalar values and recomputed summaries
before displaying captured settings. Connected prompts/settings replace only
output details, never saved workflow fallbacks. Gallery distinguishes captured
values from legacy declared metadata and marks ambiguity explicitly. No tensor,
model object or credential is captured. Receipt identity cannot be reassigned by
history enrichment. See the paired backend API reference for
limits and omissions; receipt presence is not output-quality/publication proof.

`update_value` messages that match recognized output fields are attributed to the active run context. The client stores a bounded output view and synchronizes through `/studio_outputs`. A backend preview slot, scoped by workflow/node/field, is the authority for the main preview: an accepted new run marks the slot pending, a generated output promotes its durable output ID, and tab changes or browser refreshes do not reclassify it. The Previous strip excludes that ID. Saved canvas values and current-run heuristics are compatibility fallbacks only when talking to an older backend that has no preview-slot contract.

An output can carry:

- Media URL/type and backend storage metadata
- Model/task/template identity
- Prompt and generation settings
- Form, visual graph, graph binding, and API graph snapshots
- Parent/source/variation lineage
- Task/client-run/input-hash identity

Encoded video measurements are retained per media item as `mediaMetadata` with `source: "encoded-file"`. The output boundary accepts only positive finite measurements (integer dimensions and frame counts). Gallery labels use the primary video item's measured dimensions, frame count and frame rate. Without encoded measurements, use captured execution inputs labelled Resolved; only receipts without an execution-input capture fall back to values labelled Requested. Missing captured fields are not filled from form defaults. Inspect keeps requested settings, captured execution inputs and encoded measurements separate. Neither display path rewrites the form or workflow reused for generation.

Gallery restore creates a workflow tab from the snapshot. Rerun recomputes current readiness and Auto state before submitting; persisted output metadata is not blindly trusted as current runtime proof.

For images, Gallery uses decoded media dimensions for the output-size label and
reports captured input dimensions separately. Reference-driven edit geometry may
have no explicit width/height call arguments. Do not infer those missing inputs
from the output image or form defaults. Inspect and refresh must retain the same
distinction between delivered media, captured settings, and legacy declarations.

Gallery and Studio output previews use `imageUrlLightboxOpener` for resolved
image URLs, including durable backend `/file` references and comparison pairs.
The lightbox retains the image URL sanitizer; raw base64 node-field values use
their separate encoded-image input contract.

Workflow packages are JSON. Image packages can also embed the `modiff.workflow` metadata key in PNG text chunks. Imported packages must be parsed/coerced at the boundary before they affect stores.

Expert's **Export → Service package** lazily loads `ServiceExportDialog`. It reuses
TopBar's existing Block/Modular lowering, checks the captured workflow context,
and asks the backend `/service_package` boundary for supported scalar inputs and
persisted preview outputs. Names refer to exact lowered node/field identities;
there is no second graph representation or client-owned model dispatch. The
backend owns portability checks, observed dependency/model/custom-code manifests,
and execution-time validation. `studio/servicePackage.ts` narrows responses before
showing candidates or downloading JSON. Auto keeps its existing compact menu.
Service packages run through the existing backend queue; they are not standalone
Diffusers Python or an alternative graph import format.

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

`ModiffDialog` owns the bounded flex frame and accessible description. Optional toolbars stay outside the
scrolling body alongside the fixed header and footer. Model Manager uses that toolbar for search and inventory
sections; local search filters already-resolved profiles without refetching resource plans for each keystroke.
Refresh leaves search, section navigation and dismissal available, with progress in the footer. Destructive cache
actions remain disabled while an inventory operation is pending. Token drafts are password fields, cleared on
cancel/dismissal and never read back from the server. These presentation controls do not grant model access,
acknowledge licenses, change installation targets or initiate downloads by browsing.

See the [frontend style guide](frontend-style-guide.md). `npm run style:audit` prevents new raw visual literals outside approved source areas.

## Tests And Gates

Saved Modular instances are diagnosed against the loaded exact upstream block
ID/hash in `blockSeedRepairV2.ts`. A seed on a step that does not consume a
Generator remains a visible, nonblocking warning. The existing Graph Fix dialog
offers an explicit choice only when the concrete `state_in` / `state_out` ancestry
identifies an unoccupied Generator consumer. The atomic transaction moves the
seed field and its root/local bindings and incoming wire, retaining logical IDs,
values, unrelated graph content, layout and the immutable definition snapshot.
Sealed/mirrored ambiguity, stale contracts and local-subtree scope violations
are refused with an explanation. Loading a workflow never applies this repair.
Readiness invalidation includes effective graph/interface identities and cached
instance-value fingerprints, so collapsed model switches and repairs cannot
leave an old readiness result on screen.

Task-driven readiness invalidation tracks task identity, lifecycle, workflow
ownership and the displayed run label. Progress percentages, heartbeat timestamps
and step counters update their normal task surfaces without revalidating the
entire Block graph or rebuilding its Fix plan. Resource snapshots remain a
separate invalidation signal, and changing the selected workflow rechecks queue
ownership even when its graph is otherwise unchanged.

- `scripts/*.test.mjs`: unit/contract tests for graphs, templates, requests, Gallery, styles, and coordination
- `tests/e2e/studio-mocked/`: deterministic browser coverage with mocked backend routes
- `npm run check`: format, lint, types, styles, unit tests, build, and bundle budget
- `npm run check:ui`: mocked Playwright Studio gate
- Gallery verify/coverage commands: public example and template publication gates

Mocked browser coverage proves client behavior. It does not prove model installation, GPU compatibility, output quality, or a live backend model path.

Set `MODIFF_GALLERY_STABLE=1` for long browser regression runs to disable
development hot reload while independent checks update files. Headless Vite
servers used by tests/catalog readers set `server.watch: null`; they do not
need live reload. The interactive development server excludes generated
`artifacts/` as well as Playwright result directories from its watchers, so
large qualification traces cannot exhaust the host's inotify limit. When exercising
byte-pinned default-media uploads, `MODIFF_E2E_TEMPLATE_INPUT_CACHE` may point
to the `template-gallery/runtime-inputs/assets` directory of a pinned Hub
Dataset snapshot pulled through `huggingface_hub`. The mocked harness serves
matching cached bytes only after validating the SHA-256 basename; the app
still performs its normal checksum and upload. Missing cache entries retain
the normal remote path, so this option alone does not make the entire Gallery
suite offline. Backend file mocks match the `/file` endpoint exactly; broad
substring mocks can corrupt unrelated font requests containing `/files/`.

## Change Guardrails

- Preserve compatibility for existing graph JSON, local-storage migrations, backend endpoint names, and websocket message fields unless a coordinated migration is explicitly part of the change.
- Keep graph execution visible and single-sourced through `useFlowStore`.
- Keep network and persistence payloads guarded at their boundaries.
- Preserve workflow-tab/run attribution across asynchronous work.
- Document backend needs in the relevant public issue or cross-repository change; do not add workstation-specific handoff trackers to permanent docs.
- Pair runtime claims with the correct proof level.
- Update this document, user guides, tests, and backend contract documentation together when ownership or behavior changes.

### Reviewed video file boundaries

A reviewed upstream video input may be annotated as a list of PIL frames.
Its public file-path adaptation must describe the bound video file browser;
the decoded runtime connection remains a video socket. Wan Animate2's base
and distilled routes declare this adaptation explicitly. Updating those types
also updates the paired backend compiled catalog and its exact client pins.
Preserve creator values, graph edges, structural containers and their layout.
Do not relax generic input validation to accept an image file adaptation on a
video loader. The focused regression exports both creators with only their
required media paths supplied.

Running from a generic User Node root resolves to a terminal media preview
inside that specific expanded instance (or its first terminal node when it
has no media preview). Both the store export and run coordinator use this
resolution. Other disconnected User Node instances remain outside the run;
ordinary incoming dependencies of the selected endpoint are retained. A
legacy User Node with no executable terminal fails explicitly.

### Block authoring and retained demo previews

`useBlockEditorStore` captures the workflow epoch, selected scope and request identity
for Save and Configure interface. `BlockEditorPanelV2` lazily renders their compact
right-workspace content; switching documents cannot apply a stale draft to another
Block. New User Nodes use an editable, prefilled name and omit outside nodes/wires
and derived crossing sockets.

`blockPreviewPersistenceV2` maps an exact run and field to its retained backend media
URL. A ready backend current-output slot for the same workflow/node/field can restore
completion missed while the browser was closed. A merely newer output from the same
node is insufficient. Snapshots, saves and reloads retain these durable references
without changing graph values or execution ownership.
