# Video workflows

New selected LTX and Wan workflows use shared stage nodes: **Model Setup → Encode
Inputs → Denoise → Video Output**. Expand a group to inspect and edit its ordinary
nodes. A model-specific function is not presented as a new kind of frontend node.
Four is not a stage limit: upscaling, a separately generated soundtrack and audio
timeline fitting remain visible when a template includes them.

LTX's declared separate-stage tasks accept text, an opening image, ordered
reference images or source video. The selected Wan 2.2 5B backend route currently
accepts text only. Model names and cached weights do not prove another task is
supported. Existing whole-pipeline graphs retain their original representation;
loading an old workflow does not migrate its nodes or discard saved settings.

Choose a supported task and exact model selection, enter the prompt and required
media, and review the resource settings before Run. The backend owns loading,
sampling and decoding. Auto availability and native validation remain separate
from whether a template can be created. Large video model acceptance is performed
on Linux; this interface does not promise that those weights fit every Windows
machine.

New video drafts also connect ordinary file loaders for their declared required
image, video or audio inputs. Select the files on those loader nodes. Inputs with
different roles, such as first and last frames, keep separate loaders. An absent
or incompatible loader produces a connection notice instead of a guessed wire.
Existing saved graphs are not rewritten.

Encode Inputs can reuse unchanged prompt data. Denoise consumes encoding from the
same model owner, and Video Output decodes that owner's current latents. Changing
the owner or relevant recipe requires fresh runtime data. Saved values and wires
survive reopening; runtime tensors are recomputed after restarting the app.

LTX templates retain their delivery upscaler. Wan's music-video template retains
its independent audio model, authored soundtrack, timeline fit and muxed export.
An independently generated soundtrack is not described as audio from the video
decoder. A real upscaler between decode and export remains a separate stage.

When an upscaler or separately produced soundtrack follows decoding, the
connected denoiser and decoder appear as **Generate**. The shared pipeline
input feeds both operations and checks that the selected model supports both
actions. An exclusive video loader and normalizer appear as **Video Input**.
The file picker previews the source. Target width, height, frames and fit
control the normalized clip. Expand either Block to inspect its operations.

In a saved workflow, choose **Model Setup → options → Simplify connected
stages** to apply the same grouping to that branch. Undo restores its previous
presentation.

The implementation and proof boundaries are described in the paired backend's
`docs/video-pipeline-stages.md`. Schema tests and mocked workflows establish
authoring behavior, not successful video generation. A testable release needs
native task completion and playback on the deployed source pair.

New successful stage runs capture the actual video task, encoded prompt and final
frame format in output history. The optional `graphTasksVersion: 2` distinguishes
the added video-owner vocabulary from older receipts. Existing receipts and saved
forms remain unchanged; missing or conflicting observations do not become support
or publication qualification.

The model manager can show backend-declared task artifact selections. Choose the
task before Install or Repair; text/keyframe and reference workflows can need
different transformer partitions from the same repository. Installed status is
checked against that selection's exact revision and files. Downloading one
partition does not mark the others installed. This uses the existing model
download and terms acknowledgement flow, without a second installer.

First/last-frame starters show their separate image inputs. Reference starters
show their ordered reference inputs and assembler. Switching tasks must preserve
compatible data and archive incompatible controls; it must not insert an empty
reference helper into a keyframe workflow.
