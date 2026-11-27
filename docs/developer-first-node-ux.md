# Developer-first node authoring

One editor offers Workflows, Templates, full node/Block inspection and developer
exports. Memory Automatic/Custom remains independent per workflow. Obsolete
workspace preferences are discarded once while the active layout and documents
are retained.

## Custom nodes

**Saved Blocks** reuse groups of canvas nodes and their settings. Use **Create
block** for selected nodes or **Save as reusable Block…** on a stage group, then
insert the saved copy from the library. **Custom nodes** are Python extensions:
use **Add custom node** when you want to supply new code. Saving a Block does not
write Python or authorize additional source; existing source approvals still apply.

On a collapsed reusable Block, **Expand block** shows its contents for ordinary
canvas editing. Collapse it again when finished; exposed controls stay directly
editable without expansion. Saving changes offers workflow-only, new reusable
Block and applicable existing-definition choices.

Choose **+ Custom** in the Nodes panel header to add a node from Local, Hugging Face or Git.
Selected source cards have a yellow border, tint and checkmark. Advanced contains
optional name/revision settings; normal remote imports need only a repository.
Add/Load/Reload authorizes trusted Python in one action. Validation and dependency
errors are visible; dependencies are never installed implicitly. This is not a
sandbox or malware scanner.

Drop a structured `.py` file on the canvas, or use **Choose Python file** and then **Add node**. Selecting a local file alone keeps it on the browser computer. A canvas
drop inserts its node, or offers a dropdown when it declares several nodes.
Dropping inside an expanded Block uses the existing Block adoption transaction.
Undo removes the insertion, not installed source files. If the workflow changes
while importing, the enabled node remains available in the library without being
inserted into the wrong document.

The permanent Custom nodes category discovers backend `custom/` files/packages
without running them. Use Load deliberately, then Reload after editing. Disable
keeps the source. Registry refresh does not rewrite existing node port definitions.
Code/dependency identity changes invalidate execution until Reload.
Enabled nodes appear under their Python-declared category within Custom nodes.
Search by node name or category to find the operation you want to insert.

An approved custom Block's **Load Models** component fields use their own exact
lowercase 40-character revisions when you select **Install** beside a Hub model.
Another cached revision does not hide that install action; missing exact cache
evidence keeps it available. Set a literal repository and revision first:
connected, missing or mutable pins report a correction instead of downloading a
default branch. Expand a Block to install from its component loader when the
collapsed or nested control cannot prove the pin owner. Ordinary model controls
retain their catalog behavior. Alias inspection follows declared ownership only;
malformed, cyclic or excessive control chains require expansion. This installs model files only;
source approval, dependency readiness and Custom memory requirements still apply.

## Image/audio attachment

On the loader inspector, open **Workflow stage actions → Add image / audio input…**,
then choose a supported role and an existing source or new loader. Direct socket
connections do not open this chooser. This adapts the same authored graph, using backend
operation declarations; it does not invent interchangeable model/latent types.
Prompts, compatible settings, branches and output connections are retained. The
whole edit has one Undo. Changes requiring a model/task review are reported
instead of silently discarding authored settings.

| Path / node decision                 | Result                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Native image stages                  | Keep reusable Load Models, Encode Prompt, Denoise, Decode Latents and Preview                      |
| SDXL/FLUX image-to-image             | Attach Load Image and the required Image Encode stage; do not alias image to latent                |
| Instruction/reference editing        | Offer backend-declared image/reference roles; changing to a different model remains explicit       |
| Inpaint                              | Attach image and mask separately; preserve their distinct roles                                    |
| Control/IP guidance                  | Offer only published media roles; required adapter/model inputs still need valid sources           |
| LoRA / scheduler / guider            | Retain distinct component modifiers and ownership checks; they are not image transformations       |
| Whole-pipeline Generate/Edit/Inpaint | Reuse the operation-change planner, but retain distinct runtime adapters and task contracts        |
| Upscale / refinement                 | Retain named downstream image operations, connect ordinary image outputs                           |
| ACE variation/repaint/continuation   | Attach Load Audio to declared source_audio; keep prompt/lyrics controls                            |
| Transcription / processing           | Connect existing typed audio sources to declared consumers; no automatic model-family substitution |
| Video                                | Shared stages for selected LTX/Wan routes; existing native video stages use the same grouping      |

