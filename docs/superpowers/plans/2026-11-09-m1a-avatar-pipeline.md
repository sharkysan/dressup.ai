# M1a Avatar Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a VRoid-made VRM into the game's base avatar — hair stripped, textures neutralised for runtime tinting, eight face-shape morph pairs added — plus standalone hairstyle GLBs, and make `AvatarParams` drive the rendered avatar (colours, face morphs, expression, hairstyle).

**Architecture:** A VRM-aware GLB toolkit in `tools/glb/` (read/write GLB, accessors, prune, remove hair, neutralise textures, add morph targets, extract hair) feeds three CLIs — `build-base`, `build-hair`, `build-catalog` — that write `public/assets/`. At runtime `avatar/applyParams.ts` maps params onto MToon materials, morph-target influences and VRM expressions; `avatar/skinnedAttach.ts` rebinds a hairstyle GLB to the avatar's bones by name. A dev-only params panel exercises it all before the real UI exists (M4).

**Tech Stack:** TypeScript tools run with `tsx`; `pngjs` for texture maths (no native deps); `sharp` only for optional WebP output; `zod` catalog schema; `three` + `@pixiv/three-vrm` (`MToonMaterial`, `VRMExpressionManager`); Vitest (`node` env for tools, jsdom for runtime); Playwright for visual checks.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md` — §7 Avatar, §8 (hair slot), §12 Assets and pipeline, §16 M1 (the asset half; face analysis is plan M1b).

## Global Constraints

- TypeScript strict; `npm run ci` (lint, typecheck, unit, build, e2e) stays green after every task (M0).
- Skin → MToon `color` and `shadeColor`; hair/iris textures greyscale and tinted at runtime (spec §7).
- Face-shape morphs: eight pairs, params −1..1 mapped onto paired min/max targets (spec §7): `faceWidth, jawWidth, chinLength, noseWidth, noseLength, eyeSpacing, eyeSize, lipFullness`.
- Existing VRM expression morph targets and their binds must keep working after the build (spec §7 "Existing VRM expression morphs are preserved").
- Hair is removed from the base; hairstyles are separate assets rigidly skinned to the head; no spring-bone physics in v1 (spec §7).
- Textures ≤1024² in shipped assets (spec §8/§12). Base avatar + default outfit < 3 MB is the §15 budget; record the built size in the Task 2 commit and flag if over.
- Large binaries are fetched, never committed (M0 ruling); `assets/source/**/*.vrm` and `public/assets/**/*.{vrm,glb}` are git-ignored.
- All user-facing copy in `src/ui/strings.ts`; the dev panel is not user-facing and may use literals.
- Licences: every third-party source asset has a row in `assets/LICENSES.md`; the dev samples are VRM Public License 1.0, dev-only.

## Review Focus

1. A morph variant whose vertex count differs from the neutral base → the build fails naming the mesh and primitive; never a misaligned morph that warps the face. Test in Task 2 (`addMorphTargets` throws `MorphTopologyError` with mesh/primitive in the message).
2. A hairstyle GLB that references a bone the base lacks → attach fails cleanly, the avatar stays bald, viewer status stays `ready`. Test in Task 5 (`attachSkinned` throws `AttachError` listing missing bones; `HairModel` catches and warns).
3. Params arriving from an old share link with a hair id that no longer exists → no crash, no hair, one console warning. Test in Task 6 (e2e: unknown id keeps `data-status="ready"`).
4. Face-shape weights outside −1..1 → clamped at apply time, never fed to morph influences raw. Test in Task 5 (`setFaceShape` clamps 1.5 → influence 1).
5. Re-applying the same params many times (every store change) → colours identical to applying once; no multiplicative drift. Test in Task 5 (`applyParams` twice yields the same `color` as once).

---

## File structure

```
tools/
├── glb/
│   ├── types.ts            GltfJson type (loose), GlbDoc
│   ├── glb.ts              readGlb / writeGlb
│   ├── accessors.ts        readAccessor / appendAccessor
│   ├── prune.ts            pruneUnused (materials, textures, images, samplers, accessors, bufferViews; rebuild BIN)
│   ├── removeHair.ts       removeHair
│   ├── textures.ts         getImage / replaceImage / neutralizeImage / resizeImage (pngjs)
│   ├── addMorphTargets.ts  addMorphTargets, MorphTopologyError
│   └── extractHair.ts      extractHair
├── build-base.ts           CLI: source dir → public/assets/avatars/<id>.vrm
├── build-hair.ts           CLI: source dir → public/assets/hair/<id>.glb
├── build-catalog.ts        CLI: meta.json sidecars → public/assets/catalog.json
├── synth-variants.ts       DEV ONLY: fake morph variants from a neutral VRM
├── fetch-dev-samples.sh    replaces fetch-placeholder-vrm.sh; fetches the two spec samples into assets/source/
└── test-fixtures/
    └── makeGlb.ts          builds a tiny synthetic skinned GLB for unit tests
