# Template Gallery asset storage

MoDiff stores its public Gallery payload in a public Hugging Face Dataset,
while Git contains only code, metadata, and SHA-256 identities. Runtime URLs
are pinned to one immutable Dataset commit. Public users do not need a Hugging
Face token.

[Hugging Face's current storage policy](https://huggingface.co/docs/hub/en/storage-limits)
describes storage for a free user or organization's public repositories as
**best effort**, and asks that public uploads provide real community value. The
current Gallery is about 466 MiB and 360 files, well below the Hub's
repository-structure recommendations, so a public Dataset is a reasonable
zero-cost home for this release. It is not a contractual free hosting
guarantee: monitor the current Hub policy and keep the byte manifest portable
enough to migrate to another public Dataset namespace if needed.

The checked-in source configuration is
`src/studio/templateAssetSource.json`. `mode: "local"` is the safe migration
default; it keeps the current application working until a real Dataset is
uploaded and verified. Do not replace it with a guessed namespace or a moving
`main` revision.

## One-time public Dataset setup

Choose a user or organization namespace where you have write permission. The
recommended repository name is `<namespace>/modiff-template-gallery`. The
repository must remain public for unauthenticated open-source use.

Before running an upload, settle the Gallery media license. The application is
Apache-2.0, but that does not automatically license generated outputs, input
fixtures, model-derived examples, or third-party marks. The current Dataset
card intentionally uses `license: other` because the 140 checked provenance and
review records do not declare a reusable asset license. Its metadata is also
intentionally incomplete, so it cannot be published accidentally. [Hugging
Face's repository-license contract](https://huggingface.co/docs/hub/en/repositories-licenses)
requires `license: other` to include both a descriptive `license_name` in
`docs/template-gallery-dataset-card.md` and the actual terms in
`docs/template-gallery-dataset-license.txt`; the uploader refuses all Hub
mutations until both exist. Do not choose Apache-2.0, CC0, CC-BY, or another
license unless every included asset can legally be distributed on those terms.

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
path and SHA coverage and refuses stale, missing, duplicate, or held records
before authenticating or changing a Hub repository.

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
has no activation option:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py upload-provisional \
  --repo-id <namespace>/modiff-template-gallery \
  --public \
  --confirm-redistribution-rights
```

Open the printed manifest URL in a private browser window where you are not
signed into Hugging Face. It must return JSON. The upload already performed a
full anonymous byte verification; repeat it independently before activation:

```bash
../MoDiff/.venv/bin/python scripts/template-gallery-assets.py verify-remote \
  --repo-id <namespace>/modiff-template-gallery \
  --revision <40-character-commit-sha> \
  --full
```

Full verification also rejects any stale or unexpected file under the two
MoDiff-managed prefixes.

Then activate that exact commit:

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

The complete local set contains 360 verified files. The rights ledger approves
356 and holds four ACE Chinese New Year / Ghibli media files while written
permission is pending. Publish the approved subset with `upload-provisional`;
do not activate it. After both permissions are recorded, approve those exact
four records, run the complete `upload` command, and activate only its fully
verified immutable revision.

The current strict inventory has 360 required paths: 358 are used at runtime
(14 are also used by maintainer tooling) and 2 are tooling-only. Of these, 359
files are present and total 465.91 MiB; the poster above is the one missing
path. The scanner covers runtime TypeScript/JavaScript/JSON, generated source,
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
mode, it verifies the existing 360 files before building. If it is in
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
4. Upload without `--create` to the same public Dataset.
5. Test the printed revision unauthenticated.
6. Activate the new commit and run the full frontend acceptance suite.
7. Commit the new storage manifest and pinned source configuration together.

Never mutate a released source configuration to `main`, a tag, or a pull-request
ref. Rollback means restoring the previous checked-in commit SHA and asset-set
identity.

## Live generation batching

The maintainer-only Gallery runner may reuse a loaded pipeline only for consecutive templates with the same normalized Studio `modelType`. The first template, every model boundary, and every failed template resets the reuse chain and invokes accelerator cleanup. Template inputs come from an explicit checked-in input map; the runner never acquires or repairs a model during execution. Use `npm run gallery:run -- --help` for the current options rather than retaining dated host-specific command batches in documentation.
