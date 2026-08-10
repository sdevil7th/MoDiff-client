# Security Policy

MoDiff Client is an actively developed local-first application. The current client/backend pair has no built-in authentication or multi-user authorization boundary and should not be exposed directly to the public internet.

## Reporting A Vulnerability

Use the repository's private vulnerability-reporting feature when it is enabled:

1. Open the repository's **Security** tab.
2. Choose **Advisories** and **Report a vulnerability**.
3. Include affected revisions, impact, prerequisites, and minimal reproduction steps.
4. Attach only sanitized evidence and give maintainers reasonable time to investigate before public disclosure.

If private vulnerability reporting is unavailable, open a minimal public issue requesting a private maintainer contact channel. Do not include exploit details, credentials, private media, tokens, local paths, or vulnerable-host information in that issue.

Use normal public issues for non-sensitive bugs such as rendering problems, documented command failures, or a reproducible UI regression.

## Security-Sensitive Areas

Reports are especially useful when they involve:

- File read/write or path traversal outside configured backend directories
- Unauthenticated remote graph execution or model/custom-module administration
- Cross-site scripting through prompts, metadata, node definitions, custom fields, or Gallery records
- Unsafe deserialization, archive extraction, model loading, or remote-code behavior
- Token, credential, environment, local-path, prompt, or media disclosure
- Websocket origin or session confusion
- Workflow/export/provenance data leaking between users or origins
- Dependency or build-pipeline compromise

Official Hugging Face model libraries execute only in the local backend process; they do not make model repositories or repository-supplied code trusted. Optional runtimes must be installed through an explicit, reviewed backend action. Opening a template, discovering nodes, or checking Auto compatibility must remain read-only with respect to Python packages.

## Supported Versions

Until tagged releases are published, security fixes target the current `main` branch and its compatible MoDiff backend revision. Older snapshots may not receive backports.

## Deployment Boundary

The supported default is a trusted single user with both processes bound to `127.0.0.1`. A public or shared deployment must add external controls, including authentication, authorization, TLS, origin restrictions, request/upload limits, filesystem isolation, and audited model/custom-module policy.

Read [Privacy and security](docs/privacy-and-security.md) for stored data, network behavior, third-party code trust, cleanup, and safe diagnostic sharing.
