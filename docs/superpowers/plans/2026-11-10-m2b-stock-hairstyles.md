# M2b Stock Hairstyles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship MakeHuman's 10 CC0 stock hairstyles as hairstyle assets per spec §8. They should be selectable in the dev panel, tinted by `hairColor`, following body morphs and height, with a default hairstyle so the avatar is no longer bald.

**Architecture:**
- **Build.** The existing Blender base build (`tools/blender/build_base.py`) adds each hair `.mhclo` to the same human before the T-pose bake, so hair shares the base's skeleton and rest pose exactly. After the body shapes are baked, each hairstyle captures every body shape key through a Surface Deform (the existing `capture_shape_keys`). Each hairstyle is exported as its own skinned GLB and then removed before the VRM export, so base.vrm is unchanged.
- **Post-processing.** `tools/build-base.ts` post-processes each GLB (neutralise to grey, ≤1024², sparse morphs, WebP, prune, validate, size gate) into `public/assets/hair/`. Sidecars in `assets/source/hair/<id>/meta.json` feed the existing catalog builder.
- **Runtime.** `HairModel` loads plain GLBs with standard materials, tints them like the brows, applies the current body morphs on attach, and reports what is attached.

**Tech Stack:** Blender 4.5 + MPFB 2 (project-local `.blender/`), Python unittest via `npm run test:blender`, TypeScript tools (`tools/glb/*`, sharp), three.js / @pixiv/three-vrm runtime, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md`. The governing sections:
- §8: the hairstyle asset contract. Skinned to the base skeleton and bind pose, standard PBR, textures ≤1024², one morph target per `BodyMorph` direction made with Surface Deform, MakeHuman `.mhclo` hair as a source.
- §3: content.
- §12: licences.
- §16: milestones.

## Global Constraints

- **Node commands.** Prefix every npm/npx command with `export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH" &&`.
- **Git hygiene.**
  - Never stage or delete the untracked `scarlet.webp`. Stage explicit paths only.
  - End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.
- **Install locations.** Nothing is installed or written outside the repo. Don't touch `/Applications`, `~/Library/Application Support/Blender` or shell config.
- **Hair sources.** The 10 hairstyles are exactly MPFB `data/hair/{afro01,bob01,bob02,braid01,long01,ponytail01,short01,short02,short03,short04}`. Each `.mhclo` header states CC0 ("explicitly released as CC0 in september 2020").
- **Hair assets, from spec §8:**
  - A GLB whose `SkinnedMesh` is skinned to the base's own bone names and rest pose.
  - A standard PBR material.
  - Every texture ≤1024².
  - One morph target per name in `ALL_BODY_TARGETS` (`src/avatar/baseContract.ts`).
- **Size budgets.**
  - Each hairstyle GLB ≤ 1 MiB (`HAIR_BUDGET_BYTES = 1024 * 1024`). Spec §8 says 100–600 KB is typical; the gate allows headroom because meshopt is an M7 item (Ruling 31).
  - `base.vrm` stays ≤ 6 MiB, and its morph target names, materials and validation are unchanged by this plan.
- **Deferred.** Spec §8's head binding (three nearest head vertices plus weights) is deferred to M3, which builds the head fit that consumes it.

## Review Focus

1. **Switching hairstyles quickly** (dev panel scrubbing, or analysis changing hair while one loads). Only the last selected hairstyle ends up attached, and nothing leaks. Task 2 unit test.
2. **Long hair at body-shape extremes** (weight/bust/shoulders ±1). Hair over the shoulders follows the body, and hair on the head stays exactly where it was. Task 1 real-asset test: head-region hair vertices have zero deltas. Task 2 e2e: extremes with long01 stay ready.
3. **Changing height with hair on.** The hair scales with the avatar and stays on the head. Task 2 unit test: the attached meshes are children of `vrm.scene`, which carries the scale.
4. **Hair colour changes.** They never reload the mesh, and the tint lands on every hair material. Task 2 unit test.
5. **A hairstyle file that 404s or fails to parse.** The avatar stays ready and bald, with one warning. Task 2 unit test with a rejecting loader.

---

### Task 1: Hairstyle assets (Blender export, post-processing, catalog sidecars, licences)

