# Auto Mode Design

Auto is MoDiff's evidence-aware resource planner. It chooses a known local model/runtime recipe for the current task and machine. It is not a hidden benchmark, an automatic quality reducer, a background model probe, or a generic "use less VRAM" switch.

This document describes the **Resources → Automatic** planner and **Expert
overrides** execution policy. These are independent of the Auto/Expert authoring
view: developers can use Expert tools with automatic resource management, and
Auto view can present a workflow with explicit resource overrides.

## User Contract

Auto must:

- Inspect the current task/model form, backend packages, runtime hardware, installed artifacts, artifact completeness, system memory, accelerator memory, and offload headroom.
- Distinguish backend, vendor, architecture, and memory topology. Accessible shared/GTT/unified capacity must not be ranked as equivalent dedicated VRAM.
- Select a concrete candidate with a resolved artifact and execution recipe.
- Enable Run only when the selected candidate has a proof state accepted by the backend/client contract.
- Apply the selected generation, dtype, quantization, device, and offload values to the visible graph.
- Explain an install, repair, package, access, hardware, or support gap when no candidate is ready.
- Keep retries finite, visible, and associated with the user-started run.
- Record successful/failing recipe evidence so a known-bad candidate is not silently retried forever.
- Bind optimization evidence to the complete recipe identity: model, artifact/revision, dtype, quantized components, device mapping, offload, attention backend, compile/cache settings, memory format, runtime profile, driver, and hardware.

Auto must not:

- Load a large model or generate media before the user presses Run.
- Mark a `planned`, schema-only, mocked-only, or incomplete candidate as runnable.
- Treat a matching cache-directory name as artifact completeness.
- Guess that one VRAM threshold is sufficient across model families, resolutions, frame counts, dtypes, and offload strategies.
- Apply CUDA-only offload or optional-kernel behavior to MPS/XPU merely because the graph is otherwise portable.
- Hide a kernel, out-of-memory, package, or model-access failure behind an indefinite spinner.
- Change quality-sensitive settings merely to make a workflow fit unless that change belongs to a named, reviewed recipe.

## Expert Contract

Expert exposes lower-level choices for graph authors and experimental model paths:

- Model repository/artifact
- Dtype and quantization
- Device
- Offload enablement and strategy
- Raw graph/runtime fields
- Lower-level workflow and API graph exports

The **Expert overrides** resource policy remains subject to graph, required-input,
connection, and backend capability validation. It can submit without an Auto
resource proof; opening Expert view alone cannot bypass planning or a rejection.
The UI must not describe unqualified combinations as validated for the machine.

Do not use "Manual" in user-facing documentation or new code. The current product term is **Expert**.

## Planning Flow

```text
Studio form
  -> POST /auto_resource/plan
  -> inspect runtime, packages, model indexes, artifact metadata, and history
  -> rank candidates
  -> select one candidate only when its proof is accepted
  -> verify its exact loader module/action, execution path, and selected Hub repository against the managed visible graph
  -> apply candidate to form and visible graph
  -> run-readiness validation
  -> user presses Run
  -> submit graph with candidate/runtime identity
  -> record success or classified failure
```

The model library can batch-plan visible profiles through `POST /auto_resource/plans`. Auto history can be inspected or cleared through `/auto_resource/history`; clearing history removes evidence and should be treated as a diagnostic action, not a routine way to bypass a failed recipe.

## Readiness And Proof Levels

Use precise support language:

| Level             | What it means                                                        | May Auto run?                            |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------- |
| Catalog/profile   | Client has labels, fields, task mapping, and intended artifacts      | No                                       |
| Registry/schema   | Compatible backend nodes/endpoints are present                       | No                                       |
| Mocked UI         | Client behavior passes deterministic mocked browser coverage         | No                                       |
| Artifact-ready    | Required files/revision are complete and indexed                     | Not by itself                            |
| Runtime candidate | Recipe matches declared packages/resources but has no accepted proof | No                                       |
| Accepted proof    | Backend reports a proof state recognized as ready for this candidate | Yes                                      |
| Live output proof | The recipe completed on known hardware with attributable output      | Yes, subject to current health/resources |

Proof is scoped. A successful text-to-image run does not prove inpaint, control, video, a different artifact revision, or a larger resolution. A mocked test never proves model execution.

## Candidate Contents

A usable candidate should declare enough information to reproduce and diagnose it:

- Stable candidate identifier and exact execution-profile identifier
- Model type, task, repository/artifact, resolved revision, and the exact immutable repository/revision receipt for every reviewed auxiliary model dependency
- Exact loader module/action and runtime execution path
- Dtype and quantization
- Device and offload mode
- Width, height, step count, guidance, frame count, duration, or other task-specific generation values
- Minimum/recommended hardware and disk expectations
- Required backend packages/nodes
- Artifact validation result
- Proof status/message and checked timestamp
- Known incompatibilities or failure history
- Install/repair action when the artifact is not ready