Pika H3 Flex has a conservative presentation profile alongside MiniMax H3, so
capability parsing and saved-form restoration retain its exact model identity
for text, keyframe and reference tasks. The backend still owns its provider,
task-selected weights, required adapter and fixed sampler. This presentation
registration grants no Auto, template, Gallery or live-output qualification.

When one declared producer publishes both video frames and audio, a fresh
workflow attaches the existing joined exporter and presents Video Output. Both
typed streams stay connected to that same producer. Independently generated
soundtracks retain their separate stages; missing or incompatible joined
exporters produce a connection notice. Existing saved graphs are unchanged.

This audit does not claim fewer backend classes: existing generic modular stages
already share their execution implementations, and the remaining Generate/Edit
adapters have different required inputs/preflight. The reduction is in duplicate
discovery surfaces and workflow rebuilding, not hiding useful stages. A typical
minimal native image graph has five stages including Preview. The connected
SDXL starter also exposes Guider and Layers, giving seven nodes with Preview;
attaching an image adds Load Image and Image Encode, giving nine executable nodes.
New eligible starters now present these as six and seven top-level nodes using
the visual groups below. It does not replace the execution graph. The registry includes implementation actions and compatibility identities.
The common picker lists ordinary stages and media processors. Searching by name,
dragging from a compatible socket, or enabling implementation nodes reveals
specialists. The sidebar counts matching runtime nodes and catalog entries separately.

## Encode Inputs and Guidance

New native image starters combine their input encoding stages into **Encode Inputs**.
Related Guider and Layers stages appear as **Guidance** where they are connected.
Fresh Qwen/Z-Image templates also present a single actual Guider as Guidance,
shared by encoding and denoising. Z-Image Turbo keeps CFG disabled; paths without
an upstream guider do not add one. See [image template workflows](image-template-workflows.md).
Encode Inputs uses the ordinary node layout, scrolling controls and status-strip
resize grip. It is not an expandable canvas Block. Backend encoding stages remain
separate, with typed conditioning, latent and route-state outputs. Guidance uses
the same ordinary node shell, with Guider/Layers controls and a secondary options
menu for inspection and reusable saving. Choose **Edit stages** to work inside
Guidance and **Done editing** to return. To place the Guider and Layers directly
on the canvas, choose **Convert to independent nodes…** and confirm. Schedulers
and adapters remain separate.

Guider selection and layer-stack selection use the backend's declared field
actions to reveal their applicable controls. Updates are atomic and undoable;
failed or stale metadata responses leave the graph unchanged. Inspection and
opening saved workflows do not rewrite reusable definitions. Ordinary field edits
retain configured public interfaces, including deliberately hidden controls.

New image/audio workflows include separate, connected loaders for their declared
required media: images, masks, control/reference images or audio. Same-role
consumers share a source; different roles stay separate. Select your files in the
loaders. This does not fill missing files or install models. Existing workflows
are not silently repaired or structurally rewritten when opened.

1. Enter the prompt in Encode Inputs. Text-only workflows do not create an unused
   image encoder, but supported **Image**, **VAE** and encoding output sockets
   remain visible. Leaving these optional ports unconnected keeps text-only
   execution unchanged. You can start wiring from inputs or outputs.
2. Drag from Image onto empty canvas to choose a compatible source, such as Load
   Image. Alternatively connect an existing image output directly to Image, or
   connect Image Latents to a downstream input first. There is no attachment modal
   for these sockets. The selected wire and any required stage preparation commit
   in one Undo step. Cancelling node search or failing preparation changes nothing.
