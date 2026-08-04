# Auto Mode Design

Auto is MoDiff's evidence-aware resource planner. It chooses a known local model/runtime recipe for the current task and machine. It is not a hidden benchmark, an automatic quality reducer, a background model probe, or a generic "use less VRAM" switch.

This document is the contributor contract for Auto and the corresponding Expert escape hatch.

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

Expert remains subject to graph, required-input, connection, and obvious backend capability validation. It is allowed to submit combinations without an Auto proof, but the UI must not describe those combinations as validated or safe for the machine.

Do not use "Manual" in user-facing documentation or new code. The current product term is **Expert**.

## Planning Flow

```text
Studio form
  -> POST /auto_resource/plan
  -> inspect runtime, packages, model indexes, artifact metadata, and history
  -> rank candidates
  -> select one candidate only when its proof is accepted
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

- Stable candidate identifier
- Model type, task, repository/artifact, and resolved revision when available
- Runtime/execution path
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
- Is artifact completeness checked beyond directory presence?
- Is the selected candidate's proof accepted rather than merely non-empty?
- Are hardware and package errors actionable?
- Are graph fields updated to the recipe that will actually run?
- Can another workflow tab or later request overwrite this plan/run attribution?
- Are retries bounded and visible?
- Are local paths and secrets excluded from public records?
- Do docs/tests avoid treating visibility or mocked coverage as live support?
- Does Expert remain usable without weakening Auto's honesty?
