# Kiss

![CI](https://github.com/sharkysan/dressup.ai/actions/workflows/ci.yml/badge.svg)

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

## Assets

Binary assets are never committed. Source VRMs live under `assets/source/` (layout in
[`assets/source/README.md`](assets/source/README.md)); the pipeline builds `public/assets/`:

```bash
npm run assets:dev      # fetch the dev sample VRMs, fake morph variants, build everything
npm run assets          # rebuild from your own sources in assets/source/
```

`tools/build-base.ts` strips hair, neutralises skin/iris textures for runtime tinting, adds the
eight face-shape morph pairs from `morphs/<param>.{min,max}.vrm`, stores morph targets sparsely and
textures as WebP ≤1024². Licences for every third-party asset are listed in
[`assets/LICENSES.md`](assets/LICENSES.md).

## Running the checks

CI runs `npm run ci` on every push and pull request (`.github/workflows/ci.yml`). To run the same chain locally:

```bash
npx playwright install --with-deps chromium   # once
./tools/fetch-placeholder-vrm.sh              # once
npm run ci
```