Avoid candidate fields that contain developer-specific absolute paths or secrets. Public exports and Gallery provenance should preserve reproducibility without disclosing workstation identity.

For schema-v2 plans, the selected candidate must be the unique same-ID entry in the returned candidate list and retain the same workflow and execution identity. Its artifact repository fields must agree, and its `modelDependencies` receipt must exactly match the current model/mode profile as bounded `id`/`kind`/`repo`/immutable-`revision` entries. The client applies it only when the exact loader is executable, belongs to the current managed graph, and selects that exact Hub repository. Local selectors, unknown repositories, conflicting artifact identities, disabled loaders, unrelated matching loaders elsewhere on a mixed graph, stale model/task pairs or dependency revisions, and missing targets block Run and ask the user to refresh or rebuild. A target that is already configured correctly remains valid; applicability does not depend on changing a field.

## Current Model Policy

The client contains profiles for Z-Image, Qwen Image, Wan VACE, ACE-Step Audio, and FLUX families. Their status is deliberately uneven:

- **Z-Image Turbo:** Auto-ready text-to-image profile when the official Diffusers artifact and a compatible backend are available.
- **Qwen Image text-to-image:** Auto can choose a compatible prequantized Diffusers artifact on constrained CUDA hardware; official BF16 needs substantially more headroom.
- **Qwen Image control:** Profile and graph are available, but the control recipe remains Expert until its modular/runtime path is validated for Auto.
- **Qwen Image Edit:** Auto is allowed only for modes and artifacts whose direct execution contract and resource requirements match.
- **Qwen Image Edit Plus and Layered:** Expert-only until their mode-specific execution/resource contracts are proven.
- **Wan VACE:** Auto-ready profile for supported video modes when the direct backend recipe, artifact, CUDA resources, RAM, and offload space are available.
- **ACE-Step Audio:** Auto-ready profile when the Diffusers audio runtime and artifact are installed; start with short duration before longer generations.
- **FLUX:** Schnell and selected Dev artifacts can have Auto candidates; Krea, Kontext, Fill, Depth, Canny, and Redux profiles remain Expert-only until their specialized paths are proven.

These are policy bounds, not a guarantee that the current machine is ready. The live backend plan is authoritative for Run readiness.

## Quality Rules

- Keep model-family quality defaults tied to the selected artifact/recipe.
- Do not lower Qwen native-quality recipes to very low steps or guidance without an explicit distilled/Lightning/Turbo artifact.
- Do not apply FLUX guidance semantics to Qwen or ACE-Step.
- Preserve requested aspect ratio within the model recipe's pixel budget; do not silently force every request to square.
- Video fallbacks may reduce frames, resolution, or steps only as a named recipe/retry disclosed in the run UI.
- Audio XL Turbo is guidance-distilled; higher generic guidance does not make it better.
- Prefer a visibly blocked high-quality recipe over an unlabelled low-quality workaround.

## Failure And Retry Rules

Retries occur only after the user starts a run. They must:

1. Classify the failure (for example OOM, package/kernel incompatibility, artifact error, or input contract).
2. Release managed resources when appropriate.
3. Choose a finite next candidate that materially changes the failed condition.
4. Tell the client which recipe changed and why.
5. Stop after the bounded candidate set is exhausted.
6. Persist enough evidence to avoid repeating the same unchanged failure on the next run.

Do not retry authorization failures, corrupt/incomplete downloads, invalid inputs, or missing backend nodes as if they were memory pressure.

## Adding A Model Or Mode

Before exposing a model/mode as Auto-ready:

1. Add a `StudioModelProfile` with correct task/input/output capabilities and artifact information.
2. Add `STUDIO_AUTO_MODEL_REQUIREMENTS` metadata with supported modes, hardware envelope, quality defaults, artifacts, notes, and a clear Expert-only reason when applicable.
3. Add a backend candidate that resolves a concrete installed artifact and execution path.
4. Define artifact completeness and package/node checks.
5. Define quality-safe generation defaults and finite lower-memory retries.
6. Add unit coverage proving the profile cannot become ready without requirements metadata and accepted proof.
7. Add mocked UI coverage for plan summary, install/repair action, Run gating, graph application, failure, and retry messaging.
8. Run the real backend registry/schema checks for the exact mode.
9. Produce an attributable live output on the claimed hardware/artifact path.
10. Document mocked, schema, artifact, and live proof separately.

If any step is missing, keep the profile visible as Expert-only or blocked with a specific reason.

## Review Checklist

- Does the same form produce a stable candidate key?
- Does the selected candidate target the exact managed loader module/action and preserve that target in every retry?
- Do its auxiliary/base-model dependencies match the current immutable model/mode receipt in the plan, runtime hints, and history signature?
- Is artifact completeness checked beyond directory presence?
- Is the selected candidate's proof accepted rather than merely non-empty?
- Are hardware and package errors actionable?
- Are graph fields updated to the recipe that will actually run?
- Can another workflow tab or later request overwrite this plan/run attribution?
- Are retries bounded and visible?
- Are local paths and secrets excluded from public records?
- Do docs/tests avoid treating visibility or mocked coverage as live support?
- Does Expert remain usable without weakening Auto's honesty?