**Files:**
- Modify: `tools/blender/build_base.py`, `tools/build-base.ts`, `package.json` (the `assets:base` script gains `--hair-out public/assets/hair`), `assets/LICENSES.md`, `assets/source/README.md`
- Create: `tools/base/buildHair.ts`, `tools/base/validateHair.ts`, `assets/source/hair/<id>/meta.json` (×10)
- Test: `tests/tools/base/validateHair.test.ts`, `tests/tools/build-base.test.ts` (real-asset cases), `tests/tools/build-catalog.test.ts`

**Interfaces:**
- Consumes:
  - `capture_shape_keys(source, obj, names)`, `bake_pose_as_rest(rig, meshes)`, `make_alpha_clip(material)` and `mpfb_service("HumanService").add_mhclo_asset(...)` (as `add_proxies` uses it), all in build_base.py.
  - `readGlb`/`writeGlb`, `neutralizeImage(png, 'luminance')`, `resizeImages`, `sparsifyMorphTargets(doc, { epsilon: 1e-6 })`, `convertImagesToWebp`, `pruneUnused` and `writeAtomically`, all in tools/.
  - `ALL_BODY_TARGETS`.
- Produces:
  - Blender writes `<work>/hair/<id>.glb`. The GLB holds the rig's armature plus one mesh named `Hair` with one material named `Hair` (alphaMode MASK). Its shape keys are named exactly as `ALL_BODY_TARGETS`.
  - `public/assets/hair/<id>.glb` for the 10 ids.
  - `validateHair(doc: GlbDoc, baseBoneNames: string[]): string[]`, which returns the list of problems (empty when valid).
  - `processHair(work: string, out: string, budgetBytes?: number): Promise<{ id: string; bytes: number }[]>` and `HAIR_BUDGET_BYTES`, both exported from `tools/base/buildHair.ts`.
  - Catalog entries `{ id, name, url: '/assets/hair/<id>.glb', tags }` from the sidecars.

- [ ] **Step 1: Write the failing tests**
  - `validateHair.test.ts`, against small in-memory GLB fixtures (use the existing fixture helpers in `tests/tools/glb` or build minimal JSON docs):
    - A doc with one skinned mesh, joints named from the base list, all `ALL_BODY_TARGETS` in `mesh.extras.targetNames`, MASK material and a 1024² image → `[]`.
    - A doc missing one body target → one problem naming that target.
    - A joint named `not_a_bone` → a problem naming it.
    - A 2048² image → a problem naming the image.
    - No skin → a problem.
  - `build-base.test.ts`, real-asset cases inside the existing `describe.skipIf(!fs.existsSync(BUILT))` pattern, gated on `public/assets/hair` existing:
    - All 10 `<id>.glb` exist.
    - Each is ≤ `HAIR_BUDGET_BYTES` and passes `validateHair` against the bone names read from `base.vrm`.
    - **Head still (Review Focus 2):** hair vertices whose skin weight on `head` is ≥ 0.999 have |delta| ≤ 1e-6 m in every body target.
    - `long01` has at least one vertex with |delta| > 1 mm in `body_shoulders_max` or `body_weight_max`, so the hair really follows the body.
  - `build-catalog.test.ts`: with a sidecar `hair/x/meta.json` and a built `hair/x.glb`, the catalog lists `{ id: 'x', url: '/assets/hair/x.glb', … }`, and the sidecar's `license` field is not copied into the catalog.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/tools`. Expected: FAIL (`validateHair` is not defined; the real-asset hair files are missing).

- [ ] **Step 3: Blender export in `build_base.py`.**
  - **Constant:** add `HAIRSTYLES = ("afro01", "bob01", "bob02", "braid01", "long01", "ponytail01", "short01", "short02", "short03", "short04")`.
  - **`add_hair(basemesh) -> dict[str, Object]`:** adds each `.mhclo` with `asset_type="hair"`, `subdiv_levels=0`, `material_type="GAMEENGINE"`.
    - If MPFB keeps only one hair per human, add, capture and export one hairstyle at a time instead. The result must be identical.
    - Afterwards, assert the basemesh is untouched by hair: same vertex count, and no new MASK/delete modifier (remove any the hair asset adds).
  - **Rest pose:** include the hair objects in `bake_pose_as_rest`.
  - **Body morphs:** after `bake_body_shapes` and before `delete_helper_vertices`, call `capture_shape_keys(basemesh, hair, contract["bodyTargets"])` for each hairstyle.
  - **`export_hair(rig, hair, path)`:**
    - Name the mesh and material `Hair`, and apply `make_alpha_clip` to the material.
    - glTF binary export of the rig plus that hair only: skins, shape keys, no animations, embedded images.
    - Writes `<work>/hair/<id>.glb`.
  - **Then:** delete the hair objects, so `rename`/`setup_vrm`/`export_vrm` see the same scene as before.
  - **Log:** one line per hairstyle with its vertex count.

