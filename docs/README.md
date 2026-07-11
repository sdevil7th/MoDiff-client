# MoDiff Client Documentation

This directory contains durable user, operator, and contributor documentation for the MoDiff web client. Behavior described here should match the current `main` branch and the compatible MoDiff backend. Historical implementation trackers and workstation-specific proof logs do not belong in the public documentation set.

## Start Here

| Guide                                           | Audience            | What it covers                                                                                |
| ----------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------- |
| [Project README](../README.md)                  | Everyone            | Project scope, prerequisites, quick start, first workflow, validation, and support boundaries |
| [Studio user guide](studio-user-flow.md)        | Users and testers   | Tasks, interface areas, models, Gallery, export, failures, and a manual smoke test            |
| [Troubleshooting](troubleshooting.md)           | Users and operators | Preflight, ports, connection problems, model downloads, browser state, and runtime recovery   |
| [Privacy and security](privacy-and-security.md) | Users and deployers | Stored data, network activity, exports, trust boundaries, cleanup, and safe issue reports     |
| [Windows support](windows-support.md)           | Windows users       | PowerShell launchers, backend setup, CUDA notes, process cleanup, and platform smoke tests    |
| [Ubuntu Linux support](linux-support.md)        | Linux users         | Native prerequisites, backend setup, launcher behavior, and platform smoke tests              |
| [Apple Silicon macOS support](macos-support.md) | macOS users         | Native prerequisites, MPS caveats, backend setup, and platform smoke tests                    |

## Build And Contribute

| Guide                                                          | Audience                        | What it covers                                                                              |
| -------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| [Contributing](../CONTRIBUTING.md)                             | Contributors                    | Environment setup, change rules, testing, documentation, and pull requests                  |
| [Client architecture](modiff-client-architecture.md)           | Frontend/backend contributors   | App shell, stores, graph/runtime boundaries, Studio, persistence, and extension points      |
| [Frontend style guide](frontend-style-guide.md)                | UI contributors                 | Tokens, components, fields, accessibility, and style enforcement                            |
| [Auto mode design](auto-mode-design.md)                        | Runtime and Studio contributors | Auto/Expert contract, readiness semantics, model recipe metadata, and onboarding checks     |
| [Build and deployment](deployment.md)                          | Maintainers and deployers       | Production builds, backend static-file integration, same-origin hosting, and release checks |
| [Template quality schema](template-quality-review.schema.json) | Gallery maintainers             | Machine-readable quality-review record used by the Gallery verification tooling             |

## Documentation Standards

- Describe confirmed current behavior, not an intended future state.
- Separate UI visibility, schema compatibility, mocked validation, and real model execution evidence.
- Do not claim that a model is runnable merely because a profile or cache folder exists.
- Use repository-relative paths and portable examples; never commit personal filesystem paths, access tokens, account names, or machine inventories.
- Keep commands synchronized with `package.json`, the launch scripts, and CI.
- Put dated implementation evidence in issue or pull-request records instead of permanent user guides.
- Link security-sensitive reports to [SECURITY.md](../SECURITY.md) and keep secrets out of public issues.

If a guide and the application disagree, treat the implementation and automated checks as the immediate source of truth, then update the guide in the same change.
