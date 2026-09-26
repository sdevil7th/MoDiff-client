# MoDiff Client Documentation

This directory contains durable user, operator, and contributor documentation for the MoDiff web client. Behavior described here should match the current `main` branch and the compatible MoDiff backend. Historical implementation trackers and workstation-specific proof logs do not belong in the public documentation set.

## Start Here

[Developer-first node authoring](developer-first-node-ux.md) covers the unified
editor, custom imports, matching sockets and supported image/audio attachments.

| Guide                                           | Audience            | What it covers                                                                                |
| ----------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                  | Everyone            | Project scope, prerequisites, quick start, first workflow, validation, and support boundaries |
| [Studio user guide](studio-user-flow.md)        | Users and testers   | Tasks, interface areas, Auto performance, models, Gallery, export, failures, and smoke tests  |
| [Troubleshooting](troubleshooting.md)           | Users and operators | Preflight, ports, slow/stalled runs, model downloads, browser state, and runtime recovery     |
| [Privacy and security](privacy-and-security.md) | Users and deployers | Stored data, network activity, exports, trust boundaries, cleanup, and safe issue reports     |
| [Windows support](windows-support.md)           | Windows users       | uv/npm developer setup, PowerShell launchers, CUDA notes, cleanup, and platform smoke tests   |
| [Ubuntu Linux support](linux-support.md)        | Linux users         | Native prerequisites, backend setup, launcher behavior, and platform smoke tests              |
| [Apple Silicon macOS support](macos-support.md) | macOS users         | Native prerequisites, MPS caveats, backend setup, and platform smoke tests                    |

## Build And Contribute

| Guide                                                          | Audience                        | What it covers                                                                              |
| -------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| [Contributing](../CONTRIBUTING.md)                             | Contributors                    | Environment setup, change rules, testing, documentation, and pull requests                  |
| [Client architecture](modiff-client-architecture.md)           | Frontend/backend contributors   | App shell, stores, graph/runtime boundaries, Studio, persistence, and extension points      |
| [Frontend style guide](frontend-style-guide.md)                | UI contributors                 | Tokens, components, fields, accessibility, and style enforcement                            |
| [Auto mode design](auto-mode-design.md)                        | Runtime and Studio contributors | Auto/Expert contract, readiness semantics, model recipe metadata, and onboarding checks     |
| [Third-party notices](../THIRD_PARTY_NOTICES.md)               | Maintainers and legal reviewers | Inherited source baseline, modification notices, and third-party licenses                   |
| [Build and deployment](deployment.md)                          | Maintainers and deployers       | Production builds, backend static-file integration, same-origin hosting, and release checks |
| [Template asset storage](template-gallery-assets.md)           | Gallery maintainers             | Public Hugging Face Dataset publication, pinned URLs, integrity checks, and offline cache   |
| [Template quality schema](template-quality-review.schema.json) | Gallery maintainers             | Machine-readable quality-review record used by the Gallery verification tooling             |

## Required Engineering Procedure

The [workbench acceptance guide](workbench-acceptance.md) consolidates model
coverage, native-stage exceptions, preservation, custom-node and integrated
qualification requirements. Retired implementation plans remain in Git history;
their removal does not close outstanding acceptance gates. Use
[developer-first authoring](developer-first-node-ux.md) and
[workflow authoring](workflow-authoring-ux.md) for current behavior.

See the [frontend style guide](frontend-style-guide.md#field-components) for
numeric-field containment and [library accessibility](frontend-style-guide.md#accessibility)
for readiness placement and nested disclosure guides. Recovery and output
provenance are covered by the [client architecture](modiff-client-architecture.md).

Read [Cluster engineering lessons](cluster-engineering-lessons.md) before
node/Block, hierarchy, execution, qualification or cross-machine integration work.

## Documentation Standards

- Describe confirmed current behavior, not an intended future state.
- Separate UI visibility, schema compatibility, mocked validation, and real model execution evidence.
- Do not claim that a model is runnable merely because a profile or cache folder exists.
- Use repository-relative paths and portable examples; never commit personal filesystem paths, access tokens, account names, or machine inventories.
- Keep commands synchronized with `package.json`, the launch scripts, and CI.
- Put dated implementation evidence in issue or pull-request records instead of permanent user guides.
- Link security-sensitive reports to [SECURITY.md](../SECURITY.md) and keep secrets out of public issues.

If a guide and the application disagree, treat the implementation and automated checks as the immediate source of truth, then update the guide in the same change.

- [Workflow authoring and model selection](workflow-authoring-ux.md)
- [Serial image generation and modification campaigns](image-prototyping-campaign.md)