3. Required encoding stages are prepared behind the same Encode Inputs node.
   Text and image can both be used; section collapse only hides fields. Load Image
   stays separate. In native image workflows, Generate owns its matching denoiser
   and decoder, and Image Output displays the result.
   Existing ControlNet and custom branches are retained; Image does not mean
   Control Image. Unsupported or ambiguous preparation reports an error rather
   than silently choosing a different operation or discarding existing work.
4. Choose **Edit stages** to wire the underlying operations on the canvas. **Done editing**
   returns to the same stage and keeps your edits. The stage menu also offers
   **Inspect implementation** for a read-only overview and **Convert to independent
   nodes…** when you want the listed operations to become standalone nodes. Review
   the list before confirming the conversion.
5. Change model/task through Load Models. Compatible values and external branches
   are retained; incompatible changes still require the normal review. An existing
   image/audio source also supplies newly required inputs with the same declared
   media role and compatible type when the preserved source is unambiguous.
   Different roles and already authored inputs remain separate. Save and refresh
   retain the presentation and values.

Uploading or removing a source file updates Run readiness immediately, including
optional loader pickers connected to required workflow inputs.

Existing workflows are not regrouped on open. Their loader inspector's
**Workflow stage actions** menu offers **Group input encoders**, **Group guidance**
and **Add image / audio input…** where supported. That explicit attachment action
opens the supported-role/source chooser; it is not a permanent form and ordinary
typed wiring does not require it. Audio sources retain upload, playback and seek.
Individual implementation nodes remain available. Grouping changes the selected
stages' runtime IDs once, so a first run may recompute encoding or recreate loader
ownership. Opening details or collapsing field sections does not change runtime identities.
Shared seed controls still update across the visual boundary.

Grouping does not grant model capabilities or Automatic memory qualification.
Whole-pipeline operations remain whole-pipeline operations; no fake encoder is
inserted. A group with manually nested containers or mirrored custom interfaces
requires explicit structural editing/ungrouping before automatic task adaptation.
Audio supports the applicable Model Setup and Audio Output groups described
below. Selected LTX/Wan video routes use the shared stage presentation too;
other video routes retain their existing native Modular or whole-pipeline nodes.
Fresh image, audio and video template cards with an explicit execution recipe
use that same backend-owned starter through the normal creation path. Selected
video templates retain their creative settings, source nodes, upscaler and
soundtrack branches. Their ordinary stage graph is checkpointed and restored
without a managed receipt for a different topology. This fresh-template routing
does not convert previously saved whole-pipeline workflows.
Add media reads declared image, audio and video input roles for the selected
model. It can add an ordinary media loader or use a compatible existing source.
The attachment stays in the same graph and is one Undo/Redo transaction;
unsupported task changes still require review. Existing saved graphs are not
rewritten on open, and missing source files continue to block Run.

Model Setup shows inline adapter controls where they apply. A native workflow
with declared non-image outputs omits the empty image LoRA panel. Existing
adapter rows and external connections remain inspectable, and supported audio
routes retain their declared adapter controls.

When a built-in execution recipe supplies placement inside Model Setup, the
canvas and inspector show **Execution Device** and **Runtime Offload**. Direct
image, audio, video and 3D loaders use these settings. Disconnect the recipe
to edit the loader's saved device, automatic offload switch and offload mode.
A connected VAE setting follows the same rule. Custom controls and ambiguous
connections stay visible. Base model and adapter revisions keep their
separate values. A stock image loader whose conditioning selector is set to None
hides the auxiliary model picker and revision in Model Setup and Inspector.
Connected supplier controls and the saved values remain available when applicable.

In a built-in execution recipe, **Layerwise Casting** reveals its components,
storage dtype and compute dtype. **Channels Last** reveals its own components.
Show each switch first on the raw node, grouped stage and inspector. A wired
switch keeps its settings available, and a wired option stays visible. Turning
a switch off preserves its saved options for the next time it is enabled.

Use role-specific captions for inputs and outputs. Image composition names the
overlay and base separately, and generated dimensions are labeled as measured
outputs. Presentation changes preserve authored names, field IDs and socket types.
The raw reviewed modular placement action stays resolvable for saved workflows.
The registered Block picker supplies the exact contract and is its authoring path.