assets/source/
├── README.md               layout and naming rules (below)
├── base-a/meta.json        { id, name, license }
├── base-a/neutral.vrm      (fetched/ignored)   base-a/morphs/<param>.{min,max}.vrm
└── hair/<hairId>/meta.json { id, name, base, tags }   hair/<hairId>/source.vrm (fetched/ignored)
public/assets/              built outputs: avatars/base-a.vrm, hair/*.glb, catalog.json (all ignored)
src/
├── color/oklab.ts          hexToOklab / oklabToHex / shadeFor
├── catalog/catalog.ts      zod schema, Catalog type, loadCatalog
├── avatar/eyeColors.ts     EYE_COLORS map
├── avatar/materials.ts     materialsBySuffix / tintMaterial
├── avatar/applyParams.ts   applyParams / setFaceShape / setExpression
├── avatar/skinnedAttach.ts attachSkinned, AttachError
├── avatar/loadGlb.ts       loadGlbWithMToon
├── avatar/HairModel.tsx    loads + attaches + tints a hairstyle
├── avatar/AvatarModel.tsx  (modify) apply params on change, mount HairModel
├── store/useAppStore.ts    (modify) catalog slot
└── ui/dev/ParamsPanel.tsx  dev-only controls, mounted on #dev
tests/ mirrors src/ and tools/ (tools tests use `// @vitest-environment node`)
e2e/avatar.spec.ts
```

Source naming rules (`assets/source/README.md`): a base is a directory with `neutral.vrm`, optional `morphs/<param>.min.vrm` and `<param>.max.vrm` with identical topology to neutral (exported from the same VRoid project at a slider's extremes, or sculpted in Blender and exported with the VRM add-on), and `meta.json`. A hairstyle is a directory with `source.vrm` (any VRoid VRM; its hair is extracted) and `meta.json`.

---

### Task 1: GLB toolkit core — read/write, accessors, prune

**Files:**
- Create: `tools/glb/types.ts`, `tools/glb/glb.ts`, `tools/glb/accessors.ts`, `tools/glb/prune.ts`, `tools/test-fixtures/makeGlb.ts`
- Modify: `package.json` (add dev deps `tsx`, `@types/node` present; add `vitest` node-env projects if needed), `tsconfig.test.json` (include `tools`)
- Test: `tests/tools/glb/glb.test.ts`, `tests/tools/glb/accessors.test.ts`, `tests/tools/glb/prune.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type GltfJson = Record<string, any> & { asset: { version: string }; buffers?: any[]; bufferViews?: any[]; accessors?: any[]; meshes?: any[]; nodes?: any[]; skins?: any[]; materials?: any[]; textures?: any[]; images?: any[]; samplers?: any[]; extensions?: any; extensionsUsed?: string[] };
  export type GlbDoc = { json: GltfJson; bin: Uint8Array };
  // glb.ts
  export function readGlb(buf: Uint8Array): GlbDoc;            // throws Error('not a GLB') on bad magic
  export function writeGlb(doc: GlbDoc): Uint8Array;           // JSON chunk padded with 0x20 to 4 bytes, BIN with 0x00; buffers[0].byteLength updated
  // accessors.ts
  export type TypedArray = Float32Array | Uint32Array | Uint16Array | Uint8Array;
  export function readAccessor(doc: GlbDoc, index: number): TypedArray;   // de-strides into a tight copy
  export function appendAccessor(doc: GlbDoc, data: TypedArray, type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4', opts?: { minMax?: boolean; target?: 34962 | 34963 }): number;
  // prune.ts
  export function pruneUnused(doc: GlbDoc): GlbDoc;   // new doc; drops unreferenced materials/textures/images/samplers/accessors/bufferViews, rebuilds BIN, remaps every reference site including VRMC_materials_mtoon texture infos and VRMC_vrm.meta.thumbnailImage
  // makeGlb.ts (test fixture)
  export function makeGlb(opts?: { withHair?: boolean; morphTargets?: number }): GlbDoc;  // two skinned meshes 'Body' (prims Body_00_SKIN, Tops_01_CLOTH, HairBack_00_HAIR when withHair) and 'Face' (prim Face_00_SKIN, `morphTargets` dummy targets named Fcl_*), optional 'Hair' mesh, 3-joint skin [J_Bip_C_Hips, J_Bip_C_Head, J_Sec_Hair1_01], one 2×2 PNG per material, VRMC_vrm.humanoid.head and a VRMC_springBone spring on J_Sec_Hair1_01
  ```

- [ ] **Step 1: Write the failing tests**

`tests/tools/glb/glb.test.ts`:
```ts
// @vitest-environment node
test('round-trips a GLB byte-for-byte in structure', () => {
  const doc = makeGlb();
  const bytes = writeGlb(doc);
  expect(bytes.byteLength % 4).toBe(0);
  const back = readGlb(bytes);
  expect(back.json).toEqual(doc.json);
  expect(back.bin.byteLength).toBe(doc.json.buffers[0].byteLength);
});
test('rejects a non-GLB buffer', () => {
  expect(() => readGlb(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a GLB/);
});
test('reads the real sample VRM when present', () => {   // skipped when the file is missing
  const p = 'assets/source/base-a/neutral.vrm';
  if (!fs.existsSync(p)) return;
  const doc = readGlb(fs.readFileSync(p));
  expect(doc.json.extensionsUsed).toContain('VRMC_vrm');
});
```
`tests/tools/glb/accessors.test.ts`:
```ts
test('appendAccessor then readAccessor returns the same floats', () => {
  const doc = makeGlb();
  const data = new Float32Array([1, 2, 3, 4, 5, 6]);
  const idx = appendAccessor(doc, data, 'VEC3', { minMax: true });
  expect(doc.json.accessors[idx]).toMatchObject({ type: 'VEC3', componentType: 5126, count: 2, min: [1, 2, 3], max: [4, 5, 6] });
  expect(Array.from(readAccessor(doc, idx))).toEqual([1, 2, 3, 4, 5, 6]);
  expect(doc.bin.byteLength % 4).toBe(0);
});
test('readAccessor de-strides interleaved data', () => {
  // build a bufferView with byteStride 16 holding VEC3 floats + 4 pad bytes per element
  ...
  expect(Array.from(readAccessor(doc, idx))).toEqual([1, 2, 3, 4, 5, 6]);
});
```
`tests/tools/glb/prune.test.ts`:
```ts
test('drops an unreferenced material, its texture and image, and rebuilds the BIN', () => {
  const doc = makeGlb({ withHair: true });
  const body = doc.json.meshes.find((m) => m.name === 'Body');
  body.primitives = body.primitives.filter((p) => !doc.json.materials[p.material].name.endsWith('_HAIR'));
  const out = pruneUnused(doc);
  expect(out.json.materials.map((m) => m.name)).not.toContain('HairBack_00_HAIR');
  expect(out.json.images.length).toBe(doc.json.images.length - 1);
  expect(out.bin.byteLength).toBeLessThan(doc.bin.byteLength);
  expect(out.json.extensions.VRMC_vrm.meta.thumbnailImage).toBe(out.json.images.findIndex((i) => i.name === 'Thumbnail'));
});
test('keeps every accessor a surviving primitive references and remaps indices', () => {
  const out = pruneUnused(makeGlb());
  for (const m of out.json.meshes) for (const p of m.primitives) for (const a of Object.values(p.attributes)) expect(out.json.accessors[a as number]).toBeDefined();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools` → FAIL: modules not found.

- [ ] **Step 3: Install `tsx` (`npm i -D tsx`), add `tools` to `tsconfig.test.json` include, write `makeGlb.ts`, then `glb.ts`, `accessors.ts`, `prune.ts`.**
  `pruneUnused` reference sites to walk: `meshes[].primitives[].{material, indices, attributes.*, targets[].*}`, `skins[].inverseBindMatrices`, `materials[].{pbrMetallicRoughness.{baseColorTexture,metallicRoughnessTexture}, normalTexture, occlusionTexture, emissiveTexture}.index`, `materials[].extensions.VRMC_materials_mtoon.{shadeMultiplyTexture, shadingShiftTexture, matcapTexture, rimMultiplyTexture, outlineWidthMultiplyTexture, uvAnimationMaskTexture}.index`, `textures[].{source, sampler}`, `images[].bufferView`, `extensions.VRMC_vrm.meta.thumbnailImage`, `animations` (none expected; if present, keep their accessors). Anything else referencing an accessor/bufferView is out of scope and would be a bug to surface, so throw if an unknown top-level array references `bufferView`.

- [ ] **Step 4: Run tests** — `npx vitest run tests/tools` → PASS. Then `npm run lint && npm run typecheck` → clean.

- [ ] **Step 5: Commit**
```bash
git add tools tests/tools package.json package-lock.json tsconfig.test.json
git commit -m "feat(tools): VRM-aware GLB toolkit — read/write, accessors, prune"
```

---

### Task 2: Base build — remove hair, neutralise textures, add morph targets, CLI

**Files:**
- Create: `tools/glb/removeHair.ts`, `tools/glb/textures.ts`, `tools/glb/addMorphTargets.ts`, `tools/build-base.ts`, `tools/synth-variants.ts`, `tools/fetch-dev-samples.sh`, `assets/source/README.md`, `assets/source/base-a/meta.json`
- Delete: `tools/fetch-placeholder-vrm.sh`
- Modify: `.gitignore` (`assets/source/**/*.vrm`, `public/assets/**/*.vrm`, `public/assets/**/*.glb`, `public/assets/catalog.json`), `package.json` scripts, `assets/LICENSES.md` (paths), `.github/workflows/ci.yml` (fetch + build steps), `README.md`
- Test: `tests/tools/glb/removeHair.test.ts`, `tests/tools/glb/textures.test.ts`, `tests/tools/glb/addMorphTargets.test.ts`, `tests/tools/build-base.test.ts`

**Interfaces:**
- Consumes: Task 1 toolkit.
- Produces:
  ```ts
  export function removeHair(doc: GlbDoc): GlbDoc;   // clears node.mesh on nodes whose mesh is named 'Hair'; drops Body primitives whose material name ends with '_HAIR'; drops VRMC_springBone springs whose every joint node name starts with 'J_Sec_Hair'; node indices unchanged; then pruneUnused
  export function getImage(doc: GlbDoc, name: string): Uint8Array;        // PNG bytes; throws if missing
  export function replaceImage(doc: GlbDoc, name: string, png: Uint8Array): void;  // appends a bufferView, repoints images[i].bufferView, sets mimeType image/png
  export function neutralizeImage(png: Uint8Array, mode: 'divideByMedian' | 'luminance'): Uint8Array;  // divideByMedian: per-channel divide by the median of opaque pixels, scaled so the median lands at 0.85; luminance: Rec.709 grey, scaled so the median lands at 0.75
  export function resizeImage(png: Uint8Array, maxSize: number): Uint8Array;  // bilinear downscale when either side > maxSize; unchanged otherwise
  export class MorphTopologyError extends Error { mesh: string; primitive: number }
  export function addMorphTargets(doc: GlbDoc, variants: { name: string; doc: GlbDoc }[], opts?: { epsilon?: number }): GlbDoc;  // for every mesh: for every variant, POSITION and NORMAL deltas per primitive; a variant becomes a target on a mesh only if some primitive's max |delta| > epsilon (default 1e-6), and then on ALL primitives of that mesh (zero deltas where needed); appends names to mesh.extras.targetNames
  ```
  CLI contracts:
  - `tsx tools/build-base.ts --src assets/source/base-a --out public/assets/avatars/base-a.vrm [--webp] [--max-texture 1024]` → removeHair → neutralise `*_SKIN` (divideByMedian), `EyeIris_*` (luminance) images referenced by those materials → resize all images → addMorphTargets from `morphs/*.{min,max}.vrm` named `<param>_min|max` → optional WebP (sharp; adds `EXT_texture_webp`) → writeGlb; prints output size in bytes and the morph target names added.
  - `tsx tools/synth-variants.ts --src assets/source/base-a/neutral.vrm --out assets/source/base-a/morphs` → DEV ONLY; writes the 16 variant files by transforming Face mesh positions: `faceWidth` scale X about the face centroid ±8%; `jawWidth` scale X ±10% for vertices below the mouth line (y < centroid.y − 0.25·faceHeight); `chinLength` translate Y ∓4% of faceHeight for vertices below the chin line (y < centroid.y − 0.4·faceHeight); `noseWidth`/`noseLength` scale X / translate Z for vertices within a box around the nose (|x| < 0.08·faceWidth, |y − centroid.y| < 0.15·faceHeight, z > centroid.z + 0.3·faceDepth); `eyeSpacing` translate X ±3% outward for vertices with |x| > 0.15·faceWidth and y in the eye band (centroid.y + 0.05..0.3·faceHeight); `eyeSize` scale about each eye centre ±10% in that band; `lipFullness` scale Y ±15% of the mouth band (y in centroid.y − 0.25..−0.1·faceHeight, |x| < 0.25·faceWidth). Crude by design; prints a reminder that real variants must come from VRoid/Blender.
  - `tools/fetch-dev-samples.sh` → `assets/source/base-a/neutral.vrm` (VRM1_Constraint_Twist_Sample) and `assets/source/hair/hair_seed_01/source.vrm` (Seed-san); idempotent; header-checked.
  - Scripts: `assets:fetch-dev`, `assets:synth`, `assets:base`, `assets:hair` (Task 3), `assets:catalog` (Task 4), `assets` = base + hair + catalog, `assets:dev` = fetch-dev + synth + assets.

- [ ] **Step 1: Write the failing tests**

`removeHair.test.ts`:
```ts
test('removes the Hair mesh, hair primitives and hair springs but keeps node indices', () => {
  const doc = makeGlb({ withHair: true });
  const headIndexBefore = doc.json.extensions.VRMC_vrm.humanoid.humanBones.head.node;
  const out = removeHair(doc);
  expect(out.json.nodes.length).toBe(doc.json.nodes.length);
  expect(out.json.extensions.VRMC_vrm.humanoid.humanBones.head.node).toBe(headIndexBefore);
  expect(out.json.nodes.find((n) => n.name === 'Hair').mesh).toBeUndefined();
  expect(out.json.meshes.find((m) => m.name === 'Body').primitives.map((p) => out.json.materials[p.material].name)).toEqual(['Body_00_SKIN', 'Tops_01_CLOTH']);
  expect(out.json.extensions.VRMC_springBone.springs).toHaveLength(0);
});
```
`textures.test.ts`:
```ts
test('divideByMedian lifts a skin texture to a neutral tone and keeps alpha', () => {
  const png = solidPng(8, 8, [200, 150, 130, 255]);  // helper in the test
  const out = decode(neutralizeImage(png, 'divideByMedian'));
  expect(out.data[0]).toBeCloseTo(0.85 * 255, -1); expect(out.data[1]).toBeCloseTo(0.85 * 255, -1); expect(out.data[3]).toBe(255);
});
test('luminance produces grey pixels', () => {
  const out = decode(neutralizeImage(solidPng(4, 4, [120, 60, 30, 255]), 'luminance'));
  expect(out.data[0]).toBe(out.data[1]); expect(out.data[1]).toBe(out.data[2]);
});
test('resizeImage caps the long edge', () => {
  const { width, height } = decode(resizeImage(solidPng(2048, 1024, [1, 2, 3, 255]), 1024));
  expect([width, height]).toEqual([1024, 512]);
});
test('replaceImage swaps bytes for a named image', () => {
  const doc = makeGlb(); const png = solidPng(2, 2, [9, 9, 9, 255]);
  replaceImage(doc, 'Body_00', png);
  expect(Buffer.from(getImage(doc, 'Body_00')).equals(Buffer.from(png))).toBe(true);
});
```
`addMorphTargets.test.ts`:
```ts
test('adds POSITION/NORMAL deltas as a named target on every primitive of an affected mesh', () => {
  const base = makeGlb(); const variant = makeGlb();
  // move Face vertex 0 by +0.1 in x inside variant
  ...
  const out = addMorphTargets(base, [{ name: 'faceWidth_max', doc: variant }]);
  const face = out.json.meshes.find((m) => m.name === 'Face');
  expect(face.extras.targetNames.at(-1)).toBe('faceWidth_max');
  for (const p of face.primitives) expect(p.targets.at(-1)).toHaveProperty('POSITION');
  const delta = readAccessor(out, face.primitives[0].targets.at(-1).POSITION);
  expect(delta[0]).toBeCloseTo(0.1);
  expect(out.json.meshes.find((m) => m.name === 'Body').primitives[0].targets ?? []).toHaveLength(0);  // unaffected mesh gets nothing
});
test('preserves existing expression targets and their indices', () => {
  const base = makeGlb({ morphTargets: 3 }); const variant = makeGlb({ morphTargets: 3 }); /* perturb Face */
  const out = addMorphTargets(base, [{ name: 'jawWidth_min', doc: variant }]);
  const face = out.json.meshes.find((m) => m.name === 'Face');
  expect(face.extras.targetNames.slice(0, 3)).toEqual(base.json.meshes.find((m) => m.name === 'Face').extras.targetNames);
  expect(face.primitives[0].targets).toHaveLength(4);
});
test('throws MorphTopologyError naming mesh and primitive when vertex counts differ', () => {
  const base = makeGlb(); const variant = makeGlb(); /* drop one Face vertex in variant */
  expect(() => addMorphTargets(base, [{ name: 'x_max', doc: variant }])).toThrow(MorphTopologyError);
  expect(() => addMorphTargets(base, [{ name: 'x_max', doc: variant }])).toThrow(/Face.*primitive 0/);
});
```
`build-base.test.ts` (integration; skips when `assets/source/base-a/neutral.vrm` is missing):
```ts
test('builds a base with 16 face morphs, no hair, and textures ≤1024', async () => {
  run('tsx tools/synth-variants.ts --src assets/source/base-a/neutral.vrm --out /tmp/kiss-morphs');
  run('tsx tools/build-base.ts --src assets/source/base-a --morphs /tmp/kiss-morphs --out /tmp/kiss-base.vrm');
  const doc = readGlb(fs.readFileSync('/tmp/kiss-base.vrm'));
  const face = doc.json.meshes.find((m) => m.name === 'Face');
  expect(face.extras.targetNames.filter((n) => /_(min|max)$/.test(n))).toHaveLength(16);
  expect(doc.json.nodes.find((n) => n.name === 'Hair').mesh).toBeUndefined();
  for (const img of doc.json.images) { const { width, height } = decode(getImage(doc, img.name)); expect(Math.max(width, height)).toBeLessThanOrEqual(1024); }
  expect(doc.json.extensions.VRMC_vrm.expressions.preset.happy.morphTargetBinds[0].index).toBe(3);  // unchanged
});
```
(`--morphs` overrides the default `<src>/morphs`.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/tools` → FAIL on the new files.

