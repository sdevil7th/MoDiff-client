# Image template workflows

Creating a fresh image template now builds the selected backend operation recipe
as the visible, editable developer workflow. The canvas is the graph that Run
submits. It uses the same ordinary nodes, validation, Automatic/Custom memory
selection, model readiness and output handling as a workflow authored by hand.
Opening an existing saved workflow preserves its graph.

## Current template inventory

All 54 image templates retain their creator prompts, seeds, sizes, inference
settings, immutable model revisions and required input roles. Their fresh graphs
use explicit execution-profile selections rather than a family-wide default.

| Native stage family        | Templates | Tasks                                       |
| -------------------------- | --------: | ------------------------------------------- |
| Z-Image Turbo              |         7 | Text to image and styles using LoRAs        |
| Qwen Image                 |        10 | Text to image and ControlNet image layout   |
| Qwen Image Edit            |         7 | Image editing, inpainting and outpainting   |
| Qwen Image Edit Plus       |         7 | Single-image and multiple-reference editing |
| Qwen Image Layered         |         1 | Layer decomposition                         |
| FLUX Schnell, Dev and Krea |        11 | Text to image and styles using LoRAs        |
| FLUX Kontext               |         2 | Single-image and multiple-reference editing |
| FLUX.2 Klein               |         3 | Text to image and image/reference editing   |

These 48 recipes contain real model loading, input encoding, denoising and latent
decoding stages. **Encode Inputs** presents the relevant encoding stages together;
the exported graph retains their distinct backend calls and typed connections.
Image, mask, control and reference inputs remain separate when their roles differ.

The four Qwen masked-edit/outpaint templates use real native stages with a
backend-owned compatibility path for their original image preparation and final
mask composite. Their dimensions, strength, crop padding and outpaint canvas
settings stay explicit. Ordinary developer starters keep their native defaults;
saved workflows retain their own route and values. Matched original outputs and
Auto/repeat checks on local ROCm remain separate from Windows or cloud hardware
qualification. Changing a fresh template's execution selection invalidates its
current exact-template evidence while retaining the historical example.

The other six recipes retain explicit whole-pipeline operations:

| Whole-pipeline path      | Templates | Preserved boundary                                    |
| ------------------------ | --------: | ----------------------------------------------------- |
| FLUX Fill                |         2 | Fill model, image and mask recipe                     |
| FLUX Canny/Depth control |         2 | Selected control artifact and conditioning contract   |
| FLUX Redux               |         2 | Selected base/prior models and reference conditioning |

These tasks lack a reviewed native-stage replacement for their exact selected
artifact and parameter contract. Their graphs contain actual loading and
generation operations, required utility nodes and previews. They do not gain an
encoding or Guidance node merely to resemble another workflow.

## Guidance and preserved settings

Qwen and Z-Image recipes contain a real **Guidance** owner whose Diffusers guider
feeds both prompt encoding and denoising. Their **Encode Inputs** stages retain
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
reading operator extensions. It checks all 54 creator contracts, typed graph
exports, component policies, shared guidance and seeds, controlled extras,
save/restore, undo/redo and stale asynchronous construction. Those are contract
tests. Real model generation, paired image comparison, visual review and hardware
qualification remain separate evidence.
