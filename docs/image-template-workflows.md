# Image template workflows

Creating a fresh image template now builds the selected backend operation recipe
as the visible, editable developer workflow. The canvas is the graph that Run
submits. It uses the same ordinary nodes, validation, Automatic/Custom memory
selection, model readiness and output handling as a workflow authored by hand.
Opening an existing saved workflow preserves its graph.

## Current template inventory

The current inventory contains 56 image templates. The historical 54 converted
templates retain their creator prompts, seeds, sizes, inference settings,
immutable model revisions and required input roles. Their fresh graphs
use explicit execution-profile selections rather than a family-wide default.

| Native stage family        | Templates | Tasks                                          |
| -------------------------- | --------: | ---------------------------------------------- |
| Z-Image Turbo              |         7 | Text to image and styles using LoRAs           |
| Qwen Image                 |        10 | Text to image and ControlNet image layout      |
| Qwen Image Edit            |         7 | Image editing, inpainting and outpainting      |
| Qwen Image Edit Plus       |         7 | Single-image and multiple-reference editing    |
| Qwen Image Layered         |         1 | Layer decomposition                            |
| FLUX Schnell, Dev and Krea |        11 | Text to image and styles using LoRAs           |
| FLUX Kontext               |         2 | Single-image and multiple-reference editing    |
| FLUX.2 Klein               |         3 | Text to image and image/reference editing      |
| FLUX.2 Dev                 |         1 | Full-model text to image                       |
| Cosmos 3 Super             |         1 | Full-model text to image with mandatory safety |

The 48 historical native recipes and two additional full-model candidates contain
real model loading, input encoding, denoising and latent decoding stages. The two
full-model candidates remain separately unqualified; their presence does not
establish Auto readiness or fit on ordinary hardware. Fresh eligible native graphs present **Model Setup → Encode Inputs
→ Denoise → Image Output**. **Encode Inputs** presents the relevant encoding and
actual Guidance stages together;
the exported graph retains their distinct backend calls and typed connections.
Image, mask, control and reference inputs remain separate when their roles differ.
Model Setup includes exclusive connected LoRA/configuration leaves, while shared
suppliers stay external. Image Output contains the real decoder and Preview Image.
Additional media preparation, control, composite or upscale branches remain visible;
the four-stage presentation is the core native diffusion path, not a limit on all
workflow node counts. Existing saved layouts change only through explicit stage
actions. Combine encoding and Guidance and Separate encoding stages each support
one-step Undo. Inspecting or saving a workflow never changes a reusable library
definition implicitly.

The four Qwen masked-edit/outpaint templates use real native stages with a
backend-owned compatibility path for their original image preparation and final
mask composite. Their dimensions, strength, crop padding and outpaint canvas
settings stay explicit. Ordinary developer starters keep their native defaults;
saved workflows retain their own route and values. Matched original outputs and
Auto/repeat checks on local ROCm remain separate from Windows or cloud hardware
qualification. Changing a fresh template's execution selection invalidates its
current exact-template evidence while retaining the historical example.

The other six recipes use generic pipeline stages while retaining their selected
official pipeline's specialty conditioning and sampling contract:

| Pipeline-stage path      | Templates | Preserved boundary                                                  |
| ------------------------ | --------: | ------------------------------------------------------------------- |
| FLUX Fill                |         2 | Text encoding, official image/mask sampling, decoding and composite |
| FLUX Canny/Depth control |         2 | Text and VAE control encoding, official latent sampling and decode  |
| FLUX Redux               |         2 | Pinned prior in reference order, matching base sampler and VAE      |

Their fresh graphs contain real **Load Pipeline → Encode Inputs → Denoise → Decode
Latents** operations, required utility nodes and previews. These stages retain
the official pipeline's denoising implementation rather than substituting an
unreviewed native modular recipe. They do not add an unused Guidance owner.
Existing saved whole-pipeline workflows retain their original route.

## Guidance and preserved settings

