# Developer-first node authoring

One editor offers Workflows, Templates, full node/Block inspection and developer
exports. Memory Automatic/Custom remains independent per workflow. Obsolete
workspace preferences are discarded once while the active layout and documents
are retained.

## Custom nodes

The full-width yellow **Add custom node** button opens Local, Hugging Face or Git.
Selected source cards have a yellow border, tint and checkmark. Advanced contains
optional name/revision settings; normal remote imports need only a repository.
Add/Load/Reload authorizes trusted Python in one action. Validation and dependency
errors are visible; dependencies are never installed implicitly. This is not a
sandbox or malware scanner.

Drop a structured `.py` file on the canvas, or use Choose Python file. A canvas
drop inserts its node, or offers a dropdown when it declares several nodes.
Dropping inside an expanded Block uses the existing Block adoption transaction.
Undo removes the insertion, not installed source files. If the workflow changes
while importing, the enabled node remains available in the library without being
inserted into the wrong document.

The permanent Custom nodes category discovers backend `custom/` files/packages
without running them. Use Load deliberately, then Reload after editing. Disable
keeps the source. Registry refresh does not rewrite existing node port definitions.
Code/dependency identity changes invalidate execution until Reload.

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
| Video                                | Existing functionality unchanged; simplification deferred                                          |

This audit does not claim fewer backend classes: existing generic modular stages
already share their execution implementations, and the remaining Generate/Edit
adapters have different required inputs/preflight. The reduction is in duplicate
discovery surfaces and workflow rebuilding, not hiding useful stages. A typical
minimal native image graph has five stages including Preview. The connected
SDXL starter also exposes Guider and Layers, giving seven nodes with Preview;
attaching an image adds Load Image and Image Encode, giving nine executable nodes.
New eligible starters now present these as six and seven top-level nodes using
the visual groups below. It does not replace the execution graph. Model/catalog variants are not node
kinds. Isolated startup registered234 built-in definitions; the default public
palette showed63 entries, separately from121 upstream catalog entries.

## Encode Inputs and Guidance

New native image starters combine their input encoding stages into **Encode Inputs**.
Related Guider and Layers stages appear as **Guidance** where they are connected.
Encode Inputs uses the ordinary node layout, scrolling controls and status-strip
resize grip. It is not an expandable canvas Block. Backend encoding stages remain
separate, with typed conditioning, latent and route-state outputs. Guidance uses
the same ordinary node shell, with Guider/Layers controls and a secondary options
menu for inspection, reusable saving and **Separate guidance stages**. Schedulers
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
   stays separate, as do Denoise, Decode and Preview.
   Existing ControlNet and custom branches are retained; Image does not mean
   Control Image. Unsupported or ambiguous preparation reports an error rather
   than silently choosing a different operation or discarding existing work.
4. Use **Inspect implementation** in the options menu for stage details. Use
   **Separate encoding stages** to edit individual stages/custom connections on
   the canvas, with one Undo to restore the combined node. Inspection never turns
   the node into an enclosing Block.
5. Change model/task through Load Models. Compatible values and external branches
   are retained; incompatible changes still require the normal review. Save and
   refresh retain the presentation and values.

Existing workflows are not regrouped on open. Their loader inspector's
**Workflow stage actions** menu offers **Group input encoders**, **Group guidance**
and **Add image / audio input…** where supported. That explicit attachment action
opens the supported-role/source chooser; it is not a permanent form and ordinary
typed wiring does not require it. Audio sources retain upload, playback and seek.
Individual implementation nodes
remain available. Grouping changes encoder runtime IDs once, so a first run may
recompute encoding; opening details or collapsing field sections does not change runtime identities.
Shared seed controls still update across the visual boundary.

Grouping does not grant model capabilities or Automatic memory qualification.
Whole-pipeline operations remain whole-pipeline operations; no fake encoder is
inserted. A group with manually nested containers or mirrored custom interfaces
requires explicit structural editing/ungrouping before automatic task adaptation.
New audio grouping recipes, Model Setup, Prepare Mask and Image Output are
follow-on candidates; video simplification remains deferred.

## Connection guidance

Dragging a wire highlights known-compatible existing sockets. Search filters by
direction, declared types and available semantic contracts. Generic `any` and
missing types require **Show unverified matches**. This includes deliberately
generic utilities such as Data Viewer. Type compatibility is not a guarantee of
model availability, shape, memory or the behavior of arbitrary Python.

New mask inputs use a loaded black/white image's pixels. Use the explicitly named
Alpha mask output only when you intend transparency to define the mask. A model
must still support the chosen task. Automatic memory recipes are separate from
valid graph structure; unqualified exact model/task/settings combinations need
explicit Custom settings and are not silently admitted by attachment.

## Verification trail

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