## Custom and multiple-Block workflow Auto

The information button beside Resources opens Workflow resources in the right panel.
The existing source-recipe assessment remains read-only. **Check Auto execution
plan** also validates the actual executable graph through
`POST /auto_resource/workflow` (`schemaVersion: 1`, `graph` containing the existing
API `nodes`, `paths` and optional `loops`). Inspection does not execute nodes,
install packages, generate media, randomize seeds or change graph fields.

Custom topology, User Nodes and multiple Blocks no longer force Expert. Run
exports the current execution scope and applies the existing Modular composition
lowering before planning. Running one Block excludes outside suppliers; running
the workflow includes them. The existing executor still owns dependency order,
loops, cache cleanup, progress, cancellation and output history.

The backend resolves real model loaders through the reviewed execution profiles
and reuses the existing artifact/runtime/resource candidate planner and history.
It preserves the repository, pinned revision, dtype, quantization and creative
controls. Only declared offload fields can be changed, visibly and in one Undo
transaction. A shared loader is counted once; separate loaders are counted
separately even if their repositories match. Connected pinned Modular LoRAs add a
conservative budget derived from verified safetensors shapes without loading the
tensors. Built-in data/media operations do not become model owners.

Auto preserves retained-cache behavior for a single or shared model owner.
For independent model owners, it uses the lower live-memory envelope: it derives
lifetimes from dependencies and finishes ready consumers before opening another
model. Dispatch-time recipe selection cannot discard those release checkpoints. The existing executor releases
completed owners, retains detached downstream images/arrays/scalars, and checks
actual free memory before the next loader. Shared references remain live; opaque
model/device outputs cannot be released. Loops keep their owners for the complete
loop. The resource panel reports peak live requirements; run receipts record the
actual release checkpoints. Shared GPU allocations consume system RAM, not an
additional independent pool. Placement currently covers the default accelerator;
multi-GPU placement is a required follow-up, not implemented support.

Literal and built-in Text/data operations resolve during read-only inspection.
Other supported data-only suppliers are marked pending: Run executes their
required ancestors through the existing executor, invalidates stale cached values,
then replans using actual outputs before any model is loaded. Unknown/custom or
model-dependent suppliers need a reviewed data-preparation contract. Resource
values are checked again when their consumer executes. Deferred offload changes
use the existing runtime-resource event, update only unchanged matching workflow
fields and their shared controls, and remain undoable. Newer edits are preserved.

Nested legacy definitions are converted from their current embedded snapshots;
older Cluster executable metadata is hydrated through the existing preparation
path. Auto can therefore reach formerly hidden loader fields. Conversion plus
resource changes or explicit movement form one Undo transaction. Interfaces,
current values, external connections and preview references survive; the reusable
library definition is not rewritten. Missing exact source metadata remains an
explicit diagnostic.

Run checks the graph again after planning and updates only supported visible
resource controls. A `workflowAutoPlan` receipt binds the resulting API graph by
hash. At dispatch the backend verifies the hash and re-plans against current
artifacts and memory before model allocation (after required data-only preparation). Editing a workflow, switching tabs
or changing resource policy while planning invalidates the client request. This receipt does
not grant registered-source, catalog, publication or model qualification authority.
There is one graph execution attempt; this path adds no automatic whole-graph
retry or silent reduction of quality.

Selecting Expert overrides preserves the graph and explicit settings. Loader Auto
Offload and Repeat/Loop remain separate controls. A successful combined plan is
resource eligibility, not live output proof for every possible composition.

The Resources control follows the active workflow form on reopen, including
custom workflows without a Studio binding. The separate view switch follows the
global editing preference. Neither restoration nor inspector navigation mirrors
one setting into the other. App runs that opt out of Studio metadata still use
the workflow Auto planner when automatic resources are selected.

Presentation switches preserve nodes, edges, effective inputs, graph history and
resource authority. They do not synchronize schemas or request a new Auto plan.
Advanced-field disclosure follows authoring mode; Auto-managed field indicators
and pinned overrides follow resource policy. Invalid automatic planning remains
explicit and never forces a different authoring view or silent execution fallback.

Auto accounts for reviewed Modular state-input aliases and constant iteration
resource inputs. Resource values computed within an iteration need a reviewed
upper bound; otherwise the planner explains the blocker and preserves Expert
execution. Larger batches require matching candidate evidence and requirements.
Historical recipes without a batch size cover only one item.

Deferred plans return a hash for exactly the patches offered to the client; if
all patches are postponed, the hash describes the unchanged graph. Seeded
Generator and Attention Arguments are supported data-only actions. Shared graph
ancestors execute once per attempt, preserving one advancing Generator across
consumers; later attempts receive a fresh Generator. Explicit loops still iterate.
