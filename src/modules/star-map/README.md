# Star-map module

Independent scene projection and Canvas renderer. It owns layout, camera,
node/edge rendering and interaction; it does not load Wiki files, memory stores,
Agent identities or task data.

Public entry points:

- `@/modules/star-map`: `MemorySeaCanvas` and public input types.
- `@/modules/star-map/domain`: pure layout/projection utilities and types.

The application supplies authorized `SeaPoint[]`/`SeaEdge[]`, selection and a
selection callback. Data loading and Wiki/memory adapters remain in
`src/components/workspace/memory-star-map.tsx` during migration.

`module.json` declares permitted dependencies, enforced by `npm run check:modules`.
Domain tests are colocated in `domain/scene.test.ts`. MIT attribution is in LICENSE.