- [ ] **Step 3: Implement `removeHair.ts`, `textures.ts` (pngjs), `addMorphTargets.ts`, `build-base.ts`, `synth-variants.ts`, the fetch script, `assets/source/README.md`, `base-a/meta.json` (`{ "id": "a", "name": "Base A (dev placeholder)", "license": "VRM Public License 1.0 — dev only" }`), scripts and `.gitignore` entries.** WebP: `npm i -D sharp`; if it fails to install in the environment, implement `--webp` as a no-op with a warning and ledger it.

- [ ] **Step 4: Run the pipeline for real** — `npm run assets:dev` → prints morph names and the output size; `ls -la public/assets/avatars/base-a.vrm`. Then `npm run e2e` → the viewer still renders (it now loads the built base, bald). Record the size.

- [ ] **Step 5: Run tests, lint, typecheck** — all PASS.

- [ ] **Step 6: Update CI** (`ci.yml`: replace the placeholder fetch step with `npm run assets:dev`), `LICENSES.md` paths, README (assets section describes `assets/source` layout and `npm run assets:dev`). Commit:
```bash
git add -A
git commit -m "feat(tools): build-base — strip hair, neutralise textures, add face morph targets

Built base-a.vrm: <N> MB (budget 3 MB, spec §15)."
```

