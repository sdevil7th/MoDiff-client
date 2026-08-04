# Privacy And Security

MoDiff is a local-first development application. Local-first means the default client/backend pair runs on the same machine; it does not mean that no data is stored, no network requests occur, or every extension/model is trusted.

## Trust Boundary

The current application is intended for one trusted user on a trusted workstation.

- The backend exposes graph execution, model management, file, preview, upload, queue, workflow, and runtime endpoints.
- The client does not provide user accounts, per-user authorization, or an internet-grade authentication layer.
- The default development setup binds the backend and Vite to `127.0.0.1` and uses a same-origin proxy.
- Binding to `0.0.0.0`, forwarding ports, or placing the app behind a public hostname expands the threat model and is not safe by itself.

Do not expose MoDiff to an untrusted network without authentication, TLS, authorization, request limits, origin controls, filesystem isolation, audit logging, and a reviewed reverse-proxy policy.

For SSH development, keep both services on loopback and forward the client port
through the authenticated tunnel instead of using `--host 0.0.0.0`:

```bash
ssh -L 5173:127.0.0.1:5173 <user>@<host>
```

Run `./run-dev.sh --no-browser` on the remote host, then open
`http://127.0.0.1:5173` on the local machine. Change both occurrences of
`5173` if the launcher selects a different frontend port.

## Browser Data

The client persists state in the browser origin's local storage:

| Key               | Typical contents                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `modiff.flow`     | Visual graph, node parameters, edges, viewport, and related graph state                              |
| `modiff.settings` | User interface preferences and non-volatile settings                                                 |
| `modiff.studio`   | Studio form values, workflow tabs, prompts/snippets, template provenance, and recent output metadata |

Depending on the workflow, these records can contain prompts, negative prompts, seeds, model names, local/backend file references, output URLs, and restorable graph metadata. Anyone with access to the browser profile may be able to inspect them.

Use a separate browser profile for sensitive work. Export workflows you need, then clear this origin's site data when the local browser history should not remain. Clearing browser data does not remove files stored by the backend.

## Backend Data

The backend may persist:

- Uploaded images, videos, audio, masks, and other workflow inputs
- Generated outputs and Studio output metadata
- Saved workflow files, user blocks, and runtime records
- Model caches and download metadata
- Offload files, temporary artifacts, logs, and preflight reports
- Custom modules or fields added by the operator

Exact locations depend on the backend `config.ini`, environment variables, Hugging Face configuration, and platform. Review the backend's configured data, model, and cache paths before processing private media.

Deleting an output from Gallery should remove the associated Studio history record through the backend contract, but it is not a secure-erasure guarantee for filesystem backups, logs, caches, browser downloads, or external storage. Use operating-system controls when secure deletion or retention enforcement is required.

## Network Activity

Normal local use can still contact external services:

- Model search, metadata, and downloads can contact Hugging Face.
- A model repository or optional dependency may refer to additional upstream resources.
- Remote media URLs used in a workflow may be requested by the browser or backend.
- Links opened from model/access guidance leave the local application.

Review outbound network policy when running in a restricted environment. Do not assume that offline operation will succeed unless every required package, model artifact, and input is already local and the selected runtime path performs no remote resolution.

## Models, Dependencies, And Custom Modules

Treat third-party model repositories, Python packages, custom modules, and custom fields as code or content from outside the MoDiff trust boundary.

- Review the source, license, maintainer, pinned revision, and required execution flags before installation.
- Some model ecosystems support repository-provided code; do not enable remote-code execution for an untrusted repository.
- Custom Python modules execute with the backend process's operating-system permissions.
- Custom React fields execute in the browser origin and can access data available to the client.
- Model formats such as `safetensors` reduce some serialization risks but do not make the surrounding loader, package, or module trusted.
- Gated model authorization and acceptable-use terms are controlled by the model provider, not MoDiff.

Run MoDiff under a non-administrator account with access only to the directories it needs. Keep the backend environment and custom-module sources reviewable and reproducible.

## Credentials And Secrets

Never commit or share:

- Hugging Face access tokens
- Cloud/API credentials
- Private repository URLs containing credentials
- Cookies, authorization headers, or copied browser storage
- Full environment dumps
- Unredacted preflight reports or logs containing usernames and filesystem paths

Use Hugging Face's supported credential storage or environment mechanisms for local authentication. `.env` files are ignored by this repository, but ignored files are not encrypted and can still leak through screenshots, shell history, archives, or copied diagnostics.

## Exports And Provenance

Workflow and output packages are designed to preserve reproducibility context. They may contain:

- Prompt and negative-prompt text
- Seeds, dimensions, steps, guidance, and resource settings
- Model repository names and artifact references
- Visual/API graph structure
- Input/output URLs or backend file paths
- Template, parent, lineage, or run identifiers
- Revision and provenance metadata

Inspect JSON packages before publishing them. Public Gallery provenance generated by the repository tooling redacts source commits and local paths, but custom exports and third-party records must be reviewed separately. A hash can still be a stable identifier even when its underlying payload is unavailable.

## Public Issues And Test Artifacts

Before attaching a log, screenshot, trace, workflow, or Gallery record to an issue:

1. Remove tokens, cookies, authorization headers, and environment variables.
2. Replace usernames, home directories, drive layouts, hostnames, and private repository paths.
3. Remove private prompts, input media, output media, and model-access information.
4. Check Playwright traces, which can contain page content, requests, and screenshots.
5. Reduce backend logs to the smallest relevant exception and context.
6. Do not attach an entire browser profile, model cache, or data directory.

For a suspected vulnerability, follow [SECURITY.md](../SECURITY.md) instead of opening a public issue with exploit details.

## Local Deployment Checklist

- Keep the backend and Vite bound to `127.0.0.1`.
- Keep the operating system, browser, Python, Node, and accelerator drivers patched.
- Run as a standard user, not Administrator/root.
- Restrict permissions on data, cache, model, log, and export directories.
- Review every custom module/field and optional dependency before enabling it.
- Keep model artifacts pinned or otherwise provenance-aware when reproducibility matters.
- Back up workflows intentionally; do not treat browser local storage as a backup.
- Define retention and cleanup for uploads, outputs, caches, and exported packages.
- Verify that diagnostics are redacted before sharing them.

## Clearing Local Data

1. Export any workflow or output package you need to keep.
2. Delete unwanted Gallery records through the UI so the backend receives the normal delete request.
3. Clear this origin's browser site data to remove `modiff.flow`, `modiff.settings`, and `modiff.studio`.
4. Stop MoDiff.
5. Review the backend's configured data, output, workflow, cache, offload, artifact, and log directories and remove only the data you intend to discard.
6. Review the browser download directory for exported packages and downloaded media.

Model caches are often shared with other applications. Do not delete a shared Hugging Face cache without checking which tools rely on it.