- [ ] **Step 4: Post-processing.**
  - **`tools/base/buildHair.ts` → `processHair(work, out, budgetBytes = HAIR_BUDGET_BYTES)`.** For each `<work>/hair/*.glb`, run this chain and fail naming the id on any problem:
    1. read
    2. `neutralizeImage(…, 'luminance')` on the base-colour image (other images untouched)
    3. `resizeImages` to 1024
    4. `sparsifyMorphTargets` with epsilon 1e-6
    5. `convertImagesToWebp`
    6. `pruneUnused`
    7. `validateHair` against the bone names of the just-built `base.vrm`
    8. budget gate
  - **Writing:** write the files atomically into `out`. Leave other files in `out` alone: `public/assets/hair/` may hold the owner's untracked M1 leftovers.
  - **`tools/build-base.ts`:** takes `--hair-out` and calls `processHair` after the base passes its gate. Print each hairstyle's size.

- [ ] **Step 5: Sidecars, licences, docs.**
  - **Sidecars:** `assets/source/hair/<id>/meta.json` = `{ "id", "name", "tags": { length, volume, bangs, parting }, "license": "CC0-1.0" }` with the values in the table below.
    - Render each hairstyle from the front once (scratch script, not committed).
    - Correct `bangs`/`parting` if the render contradicts the table, and list every correction in the report.

    | id | name | length | volume | bangs | parting |
    |---|---|---|---|---|---|
    | afro01 | Short afro | short | high | false | none |
    | bob01 | Side-swept bob | medium | medium | true | left |
    | bob02 | Bob with fringe | medium | medium | true | none |
    | braid01 | Single braid | long | low | false | center |
    | long01 | Long straight | long | low | false | center |
    | ponytail01 | Ponytail | long | low | false | none |
    | short01 | Short crop | short | low | false | none |
    | short02 | Short textured | short | medium | false | none |
    | short03 | Short side-swept | short | medium | true | left |
    | short04 | Short slicked back | short | low | false | none |

  - **`assets/LICENSES.md`:** one row per hairstyle, CC0 1.0, citing the `.mhclo` header and the MPFB path. Run prettier on it.
  - **`assets/source/README.md`:** hair sidecars live in `hair/<id>/meta.json`; the geometry comes from MPFB at build time.

- [ ] **Step 6: Build and verify.**
  - `npm run assets:base && npm run assets:catalog` → exit 0, base.vrm ≤ 6 MiB, 10 hairstyles each ≤ 1 MiB, and the catalog lists 10 hairstyles.
  - `npx vitest run tests/tools && npm run test:blender` → PASS.
  - `npm run lint && npm run typecheck` → clean.

- [ ] **Step 7: Commit** (explicit paths)

```bash
git commit -m "feat(hair): MakeHuman's 10 CC0 stock hairstyles as skinned GLBs with body morphs; catalog sidecars and licences"
```

---

### Task 2: Hair in the app

**Files:**
- Modify:
  - `src/avatar/HairModel.tsx`
  - `src/avatar/loadGlb.ts`
  - `src/avatar/materials.ts` (remove the MToon helpers that become unused; keep `mixHex` if used)
  - `src/store/useAppStore.ts`
  - `src/catalog/params.ts` (default hair)
  - `e2e/avatar.spec.ts`
  - `docs/superpowers/specs/2026-11-08-dressup-game-design.md`
- Test: `tests/avatar/HairModel.test.tsx`, `tests/avatar/materials.test.ts` (trim), `tests/catalog/*` (default params)

**Interfaces:**
- Consumes:
  - `public/assets/hair/<id>.glb` from Task 1: mesh `Hair`, material `Hair` (MASK), morph targets named as `ALL_BODY_TARGETS`.
  - `attachSkinned(vrm, root)` and `applyBodyMorphs(root, body)`.
- Produces:
  - `loadGlb(url: string): Promise<Group>` (plain GLTFLoader). It replaces `loadGlbWithMToon`, which is removed.
  - Store field `attachedHair: string`. It is `'none'` when bald, and the hairstyle id once its meshes are attached. It is set only by `HairModel`, with setter `setAttachedHair(id: string)`.
  - `defaultParams.hair = 'bob02'`.