---

### Task 3: Hairstyle extraction and build

**Files:**
- Create: `tools/glb/extractHair.ts`, `tools/build-hair.ts`, `assets/source/hair/hair_twist_01/meta.json`, `assets/source/hair/hair_seed_01/meta.json`
- Modify: `tools/fetch-dev-samples.sh` (also link `hair_twist_01/source.vrm` to the base sample), `package.json` (`assets:hair`)
- Test: `tests/tools/glb/extractHair.test.ts`, `tests/tools/build-hair.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function extractHair(doc: GlbDoc, opts?: { headBoneName?: string }): GlbDoc;  // default 'J_Bip_C_Head'. Output GLB: nodes [scene root, joint named headBoneName, one mesh node 'Hair'], one skin { joints: [1], inverseBindMatrices: the source skin's IBM for the head joint }, one mesh whose primitives are the source 'Hair' mesh primitives plus Body primitives with '_HAIR' materials, JOINTS_0 rewritten to [0,0,0,0] and WEIGHTS_0 to [1,0,0,0]; hair images neutralised (luminance) and resized; extensionsUsed = ['VRMC_materials_mtoon'] (+ KHR_materials_unlit if any material used it); no VRMC_vrm, no springBone. Throws Error('no hair found') when there is nothing to extract.
  ```
  CLI: `tsx tools/build-hair.ts --src assets/source/hair --out public/assets/hair` → one `<hairId>.glb` per subdirectory with `source.vrm`; prints sizes.
  `meta.json` for hair: `{ "id": "hair_twist_01", "name": "Long straight with bangs", "base": "a", "tags": { "length": "long", "volume": "medium", "bangs": true, "parting": "center" }, "license": "VRM Public License 1.0 — dev only" }`; Seed-san: short, medium, bangs true, parting left.