Qwen and Z-Image recipes contain a real **Guidance** owner whose Diffusers guider
feeds both prompt encoding and denoising. This owner is inside Encode Inputs in
fresh graphs. Closing its Guidance disclosure hides the controls without disabling
execution; use its Enabled setting to change execution. Models without declared
Guidance have no Guidance section. Their **Encode Inputs** stages retain
the authored positive and negative prompts; disabled guidance does not encode
an unused negative. Qwen retains the upstream classifier-free
guidance formulation and the template's scale. The seven Z-Image templates
converted from the standard pipeline preserve its observed two-batch CFG:
guidance is enabled with the original formulation, `positive + scale *
(positive - negative)`, and the creator's scale. This template policy is separate
from the ordinary upstream developer starter, which keeps guidance disabled.

Studio offers denoising strength and strength variations only when the selected
image task has a reviewed execution binding for that setting. An image input or
an aggregate node's strength port does not establish that its active route uses
the value. Plain Qwen Image Edit, Edit Plus, Layered, and Redux/Kontext/Klein
reference edits do not use this control; inpainting and supported image-to-image
tasks retain it. The template
with the historical ID `qwen_edit_strength_sweep` is a single-image reference
edit, now labelled **Reference Variations**. Its original prompt, seed and
execution route are preserved. An unused historical strength value is not a
claim that the workflow performs a strength sweep.
The thirteen converted Flux and Kontext recipes also use a real Guidance owner
shared by encoding and denoising. Their creator guidance scalar retains the
standard pipeline's true CFG setting. The separate embedded model guidance keeps
the original Gallery's effective value: `3.5` for Flux Dev/Krea and Kontext.
Schnell consumes no embedded guidance tensor; its native scalar `0` and the old
pipeline's inactive default do not affect model output. The old Gallery left the
secondary override disabled, so Kontext used the standard pipeline's `3.5`
default. Its ordinary native developer starter still defaults embedded guidance
to `2.5`. Schnell keeps CFG disabled. Ordinary developer Flux starters keep their guider disabled
at scale `1`; creating a converted template explicitly applies that template's
preserved settings.

The 35 recipes converted from whole-pipeline loading bind their original
attention backend and enabled VAE slicing/tiling explicitly. The original 13
native recipes retain inherited attention and unset VAE policies. Schnell's
template preserves its authored 512-token prompt limit; the ordinary developer
starter still defaults to 256, with a reviewed maximum of 512.

LoRA descriptors preserve their immutable files, adapter names, scales and
order. Native descriptor chains feed the one model owner through
`previous_loras`; they do not modify a second hidden pipeline. Scheduler options,
reference assembly, outpaint placement and the optional upscaler branch retain
their declared recipe values. Every generator initialization retains the seed
and the backend's device/state contract.
Model Setup exposes owned adapters as ordered real-node rows. Add LoRA opens a
draft form and inserts nothing until the selection is complete. Hub selections
require the exact commit, Safetensors weight filename and expected SHA-256. Add,
Remove and Move preserve other branches and support Undo; external shared suppliers
remain connected. Editing this form or grouping stages does not install a runtime
or load model weights. Normal model readiness and Run validation still apply.

New image adapter edits also require the current selected backend capability,
execution profile and its exact `repository_revisions` pair to agree with the
registered adapter transport. An alias cannot override its native pipeline's
declared restriction. Missing or unsupported authority disables Add and ordering;
saved rows remain inspectable, and Remove can repair them through ordinary Undo
without silently discarding their values or shared connections on import.

The converted Z-Image LoRA Style and Fast LoRA recipes explicitly retain the
original whole-pipeline adapter name `default`. Their creator settings omitted
the name, so this default is part of the selected execution policy. Original
native recipes with unnamed descriptors retain their generated identities;
explicitly named adapters retain their authored names.

## Historical Gallery examples

An existing approved image generated with the previous recipe can remain visible
as **Previous recipe example** when its original prompt, settings, inputs and
model revision still match. It is historical output, not visual qualification of
the new graph. Stale or revoked proof does not qualify either recipe. Changing
the execution selection or its explicit component/guidance/LoRA policy changes the template's
exactness identity; old approvals are not copied onto the new identity.

Fresh generation and review must record the actual exported graph and consumed
recipe. Structural checks alone cannot establish equal image quality or pixel
parity. Use the backend's [image template validation guide](https://github.com/sdevil7th/MoDiff/blob/develop/docs/image-template-validation.md)
for matched old/new runs, runtime and input identity checks, decoded-image
comparison and the Windows validation procedure.