- [ ] **Step 1: Write the failing tests** (`HairModel.test.tsx`, with a mocked `loadGlb` returning a small skinned scene whose bones are named like the test VRM's):
  - **Attaches with the current colour and body:** with `hairColor '#aa3311'` and `body.weight 1`, every hair `MeshStandardMaterial.color` equals `#aa3311` and its `alphaToCoverage` is true. `body_weight_max` influence is 1 on the hair mesh. `attachedHair` becomes the id. Each attached mesh's parent is `vrm.scene` (Review Focus 3).
  - **Colour change keeps the mesh (Review Focus 4):** re-render with a new colour → same mesh object (no second `loadGlb` call) and the new colour.
  - **Quick switching (Review Focus 1):** switch `a → b` before `a`'s load resolves; resolve `a` after `b`. Only `b`'s meshes are in `vrm.scene`, `a`'s geometry is disposed, and `attachedHair === 'b'`.
  - **A failing load (Review Focus 5):** `loadGlb` rejects → no meshes added, one `console.warn` naming the id, `attachedHair === 'none'`.
  - **`'none'` detaches:** switching from an id to `'none'` removes the meshes and sets `attachedHair` to `'none'`.
  - **Default:** `defaultParams.hair === 'bob02'`.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/avatar/HairModel.test.tsx`.

- [ ] **Step 3: Implement.**
  - **`HairModel`:**
    - Load with `loadGlb`.
    - Hair materials = every `MeshStandardMaterial` in the loaded root. Set `color` to `hairColor` and `alphaToCoverage = true` (the canvas is antialiased), and keep the GLB's alphaTest/MASK and double-sidedness.
    - Attach with `attachSkinned`, then `applyBodyMorphs(vrm.scene, useAppStore.getState().params.body)`. Later body changes reach the hair through `applyParams`, because the hair meshes live in `vrm.scene`.
    - Set `attachedHair` after attach and on detach.
    - Keep the existing one-warning-per-unknown-id behaviour.
  - **Default:** `defaultParams.hair = 'bob02'`.
  - **Remove** `loadGlbWithMToon`, plus the MToon-only helpers and tests that nothing else uses (check with grep).

- [ ] **Step 4: e2e (`e2e/avatar.spec.ts`).** Wait for hair with `expect.poll(() => window.__kiss.store.getState().attachedHair).toBe(id)` in each case:
  - **"a hairstyle renders on the head":** portrait framing; `none` vs `bob02` differ by >2000 px.
  - **"hair colour tints the hair":** `bob02` at `#2b1b12` vs `#d9b380`, portrait framing, >1000 px.
  - **"every catalog hairstyle attaches":** for each id in `catalog.hair`, set it, the poll reaches the id, and `data-status` stays `ready`. Also assert there are no page errors.
  - **"long hair at body extremes stays ready":** `long01` with every signed morph +1 (gender 1), then −1. Each time `data-status` is `ready` and `attachedHair === 'long01'`.
  - **Keep "an unknown hair id leaves the avatar ready and bald"**, and add `attachedHair === 'none'` to it.
  - **Existing tests:** check them with the new default hair (portrait-framing expression diffs, the base-layer guard). Where hair intrudes on a sampled patch, set `hair: 'none'` in that test, and say so in the report.

- [ ] **Step 5: Spec.** Update `docs/superpowers/specs/2026-11-08-dressup-game-design.md`:
  - **§16:** an "M2b — stock hairstyles" line. MakeHuman's 10 CC0 hairstyles ship as a stopgap; M3's ≥3 realistic starter hairstyles still stand.
  - **Decision log**, entry dated 2026-11-10:
    - Stock hairstyles ship early on the owner's request.
    - The default hair is `bob02`.
    - Head binding moves to M3.
    - meshopt moves to M7.
  - **§8:** note that hairstyles are built by `tools/blender/build_base.py`, not `tools/build-garments.py`, until M4 adds garments.
  - Run prettier on the file.

- [ ] **Step 6: Verify.**
  - `npm run ci` → exit 0.
  - Screenshot full and portrait framing with `bob02`, `long01` and `afro01` at default params, and `long01` at weight +0.8. Hide the dev panel and save to the plan workspace. Say what you see: hair seated on the scalp with no gap or floating, no z-fighting with the scalp, the tint applied, and soft edges.

- [ ] **Step 7: Commit** (explicit paths)

```bash
git commit -m "feat(hair): stock hairstyles in the app — standard-material hair tinted by hairColor, following body morphs; default bob02"
```