- [ ] **Step 1: Write the failing tests**
```ts
test('extractHair produces a single-joint skin bound to the head and only hair primitives', () => {
  const out = extractHair(makeGlb({ withHair: true }));
  expect(out.json.skins).toHaveLength(1);
  expect(out.json.nodes[out.json.skins[0].joints[0]].name).toBe('J_Bip_C_Head');
  const mesh = out.json.meshes[0];
  expect(mesh.primitives.map((p) => out.json.materials[p.material].name).sort()).toEqual(['HairBack_00_HAIR', 'Hair_00_HAIR']);
  const joints = readAccessor(out, mesh.primitives[0].attributes.JOINTS_0);
  expect(new Set(Array.from(joints))).toEqual(new Set([0]));
  const weights = readAccessor(out, mesh.primitives[0].attributes.WEIGHTS_0);
  expect(weights[0]).toBe(1); expect(weights[1]).toBe(0);
  expect(out.json.extensions?.VRMC_vrm).toBeUndefined();
  expect(out.json.extensionsUsed).toContain('VRMC_materials_mtoon');
});
test('extractHair throws when the model has no hair', () => {
  expect(() => extractHair(makeGlb({ withHair: false }))).toThrow(/no hair/);
});
test('inverse bind matrix matches the source head joint IBM', () => { ... expect(Array.from(readAccessor(out, out.json.skins[0].inverseBindMatrices))).toEqual(Array.from(sourceHeadIbm)); });
```
`build-hair.test.ts` (skips without sources): runs the CLI into a temp dir, asserts two GLBs exist, each parses with `readGlb`, each image ≤1024, each file < 2 MB.

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `extractHair.ts` and `build-hair.ts`; write the two `meta.json` files; extend the fetch script.**
- [ ] **Step 4: Run** `npm run assets:hair` → two GLBs; `npm test` PASS; lint/typecheck clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(tools): extract hairstyles into head-bound GLBs"`.