## Qualification-only blocked-template probes

The two FLUX 3 style planning candidates now name the selected immutable
adapters: [NASA concept art](https://huggingface.co/kocabiyik/nsc7-style-lora/blob/9b998d3bdc3b4aeb2113ab4e8cbd9fe2ebfa1cae/README.md)
for Distilled at scale `0.75`, and [Monet oil painting](https://huggingface.co/pjecuacion/flux3-klein-mnt-oil-monet-lora/blob/0d94b6a4601892499defd8c5d89c24f78e78043b/README.md)
for Base at scale `0.65`. Both cards declare the
[FLUX Kommunity License v1.0](https://huggingface.co/black-forest-labs/flux-3-image-klein-base/blob/1469d27cfb9bb1bd81d3a93f5a023b39dbf136e4/LICENSE.md).
Their training-data provenance is the authors' statement, not independent rights
verification. The Base planning candidate explicitly replaces Tarot; saved Tarot
workflows and historical evidence keep their original identities.

The revised candidates use the ring-habitat and meadow-fox prompts, seeds
`481205` and `481405`, 512-square FP8r/BF16 recipes, 16/50 steps and guidance 1/3.5.
The original radio/fox recipes and their failed outputs retain their historical
identities. The two plain-radio candidates use revised two-front-control prompts
and seeds `481402` (Distilled) and `481401` (Base). PUP remains
disabled. The locked public settings are Expert with no offload and
`autoOffload=false`. Successful local `model_cpu` / `autoOffload=true` trials
are a separate recipe and cannot qualify these locks. NASA's advertised style
effect remains unproved; Monet's painterly scale-zero baseline must be considered
when reviewing the adapter effect. Inspect actual outputs for invented marks and
signatures. Both candidates remain blocked planning entries without public media,
template qualification, Gallery eligibility, hardware-fit proof or output
publication approval. Adapter terms and local test consent do not approve an
output's publication.

The two packaging planning recipes preserve the ordered model references, then
compose the generated photograph onto the second reference using ordinary image
nodes. The declared mask protects all pixels outside the photo panel. Three
explicit Lanczos resize/pad operations precede a 1024-square crop at `y=205`
(Distilled) or `y=165` (Base), followed by Mask Composite and Save Image. The
generation remains 512-square; the composited Gallery image is 1024-square PNG.
This is generated plus composited media, without a native Fill claim. Creation
requires the declared mask, a single-image batch and the paired backend's PNG
Save Image preview contract. The authored mask and selected output media must be
published and verified through the normal asset contract before Gallery admission.
Existing saved graphs retain their own nodes, settings and outputs.

A complete recipe may remain a blocked planning template while its exact output
and visual quality are unqualified. The Gallery runner's explicit
`--allow-blocked-probe --record-qualification` combination may retain a successful
locked run as an execution receipt. Direct `release:template:qualify` accepts
`--allow-blocked-probe` for the same lookup scope. A current canonical workflow,
unchanged recipe locks, immutable model, valid output and resource measurements
remain required. This does not clear the template's blocked status or authorize
Gallery publication, model/Auto eligibility, or reuse of failed evidence. Normal
media provenance, quality review and per-file rights gates still apply.

## Contributor checks

The current builder is shared by interactive template creation and the developer
Gallery/workflow-library harness. Harnesses generating a new image graph must
use that selected path. Explicit historical fixtures may keep the previous
builder to test saved managed workflows; production authoring must not use them.

```bash
npm run test:templates
npm run test:gallery-harness
npm run typecheck
npm run check
npm run check:ui
```

`template-operation-workflows.test.mjs` obtains the real selected backend
starters, public capabilities and node schemas without constructing models or
reading operator extensions. Its historical migration fixture checks the original
54 creator contracts, typed graph
exports, component policies, shared guidance and seeds, controlled extras,
save/restore, undo/redo and stale asynchronous construction. The current public
catalog contains 56 image templates; additional native candidates have separate
selected-recipe tests. Those are contract tests. Real model generation, paired
image comparison, visual review and hardware qualification remain separate evidence.
