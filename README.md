# Kiss

A web dress-up game for adults: upload a photo, get a stylized 3D avatar that resembles you, dress it from a wardrobe, pose it, and export an image. Everything runs in the browser — the photo never leaves the device.

Design spec: [`docs/superpowers/specs/2026-11-08-dressup-game-design.md`](docs/superpowers/specs/2026-11-08-dressup-game-design.md).
Implementation plans live in `docs/superpowers/plans/`.

## Prerequisites

- Node 22 (`nvm use` reads `.nvmrc`)
- npm

## Scripts

| Script               | What it does                                |
| -------------------- | ------------------------------------------- |
| `npm run dev`        | Vite dev server                             |
| `npm run build`      | Typecheck all projects and build to `dist/` |
| `npm run preview`    | Serve the production build locally          |
| `npm run lint`       | oxlint + Prettier check                     |
| `npm run format`     | Prettier write                              |
| `npm run typecheck`  | `tsc -b` over app, tests and e2e            |
| `npm test`           | Vitest unit tests (`tests/`)                |
| `npm run test:watch` | Vitest in watch mode                        |