Recorded ordinary video stage inputs keep condition strength and denoise
strength separate. A source-video pixel digest identifies the ordered frozen
PIL frames used by Encode Inputs, alongside their count; it is not a source-file
hash. Other frame types report an unavailable digest. Saved receipts survive
history reload without borrowing values from the current form.

## Audio stages

The same stage actions offer **Group model setup** for eligible direct audio
loaders and their exclusive configuration/adapter nodes. Native MiniMax keeps
**Generate Semantics** for its song structure and uses one **Generate** card for
denoising and decoding. **Audio Output** holds the file export and player. Direct
whole-pipeline Generate operations also retain their separate exporter. Source
audio and other processing nodes remain connected outside those stages.

Selected ACE branches can expose one owned adapter row when the backend declares
the exact task, model revision and registered transport. Capacity restricts Add;
the existing row can still be edited, replaced or removed. Other audio models do
not inherit that permission. See [audio workflow stages](audio-workflows.md) for
the full task, adapter and qualification boundaries.

## Optional image stages

**Workflow stage actions** in the loader’s Node inspector, or inside an existing
Model Setup node, offers these explicit groups when the existing model branch
contains the required nodes:

- **Group model setup** combines the loader with connected built-in LoRA
  descriptors/adapters or quantization/execution-recipe configuration. A bare
  loader stays Load Models. Unrelated loaders, ControlNet, Guidance and shared
  modifiers remain separate.
- **Group mask preparation** combines Load Image and the existing Outpaint
  Canvas utility only when its canvas and mask outputs feed the same declared
  inpaint/outpaint consumer. Geometry, margins, overlap, feathering and file
  selection stay on those original fields. A plain inpaint mask loader has no
  new preprocessing step.
- **Group image output** combines a declared native image decoder with its
  directly connected Preview Image nodes. Whole-pipeline output already goes
  straight to Preview, so that single node is not wrapped.

These groups use the ordinary node shell, with real controls and declared
sockets. Image Output displays the existing backend preview. The stage menu opens
inspection and interface configuration, saves eligible stages as reusable Blocks,
or converts the listed operations to independent nodes after confirmation.
Converting or grouping operations takes one Undo step. Refreshing keeps the
chosen layout and settings. Saving snapshots current values
and creates independent reusable instances through the same User Node contract.

Model Setup retains the model picker and Change model / task review. Applying a
change adapts its complete connected workflow, including Encode Inputs and
Denoise outside the wrapper. Cancelling leaves the graph unchanged. Existing
saved workflows and new template defaults are not automatically regrouped.
Grouping folds real canvas nodes/wires into a V2 interface; executable stages,
component wires, backend cache policies and the executor stay the same.

The same menu offers **Use component bundle** and **Expose components** when
actual operation contracts declare that a loader aggregate supplies exact scoped
component members to the existing stage inputs. The initial backend prototype
publishes this relation for Qwen native text to image. It keeps the same loader,
Encode Inputs, Guidance, Denoise and Decode implementations; four raw loader
component connections become three aggregate connections, reducing this graph
by one wire. It does not replace the shared, per-run Guidance strategy with the
bundle's default guider. There is no model-name dispatch in the client action.

An independent component supplier, modifier path, literal component override or
custom aggregate cannot prove the backend's sealed loader/member identity, so
that entire consumer keeps its existing ordinary component connections. Breakout
restores the declared raw loader connections while keeping explicit overrides.
Both actions use one Undo transaction and persist on refresh; reusable V2
snapshots and unrelated branches retain their existing authority. Backend checks
still enforce actual object identity, component roles, loader ownership and
runtime generation. This is explicit opt-in wiring; template defaults and saved
graphs are not automatically converted. Broader component facades remain deferred.

## Connection guidance

Dragging a wire highlights known-compatible existing sockets. Search filters by
direction, declared types and available semantic contracts. Generic `any` and
missing types require **Show unverified matches**. This includes deliberately
generic utilities such as Data Viewer. Type compatibility is not a guarantee of
model availability, shape, memory or the behavior of arbitrary Python.

