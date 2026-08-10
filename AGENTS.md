# MoDiff Client Agent Instructions

These rules apply to Codex, Copilot-style agents, and any AI tool editing this repo. `CONTRIBUTING.md` is the full human-facing source of truth; keep this file aligned with it.

## Non-Negotiable Rules

- The backend may execute models through official libraries maintained and published by Hugging Face. Keep all of
  them behind the existing backend graph, resource, Auto/Expert, file, and security contracts; do not add a hosted
  inference provider, second graph executor, browser-side model runtime, or client-owned workflow representation.
- Keep frontend nodes and task surfaces generic. Render the backend's declared dynamic inputs, parameters, outputs,
  readiness, and install requirements instead of selecting Python classes or maintaining model-specific parameter
  branches in the client.
- Transformers is an optional backend runtime, not a default client/application dependency. Browsing or opening a
  template, loading registry data, and requesting an Auto plan must never install it. Show an explicit install and
  consent action for a reviewed optional-runtime profile, then require backend verification before enabling Run.
- New UI work is Tailwind/headless-first. Do not reintroduce MUI, Emotion, notistack, styled-components, CSS modules, or another UI framework.
- Use `src/theme` for MoDiff colors, Hugging Face-inspired tokens, typography, radii, shadows, z-index values, category colors, style sanitizers, and React Flow helpers.
- Use `src/ui` primitives before writing repeated panel, status, field, image, toast, dialog, menu, tab, or toolbar styling.
- Do not add raw hex colors, `rgb()` / `rgba()`, direct `fontSize`, direct `borderRadius`, one-off `boxShadow`, or JSX `style={...}` in feature components.
- Keep `src/App.css` limited to global browser rules, React Flow internals, and behavior hooks such as `modiff-field`, `nodrag`, and `nowheel`.
- Backend-provided `style` objects must go through the MoDiff style sanitizer and stay limited to safe layout properties.

## Component Rules

- Feature components should describe behavior and layout, not recreate visual primitives.
- Use Headless UI through `src/ui` wrappers when focus management, keyboard behavior, or accessible dialog/menu/tab state matters.
- Use native controls when they are simpler and already accessible.
- Use explicit Lucide imports; do not add dynamic icon registries.
- Field components must use `FieldFrame`, preserve `data-key`, and keep graph behavior classes intact.
- Keep panels dense and practical. Preserve current graph, Studio, model manager, setup, gallery, and dialog behavior unless the task explicitly asks for UX changes.
- Avoid adding dependencies unless the implementation plan explains why and includes bundle/regression checks.

## State And Types

- Keep Zustand. Use typed selectors and `useShallow` when reading multiple values.
- Treat network, websocket, localStorage, and backend dynamic-node data as `unknown` until narrowed by guards.
- Preserve MoDiff localStorage keys and legacy migrations.

## Required Checks

Run these before claiming a maintainability or UI change is complete:

```powershell
npm run check
```

Run relevant Playwright tests when behavior or layout-sensitive surfaces are touched:

```powershell
npm run check:ui
```

For a release candidate, run `npm run check:acceptance`; report any intentionally skipped live hardware or model
qualification separately instead of treating static or mocked checks as equivalent proof.
