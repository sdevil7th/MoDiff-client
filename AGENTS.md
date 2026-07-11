# MoDiff Client Agent Instructions

These rules apply to Codex, Copilot-style agents, and any AI tool editing this repo. `CONTRIBUTING.md` is the full human-facing source of truth; keep this file aligned with it.

## Non-Negotiable Rules

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
npm run lint
npm run style:audit
npm run test:styles
npm run build
```

Run relevant Playwright tests when behavior or layout-sensitive surfaces are touched:

```powershell
npm run e2e:studio:mocked
```
