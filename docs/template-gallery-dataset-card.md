---
pretty_name: MoDiff Template Gallery
license: other
license_name: modiff-template-gallery-mixed-asset-terms
license_link: LICENSE
task_categories:
  - text-to-image
  - image-to-image
  - text-to-video
  - text-to-audio
tags:
  - diffusers
  - modular-diffusers
  - modiff
  - generated-media
size_categories:
  - n<1K
---

# MoDiff Template Gallery

This public Dataset contains rights-approved media, input fixtures, posters,
and provenance records used by the open-source MoDiff template Gallery. MoDiff
executes local workflows with Hugging Face Diffusers and Modular Diffusers.
The Dataset exists so users can inspect or reuse the public examples without
adding large binary files to the application source repository.

## Versioning and integrity

MoDiff releases pin this Dataset by its immutable Hub commit SHA. The file
`_modiff/template-assets.v1.json` records the byte length, media type, and
SHA-256 digest of every application-owned file. A moving branch such as `main`
is never used by a released application.

## Repository structure

- `template-gallery/manifest.json` is MoDiff's reviewed-example manifest.
- `template-gallery/runtime-inputs/` contains byte-pinned workflow inputs.
- `template-gallery/reviews/` contains review and provenance metadata.
- Other files under `template-gallery/` are generated examples and browser
  derivatives.
- `_modiff/template-assets.v1.json` is the deterministic storage manifest.
- `_modiff/template-asset-rights.v1.json` binds the redistribution review to
  the exact SHA-256 identity of every published file.

## Contents and curation

The Dataset is a small, curated application fixture rather than a general
training corpus. It may contain generated image, audio, and video examples;
browser-friendly posters and previews; workflow input fixtures; and JSON
review records. Every published byte must have an `approved` record in the
rights ledger for the same path and SHA-256 digest. That record identifies the
creator or rightsholder, creation method, source and model terms, attribution,
likeness and mark review, reviewer, and review date.

Technical generation receipts and quality reviews are supporting evidence,
not permission to redistribute a file. Maintainers exclude candidates whose
source, consent, model terms, or redistribution rights cannot be established.

## Intended use

The files support browsing, reproducing, and reviewing MoDiff workflows. They
are not a training corpus and are not intended to identify or represent real
people. Maintainers should remove an asset if its provenance or redistribution
rights cannot be demonstrated.

The media is not a quality benchmark, safety evaluation, or representative
sample of any model's possible outputs. It must not be used to infer model
fitness, demographic performance, or the rights status of newly generated
media.

## Limitations and potential bias

The Gallery is selected by MoDiff maintainers to demonstrate particular
workflows, so it reflects those curatorial choices, prompts, checkpoints,
hardware, and generation settings. Generated outputs may reproduce biases,
artifacts, or limitations of the referenced models. A successful rights review
does not certify factual accuracy, suitability, or freedom from all third-party
claims. Revisions are immutable snapshots; later removals or corrections do
not alter an older pinned release.

## Privacy, safety, and takedowns

Do not publish private prompts, local paths, credentials, personal data,
unconsented real-person likenesses, or confidential source media. Public
provenance records must be reviewed and redacted before upload. Report a
privacy, consent, attribution, trademark, or redistribution concern through
the [MoDiff Client security-reporting process](https://github.com/sdevil7th/MoDiff-client/security/policy).
Maintainers should hold the affected asset immediately and publish a corrected
Dataset revision; the application source must then pin that new immutable
revision.

## Licenses and attribution

The MoDiff application source is licensed separately. Apache-2.0 for the
application does **not** relicense model-generated media, input material, model
weights, or third-party marks. Review the per-template provenance records and
the licenses or terms of every referenced model before redistributing or using
an asset beyond the MoDiff Gallery. Where provenance or redistribution rights
are incomplete, the file must not be published in this Dataset. A technical
generation receipt is not itself a copyright, consent, trademark, or
redistribution grant.

## Updates

Maintainers generate and verify the storage manifest locally, upload one
reviewed asset set, and pin the resulting commit SHA in MoDiff. Replacing a
file creates a new asset-set identity and requires a new pinned Dataset commit.
Historical application releases continue resolving their original revision.