---

### Task 4: Catalog schema, loader and builder

**Files:**
- Create: `src/catalog/catalog.ts`, `tools/build-catalog.ts`
- Modify: `src/store/useAppStore.ts` (catalog slot), `package.json` (`assets:catalog`, `assets`, `assets:dev`)
- Test: `tests/catalog/catalog.test.ts`, `tests/tools/build-catalog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const hairStyleSchema = z.object({ id: z.string(), name: z.string(), base: z.enum(['a', 'b']), url: z.string(), thumb: z.string().optional(),
    tags: z.object({ length: z.enum(['short', 'medium', 'long']), volume: z.enum(['low', 'medium', 'high']), bangs: z.boolean(), parting: z.enum(['left', 'center', 'right', 'none']) }) });
  export const catalogSchema = z.object({ version: z.literal(1), bases: z.array(z.object({ id: z.enum(['a', 'b']), name: z.string(), url: z.string() })), hair: z.array(hairStyleSchema) });
  export type Catalog = z.infer<typeof catalogSchema>;  export type HairStyle = z.infer<typeof hairStyleSchema>;
  export async function loadCatalog(url = '/assets/catalog.json'): Promise<Catalog>;   // fetch + parse; throws on invalid
  export function findHair(catalog: Catalog, id: string): HairStyle | undefined;
  // store additions
  catalog: Catalog | null; setCatalog: (c: Catalog) => void;
  ```
  CLI: `tsx tools/build-catalog.ts --source assets/source --public public/assets --out public/assets/catalog.json` → reads every `meta.json`, verifies the built file exists for each entry (error otherwise), writes `{ version: 1, bases: [{ id, name, url: '/assets/avatars/base-<id>.vrm' }], hair: [{ ...meta minus license, url: '/assets/hair/<id>.glb' }] }`, validated with `catalogSchema` before writing.

- [ ] **Step 1: Write the failing tests** — schema accepts a valid catalog and rejects a hair entry with an unknown tag value; `findHair` returns undefined for a missing id; builder test (skips without built assets) runs the CLI and parses the output with `catalogSchema`, expecting 1 base and 2 hairstyles; builder fails with a message naming the id when a `meta.json` has no built GLB.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run assets:dev` end-to-end → `public/assets/catalog.json`; tests, lint, typecheck PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: asset catalog schema, loader and builder"`.

---

### Task 5: Runtime — colours, face morphs, expression, hairstyle attach

**Files:**
- Create: `src/color/oklab.ts`, `src/avatar/eyeColors.ts`, `src/avatar/materials.ts`, `src/avatar/applyParams.ts`, `src/avatar/skinnedAttach.ts`, `src/avatar/loadGlb.ts`, `src/avatar/HairModel.tsx`
- Modify: `src/avatar/AvatarModel.tsx` (apply params on store change; mount `HairModel`), `src/scene/Viewer.tsx` (load catalog once into the store)
- Test: `tests/color/oklab.test.ts`, `tests/avatar/materials.test.ts`, `tests/avatar/applyParams.test.ts`, `tests/avatar/skinnedAttach.test.ts`

**Interfaces:**
- Consumes: `AvatarParams`, store, `Catalog`/`findHair` (Task 4).
- Produces:
  ```ts
  // color/oklab.ts
  export function hexToOklab(hex: string): { L: number; a: number; b: number };
  export function oklabToHex(lab: { L: number; a: number; b: number }): string;   // clamps to gamut, lowercase #rrggbb
  export function shadeFor(hex: string): string;      // L − 0.18, chroma × 1.10 (spec §6 shade rule)
  // avatar/eyeColors.ts
  export const EYE_COLORS: Record<AvatarParams['eyeColor'], string> = { brown: '#6b4423', darkBrown: '#3b2314', hazel: '#8f7032', green: '#4e7d44', blue: '#4a76b0', grey: '#7d838c' };
  // avatar/materials.ts
  export function materialsBySuffix(root: Object3D, suffix: string): MToonMaterial[];   // unique materials on Mesh descendants whose name endsWith(suffix); MToonMaterial from @pixiv/three-vrm
  export function tintMaterial(material: MToonMaterial, hex: string): void;   // color.set(hex); shadeColorFactor.set(shadeFor(hex)); material.needsUpdate not required
  export function mixHex(a: string, b: string, t: number): string;   // OKLab mix
  // avatar/applyParams.ts
  export const FACE_SHAPE_KEYS: (keyof AvatarParams['faceShape'])[];
  export function setFaceShape(root: Object3D, faceShape: AvatarParams['faceShape']): void;  // for each Mesh with morphTargetDictionary: weight w clamped to −1..1; `${key}_max` influence = max(w,0), `${key}_min` influence = max(−w,0); keys without targets ignored
  export function setExpression(vrm: VRM, expression: AvatarParams['expression']): void;  // zero all presets it manages (neutral, happy, relaxed, surprised, blinkLeft), then set the mapped one to 1; 'wink' → 'blinkLeft'; 'neutral' sets none
  export function applyParams(vrm: VRM, params: AvatarParams): void;   // skin: tint '_SKIN' materials; lips: '_FACE' material whose name startsWith 'FaceMouth' gets mixHex('#ffffff', lipTint, 0.35); brows: materials startsWith 'FaceBrow' tinted hairColor; eyes: '_EYE' materials startsWith 'EyeIris' tinted EYE_COLORS[eyeColor]; then setFaceShape; then setExpression. Hair tinting is HairModel's job.
  // avatar/skinnedAttach.ts
  export class AttachError extends Error { missingBones: string[] }
  export function attachSkinned(vrm: VRM, attachment: Object3D): { detach(): void };   // for each SkinnedMesh in attachment: bones = its skeleton.bones.map(b => vrm.scene.getObjectByName(b.name)); missing → AttachError (nothing attached); new Skeleton(bones, mesh.skeleton.boneInverses); mesh.bind(skeleton, mesh.bindMatrix); vrm.scene.add(mesh). detach removes meshes and disposes geometry/materials/textures.
  // avatar/loadGlb.ts
  export function loadGlbWithMToon(url: string): Promise<Group>;   // GLTFLoader + VRMLoaderPlugin so MToon materials resolve; returns gltf.scene
  // avatar/HairModel.tsx
  export function HairModel(props: { vrm: VRM; hairId: string; hairColor: string }): null;   // 'none' → nothing; unknown id (not in catalog) → console.warn once, nothing; loads via catalog url, attachSkinned, tints '_HAIR' materials; re-tints on hairColor change without reload; detaches on id change/unmount; AttachError → console.warn, nothing attached
  ```