On ordinary nodes and collapsed stages, selecting a node or wire keeps the
wire's hit area below other node controls. Selection still changes its stroke,
and exposed wire sections remain selectable. Expanded child edges retain the
existing hierarchy layering; this changes no saved graph or execution wiring.

New mask inputs use a loaded black/white image's pixels. Use the explicitly named
Alpha mask output only when you intend transparency to define the mask. A model
must still support the chosen task. Automatic memory recipes are separate from
valid graph structure; unqualified exact model/task/settings combinations need
explicit Custom settings and are not silently admitted by attachment.

## Verification trail

The library parser accepts collection schema 7 with explicit immutable source
supplements, while preserving schema 5/6 collections. Member definitions keep
their own schema and source revision; adding a source does not rewrite existing
definition hashes. Source metadata is for authoring and does not activate a
runtime, approve custom code or establish model/hardware qualification. The
client renders these declarations without model-specific parameter branches.

The unpruned hierarchy API uses collection schema 2 with separate schema 1 source
snapshots. Select the definition's exact revision before showing or compiling its
tree; an unavailable source remains unavailable. Standalone historical schema 1
snapshots stay readable. Source grouping does not grant edited-tree execution or
change an existing graph's source identity.

Focused source/lifecycle, graph transactions, saved-Block boundaries, registry
and search tests precede real browser journeys. The model-free Local/Hub/Git
journeys import, insert, connect, Run and refresh using a real backend. The Hub
fixture is an upstream ModularPipelineBlocks implementation with a typed sidecar;
Git uses the same real repository via Git transport, not a mocked download.

Run isolated browser checks with the backend's `scripts/run_node_ux_backend.py`
and client `tests/e2e/live-backend/node-ux.spec.ts`. Set MODIFF_NODE_UX_ISOLATED=1,
MODIFF_LIVE_BACKEND_URL, MODIFF_NODE_UX_ROOT, and MODIFF_NODE_UX_REPO (a compatible
repository you can access). Do not point the isolated fixture root at operator
data. Remote tests skip explicitly without a repository; skips are not evidence.
Native Windows/RTX4080 and all-model generation qualification are separate from
these Linux UI/contract checks.

For a new speech graph, add **Transcribe Audio** and wire a speech model and
source audio. The model connection controls which settings appear. A
sequence-to-sequence recognizer offers language, translation and three timing
choices. A CTC recognizer offers plain text or word timing. Switching back
restores the settings for the previous recognizer. Saved CTC recipes retain
their original action and timestamp field.

Saved graphs discard transient signal values. A loader that always supplies
the same model family can declare its output signal `fixed: true`. Reopening
restores that capability from the installed registry. Mark a newly added
optional input with `fieldOptions.omitInactiveDefault` when a disconnected
default has no effect. Older graphs then offer the socket, and their executable
recipes acquire the input when the user connects or edits it.

**Process Video** accepts files, retained clips and decoded frame sequences.
The file picker is the fallback when the Source input is disconnected. Files
carry their own frame rate and embedded audio. Decoded frames use the frame
rate entered on the stage and carry no audio track.

## Finding a stage by its action

Browse starts with 15 everyday stages. Show task stages adds 14. Advanced includes six more. Search by stage or action, for example `KSampler`, `CheckpointLoaderSimple`, `Canny` or `fit audio duration`. Expand a result to choose an available action. A search from a wire also checks its type, direction and role. The Docs tab shows the action in the selected stage. Custom authors can declare searchable `searchTerms` on their node class.

Choose **Show on canvas** to locate an existing instance. For an independently inserted node, open its help menu and use **Stage action** to switch modes. The editor restores values for the selected mode and identifies any wire that needs your attention. For a model-bound workflow, use Model Setup to change the model or task for the connected stages.

Searching an exact older implementation name such as `WorkflowImageDenoise` on an empty canvas lists the stages that can own it. Select a compatible model and task to enable the action. Searching from a wire shows the insertable choices for that port.
