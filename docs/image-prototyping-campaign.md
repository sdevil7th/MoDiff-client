# Serial image qualification

The campaign uses the backend's ordinary operation starters, the client's existing
graph exporter, and the normal `/graph` executor. It does not add an inference
engine or qualify browser gestures. Output decoding is automatic; visual/prompt
assessment, custom-code journeys and hardware acceptance remain separate. The
final per-route case exports, prepares and runs a service package of the edited
graph through the same backend queue.

Finish implementation, regenerate contracts and build the paired app before
starting. Run the automated gates first. Stop the ordinary backend explicitly:
each campaign job owns a fresh loopback backend on port 8088. It refuses to take
over an existing server or active queue. Existing saved workflows and media are
not replaced.

From this client checkout:

```bash
node scripts/image-prototyping-campaign.mjs plan --output artifacts/image-prototyping/run-1
node scripts/image-prototyping-campaign.mjs run --output artifacts/image-prototyping/run-1 --budget-ms 28800000
```

Add `--download` to **plan** only when downloads are authorized. It uses the exact
reviewed revision/file selection and the application's disk-space reservation.
It does not accept licenses, enable remote code, install runtimes or delete models.
Supply task inputs with `--inputs <file.json>` at planning time: an object keyed
by exact readiness `routeId`, with each value mapping backend field names to
ordinary input values. Missing image/mask/component inputs remain failures, not
implicit fixture substitutions.
For a connected image field, use `{"sourceFile":"@data/images/fixture.png"}` as
its input value. The runner inserts the real registered Load Image node and
wires its output; it does not pass a filename in place of a decoded image.
`sourceFile` may also be an explicit ordered array of up to 16 files for a
multi-reference or compositing input. Hidden/inactive inputs are not wired.
An optional distinct `alternateSourceFile` on that binding adds a reference-edit
case. This provides an explicit image-input variation for depth, caption, upscale
and editing tasks without inventing meaningless denoise controls.
The edited service exposes each source file as a required invocation input;
local paths are never embedded as portable service defaults.

Task-declared component download requirements are included with the primary
artifact under one shared 15-minute download deadline. Downloads may
use synchronous responses; the runner's core HTTP transport applies this
same deadline to headers and body (without fetch's separate five-minute header
timeout), caps JSON responses at 64 MiB, and aborts stalled requests.
Native starters may still
leave auxiliary component sockets unbound. Supply these explicitly with a route's
`componentSources` list: each entry names `operationId`, `field`,
`nodeKey: "modules.ModularDiffusers.AutoModelLoader"`, and `values` containing
the component type, Hub selector and exact revision. The runner creates the normal
loader and typed wire; it rejects undeclared fields, occupied inputs and remote
code. It never guesses a ControlNet or adapter to make a route pass.
An explicit `modules.ModularDiffusers.Guider` with `guider: "ClassifierFreeGuidance"`
may use `targets: [{ operationId, field }, ...]` to share one ordinary CFG instance
between an IP-Adapter and Denoise. Other guider/layer compositions are not invented
by this fixture helper.

`--prioritize <route-id>,<route-id>` changes execution order without removing
other denominator rows. Use it to exercise known cached, short routes first.
Planning also records exact backend/client source inventories and the built
bundle. Resume refuses source drift; old output remains historical evidence.

Every advertised ledger row gets a queue entry. Each route runs baseline,
unchanged repeat, prompt change, seed change, step change, guidance change,
a task-specific setting change (where declared), non-square size,
explicit reference-image change, service round trip,
output-only recomputation and model-release recovery
where those controls exist. Changes are sequential, so a seed edit retains the
previous prompt. The same node IDs are used within a route to exercise cache
behavior. Timing or equal output hashes alone do not prove cache reuse; inspect
retained backend counters/receipts separately. Image-to-text routes capture the
declared text result through Data Viewer, require nonempty bounded UTF-8 text,
and use image-description prompts. Their semantic accuracy still needs review;
a valid string is not caption-quality approval. Other output kinds require their
own task-specific assertions and are not silently treated as images.
Connected or hidden fallback controls are never counted as edited inputs. An
explicit Guider records the same finite pipeline choice that its canvas signal
persists, allowing headless/service replay without a browser metadata RPC.
Image capture follows the task-bound Preview receipt's ordered media collection
(1–64 images), saving and decoding every item. Missing, duplicate or inconsistent
collection metadata fails the case; the runner never probes out-of-range cache
indexes, which the backend clamps. The first image retains the legacy filename
and receipt fields, with all items listed separately under `images`.

For a safe between-route maintenance stop, create `STOP_AFTER_CURRENT` in the
campaign directory. The active route finishes and keeps its receipt; no later
route starts. Remove that file before resuming. SIGINT/SIGTERM instead interrupt
the active job and are intended for immediate shutdown, not a graceful pause.
The lower-level queue accepts an explicit `--stop-file <path>` for the same behavior.

The existing generation queue now also supports:

```bash
node scripts/example-generation-queue.mjs run-all --config artifacts/image-prototyping/run-1/queue.config.json --state artifacts/image-prototyping/run-1/queue-state.json --budget-ms 28800000 --json
```

- Jobs run one by one. Failure is recorded, then the next independent job runs.
- Per-job and campaign deadlines are finite. POSIX process groups receive TERM,
  then KILL; descendants cannot keep inherited output pipes open forever.
- Output logs are capped at 16 MiB per stream. State records attempts, heartbeats,
  last output activity, timeouts, exit codes, failure signatures and log paths.
- Resume with the same command. Completed/failed jobs are not automatically
  repeated; a retry needs an explicit remediation through the existing queue CLI.
- `coverage-snapshot.json` preserves the denominator, including pending and
  failed rows. Receipts do not turn pending/unsupported cases into passes.
- Use a new campaign directory after execution-affecting changes. Do not reuse
  old receipts as evidence for a new candidate.

A watchdog or cron can read `queue-state.json`; a heartbeat means the supervisor
is alive, not that a GPU kernel is progressing. Check the active attempt's hard
deadline before treating quiet inference as stuck. Kernel/driver failure, disk
failure or machine suspension cannot be guaranteed recoverable by a script.

## Model-switch recovery

Ordinary operation authoring now records explicit edits even when they equal the
old default. Replaced owned stages and crossing wires are retained in bounded,
non-executable drafts on the owning model node. Selecting the exact previous
model/task restores compatible stage settings and layout. Newer active values
and connections take precedence. Ambiguous guidance semantics stay inactive
rather than being transferred merely because a slider has the same label.
