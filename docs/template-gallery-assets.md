# Template Gallery asset storage

MoDiff stores its public Gallery payload in a public Hugging Face Dataset,
while Git contains only code, metadata, and SHA-256 identities. Runtime URLs
are pinned to one immutable Dataset commit. Public users do not need a Hugging
Face token.

[Hugging Face's current storage policy](https://huggingface.co/docs/hub/en/storage-limits)
describes storage for a free user or organization's public repositories as
**best effort**, and asks that public uploads provide real community value. The
checked complete Gallery manifest declares 395 files (about 468 MiB), below the Hub's
repository-structure recommendations, so a public Dataset is a reasonable
zero-cost home for this release. It is not a contractual free hosting
guarantee: monitor the current Hub policy and keep the byte manifest portable
enough to migrate to another public Dataset namespace if needed.

The checked-in source configuration is
`src/studio/templateAssetSource.json`. The current release selects a public
Hugging Face Dataset by immutable revision and explicitly lists withheld assets.
`mode: "local"` remains available for a complete verified local copy. Never replace
the reviewed source with a guessed namespace or a moving `main` revision.

## One-time public Dataset setup

Before publishing or refreshing examples, preserve each run's original consumed
recipe, graph, task receipts, model/input identities and source/runtime provenance.
Historical examples keep their original recipe authority when templates change.
Updating a template hash alone does not establish equivalent execution.

The template browser labels retained approved media **Previous recipe example**
when the earlier creator lock matches without the new execution selection.
It also recognizes an added explicit Hub artifact revision only when the
published record's model revision and model commit both already contain that
exact immutable repository/revision pair. The previous lock must still match
all other settings, weight hashes, input bindings and review requirements.
This read-only display lookup never rewrites the current template or published
record, and never satisfies current-graph exactness or the release Gallery gate.

The maintainer-only `gallery:repair-evidence` command repairs one retained example
from its original evidence. It requires the original per-run provenance and
matching creator settings, admission locks, consumed form, canonical graph,
completed task/node receipts and pinned inputs. Indexed reference roles preserve
input order. It refuses missing authority or changed recipes before modifying
sidecars, preserves source/runtime/model identities, capture time and the original
ordered output byte identities, and retains content-addressed before-copies with
rollback if paired writes fail. Persistent storage failure or process termination
can require recovery from those originals; this is not a crash-atomic transaction. Its media
discovery excludes sidecars and preserves output collection order. Use it on
private retained evidence; public asset updates still follow the publication
procedure below. Missing current execution or quality proof requires recovery
and review of matching receipts or a genuinely accepted new run.

For historical reconciliation, preserve the original manifest, provenance and
quality-review bytes before assembling a candidate. Keep current recipe
comparison separate from the retained creator and any recorded derivative.
Media with a previous-recipe match remains historical even when its bytes and
review are valid. A missing complete model-set record cannot be reconstructed
from a singular model field or a graph naming one loader.

Public provenance intentionally redacts source/runtime details. Its maintained
public verification uses the pinned original attestations; a private validator
requiring unredacted source inventories is not interchangeable with that check.
Do not interpret expected redaction diagnostics as authority to fill missing
fields, relax current proof requirements or rewrite approved sidecars.

A later private run can supply a current-recipe replacement candidate when an
original pre-run declaration matches today's locked settings and execution
selection, and the original task, consumed controls, graph, model, source and
media independently corroborate it. Keep any absent output template identity
absent. Preserve the run's source, capture time and original public/private
status; do not retrospectively label it a public-default execution.

Prepare its proposed entry, public-format provenance and exact media outside the
active Gallery. A single reviewed run is not an exact duplicate proof. Carry
private human acceptance separately from the template rubric, per-file rights
and publication decision. An unfinished review must continue to fail the normal
publication checks. An isolated local verification fixture is not authority to
change the real Dataset source or weaken its complete-set checks.

In particular, matching prompts, seed and media do not make Expert execution
prove a currently selected Auto recipe. Required-input paths are real input
bindings rather than blank template defaults; retain their original content
identity and establish current bundled-input authority separately. Missing
consumed fields cannot be filled from submitted intent or listening approval.
The [paired recovery checkpoint](https://github.com/sdevil7th/MoDiff/blob/fix-ui-ux-issues/plans/release-20261028/gallery-evidence-recovery.md)
records one prepared contact-sheet proposal and the remaining ACE policy/capture
holds. Public activation remains a separate reviewed asset update.

The release-contract generator also inspects the bundled backend node sources.
It ignores removed module directories only when they are empty or contain solely
the residual `__pycache__` directory. Other missing initializers, Python sources
or unresolved registry declarations remain errors; cached bytecode is never
imported to reconstruct a missing module.

Hardware registration uses the run's measured execution device and backend,
not the first accelerator listed by its host. CPU execution cannot qualify a
CUDA, ROCm, XPU or MPS profile. GPU evidence must identify the actual device
index in captured physical device metadata, with a matching backend. Missing
or contradictory measurements remain blocked; old receipts are not rewritten
to supply them. A conditional/preview profile still records an observation,
not supported-profile qualification. Runtime installation tiers and CI checks
alone do not establish physical model qualification.

Current health reports use a resource fingerprint, while completed tasks retain
a separate execution fingerprint. Hardware registration compares the resource
domain to health, then binds the unchanged execution identity and normalized
runtime to original provenance and the worker's exact source inventory. It does
not replace an execution hash with a resource hash. Retained live-proof artifact
directories must include the original `run-terminal.json`, `backend-health.json`
and `run-provenance.json` alongside `status.json`; the completed task must own
that provenance. The full provenance validator still applies. A status marker
or an old output file alone cannot establish qualification.

The ACE-Step RTX 4080 cold-load check applies to both the catalog display alias
and the actual backend pipeline class. Changing that identity spelling does
not remove its required timing evidence or its 120-second limit.

For ordinary direct-audio graphs without a legacy Studio binding, the proof
reader can recover a manual resource identity from one executed loader, its
connected disabled-quantization recipe and the exact Generate/Export chain.
Source-backed and loudness-match/join chains must retain their required input
connections and execution order. The audio contract, immutable model revision,
resource controls and saved manual policy must agree. This identity names the
actual backend pipeline, not a display alias from the form. It does not recover
missing consumed controls, establish input bytes or grant model, hardware,
Automatic memory, listening or publication qualification. Unsupported or
ambiguous compositions remain held; canonical field-accounting coverage is a
separate contract.

The ordinary Audio Load and Export nodes can retain `ui_audio` preview values
after execution and reopening. Their declared `filename`/`file` preview sources
are presentation metadata, with bounded literal media references. The proof
reader preserves those references and retains the same resource identity;
connected preview suppliers, unknown keys, structured values and unsupported
preview sources remain rejected. This does not supply missing input-byte or
consumed-control evidence, and never rewrites the original submitted graph.

Choose a user or organization namespace where you have write permission. The
recommended repository name is `<namespace>/modiff-template-gallery`. The
repository must remain public for unauthenticated open-source use.

Before running an upload, review the rights for every included file. The
application is Apache-2.0, but that does not automatically license generated
outputs, input fixtures, model-derived examples, or third-party marks. The
Dataset card declares `license: other`,
`license_name: modiff-template-gallery-mixed-asset-terms`, and `license_link: LICENSE`.
The complete terms already exist in `docs/template-gallery-dataset-license.txt`;
they defer to each exact file's rights record and grant no blanket asset license.
[Hugging Face's repository-license contract](https://huggingface.co/docs/hub/en/repositories-licenses)
requires a descriptive name and actual terms for `license: other`, and the
uploader checks both before any Hub mutation. These existing Dataset terms do
not approve new media. Choose each file's license only after reviewing its source,
model and adapter terms, attribution, consent, and redistribution rights.

Publication also requires `config/template-asset-rights.v1.json`. It is a
SHA-bound, one-record-per-file ledger and is uploaded alongside the byte
manifest. Generate its fail-closed skeleton after the byte inventory is final:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py rights-template --write
```

Every new or changed byte starts with `publishDecision: "hold"`. For approval,
record the creator/rightsholder, creation method, source URL and revision,
source license, model terms, AI-generation flag, likeness/consent status,
marks, attribution, asset license, reviewer, and review date. Change the
decision to `approved` only after a human review. The uploader requires exact
path and SHA coverage and refuses stale, missing, or duplicate records before
authenticating or changing a Hub repository. Complete publication also refuses
held records; provisional publication includes only the approved subset and
retains every hold.

The commands below use the backend environment because it already contains
`huggingface_hub` and `hf_xet`. Authenticate with a write-scoped token. Never
put the token in Git, a command argument, `.env`, or documentation.

If the backend environment was removed for a lightweight handoff, create a
temporary uploader environment outside both repositories and use its `python`
and `hf` executables in place of the `../MoDiff/.venv/bin/...` paths below:

```bash
modiff_asset_env=$(mktemp -d)
uv venv --python 3.12 "$modiff_asset_env"
uv pip install --python "$modiff_asset_env/bin/python" \
  'huggingface_hub>=1.23.0,<2.0' hf_xet
"$modiff_asset_env/bin/hf" auth login
```

Keep that shell open through upload, verification, and activation. The
temporary environment contains tools only, not Gallery media or credentials
stored in either repository. Let the operating system clear the temporary
directory after the cutover, or remove the exact printed directory once it is
no longer needed.

Linux:

```bash
cd /path/to/MoDiff/MoDiff-client
../MoDiff/.venv/bin/hf auth login
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py inventory --write
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py verify
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py rights-template --write
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py upload \
  --repo-id <namespace>/modiff-template-gallery \
  --create \
  --public \
  --confirm-redistribution-rights
```

Windows PowerShell:

```powershell
Set-Location C:\path\to\MoDiff\MoDiff-client
..\MoDiff\.venv\Scripts\hf.exe auth login
..\MoDiff\.venv\Scripts\python.exe scripts\template-gallery-assets.py inventory --write
..\MoDiff\.venv\Scripts\python.exe scripts\template-gallery-assets.py verify
..\MoDiff\.venv\Scripts\python.exe scripts\template-gallery-assets.py rights-template --write
..\MoDiff\.venv\Scripts\python.exe scripts\template-gallery-assets.py upload `
  --repo-id <namespace>/modiff-template-gallery `
  --create `
  --public `
  --confirm-redistribution-rights
```

The upload command refuses incomplete manifests or incomplete Dataset license
metadata and requires explicit public and redistribution-rights
acknowledgements. It uploads through `huggingface_hub`/Xet, then anonymously
downloads that exact commit and verifies the remote manifest, rights ledger,
public visibility, and every managed byte before it reports success or prints
the final 40-character commit SHA. It does not activate the Dataset
automatically. On updates it replaces both MoDiff-managed prefixes
(`template-gallery/**` and `_modiff/**`) and the root Dataset `LICENSE`, so
revoked, renamed, or superseded terms do not remain in the new revision. It
does not delete `README.md`, `.gitattributes`, or unrelated Dataset files.

While upstream permissions are pending, `upload-provisional` may publish only
the ledger's approved records. It writes a blocked manifest, lists every
withheld path in the Dataset card, verifies the public bytes anonymously, and
has no activation option.

The provisional command validates the complete checked-in inventory and rights
ledger, then stages only approved files. Withheld local files may be absent;
their descriptors and holds remain unchanged. Every approved file must still
have exact local bytes and a safe regular-file path. Staging and byte verification
finish before credential access or a Hub mutation. Complete-set verification,
upload, activation and pruning retain their stricter complete-set requirements.

For example:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py upload-provisional \
  --repo-id <namespace>/modiff-template-gallery \
  --public \
  --confirm-redistribution-rights
```

Open the printed manifest URL in a private browser window where you are not
signed into Hugging Face. It must return JSON. The upload already performed a
full anonymous byte verification. For a complete publication, repeat it before
activation. For a provisional publication, first follow the
[reviewed approved-subset source update](#reviewed-approved-subset-source-updates)
procedure, which validates against the candidate descriptor:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py verify-remote \
  --repo-id <namespace>/modiff-template-gallery \
  --revision <40-character-commit-sha> \
  --full
```

Full verification also rejects any stale or unexpected file under the two
MoDiff-managed prefixes.

For a complete publication only, activate that exact commit:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py activate \
  --repo-id <namespace>/modiff-template-gallery \
  --revision <40-character-commit-sha>
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py verify-remote
```

On Windows, use `..\MoDiff\.venv\Scripts\python.exe` for these commands.

Activation again downloads the public manifest and rights ledger without
credentials, compares them byte-for-byte with the checked contracts, verifies
public visibility and every managed asset byte, and only then updates
`templateAssetSource.json`.

## Current publication state

The checked complete manifest declares 395 files with no missing paths. Its
rights ledger marks 391 approved and holds four ACE Chinese New Year / Ghibli media
files while written permission is pending. The current source descriptor pins
the public approved subset and names those four unavailable paths. These are
contract counts, not a claim that every file is materialized in each checkout.
Recompute them after an asset change.

Use `upload-provisional` while holds remain and review any new source pin using
the approved-subset procedure below. Keep each held path and digest unchanged
until its own permission evidence is recorded. Complete-set `upload` and
`activate` require a fully approved set.

The strict inventory classifies runtime and maintainer references separately.
The scanner covers runtime TypeScript/JavaScript/JSON, generated source,
the public Gallery manifest, maintainer scripts, and JSON/YAML/TOML configs. It
recognizes `/template-gallery/...`, `public/template-gallery/...`, and bare
`template-gallery/...` references. Adding a concrete reference in a durable but
unclassified source fails inventory rather than silently omitting that asset.

The current inventory reports zero unreferenced migration candidates. Re-run
inventory before acting because references can change; an unreferenced file is
never included in the Dataset merely because it exists locally.

## Validate the remote application on Linux before pruning

After activation, validate both the complete local source set and the remote-mode
application while the local bytes are still available:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py verify-remote --full
npm run test:template-assets:local
npm run gallery:assets:verify
npm run test:asset-storage
npm run check
npm run typecheck
npm run lint
npm run release:assets:gate
```

A remote build must not contain `dist/template-gallery`. It should contain only
the small shell assets under `dist/assets` plus the application bundles. Open
the Gallery and confirm browser requests use this form, including the immutable
commit rather than `main`:

```text
https://huggingface.co/datasets/<namespace>/modiff-template-gallery/resolve/<commit>/template-gallery/<file>
```

Check image, audio, video, before/after, and template-default-input workflows.
The source-release build exercises immutable Hub URLs. A normal user install
downloads and verifies this same snapshot during setup, bundles it under the
backend's `web/template-gallery`, and serves all Gallery media and default
inputs from local disk during use.

`npm run test:asset-storage` and the ordinary unit/check suite validate the
checked manifest and work in a lightweight remote-mode checkout without local
Gallery bytes. Maintainers with a complete downloaded snapshot should also run
`npm run test:template-assets:local` and `npm run gallery:assets:verify`; those
two gates intentionally hash the local files and are not clean-checkout gates.

## Installed local copy

The normal backend installer automatically materializes the exact pinned
snapshot, forces a local-mode client build, and mirrors the complete payload to
`web/template-gallery`. If the checked source is still in migration-time local
mode, it verifies the complete expected asset set before building. If it is in
Hugging Face mode, it downloads anonymously first. Installation fails closed
on a missing file or hash mismatch.

An already running remote-mode app can materialize or repair the same reviewed
payload from **Setup → Template Gallery assets**. That path remains entirely
app-owned: it validates the immutable manifest, checks the full download and
staging reservation against active model reservations and the 64 GiB safety
margin, downloads the exact Dataset snapshot, verifies every file, and
atomically promotes the local tree without deleting model-cache entries.
Restart MoDiff after active downloads finish so `/template-gallery/*` is
registered. The maintainer commands below are for offline recovery and Dataset
lifecycle work, not the normal in-app action.

The commands below are the manual recovery equivalent.

An offline installation can materialize the exact pinned snapshot. The command
uses the Hugging Face cache, rejects symlink/junction redirects, copies through
verified sibling temporary files, installs each file atomically, refuses to
overwrite mismatched files unless `--replace` is explicit, and verifies every
byte after materialization:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py download
VITE_MODIFF_TEMPLATE_ASSET_MODE=local npm run build
```

PowerShell:

```powershell
..\MoDiff\.venv\Scripts\python.exe scripts\template-gallery-assets.py download
$env:VITE_MODIFF_TEMPLATE_ASSET_MODE = "local"
npm run build
Remove-Item Env:VITE_MODIFF_TEMPLATE_ASSET_MODE
```

Local mode intentionally embeds the downloaded Gallery into `dist`; the normal
installer uses that mode after verification. `VITE_MODIFF_TEMPLATE_ASSET_REPO`,
`VITE_MODIFF_TEMPLATE_ASSET_REVISION`, and
`VITE_MODIFF_TEMPLATE_ASSET_SET_ID` are emergency build-time overrides, but a
release should use the reviewed checked-in source configuration.

## Remove Gallery bytes from Git and the Linux working copy

The checked-in ignore rules already exclude `public/template-gallery/**` while
retaining the two small source-of-truth metadata files:

```gitignore
public/template-gallery/**
!public/template-gallery/manifest.json
!public/template-gallery/runtime-inputs/
public/template-gallery/runtime-inputs/**
!public/template-gallery/runtime-inputs/default-input-bindings.json
```

Only after upload, unauthenticated full-snapshot verification, activation, and
the Linux validation above have all succeeded, run the opt-in local prune:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py prune-local \
  --confirm-delete-local-assets
```

`prune-local` refuses to run unless the checked source mode is `huggingface`,
the revision is an immutable 40-character commit, and its asset-set identity
matches the checked manifest. Before deleting anything, it verifies the public
repository, remote manifest, rights ledger, and every snapshot byte without a
token, and preflights every local candidate. It refuses traversal, symlinks,
non-files, or locally modified bytes. It unlinks only exact paths in
`config/template-assets.v1.json`, preserves the Gallery manifest and runtime
default-input bindings, leaves all unlisted files alone, and removes only empty
ancestor directories created by those unlinks. The confirmation flag is
mandatory; there is no recursive Gallery deletion.

Record deletions of previously tracked assets and force-add the retained
metadata:

```bash
git add -u public/template-gallery
git add -f public/template-gallery/manifest.json \
  public/template-gallery/runtime-inputs/default-input-bindings.json
git add .gitignore config/template-assets.v1.json \
  config/template-asset-rights.v1.json src/studio/templateAssetSource.json \
  docs/template-gallery-dataset-card.md \
  docs/template-gallery-dataset-license.txt
```

Review `git status` before any commit. The current strict inventory has zero
unreferenced migration candidates; 24 earlier candidates have already been
archived outside these repositories. Re-run inventory before a future cutover
because references can change. The prune command never deletes an unlisted
file, even if it appears unused.

The backend currently contains an older tracked Gallery snapshot as well. A
remote-mode production build must replace the backend web shell and record the
whole snapshot removal atomically. Build after local pruning, mirror the
contents of the remote-mode `dist` directory, and verify that no Gallery was
copied:

```bash
npm run build
rsync -a --delete --exclude '/user/' dist/ ../MoDiff/web/
test ! -e ../MoDiff/web/template-gallery
git -C ../MoDiff add -u web
git -C ../MoDiff add web
```

Do not prune individual files from the backend's old Gallery manifest. The
exact Windows mirror equivalent is documented in [Build and
deployment](deployment.md). The ignore rules in both repositories prevent a
later local/offline snapshot from being added accidentally.

Removing tracked files cleans future repository trees, not existing Git
history. If the requirement is that old Gallery blobs become unreachable from
GitHub history, use a separately reviewed `git filter-repo` migration and
force-push both repositories only after making backups and coordinating every
clone. Do not mix that destructive history rewrite into the ordinary storage
cutover commit.

Do not commit Gallery files from frontend `dist`, backend `web`, a GitHub source
tree, or Git LFS. A source release stays lightweight; installation downloads
the verified Dataset once and places the runtime copy in backend `web`.

## Lightweight Linux-to-Windows handoff

The handoff order is deliberate: publish, verify anonymously, activate,
validate on Linux, prune exact local assets, build and mirror the remote client,
then archive and SCP. Do not prune first and do not include local environments
or generated frontend output in the transfer.

From the parent directory containing the two adjacent repositories, first
confirm that the Gallery prune is complete and that neither Git remote embeds a
credential:

```bash
cd /path/to/MoDiff-parent
find MoDiff-client/public/template-gallery -type f -print
git -C MoDiff remote -v
git -C MoDiff-client remote -v
```

The Gallery command must list only `manifest.json` and
`runtime-inputs/default-input-bindings.json`. The remote URLs must not contain
a username/password or access token. Then create a source archive from exactly
the tracked and non-ignored untracked working-tree files, plus both `.git`
directories. This preserves uncommitted edits and deletions without copying
ignored environments, models, outputs, journals, custom modules, local config,
`.env` files, reports, caches, or Gallery bytes:

```bash
modiff_archive=../modiff-source.tar
modiff_backend_list=$(mktemp)
modiff_client_list=$(mktemp)
test ! -e "$modiff_archive"
test ! -e "$modiff_archive.gz"

git -C MoDiff ls-files -z --cached --others --exclude-standard |
  while IFS= read -r -d '' modiff_path; do
    if [ -e "MoDiff/$modiff_path" ] || [ -L "MoDiff/$modiff_path" ]; then
      printf '%s\0' "$modiff_path"
    fi
  done >"$modiff_backend_list"

git -C MoDiff-client ls-files -z --cached --others --exclude-standard |
  while IFS= read -r -d '' modiff_path; do
    if [ -e "MoDiff-client/$modiff_path" ] || [ -L "MoDiff-client/$modiff_path" ]; then
      printf '%s\0' "$modiff_path"
    fi
  done >"$modiff_client_list"

tar -C MoDiff --null --verbatim-files-from \
  --files-from="$modiff_backend_list" --transform='s,^,MoDiff/,' \
  -cf "$modiff_archive"
tar -C . -rf "$modiff_archive" MoDiff/.git
tar -C MoDiff-client --null --verbatim-files-from \
  --files-from="$modiff_client_list" --transform='s,^,MoDiff-client/,' \
  -rf "$modiff_archive"
tar -C . -rf "$modiff_archive" MoDiff-client/.git

gzip -9 "$modiff_archive"
unlink "$modiff_backend_list"
unlink "$modiff_client_list"
sha256sum "$modiff_archive.gz"
du -sh MoDiff MoDiff-client "$modiff_archive.gz"
```

If the first check lists anything else, stop and review that file rather than
broadening the prune. Copy the printed SHA-256 value somewhere separate. On
Windows PowerShell:

```powershell
scp <linux-user>@<linux-host>:/path/to/modiff-source.tar.gz "$HOME\Downloads\modiff-source.tar.gz"
Get-FileHash "$HOME\Downloads\modiff-source.tar.gz" -Algorithm SHA256
New-Item -ItemType Directory -Force C:\src\modiff-handoff | Out-Null
tar -xzf "$HOME\Downloads\modiff-source.tar.gz" -C C:\src\modiff-handoff
Set-Location C:\src\modiff-handoff\MoDiff-client
.\install-dev.ps1 -BackendPath ..\MoDiff -Accelerator auto
npm run test:asset-storage
npm run check
npm run release:assets:gate
Set-Location ..\MoDiff
.\.venv\Scripts\python.exe -m pytest
Set-Location ..\MoDiff-client
.\run-dev.ps1
```

The Windows hash must equal the Linux hash before extraction. The ordinary
remote-mode checks are expected to pass without Gallery binaries; do not run
the two local-snapshot hash gates unless you intentionally restore the assets
with `download`. After the integrated application test succeeds, review
`git status` independently in both repositories before pushing.

## Updating an asset set

1. Download the currently pinned set if local bytes are absent.
2. Add or replace reviewed files and update Gallery qualification metadata.
3. Run `inventory --write`, `verify`, and the normal Gallery qualification
   gates.
4. Refresh the per-file rights skeleton. New or changed bytes remain held until
   their specific human review; do not use a blanket attestation.
5. Upload without `--create` to the same public Dataset, using
   `upload-provisional` while any holds remain, and verify the returned revision
   anonymously.
6. Use complete-set activation or the reviewed approved-subset source update,
   as applicable, then run the required frontend acceptance checks.
7. Commit the new storage manifest and pinned source configuration together.

Never mutate a released source configuration to `main`, a tag, or a pull-request
ref. Rollback means restoring the previous checked-in commit SHA and asset-set
identity.

## Reviewed approved-subset source updates

`upload-provisional` remains non-activating. When a release deliberately retains
held previews, maintainers may review an immutable source-descriptor update,
as the existing approved-subset runtime contract supports. This is separate
from the complete-set `activate` command.

After human rights approval of every newly included byte and the uploader's
anonymous verification, review the exact returned Dataset revision and subset
manifest against the complete local manifest and rights ledger. Update only
`repoId`, the immutable `revision`, and the corresponding source identities in
`src/studio/templateAssetSource.json`: `assetSetId` is the verified subset;
`completeAssetSetId` is the complete checked authoring manifest; and the sorted
`unavailableAssets` list must exactly match the verified remote `missingAssets`.
Preserve the existing path roots and Dataset type. Never infer these values
from directory contents or clear a hold to make the sets match.

Preserve the previous descriptor bytes before preparing this change. The edited
descriptor is a release candidate; do not build or deploy it until verification
succeeds. If verification fails, restore those exact descriptor bytes and
retain the failure evidence.

Run `verify-remote --full` against that reviewed descriptor before its commit.
It validates the exact complete manifest or approved-subset projection and
rights ledger, then anonymously verifies every included byte and rejects
unexpected managed files. Run the ordinary asset storage/release checks and
Setup's Gallery materialization check for the same pinned source. Rollback is
the previous descriptor and identities. Keep held assets excluded; do not use
complete-set `activate` or `prune-local` for a subset.

This source update does not approve media rights, template quality, model
execution, Auto, or Gallery eligibility. New inputs and previews still require
the normal per-file human rights and template evidence reviews.

`npm run gallery:verify` verifies locally materialized bytes against the active
source descriptor. For an immutable Hugging Face subset, it requires the exact
complete storage manifest and rights ledger, verifies every included file's
byte identity, and reports `withheldAssets` and `withheldExamples` separately
from `verifiedExamples`. An exclusion must be an explicit rights hold with an
exact path and hash; held bytes found locally remain withheld. All available
media, provenance, quality review, and current template checks remain required,
including the metadata checks for withheld examples. Local-source mode still
requires the complete Gallery. This check does not approve held content,
replace anonymous `verify-remote --full`, or establish new execution or quality
evidence.

## Decoded-video identity across reviewed FFmpeg producers

Historical `sha256:decoded-video-framemd5` identities hash FFmpeg's complete
frame-checksum output, including its software banner. The reviewed Linux
`Lavf61.1.100` and Windows `Lavf61.7.100` producers can emit identical stream
metadata, timestamps and per-frame checksums with different software comments.
The verifier retains the actual raw digest and accepts a historical digest only
when changing that single banner to a reviewed producer reproduces it exactly.
It reports each use in `decodedHashCompatibilityMatches`. All remaining checksum
bytes, published-file SHA-256, audio PCM, provenance and review checks stay strict.
For AV identity, only a matching historical video identity and the actual decoded
audio identity can reproduce the recorded AV hash. No media, manifest hash or
approval record is rewritten. This compatibility does not qualify a changed
template recipe; stale creator locks and other release failures remain blocking.

## Live generation batching

The maintainer-only Gallery runner may reuse a loaded pipeline only for consecutive templates with the same normalized Studio `modelType`. The first template, every model boundary, and every failed template resets the reuse chain and invokes accelerator cleanup. Template inputs come from an explicit checked-in input map; the runner never acquires or repairs a model during execution. Use `npm run gallery:run -- --help` for the current options rather than retaining dated host-specific command batches in documentation.

## Retained whole-workflow Auto observations

A normal graph Run can have a verified whole-workflow Auto receipt without a
primary Studio candidate ID. For a completed, fresh, unquantized native modular
text-to-image graph, the provenance reader can recover an observed resource
identity from the original task's backend-resolved fields and consumed node
receipts. It checks the exact request/output/task/attempt/session/workflow joins,
worker graph hash, immutable literal model owner, controls and backend task
declaration. Missing, conflicting, connected, reused, deferred, patched or
unsupported evidence stays held. Client form intent alone supplies no identity.

The `observed-workflow-auto-resource-v1` identity records that executed recipe;
it does not assert a registered primary Auto recipe, hardware qualification or
publication approval. Node IDs, prompts and seeds do not manufacture distinct
resource recipes; model pins, effective settings and geometry remain bound.
Original tasks retain their original candidate fields, source and capture time.
Do not rerun a model merely to add this maintainer metadata, rewrite a raw task,
refresh a stale public template lock, or infer missing consumed defaults. The
existing source/model/input/media validators and human review still apply.

A separate `observed-workflow-auto-lora-resource-v1` vocabulary covers one
literal pinned Hub `ModularDiffusers.Lora` descriptor connected to the ordinary
modular text-to-image owner, optionally with the existing Guider. It requires the
original complete, freshly activated native adapter application and the existing
strict ordered-adapter proof, including installed base/adapter identities,
artifact pin/hash, name and numeric scale. The resource projection retains the
validated adapter material; per-application IDs stay in execution evidence and
do not manufacture a different resource recipe. The final provenance validator
joins that projection back to the strict native proof even if someone recomputes
its hash. Legacy plain-graph identities are unchanged.

Multiple adapters, predecessor chains, scheduler overrides, connected descriptor
controls, missing/ambiguous pins, unavailable/truncated state and reused owners
remain outside this observed-reader scope. This reader runs only in maintainer
evidence tooling: it does not add an Auto recipe, execute a supplier, alter saved
graphs/receipts, acquire weights or grant hardware, quality or publication
qualification. A missing original task candidate remains missing; the derived
observation records the actual retained execution separately.

The `observed-workflow-auto-audio-resource-v1` vocabulary covers a fresh,
unquantized direct-audio text-to-audio graph or its ordinary Load → Generate →
MatchLoudness → Join → Export continuation. It requires a completed first attempt,
one immutable installed model, the exact five/eight-node graph and typed audio
contract, matching request/task/output/session/workflow/form snapshots, the worker
graph hash, complete native consumed controls and backend-resolved Auto fields.
Automatic attention, the exact loader/recipe/disabled quantization settings and
every claimed creative input must agree; a form selection alone is insufficient.

The resource projection distinguishes the requested source duration from the
full generated continuation target and final delivered duration. Prompt, lyrics,
seed and node labels remain in execution evidence rather than manufacturing new
resource recipes. Rehashed observations must still match the canonical controls,
installed model pin, sample rate and output duration. Original tasks keep their
absent primary candidate ID. Repaint, variation, patched/deferred/reused owners,
quantization and unsupported graphs stay outside this reader's scope. A valid
observation closes only this execution-identity gap: source/input/media checks,
human listening, current-template review and publication decisions remain
separate. It adds no runtime, Auto admission, hardware qualification or download.
