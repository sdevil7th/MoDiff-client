# Copilot Instructions

MoDiff Client is a React 19, TypeScript, Vite, Tailwind CSS, Headless UI, Lucide React, Zustand, and React Flow app. `CONTRIBUTING.md` is the full source of truth for contributor rules.

- New UI work is Tailwind/headless-first. Do not reintroduce MUI, Emotion, notistack, styled-components, CSS modules, or another broad UI framework.
- Use `src/theme` for MoDiff colors, Hugging Face-inspired tokens, typography, radii, shadows, category colors, style sanitizers, and React Flow helpers.
- Use `src/ui` primitives for repeated buttons, icon buttons, panels, dialogs, menus, tabs, status boxes, fields, image frames, progress, and toolbar controls.
- Use Headless UI through `src/ui` wrappers when focus management, keyboard behavior, or accessible dialog/menu/tab state matters. Simple native controls can stay native.
- Do not add raw colors, `rgb()` / `rgba()`, inline `style={...}`, direct `fontSize`, direct `borderRadius`, or one-off shadows in feature components.
- Use explicit Lucide imports; do not add dynamic icon registries.
- Keep global CSS in `src/App.css` limited to browser/global behavior, React Flow internals, and behavior hooks.
- If editing `src/fields`, use `FieldFrame`, preserve `data-key`, `modiff-field`, `nodrag`, `nowheel`, hidden, and disabled behavior contracts.
- Backend-provided style objects must remain sanitized layout-only styles.
- Keep Zustand. Use typed selectors and `useShallow` when reading multiple store values.
- Treat network, websocket, localStorage, and backend dynamic-node data as `unknown` until guarded.
- Keep public docs durable: no personal paths, machine inventories, credentials, dated execution trackers, or claims that confuse mocked/schema checks with live model proof.
- Before finalizing changes, run `npm run check`; run `npm run check:ui` for behavior/layout changes and Gallery verification/coverage for public example changes.
