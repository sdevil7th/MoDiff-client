# Studio User Guide

Studio is MoDiff's guided layer over the visible backend graph. It helps choose a task, model, inputs, prompt, and resource recipe without hiding the nodes that will execute. Studio and the canvas are two views of the same workflow; there is no separate Studio-only execution engine.

## Start The App

Follow the [project installation guide](../README.md#install-and-run-modiff) to
run the client and backend together. When the page opens, confirm the top-right
connection button reports **Connected**, then open **Setup** and resolve any
environment repair blocker before trying to install models or run a graph.

The normal local addresses are:

- Installed app: `http://127.0.0.1:8088` (backend and bundled client)
- Development client: first available port starting at `http://127.0.0.1:5173`

The launcher prints the actual client URL. A different Vite port is normal when `5173` is occupied.

## Choose How To Start

When the canvas is empty, the task launcher offers common guided entry points:

| Task                       | Required input                               | Typical model family                                | Notes                                                                                      |
| -------------------------- | -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Text to image              | Prompt                                       | Z-Image, Qwen Image, or an eligible FLUX profile    | Best first smoke test is a lightweight Auto-ready image recipe                             |
| Edit image                 | Source image and prompt                      | Qwen Image Edit or an eligible edit profile         | Preserves the source as workflow context                                                   |
| Multi-image reference edit | Multiple reference images                    | Qwen Image Edit Plus or an eligible reference model | Some profiles remain Expert-only                                                           |
| Inpaint                    | Source image, mask, and prompt               | Qwen Image Edit or eligible Fill profile            | Run remains blocked until both media inputs and a supported execution contract are present |
| Outpaint                   | Source image, expansion settings, and prompt | Qwen Image Edit or eligible Fill profile            | Studio prepares an expanded canvas/boundary mask for supported paths                       |
| Control image              | Prepared control image and prompt            | Qwen ControlNet or eligible control profile         | Additional model artifacts may be required                                                 |
| Layer decomposition        | Source image and layer settings              | Qwen Image Layered                                  | Expert-only until its Auto resource contract is validated                                  |
| Text/video transformation  | Prompt and mode-specific video/image input   | Wan VACE                                            | Large, slow, and hardware-dependent                                                        |
| Advanced workflow          | None                                         | Any backend node family                             | Leaves a blank canvas for direct graph authoring                                           |

**Browse recipes** opens the template browser. Templates are often the clearest way to discover image, video, audio, or advanced workflows that are not shown as first-screen shortcuts.

The model list is filtered by task. A model profile being visible means the client understands its intended fields and requirements; it does not guarantee that the current backend, artifact, or machine can run it.

## Understand The Interface

### Top Bar

- **New** opens a clean local workflow tab.
- **Open workspace / Collapse workspace** toggles the right panel. New workflows, including Advanced workflows,
  open Studio. Adding or selecting nodes reopens a collapsed workspace; selecting on the canvas preserves an
  already-open Queue, Setup, or Block tool. Refresh preserves your explicit open/collapsed choice.
- **Save** writes the active snapshot to the backend **My workflows** library. Its menu provides Save as and a JSON
  file copy; `Ctrl+S` saves the current name and `Ctrl+Shift+S` opens Save as.
- **Export** provides a workflow package, latest-output package, and Gallery shortcut. Expert also exposes raw workflow/API graph JSON.
- **Auto view / Expert view** changes editing tools and node discovery. It preserves the graph and execution settings.
- **Resources → Automatic / Expert overrides** selects this workflow's execution policy in either view.
- **Fix** opens a review dialog only when the client has deterministic graph repairs. Inspect the proposed changes
  before applying them; the tool does not guess at model or creative intent.
- **Run** validates and submits the current graph. While any work is active or waiting, the same one-shot action is labeled **Queue** and appends an immutable graph snapshot without interrupting the current run. Its menu also contains continuous **Auto** and **Loop** behaviors; use those only when repeated execution is intentional.
- **Stop** asks the backend to interrupt execution and resets repeated-run state.
- The progress badge opens queue context.
- The compact resource monitor reports the backend's current CPU, memory, disk active time, and accelerator snapshot; disk capacity remains in the expanded storage details. It is monitoring
  evidence, not proof that the selected model will fit.
- **Models**, **Templates**, **Settings**, **Gallery**, and the connection button open their respective tools.

The view switch controls presentation; Resources controls planning. The Run menu's **Auto** item reruns after graph parameter edits. Prefer one-shot **Run** until you understand the repeated modes.

### Left Rail

- **Nodes** browses the live backend registry and adds nodes to the canvas.
- **Templates** browses curated workflow recipes.
- **Gallery** shows generated and imported media for the active workflow.
- **Models** summarizes supported, installed, missing, and downloading artifacts.
- **Workflows** browses backend workflow files.

Creator and Developer share one **Nodes** library. It starts with generic nodes,
common task/media operations, graph-qualified task Blocks, enabled custom nodes
and Saved Blocks. Generic nodes remain available before selecting a pipeline.
Select a pipeline and task in **Diffusers operations**, then click **Load models**,
**Encode prompt**, **Denoise**, **Decode latents**, or another declared operation
to add one ordinary node with that pipeline's inputs. Whole-pipeline routes show
a **Pipeline** label. Specialized audio, video and conditioning operations retain
their declared entries.

The picker reports execution adapters and runtime requirements separately. A
node can be authored without an executable adapter; visibility does not mean Run
is available. Model artifacts and resource checks still belong to the backend.
Install required packages explicitly through Setup. Browsing a pipeline changes
neither existing nodes nor execution settings. Leaving the destination workflow
or changing the pipeline/task selection cancels pending insertion.

Sidebar and canvas search share the same transient discovery filters and pipeline
selection. The selection resets when the destination document is replaced. In
common discovery, a bound operation replaces only its exact registry contract
and aliases; distinct schemas remain separate. Older backend registries remain
usable without an operation catalog. Saved identities and graphs do not change.

Select a node or Block on the canvas to see its controls in the Studio side panel.
The selection toolbar's **Inspect node** or **Inspect Block** opens the same inspector
in a dialog, even when the Nodes library is closed. Both Creator and Developer offer:

- **Parameters**: the canvas's existing controls, with the same edits and Undo.
- **Interface**: declared input/output types, required sockets and current connections.
  A composition shows its public sockets without expanding its internal graph.
- **Implementation**: the underlying action, operation defaults and overrides,
  retained settings excluded from execution, and available source/revision metadata.
  Approved custom Python nodes expose their installed source path and inspected code
  hash; opening the inspector grants no code permission.
- **Docs**: descriptions and field help supplied by the node or Block.
- **Run details**: current execution status, reported cache state and diagnostics.
  Cached outputs do not guarantee a cache hit on the next run; earlier runs remain
  in history.

Browsing these details does not edit the graph, resolve fields or load models.
Parameter edits update the original workflow. Escape closes the dialog and restores
focus; selection or workflow changes close it. Run-blocked and Fix inspection actions
focus the affected node without changing workspace or memory policy. Expand a Block
on the canvas for structural editing; this does not edit its Python implementation.

Double-click empty canvas space, or drag a connection to empty space, to search
nodes and Saved Blocks without opening the library. Select a pipeline in this
picker to find its bound nodes too. Searches retain old registry
keys and labels, plus the historical **User Nodes** name. Saved Blocks show their
saved revision; equal names do not merge separate definitions. Connection searches
show compatible public inputs or outputs according to the originating handle.
Selecting a result creates a fresh instance and validates the wire through the
canvas's existing rules. For a bound node, a compatible declared value input can
expose its editable control as a socket, just as dragging a wire onto that control
would. Hidden, disabled, signal and binding-constant fields are not exposed. Undo removes that insertion and wire together; a rejected
connection leaves no disconnected insertion. Search does not grant code consent.

**Blocks** is the public name for both registered compositions and saved reusable
compositions. **Saved Blocks** retains each saved name and revision. Existing
workflow types, action names and library identities are unchanged. Historical
Cluster/User Node terminology can still occur in older files and migration
receipts. Use the explicit migration preview for supported historical documents;
opening a file or switching Auto/Expert does not convert it.

New ordinary Diffusers image nodes and connected workflows use the selected
model’s reviewed dtype, size, steps and guidance when those controls apply.
Models sharing a pipeline class retain their own starting values. These are
editable starting values; resolving another model does not rewrite an existing
workflow or change its memory policy.

Ordinary image utilities—including Resize, Apply Mask, Merge Images, Image Grid,
comparison and saving—are available in the normal Nodes library in both workspaces,
alongside text and value utilities. They do not require a pipeline selection or
an implementation filter.

**Show implementation nodes** adds underlying adapters, upstream Modular blocks,
catalog-only tasks and component references. Check each entry's readiness.
**Show experimental nodes** independently adds experimental entries. These options
are available in both workspaces, apply to sidebar and canvas discovery, and stay
selected when switching workspace. They do not change the workflow or memory
policy. Saved Blocks remain available with either option.

### Canvas And Workflow Tabs

The canvas is the executable workflow. You can move and resize nodes, connect compatible ports, select multiple nodes, import graphs, and use node context actions.

Workflow tabs sit above the canvas and are local-first:

- `+`/New opens another workflow.
- Switching tabs saves and restores graph, viewport, Studio form, and graph binding.
- Closing a tab selects a nearby tab; closing the last tab creates a fresh workflow.
- Imported graphs, templates, Gallery restores, and output packages can open new tabs.
- A dirty marker means the local snapshot changed; tabs are not automatically backend workflow files.

Browser local storage is not a backup. Save important workflows to **My workflows** or export a JSON/package before
clearing site data or switching browser profiles.

### Connect And Move Across Blocks

Drag an input or output onto empty canvas to add a compatible node. Dragging an
output suggests nodes with matching inputs; dragging an input suggests matching
outputs. Installed custom nodes participate through their declared port types,
including controls already exposed as inputs. Search narrows those compatible
results, and selecting a node inserts and connects it. These suggestions use the
full executable node registry, independently of the left library's catalog tab.
They do not install custom code or establish model-family compatibility.

A compatible outside node can connect directly to an internal input, and an internal
output can connect outside. Expanded Blocks show curved links to the visible internal
node. Collapsed Blocks show an additional **Connected internal ports** section at the
bottom. Removing the last crossing connection removes that temporary socket. Explicitly
configured inputs and outputs stay available. Existing Step link preferences are retained.

Ordinary dragging only repositions nodes; an internal move grows its container when
needed. Hold **Ctrl** (Windows/Linux) or **Cmd** (macOS) while dragging to move a node or
Block into, out of, or between Blocks. Overlap alone never changes ownership. Select an
internal node or Block and use **Move out of Block** to move up one level. Toolbar tooltips
show the available shortcuts or gestures, including **Delete / Backspace**.

**Run Block** executes contained nodes and their internal dependencies only, including
all enabled terminal branches. Outside sources are ignored even when attached to a
configured input: the Block uses its stored fallback or reports a missing input. The
whole-workflow Run includes connected outside sources. Move a source inside when it
should be part of a Block-only run. This behavior applies to modern Blocks.

### Save A Block Or An Internal Modular Block

Use the Block header's Save button, or select an internal Modular Block and
use Save in its selection toolbar. Both open **Save block changes** in the right workspace, with an editable name
prefilled from the selected Block:

- **Keep only in this workflow** retains the current local workflow snapshot;
  it does not create or update a saved Block. Use the top-bar Save as well when
  you want a named backend workflow file.
- **Save as new Block** copies the selected Block with its current prompts
  and settings. For an internal Block it copies only that subtree and its
  explicitly configured interface. Outside nodes and wires are omitted;
  temporary connected-only sockets are not saved as reusable ports. Its parent and
  other workflow instances are unchanged.
- **Update existing Block** appears on a user-owned reusable Block root.
  Internal projections do not have independent library definitions to overwrite.
  Insert a saved subtree from Saved Blocks to edit/update that definition independently.

Collapsed internal Blocks show their declared descendant controls. Editing the
same prompt or parameter at the root, an intermediate Block, or its internal
node changes one workflow value; it does not rebuild the graph or reset defaults.

Use the settings icon on a Block header to configure exposed inputs, outputs and
controls. On an internal Block, the right panel edits that subtree's exposure through
the owning Block interface and preserves other branches. Consumers shared across
branches must be edited from the root. Internal connection sockets are derived
from the actual links, not independently stored nested interfaces. Disconnect a
public port before removing it. If the Block changes while the panel is open,
cancel and reopen it to avoid overwriting newer edits. Apply is undoable; Cancel
does not change the workflow.

Cancel makes no library write. A workflow or canvas switch invalidates an open
save operation rather than allowing it to save a different instance.

### Right Workspace

- **Studio** contains guided task/model/form controls and graph-aware readiness.
- **Queue** shows current and recent task progress, cancellation, and errors.
- **Setup** reports backend runtime, capability metadata, model/cache state, and install diagnostics.
- **Setup → Runtime optimizations** shows supported optimization packages, isolated environments, qualification
  receipts, activation, and rollback. Install or activate only entries supported by the current backend profile, and
  do not treat an unqualified probe as production evidence.
- **Setup → Template Gallery assets** verifies the installed byte-pinned
  payload and offers an explicit app-owned install or repair. It plans the
  complete download and staging reservation alongside active model downloads,
  preserves a 64 GiB safety margin, and never removes cached models. Restart
  MoDiff after the action completes and active downloads have finished.
- **Run as app** appears in Expert for graphs with a recognized input/output surface.

## Build And Edit A Guided Workflow

1. Choose a task or template.
2. In Studio, select a compatible model.
3. Keep **Resources → Automatic** selected unless you are deliberately testing an experimental configuration.
4. Enter the prompt and mode-specific media inputs.
5. Adjust generation settings that the selected recipe permits.
6. Use **Sync** when you want to explicitly reconcile Studio values into the managed graph. Most guided changes also synchronize automatically.
7. Inspect the canvas before running. Studio-owned nodes should form one coherent execution path; unrelated manual nodes should remain untouched.
8. Review the readiness row. Clicking a warning opens the complete issue list.
9. Press one-shot **Run**.

Studio adopts a compatible existing graph when possible. If you manually change a managed graph until it no longer matches its binding, Studio treats it as a custom graph rather than silently replacing it. You can still select nodes and edit their exposed parameters from the Studio panel.

For a custom graph, **Node controls** shows the selected ordinary node or Block's declared
controls with the same values and connections as the canvas. Expand a Block and select an internal node to edit
its controls. Edits use the normal workflow undo/redo and save behavior. **Pin inputs** keeps chosen controls in
that workflow's panel after deselection. Pins inside collapsed Blocks remain readable; **Reveal in Block to edit**
opens their containing Blocks. Custom graph model install/repair actions come from the graph's own requirements,
including multiple models; guided task/model selectors and prompt tools appear only for a managed workflow.

For a Block's explicitly required image/audio/video file input, an empty picker
with no enabled incoming source blocks Run in both Auto and Expert. **Fix → Open
required input** selects the affected controls; it does not invent a mask or
change the graph. Upload a file or connect a compatible source, then save normally.
Optional inputs and disabled branches are not treated as missing required media.
Selected-node Run and branch preview check media in that node's actual execution
path, including upstream dependencies. An unrelated unfinished Block does not
block the selected media path; whole-workflow Run still checks all enabled paths.

## Auto And Expert

### Automatic resources

In either authoring view, **Resources → Automatic** requests a backend plan for the current form. A ready plan can select:

- A specific installed model artifact or repository revision
- Safe spatial/temporal defaults
- Dtype and supported quantization
- CPU, group, or disk-backed offload strategy
- A direct or modular execution path
- A bounded lower-memory retry after a user-started run

Auto does not load a model or generate media merely to decide readiness. A plan must identify a compatible local artifact and carry the backend's current evidence. If no known recipe matches, Run remains blocked and the UI explains the install, package, resource, or support gap.

A ready plan means the backend considers the recipe runnable; it is not a speed
rating. Shared system memory exposed to an integrated GPU is not equivalent to
the same capacity of discrete VRAM. A first run may spend substantial time in
download, validation, pipeline loading, or weight placement before it reports a
denoising step.

Keeping the same prompt and generation parameters does not require keeping the
same runtime recipe. A later run can sometimes use a qualified pre-quantized
artifact, attention backend, compile/cache path, or different device placement.
Those choices require pipeline reload and cannot safely optimize work already
in progress. Auto uses only qualified choices; Expert availability alone is not
runtime qualification.

### Expert

Expert exposes model artifact, dtype, quantization, offload, device, graph, and output fields. It is intended for contributors, advanced users, and explicitly unproven paths. Opening Expert view keeps automatic resource planning enabled when that is the workflow's saved policy. To use your configured execution settings, choose **Resources → Expert overrides** explicitly. Graph and required-input validation still apply; the override policy does not prove that a combination fits memory or matches a model's runtime contract.

Your editing preference is global; each workflow tab saves its own resource
policy. Refresh and reopening preserve them independently. Switching views does
not rebuild the graph, reset parameters, or change the graph's Undo history.

See [Auto mode design](auto-mode-design.md) for the contributor-level contract.

## Model Discovery And Installation

Use the left **Models** library for a task-focused view, the top-bar **Models** dialog for a larger inventory, and **Setup** for diagnostics.

The client combines several backend sources:

- `/model_capabilities` for Studio-supported profiles and task metadata
- `/hf_cache?compact=1` for configured Hugging Face cache entries
- `/local_models` for local model files
- `/model_cache/diagnostics` for scanned cache locations, incomplete artifacts, and discovered external packages
- `/runtime/status` for Python, Torch, CUDA/MPS, package, path, and device state

Possible states include:

- **Ready**: the selected artifact is present and passes the current planner/index checks.
- **Missing**: an expected artifact is absent.
- **Repair**: a repository exists but is incomplete or otherwise not runnable.
- **Installing**: a backend download task is active.
- **Access required**: upstream authorization or repository terms block the download.
- **Expert only**: the client exposes the profile, but Auto has no validated recipe.
- **Discovered, not runnable**: an external package/cache was found but no backend loader accepts its layout.

Use the install/repair action attached to the selected plan. The client sends the backend `/hf_download` request, joins duplicate requests for the same repository, limits new active installs, and refreshes model indexes when the task completes.

Progress can show exact bytes when Hugging Face exposes a total. During metadata resolution or cache materialization, the total may be unknown and progress is intentionally indeterminate. Do not infer a failure solely from an unchanged percentage; check backend activity, disk space, file counts, and the terminal task state.

For gated models, accept the provider's terms and authenticate through supported Hugging Face tooling. Never put a token in a prompt, issue, screenshot, export, or tracked configuration file.

## Run Readiness

The current graph is checked before submission. Blocking issues can include:

- Backend or websocket unavailable
- Empty graph or no reachable output
- Missing required source image, mask, video, audio, or control input
- Missing, partial, or gated model artifact
- Required backend node or Python package unavailable
- Auto plan absent, stale, or incompatible
- Dynamic graph fields still finalizing
- Invalid graph connection or unsupported task/model combination

Warnings describe risk but do not necessarily block Expert. A red node border or issue message is attached to the relevant node when possible.

The submitted Studio run captures the exact API graph, form, graph binding, and run identity used for output attribution. This prevents a later tab or form edit from rewriting the record for an earlier run.

## Queue, Progress, And Stop

The Queue panel and session shelf use HTTP snapshots plus websocket updates. Depending on backend support, a task can report:

- Queued/running/completed/failed/cancelled state
- Active node and phase
- Step number, total steps, percentage, elapsed time, and ETA
- Resource retry or cleanup state
- Task, client-run, and attempt identifiers
- Terminal exception and traceback details

Not every library exposes incremental model-loading or generation callbacks. An indeterminate phase with liveness evidence is more honest than a fabricated percentage.

When a run is already active, choose **Queue** in the Run menu and submit the current graph. MoDiff keeps the active task running and appends the new graph snapshot to the serial FIFO queue. The active run retains canvas ownership until the queued task starts, and the button returns to **Run** when no active or queued work remains.

When a run seems slow, check its active phase, last update, step counter, logs,
and resource monitor. Continued step progress or accelerator activity normally
means slow-but-live execution. A static phase with no websocket heartbeat, log
activity, or resource activity for an extended period is more likely to need
recovery. During denoising, completed-step duration gives a useful rough
estimate for the remaining steps. See [Troubleshooting](troubleshooting.md#a-run-is-taking-much-longer-than-expected)
for phase-specific checks.

**Stop** requests interruption; some native library calls may not stop until control returns to the backend. Do not terminate the process during a model write unless recovery requires it.

## Gallery And Imported Media

Gallery contains generated outputs synchronized from the backend and media imported through the client.

Generated views:

- **Grid**: cards and common actions
- **Inspect**: one output with metadata
- **Compare**: two compatible image outputs and settings differences
- **Lineage**: root/branch/rerun relationships

Common output actions:

- Open or inspect media
- Select/compare compatible images
- Favorite
- Download media
- Download a metadata workflow package
- Download an image with embedded MoDiff PNG metadata where supported
- Restore or rerun the saved workflow
- Send the output to an edit/reference flow
- Copy metadata
- Delete the record

Backend Studio history persists output metadata and managed media so Gallery can recover after browser state is cleared. The client keeps a bounded recent view rather than an unlimited in-memory history. Deleting a record is not a secure-erasure guarantee for logs, caches, backups, or previously downloaded exports.

The main node preview remains the most recently completed output for that workflow and field across workflow-tab changes, browser-tab changes, and refresh. It moves into Previous only after the backend accepts another run that can produce that same preview field. Queueing work never cancels the active run. If the accepted run fails, is cancelled, or completes without an output, the prior record remains in history and is not silently promoted back to current.

Imported media is uploaded through the backend when connected. If backend persistence fails, the browser can use a temporary object-URL fallback for that session. Importing a workflow package accepts MoDiff JSON or a PNG with compatible embedded workflow metadata.

## Export And Restore

The top-bar **Export** menu provides:

- **Workflow package**: Studio metadata, visual graph, API graph when available, and active workflow output context.
- **Latest output package**: selected output metadata plus a restorable workflow snapshot.
- **Open Gallery**: direct access to output/import actions.
- **Workflow JSON** and **API graph JSON**: Expert-only lower-level formats.

Exports can contain prompts, file references, model repositories, graph structure, seeds, settings, and provenance. Inspect files before publishing them. See [Privacy and security](privacy-and-security.md).

## Node And Selection Actions

Right-click a node for actions such as:

- Run from node or branch preview
- Duplicate
- Collapse/expand
- Reset size
- Clear backend cache for the node
- Copy node information
- Inspect issues
- Delete with connected edges

Selecting nodes exposes a selection toolbar. Studio can surface editable fields for one selected custom-graph node, and it can pin useful graph inputs when no node is selected.

Port colors communicate backend data categories. Connection validation still comes from the live node registry; matching colors alone do not make two handles compatible.

## Failure Recovery

When the backend reports a node failure:

- The node receives an error state.
- Queue records the task/attempt.
- The failure dialog shows the available task, node, exception, message, and traceback context.
- Out-of-memory failures can offer **Release accelerator cache**, which calls `/runtime/gpu_cleanup`.

After an accelerator failure:

1. Stop repeated/loop execution.
2. Release accelerator cache.
3. Return to a known Auto plan or reduce model/input size.
4. Restart the backend if the device remains unhealthy.
5. Preserve a minimal redacted exception before retrying if you intend to report the bug.

## Manual Smoke Test

This test avoids claiming real model support when only the UI is available. Use an installed lightweight model for live steps.

1. Start the backend/client and confirm the connection button reports Connected.
2. Open Setup; refresh and confirm runtime, node capability, and model/cache requests complete.
3. Create a new workflow and choose Text to image.
4. Confirm Studio creates one managed graph and Auto reports either a concrete ready plan or an actionable setup blocker.
5. Press Sync twice; verify node/edge counts do not grow.
6. Switch to an edit or control task; verify required media/model issues appear before Run.
7. Switch back; verify obsolete Studio-owned nodes are removed without deleting unrelated manual nodes.
8. Start a second workflow tab, change its prompt/viewport, switch tabs, and confirm both snapshots restore independently.
9. Open Templates and inspect at least one recipe's inputs, defaults, Gallery proof state, and model requirements.
10. If a small model is intentionally missing, start its install and confirm Models, Setup, and top-bar download state agree.
11. With a runnable plan, perform one one-shot run and confirm Queue attributes progress/failure to the active workflow.
12. If output completes, confirm Gallery can inspect, download, restore, and export the workflow package.
13. Import that package into a new tab and confirm readiness is recomputed for the current backend rather than blindly trusted.
14. Stop the dev processes with the repository stop script and confirm unrelated listeners are left untouched.

For automated UI coverage, run `npm run check:ui`. It uses mocked backend routes and proves client behavior without downloading or executing a real model.
