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
- **Save** writes the active snapshot to the backend **My workflows** library. Its menu provides Save as and a JSON
  file copy; `Ctrl+S` saves the current name and `Ctrl+Shift+S` opens Save as.
- **Export** provides a workflow package, latest-output package, and Gallery shortcut. Expert also exposes raw workflow/API graph JSON.
- The **Auto** switch changes the resource/control surface between Auto and Expert.
- **Fix** opens a review dialog only when the client has deterministic graph repairs. Inspect the proposed changes
  before applying them; the tool does not guess at model or creative intent.
- **Run** validates and submits the current graph. While any work is active or waiting, the same one-shot action is labeled **Queue** and appends an immutable graph snapshot without interrupting the current run. Its menu also contains continuous **Auto** and **Loop** behaviors; use those only when repeated execution is intentional.
- **Stop** asks the backend to interrupt execution and resets repeated-run state.
- The progress badge opens queue context.
- The compact resource monitor reports the backend's current CPU, memory, disk active time, and accelerator snapshot; disk capacity remains in the expanded storage details. It is monitoring
  evidence, not proof that the selected model will fit.
- **Models**, **Templates**, **Settings**, **Gallery**, and the connection button open their respective tools.

The Auto switch and the Run menu's Auto item have different roles: the switch selects a hardware-aware resource recipe, while the run item reruns after graph parameter edits. Prefer one-shot **Run** until you understand the repeated modes.

### Left Rail

- **Nodes** browses the live backend registry and adds nodes to the canvas.
- **Templates** browses curated workflow recipes.
- **Gallery** shows generated and imported media for the active workflow.
- **Models** summarizes supported, installed, missing, and downloading artifacts.
- **Workflows** browses backend workflow files.

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

### Right Workspace

- **Studio** contains guided task/model/form controls and graph-aware readiness.
- **Queue** shows current and recent task progress, cancellation, and errors.
- **Setup** reports backend runtime, capability metadata, model/cache state, and install diagnostics.
- **Setup → Runtime optimizations** shows supported optimization packages, isolated environments, qualification
  receipts, activation, and rollback. Install or activate only entries supported by the current backend profile, and
  do not treat an unqualified probe as production evidence.
- **Run as app** appears in Expert for graphs with a recognized input/output surface.

## Build And Edit A Guided Workflow

1. Choose a task or template.
2. In Studio, select a compatible model.
3. Keep Auto enabled unless you are deliberately testing an experimental configuration.
4. Enter the prompt and mode-specific media inputs.
5. Adjust generation settings that the selected recipe permits.
6. Use **Sync** when you want to explicitly reconcile Studio values into the managed graph. Most guided changes also synchronize automatically.
7. Inspect the canvas before running. Studio-owned nodes should form one coherent execution path; unrelated manual nodes should remain untouched.
8. Review the readiness row. Clicking a warning opens the complete issue list.
9. Press one-shot **Run**.

Studio adopts a compatible existing graph when possible. If you manually change a managed graph until it no longer matches its binding, Studio treats it as a custom graph rather than silently replacing it. You can still select nodes and edit their exposed parameters from the Studio panel.

## Auto And Expert

### Auto

Auto requests a backend plan for the current form. A ready plan can select:

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

Expert exposes model artifact, dtype, quantization, offload, device, graph, and output fields. It is intended for contributors, advanced users, and explicitly unproven paths. Expert validates obvious graph and input failures but cannot prove that an arbitrary combination fits memory or matches a model's runtime contract.

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
