## Summary

-

## Checks

- [ ] `npm run check`
- [ ] `npm run check:ui` for behavior/layout changes, or reason not needed:
- [ ] `npm run gallery:verify` and `npm run gallery:coverage` for Gallery/template changes, or reason not needed:
- [ ] Documentation and local Markdown links updated when behavior/commands changed.

## Compatibility And Proof

- [ ] Existing graph, storage, endpoint, and websocket compatibility is preserved or the migration is described.
- [ ] Mocked, backend/schema, artifact, and live model proof are reported separately where relevant.
- [ ] No credentials, private media, personal paths, machine inventories, or unredacted provenance are included.

## Styling Maintainability

- [ ] Reused `src/theme` tokens for visual constants.
- [ ] Reused `src/ui` primitives where possible.
- [ ] Did not add another broad styling/component system.
- [ ] Did not add new raw colors, inline `style`, direct font sizes, direct radii, or one-off shadows in feature code.
- [ ] Preserved field behavior classes such as `modiff-field`, `nodrag`, and `nowheel` when touching fields.