- [ ] **Step 1: Write the failing tests**

`oklab.test.ts`: round-trip `#c68642` within ±1 per channel; `shadeFor('#c68642')` is darker (`L` lower by ≈0.18) and valid hex; `oklabToHex` clamps out-of-gamut.
`materials.test.ts` (plain three.js in jsdom):
```ts
test('materialsBySuffix finds unique MToon materials by name suffix', () => {
  const root = new Group(); const skin = new MToonMaterial(); skin.name = 'Body_00_SKIN';
  root.add(new Mesh(new BufferGeometry(), skin), new Mesh(new BufferGeometry(), skin), new Mesh(new BufferGeometry(), Object.assign(new MToonMaterial(), { name: 'Hair_00_HAIR' })));
  expect(materialsBySuffix(root, '_SKIN')).toEqual([skin]);
});
test('tintMaterial sets color and a darker shade', () => { tintMaterial(m, '#c68642'); expect('#' + m.color.getHexString()).toBe('#c68642'); expect(m.shadeColorFactor.getHexString()).toBe(shadeFor('#c68642').slice(1)); });
```
`applyParams.test.ts` (build a fake `vrm` = `{ scene, expressionManager }` where `scene` holds a Face mesh with `morphTargetDictionary` `{ faceWidth_min:0, faceWidth_max:1, Fcl_ALL_Joy:2 }` and `morphTargetInfluences` `[0,0,0]`, and `expressionManager` is a real `VRMExpressionManager` with registered `VRMExpression`s for neutral/happy/relaxed/surprised/blinkLeft):
```ts
test('positive faceWidth drives only the _max target', () => { setFaceShape(scene, { ...zero, faceWidth: 0.6 }); expect(influences).toEqual([0, 0.6, 0]); });
test('negative drives only _min', () => { setFaceShape(scene, { ...zero, faceWidth: -0.4 }); expect(influences).toEqual([0.4, 0, 0]); });
test('weights are clamped to −1..1', () => { setFaceShape(scene, { ...zero, faceWidth: 1.5 }); expect(influences[1]).toBe(1); });
test('expression targets are left untouched by setFaceShape', () => { influences[2] = 1; setFaceShape(scene, zero); expect(influences[2]).toBe(1); });
test('setExpression resets the previous preset', () => { setExpression(vrm, 'happy'); setExpression(vrm, 'surprised'); expect(em.getValue('happy')).toBe(0); expect(em.getValue('surprised')).toBe(1); });
test('wink maps to blinkLeft and neutral clears all', () => { setExpression(vrm, 'wink'); expect(em.getValue('blinkLeft')).toBe(1); setExpression(vrm, 'neutral'); expect(em.getValue('blinkLeft')).toBe(0); });
test('applyParams is idempotent', () => { applyParams(vrm, p); const once = skin.color.getHex(); applyParams(vrm, p); applyParams(vrm, p); expect(skin.color.getHex()).toBe(once); });
test('applyParams tints skin, iris, brows and lips from params', () => { ... expect skin color = params.skin, iris = EYE_COLORS[params.eyeColor], brow = params.hairColor, mouth = mixHex('#ffffff', params.lipTint, 0.35) });
```
`skinnedAttach.test.ts` (plain three.js: a `vrm` stub `{ scene }` with bones `J_Bip_C_Hips` → `J_Bip_C_Head`; an attachment with a SkinnedMesh whose skeleton has one bone named `J_Bip_C_Head`):
```ts
test('rebinds to the avatar bone with the same name and adds the mesh to vrm.scene', () => { const h = attachSkinned(vrm, attachment); expect(mesh.skeleton.bones[0]).toBe(headBone); expect(mesh.parent).toBe(vrm.scene); h.detach(); expect(mesh.parent).toBeNull(); });
test('throws AttachError listing missing bones and attaches nothing', () => { /* bone named J_Nope */ expect(() => attachSkinned(vrm, attachment)).toThrow(AttachError); try { ... } catch (e) { expect((e as AttachError).missingBones).toEqual(['J_Nope']); } expect(vrm.scene.children).not.toContain(mesh); });
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the six source files; wire `AvatarModel` to `useAppStore.subscribe` (apply on any `params` change once `vrm` exists, and once right after load) and render `<HairModel vrm={vrm} hairId={params.hair} hairColor={params.hairColor} />`; `Viewer` loads the catalog on mount (`loadCatalog().then(setCatalog)`, warn on failure — hair then stays `none`).
- [ ] **Step 4: Run tests, lint, typecheck** — PASS. `npm run e2e` still green (default params: hair `none`, so the built base renders bald with default skin).
- [ ] **Step 5: Commit** — `git commit -m "feat(avatar): apply params — tints, face morphs, expressions, hairstyle attach"`.

---

### Task 6: Dev params panel and visual e2e

**Files:**
- Create: `src/ui/dev/ParamsPanel.tsx`, `src/ui/dev/devFlag.ts`, `e2e/avatar.spec.ts`
- Modify: `src/App.tsx` (mount panel when dev flag). `defaultParams.hair` stays `'none'`; the panel selects hair.
- Test: `tests/ui/ParamsPanel.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function isDevPanelEnabled(loc: Location = location): boolean;   // import.meta.env.DEV || loc.hash === '#dev'
  export function ParamsPanel(): JSX.Element;   // controls bound to the store: color inputs skin/hairColor/lipTint (data-testid `param-skin` etc.), select eyeColor, select hair (options: none + catalog.hair for current base), select expression, range −1..1 step 0.05 per FACE_SHAPE_KEYS (data-testid `param-faceShape-<key>`), button 'Reset'. When the dev flag is on, also `window.__kiss = { store: useAppStore }` for tests.
  ```

- [ ] **Step 1: Write the failing tests**

`ParamsPanel.test.tsx`: renders a range per `FACE_SHAPE_KEYS` (8); changing `param-faceShape-jawWidth` to `0.5` updates `store.params.faceShape.jawWidth`; hair select lists `none` plus catalog entries for base `a` only (seed a catalog with one `a` and one `b` entry); Reset restores `defaultParams`.

`e2e/avatar.spec.ts` (helper `setParams(page, patch)` → `page.evaluate(p => window.__kiss.store.getState().setParams(p), patch)`; `shot(page)` → portrait-ish screenshot of the canvas after `page.waitForTimeout(400)`; `diffPixels(a, b)` in `e2e/helpers/png.ts` counting pixels whose RGB differs by > 24 in any channel):
```ts
test.beforeEach(async ({ page }) => { await page.goto('/#dev'); await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', { timeout: 45_000 }); });
test('face morphs change the render', async ({ page }) => {
  await setParams(page, { faceShape: { ...zero, faceWidth: -1 } }); const a = await shot(page);
  await setParams(page, { faceShape: { ...zero, faceWidth: 1 } });  const b = await shot(page);
  expect(diffPixels(a, b)).toBeGreaterThan(300);
});
test('skin tone changes the render', async ({ page }) => { light vs dark skin → diffPixels > 2000 });
test('a hairstyle attaches, tints, and detaches', async ({ page }) => {
  const bald = await shot(page);
  await setParams(page, { hair: 'hair_twist_01', hairColor: '#2b1b12' }); await page.waitForTimeout(1500); const dark = await shot(page);
  expect(diffPixels(bald, dark)).toBeGreaterThan(2000);
  await setParams(page, { hairColor: '#e8c872' }); const blonde = await shot(page);
  expect(diffPixels(dark, blonde)).toBeGreaterThan(500);
  await setParams(page, { hair: 'none' }); await page.waitForTimeout(500);
  expect(diffPixels(await shot(page), bald)).toBeLessThan(100);
});
test('an unknown hair id leaves the avatar ready and bald', async ({ page }) => {
  const warnings: string[] = []; page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await setParams(page, { hair: 'does_not_exist' }); await page.waitForTimeout(500);
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready');
  expect(warnings.some((w) => w.includes('does_not_exist'))).toBe(true);
});
test('expressions change the face', async ({ page }) => { neutral vs surprised → diffPixels > 100 });
```
- [ ] **Step 2: Run to verify failure** (unit: module missing; e2e: `window.__kiss` undefined).
- [ ] **Step 3: Implement** `devFlag.ts`, `ParamsPanel.tsx` (plain inputs, fixed-position panel on the left, no styling beyond legibility), mount in `App`, add `diffPixels` helper.
- [ ] **Step 4: Run** `npm run ci` → all green. Save one screenshot each of: bald base, with `hair_twist_01` dark, blonde, `faceWidth` −1 and +1 — into `/tmp` for the human check.
- [ ] **Step 5: Commit** — `git commit -m "feat(dev): params panel and visual e2e for the avatar pipeline"`.

---

## Self-review notes

- Spec §7 coverage: hair removal ✔ T2; textures neutralised and tinted at runtime ✔ T2/T5; 8 morph pairs with min/max mapping ✔ T2/T5; expression morphs preserved ✔ T2 test; skin → MToon color + shade ✔ T5; eyes/lips/brows ✔ T5; hair separate, head-bound, no physics ✔ T3/T5. §12 pipeline scripted and idempotent ✔ T2–T4; textures ≤1024 ✔ T2/T3; licences ✔ T2. §8 `hidesHair` on head items is M2 (no head items yet). Region-ID texture and base-layer bake are M2 (wardrobe needs them; nothing in M1 does). Brow shape/thickness decals are M1b (they come from analysis).
- Names cross-checked: `readGlb/writeGlb/readAccessor/appendAccessor/pruneUnused/removeHair/addMorphTargets/extractHair/getImage/replaceImage/neutralizeImage/resizeImage`, `MorphTopologyError`, `AttachError`, `attachSkinned`, `materialsBySuffix/tintMaterial/mixHex`, `setFaceShape/setExpression/applyParams/FACE_SHAPE_KEYS`, `loadCatalog/findHair/catalogSchema/hairStyleSchema`, `HairModel`, `isDevPanelEnabled`, `window.__kiss`.
- Review Focus 1–5 each have a test (T2, T5, T6, T5, T5).
- Known dev-only compromises to ledger at execution: synthetic morph variants (real ones need the user's VRoid project or Blender work); dev samples under VPL 1.0; `--webp` depends on `sharp` installing.
