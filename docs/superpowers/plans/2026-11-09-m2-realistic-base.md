# M2 Realistic Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the VRoid cartoon base with a realistic MakeHuman base built headlessly in Blender (MPFB2 → VRM 1.0), with body-shape morphs, baked expressions, realistic skin with the base layer, height scaling and dev-panel body sliders, so the app renders a lifelike default avatar at any body shape.

**Architecture:** A project-local, pinned Blender toolchain (`.blender/`) runs `tools/blender/build_base.py`, which builds probe humans for every body-morph direction, bakes a T-posed base with body and expression shape keys, writes region and base-layer textures, and exports VRM 1.0 through the VRM add-on. `tools/build-base.ts` drives it, post-processes with the existing `tools/glb/` toolkit, validates the result against a shared naming contract (`src/avatar/baseContract.ts`), and writes `public/assets/base/`. At runtime, `AvatarParams` v2 drives morph influences, root scale and grounding, a composited skin texture, eye textures and VRM expressions.

**Tech Stack:** Blender 4.5.15 LTS (headless Python, numpy), MPFB 2.0.18, VRM Add-on for Blender 4.10.4, MakeHuman system assets (CC0), faceunits01 (CC0); TypeScript tools via `tsx`; `three` + `@pixiv/three-vrm` 3.5.5 (standard materials); `zod`; Vitest; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md` — §4, §5, §7, §12, §15 budgets, §16 M2. Research behind the toolchain choices (verified against MPFB2 and VRM add-on source): MPFB `HumanService`, `TargetService`, `RigService`, `ExportService` APIs; faceunits01 ARKit targets for expressions; VRM add-on `vrm_addon_extension` property groups and `export_scene.vrm`.

**Deferred on purpose (not in M2):**

- Bones do not follow body morphs (leg, arm and shoulder morphs move vertices, not joints). Rest-pose rendering is unaffected; M5 (posing) adds per-morph joint offsets from the build.
- Region transparency under garments (M4). M2 builds and ships `regions.png` only.
- Hair. The VRoid hairstyles cannot attach to the MakeHuman skeleton; the hair catalog is empty until M3 adds realistic hair.

## Global Constraints

- Node 22 (`.nvmrc`), TypeScript strict; `npm run ci` stays green after every task. The only exception is an e2e case parked with `test.fixme`, and the task that parks it names the task that restores it.
- Toolchain pins (all in `tools/blender/versions.env`, each download sha256-checked): Blender 4.5.15 LTS (macOS arm64 dmg sha256 `bfbc0bda099d1ab7aef0992a584f872f58bed9bb491210ad45f9ca071aa2e688`, macOS x64 `3801a97619292a012ede0e855ee705ae872a680474845297b777254f7f21ed78`; Linux x64 from `blender-4.5.15.sha256`), MPFB 2.0.18 (`c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad`), VRM add-on 4.10.4 (`a711da721878d319a76eaaf9dc72c40de6b96d4ed95766f30666ecf7ae492f5b`).
- The toolchain lives under `.blender/` (git-ignored) with `BLENDER_USER_RESOURCES` pointing inside it. Nothing is installed to `/Applications` or the user's Blender config.
- Body morphs (spec §5): `gender` 0..1 (0 feminine, default 0); `weight, muscle, shoulders, bust, waist, hips, legLength, armLength` −1..1; `heightCm` 140..210.
- Body morphs never move the head: deltas are zeroed above the neck, blended over the neck (spec §7).
- Base is VRM 1.0 with standard PBR materials, no `VRMC_materials_mtoon` (spec §4).
- Expressions (spec §9): `neutral`, `happy`, `relaxed`, `surprised`, `wink` → VRM `blinkLeft`.
- The base layer (undershirt over `torso`, shorts over `pelvis`) is always visible; the avatar is never undressed (spec §3).
- Textures ≤2048² for the body skin, ≤1024² for everything else (spec §12). `base.vrm` must be ≤6 MB (leaves 2 MB of the spec's 8 MB base + default outfit budget); the build fails above that.
- Built and downloaded binaries are never committed. `public/assets/**/*.vrm` is already ignored; add `public/assets/base/` and `.blender/`.
- Every third-party asset has a row in `assets/LICENSES.md`. MPFB and the VRM add-on are build-time only and not shipped.
- User-facing copy lives in `src/ui/strings.ts`; the dev panel may use literals.

## Review Focus

1. Every body slider at an extreme, alone and all at once (including `gender` 1 with `weight` +1) → the avatar stays `ready`, scale is finite and positive, feet stay on the floor, and metrics are finite. Tests: Task 8 (`avatarScale`/`groundOffset` with all extremes) and Task 10 (e2e "all body extremes keep the avatar grounded").
2. `heightCm` at 140 and 210 combined with `legLength` ±1 → rendered height equals `heightCm` within 1%. Tests: Task 8 unit and Task 10 e2e (head-bone height ratio).
3. A body morph combined with an expression → body keys never move head vertices, so the expression is unchanged. Test: Task 5 (Blender: every body key's delta is 0 for vertices with head weight ≥ 0.999).
4. Toolchain missing, wrong version or an asset pack absent → the build stops with a message naming what is missing and `npm run blender:setup`, and an existing `public/assets/base/base.vrm` is never replaced by a half-built one. Tests: Task 1 (smoke with empty user resources exits 1 with the message) and Task 3 (`writeAtomically` keeps the old file when validation fails).
5. The exporter silently drops an expression bind, a morph target name or an alpha mode (it still returns `FINISHED`) → the build fails naming each problem. Tests: Task 2 (one failing fixture per validator check).

---

## File structure

```
tools/blender/
├── versions.env        pinned versions, URLs, sha256s
├── setup.sh            idempotent: Blender + add-ons + asset packs into .blender/
├── env.sh              exports BLENDER and BLENDER_USER_RESOURCES
├── run.sh              run.sh <script.py> [-- args]: Blender --background with the env
├── mpfb.py             mpfb_service(name), require_toolchain()
├── smoke.py            prints "blender toolchain OK: …" or exits 1
├── print_paths.py      prints MPFB's user-data dir (used by setup.sh)
├── targets.py          pure: parse .target files, mix recipes, axis conversion
├── bake.py             pure: head mask, height and min-y deltas, region classification, UV rasteriser
├── build_base.py       the base build (Tasks 3–6)
├── run_tests.py        unittest runner for tools/blender/tests (exit 1 on failure)
└── tests/test_*.py     pure-Python tests run inside Blender's Python
tools/base/
├── validateBase.ts     validateBase(doc) → problems[]
└── writeAtomically.ts  temp file + rename
tools/build-base.ts     (rewrite) contract → Blender → post-process → validate → public/assets/base/
src/avatar/
├── baseContract.ts     names shared by build and runtime; BaseMeta schema; URLs
├── body.ts             applyBody, avatarScale, groundOffset
├── bodyTexture.ts      composeBodyAlbedo (pure) + SkinTexture (canvas → CanvasTexture)
├── baseMaterials.ts    standard-material lookups by contract name, eye textures
└── (modify) applyParams.ts, AvatarModel.tsx, loadVrm.ts; (delete) vroidNames.ts
public/assets/base/     base.vrm, base.json, baselayer.webp, regions.png, eyes/<preset>.webp (all built, ignored)
```

---

### Task 1: Pinned Blender toolchain

**Files:**

- Create: `tools/blender/versions.env`, `setup.sh`, `env.sh`, `run.sh`, `mpfb.py`, `smoke.py`, `print_paths.py`
- Modify:
  - `.gitignore`: add `.blender/`.
  - `package.json`: scripts `blender:setup` and `blender:smoke`.
  - `.github/workflows/ci.yml`, before the asset step:
    - `actions/cache` for `.blender`, keyed on `hashFiles('tools/blender/versions.env')`.
    - `sudo apt-get install -y libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libxkbcommon0 libsm6`.
    - `npm run blender:setup`.
    - `timeout-minutes: 45`.

**Interfaces:**

- Produces: `tools/blender/run.sh <script.py> [-- args…]` (exit code = script's); in Python, `from mpfb import mpfb_service, require_toolchain` after `sys.path.insert(0, <tools/blender>)`; `mpfb_service('HumanService')` returns the class from `bl_ext.<repo>.mpfb.services.<lower>`; `require_toolchain()` raises `SystemExit(1)` printing what is missing.
- Produces env (from `env.sh`): `BLENDER` (binary), `BLENDER_USER_RESOURCES=<repo>/.blender/user`, `MPFB_DATA` (MPFB user-data dir), `FACEUNITS_DIR=<repo>/.blender/packs/faceunits01`.

- [ ] **Step 1: Write `versions.env`** with `BLENDER_VERSION=4.5.15`, per-platform URLs under `https://download.blender.org/release/Blender4.5/` and the sha256s from Global Constraints; MPFB and VRM add-on URLs `https://extensions.blender.org/download/sha256:<sha>/add-on-mpfb-v2.0.18.zip` and `…/add-on-vrm-v4.10.4.zip`; `SYSTEM_ASSETS_URL=https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip` and `FACEUNITS_URL=https://files.makehumancommunity.org/functional/faceunits01.zip` with empty sha256s for now.

- [ ] **Step 2: Write `setup.sh`** (bash, `set -euo pipefail`, idempotent; skips steps whose output exists and verifies). Downloads go to `.blender/downloads/` with `curl --retry 5 --retry-delay 5 -fL` (the system-assets mirror is slow) and are checked with `shasum -a 256`; a mismatch deletes the file and exits 1. macOS: `hdiutil attach -nobrowse -readonly`, copy `Blender.app` to `.blender/Blender.app`, detach. Linux: extract the tarball to `.blender/blender`. Add-ons: `"$BLENDER" --command extension repo-list`; take the repository whose id is `user_default` and fail with the full listing if it is absent; then `"$BLENDER" --command extension install-file -r user_default --enable <zip>` for MPFB and the VRM add-on. Asset packs: `MPFB_DATA=$(run.sh print_paths.py)`, unzip the system assets into `$MPFB_DATA` (the zip already has a `packs/` root) and faceunits01 into `.blender/packs/faceunits01`. Finally run `smoke.py`.

- [ ] **Step 3: Write `mpfb.py`, `print_paths.py` and `smoke.py`.** `mpfb_service` searches `sys.modules` for a name ending in `mpfb.services.<lower>` (the pattern from MPFB's `script_samples`). `require_toolchain()` checks, in order: `bpy.app.version[:2] == (4, 5)`; an MPFB module is loaded with version 2.0.18; `hasattr(bpy.ops.export_scene, 'vrm')`; `<MPFB_DATA>/skins` has at least one `.mhmat`; `$FACEUNITS_DIR` contains `eyeBlinkLeft.target`. Each failure prints one line naming the missing piece plus "run `npm run blender:setup`" and exits 1. `smoke.py` calls it, then prints `blender toolchain OK: Blender 4.5.15, MPFB 2.0.18, VRM 4.10.4`.

- [ ] **Step 4: Run setup and the smoke test**

Run: `npm run blender:setup` (first run downloads ~900 MB). Then record the two pack sha256s it printed into `versions.env` and re-run it.
Expected: the last line is `blender toolchain OK: Blender 4.5.15, MPFB 2.0.18, VRM 4.10.4`; the second run downloads nothing.

- [ ] **Step 5: Verify the failure path**

Run: `BLENDER_USER_RESOURCES=$(mktemp -d) tools/blender/run.sh tools/blender/smoke.py; echo "exit=$?"`
Expected: a line naming MPFB as missing with "run `npm run blender:setup`", then `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add tools/blender .gitignore package.json .github/workflows/ci.yml
git commit -m "build(blender): pinned project-local Blender 4.5 + MPFB 2.0.18 + VRM add-on toolchain, cached in CI"
```

### Task 2: Naming contract and export validator

**Files:**

- Create: `src/avatar/baseContract.ts`, `tools/base/validateBase.ts`
- Modify: `src/catalog/params.ts` (add `BODY_MORPHS` and `BodyMorph` only; the schema change is Task 7)
- Test: `tests/avatar/baseContract.test.ts`, `tests/tools/base/validateBase.test.ts`

**Interfaces:**

- Produces in `src/catalog/params.ts`: `export const BODY_MORPHS = ['gender','weight','muscle','shoulders','bust','waist','hips','legLength','armLength'] as const; export type BodyMorph`.
- Produces in `src/avatar/baseContract.ts`:
  - `morphTargetNames(m: BodyMorph): string[]` → `['body_gender_max']` for gender, else `['body_<m>_min', 'body_<m>_max']`; `ALL_BODY_TARGETS: string[]`.
  - `EXPRESSION_TARGETS = { happy: 'ex_happy', relaxed: 'ex_relaxed', surprised: 'ex_surprised', blinkLeft: 'ex_blinkLeft' } as const`.
  - `BODY_MESH = 'Body'`; `MATERIALS = { skin: 'Skin', eyes: 'Eyes', brows: 'Brows', lashes: 'Lashes', teeth: 'Teeth', tongue: 'Tongue' } as const`; `MASKED_MATERIALS = ['Brows', 'Lashes']`.
  - `REGION_CODES: Record<Region, number>` = torso 1, pelvis 2, upperArms 3, forearms 4, thighs 5, calves 6, feet 7, neck 8 (0 = never hidden: head, hands).
  - `REQUIRED_HUMAN_BONES`: hips, spine, chest, neck, head, left/right UpperArm, LowerArm, Hand, UpperLeg, LowerLeg, Foot (VRM 1.0 names).
  - `baseMetaSchema` (zod) and `type BaseMeta = { version: 1; heightM: number; minY: number; morphHeightDelta: Record<string, number>; morphMinYDelta: Record<string, number> }` (keys are body target names; metres, glTF Y-up).
  - URLs: `BASE_URL = '/assets/base/base.vrm'`, `BASE_META_URL = '/assets/base/base.json'`, `BASE_LAYER_URL = '/assets/base/baselayer.webp'`, `REGIONS_URL = '/assets/base/regions.png'`, `eyeTextureUrl(preset: AvatarParams['eyeColor']) => '/assets/base/eyes/<preset>.webp'`.
  - `contractJson(): object`: everything above that the Blender build needs, as plain JSON (names, regions, bones, expression targets).
- Produces in `tools/base/validateBase.ts`: `validateBase(doc: GlbDoc, checks?: Partial<Record<BaseCheck, boolean>>): string[]` (empty = valid).
  - `type BaseCheck = 'vrm' | 'humanoid' | 'materials' | 'expressions' | 'bodyTargets'`; every check is on by default.
  - Task 3 turns off `expressions` and `bodyTargets`, Task 4 turns `expressions` back on, and from Task 5 every check runs.

- [ ] **Step 1: Write the failing tests.** `baseContract.test.ts`: `morphTargetNames('gender')` equals `['body_gender_max']`; `morphTargetNames('waist')` equals `['body_waist_min','body_waist_max']`; `ALL_BODY_TARGETS.length === 17`; `REGION_CODES` values are unique and in 1..8. `validateBase.test.ts` builds a `validBaseDoc()` (`GlbDoc` with JSON only, empty bin: VRMC_vrm `specVersion: '1.0'`, all required human bones, expressions with one bind each, a `Body` mesh whose `extras.targetNames` lists every body and expression target, the six named materials with Brows/Lashes `alphaMode: 'MASK'`). Then:
  - `validateBase(validBaseDoc())` equals `[]`.
  - Removing `leftFoot` → a problem containing `leftFoot`.
  - Emptying `blinkLeft.morphTargetBinds` → a problem containing `blinkLeft`.
  - Dropping `body_legLength_max` from targetNames → a problem containing `body_legLength_max`.
  - Adding `VRMC_materials_mtoon` to `Skin` → a problem containing `MToon`.
  - Setting `Lashes.alphaMode = 'BLEND'` → a problem containing `Lashes` and `MASK`.
  - `specVersion: '0.0'` (or VRM 0.x `VRM` extension) → a problem containing `1.0`.
  - With `blinkLeft` binds emptied and `{ expressions: false }` passed → `[]`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/avatar/baseContract.test.ts tests/tools/base/validateBase.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `baseContract.ts` and `validateBase.ts`.** The validator collects every problem (does not stop at the first), one line each, naming the item.

- [ ] **Step 4: Run them to see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/avatar/baseContract.ts src/catalog/params.ts tools/base tests/avatar/baseContract.test.ts tests/tools/base
git commit -m "feat(base): naming contract shared by build and runtime, VRM export validator"
```

### Task 3: First realistic base end to end

Builds the T-posed MakeHuman base with skin, rig and eye/brow/lash/teeth/tongue proxies, exports VRM 1.0, and switches the app to it. No morphs yet.

**Files:**

- Create: `tools/blender/build_base.py`, `tools/base/writeAtomically.ts`, `tests/tools/base/writeAtomically.test.ts`
- Rewrite: `tools/build-base.ts`; `tests/tools/build-base.test.ts` (integration; skips when `public/assets/base/base.vrm` is missing)
- Modify:
  - `src/avatar/loadVrm.ts`: `BASE_A_URL` removed; `AvatarModel` and `Viewer` use `BASE_URL`.
  - `package.json`:
    - `assets:base`: `tsx tools/build-base.ts --out public/assets/base`.
    - Drop `assets:synth` from `assets:dev`. It only fed the VRoid base.
  - `tools/build-catalog.ts` and `tests/tools/build-catalog.test.ts`: base `a` now points at `BASE_URL` and requires `public/assets/base/base.vrm`. Catalog v1 stays until Task 7; hair entries are untouched.
  - `.gitignore`: add `public/assets/base/`.
  - `e2e/avatar.spec.ts`:
    - Delete "face morphs change the render" (feature retired).
    - Delete "a hairstyle attaches, tints, and detaches". VRoid hair can't bind to the new skeleton; M3 brings hair back.
    - Park "expressions change the face" with `test.fixme`; Task 4 restores it.
    - Park "skin tone changes the render" with `test.fixme`; Task 9 restores it.

**Interfaces:**

- Consumes: Task 1 `run.sh`, `mpfb_service`, `require_toolchain`; Task 2 `contractJson`, `validateBase`.
- Produces: `python build_base.py -- --contract <json> --work <dir>` writes `<work>/base.vrm` (later tasks add `base.json`, `regions.png`, `baselayer.png` and `eyes/*.png`). `buildBase(opts: { out: string; budgetBytes?: number }): Promise<{ bytes: number; problems: string[] }>` in `tools/build-base.ts`. `writeAtomically(file: string, bytes: Uint8Array): void`.

- [ ] **Step 1: Write the failing tests.** `writeAtomically.test.ts` (node env, temp dir): writes the content; a throw between temp write and rename (inject via a `rename` stub option) leaves the previous file byte-identical and no temp file behind. `build-base.test.ts` (node env, `describe.skipIf(!fs.existsSync(out))`): `validateBase(readGlb(file), { expressions: false, bodyTargets: false })` is `[]` (Tasks 4 and 5 drop the flags); the Body mesh's bounding height (from the POSITION accessor min/max) is between 1.5 and 1.85 m; the `Eyes` mesh's mean z is greater than the `head` node's world z (the model faces +Z).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/tools/base/writeAtomically.test.ts tests/tools/build-base.test.ts`
Expected: FAIL (module missing; the integration test is skipped until the build exists).

- [ ] **Step 3: Implement `build_base.py` (base only).**
  - Create the human with `HumanService.create_human(scale=0.1, …)` using `get_default_macro_info_dict()` with `gender` 0.0.
  - `set_character_skin(<mhmat>, basemesh, skin_type='GAMEENGINE')`. Choose a young adult female skin of medium tone from `$MPFB_DATA/skins` and record its name as `SKIN_MHMAT` in the script.
  - `add_builtin_rig(basemesh, 'game_engine')`.
  - `add_mhclo_asset(…, material_type='GAMEENGINE')` for eyes, eyebrows, eyelashes, teeth and tongue; record the chosen asset names as constants.
  - Apply the rig's T-pose: use MPFB's pose-loading call for `rigs/standard/t-pose.json` if 2.0.18 exposes one, else set the rotations from that JSON on the pose bones.
  - Bake the T-pose as rest:
    1. For every mesh, `shape_key_remove(all=True, apply_mix=True)`.
    2. Remove Mask and Subdivision modifiers (remove, never apply).
    3. Apply the Armature modifier.
    4. `bpy.ops.pose.armature_apply(selected=False)`.
    5. Re-add the Armature modifiers.
  - Delete `HelperGeometry` and `JointCubes` vertices with bmesh. This keeps shape-key layers, which matters from Task 4 onward.
  - Rename objects and materials per the contract.
  - Alpha:
    - `Skin`: unlink the texture-alpha → Principled Alpha link, so the export is OPAQUE.
    - `Brows`/`Lashes`: route texture alpha through Math GREATER_THAN 0.5, so the export is MASK.
  - VRM setup:
    - `armature.data.vrm_addon_extension.spec_version = '1.0'` first.
    - Humanoid bones from a `GAME_ENGINE_TO_VRM` table. Confirm each name against MPFB's `rig.game_engine.json`: pelvis→hips, spine_01→spine, spine_02→chest, spine_03→upperChest, neck_01→neck, head, clavicle_l/r→left/rightShoulder, upperarm→UpperArm, lowerarm→LowerArm, hand→Hand, thigh→UpperLeg, calf→LowerLeg, foot→Foot, ball→Toes, plus finger chains.
    - `humanoid.pose = 'restPositionPose'`; meta name "Kiss base", authors "Kiss".
  - Run `bpy.ops.vrm.model_validate` and print its messages. Then call `bpy.ops.export_scene.vrm(filepath=…, armature_object_name=…)` and exit 1 unless it returns `{'FINISHED'}`.

- [ ] **Step 4: Implement `tools/build-base.ts`.**
  1. Write `contractJson()` to a temp dir.
  2. Spawn `tools/blender/run.sh tools/blender/build_base.py -- --contract … --work …`, inheriting stdio and failing on a non-zero exit.
  3. `readGlb`, `pruneUnused`, then `validateBase` with `{ expressions: false, bodyTargets: false }`. If there are any problems, throw listing them all.
  4. Enforce `budgetBytes` (default 6 MiB): throw with the size.
  5. `writeAtomically` to `<out>/base.vrm`, and print the size.

  Implement `writeAtomically`. Point the app at `BASE_URL`.

- [ ] **Step 5: Build and run the tests**

Run: `npm run assets:base && npm run assets:catalog && npm run ci`
Expected: the build prints `wrote public/assets/base/base.vrm (<size>)`; everything PASSES, with exactly the two parked e2e cases reported as fixme.

- [ ] **Step 6: Look at it.** `npm run dev`, open `/#dev`, screenshot full and portrait framing. The avatar should face the camera, stand in a T-pose on the floor, and show realistic skin with eyes, brows and lashes in place. Keep the screenshot for the commit description.

- [ ] **Step 7: Commit**

```bash
git add tools/blender/build_base.py tools/build-base.ts tools/build-catalog.ts tools/base tests/tools src/avatar src/scene e2e package.json .gitignore
git commit -m "feat(base): MakeHuman base built in Blender and exported as VRM 1.0; app loads it"
```

### Task 4: Expressions from faceunits01

**Files:**

- Create: `tools/blender/targets.py`, `tools/blender/run_tests.py`, `tools/blender/tests/test_targets.py`
- Modify:
  - `tools/blender/build_base.py`.
  - `package.json`:
    - `test:blender`: `./tools/blender/run.sh tools/blender/run_tests.py`.
    - Append `npm run test:blender` to `ci` after `npm test`.
  - `tools/build-base.ts` and `tests/tools/build-base.test.ts`: drop `expressions: false`.
  - `e2e/avatar.spec.ts`: restore "expressions change the face".

**Interfaces:**

- Produces in `targets.py`:
  - `parse_target(text: str) -> dict[int, tuple[float, float, float]]`: lines `idx dx dy dz`; skips blank lines and lines starting with `#`.
  - `to_blender(delta, scale: float) -> tuple`: MakeHuman (x, y, z) → Blender (x·s, −z·s, y·s).
  - `mix(targets: dict[str, dict[int, tuple]], recipe: dict[str, float]) -> dict[int, tuple]`: weighted sum of the named units.
  - `EXPRESSION_RECIPES`:
    - `happy`: mouthSmileLeft 0.8, mouthSmileRight 0.8, cheekSquintLeft 0.4, cheekSquintRight 0.4, eyeSquintLeft 0.2, eyeSquintRight 0.2
    - `relaxed`: mouthSmileLeft 0.3, mouthSmileRight 0.3, eyeBlinkLeft 0.25, eyeBlinkRight 0.25, browInnerUp 0.1
    - `surprised`: browInnerUp 0.7, browOuterUpLeft 0.6, browOuterUpRight 0.6, eyeWideLeft 0.8, eyeWideRight 0.8, jawOpen 0.35
    - `blinkLeft`: eyeBlinkLeft 1.0
- Produces in the VRM: shape keys `ex_happy`, `ex_relaxed`, `ex_surprised`, `ex_blinkLeft` on `Body` and on `Brows`, `Lashes`, `Teeth`, `Tongue` (not `Eyes`). Each VRM preset `happy|relaxed|surprised|blink_left` binds that key at weight 1.0 on every mesh that has it.

- [ ] **Step 1: Write the failing tests** (`test_targets.py`, `unittest`):
  - `parse_target("# c\n12 0.1 0.2 0.3\n\n7 -1 0 0\n")` equals `{12: (0.1, 0.2, 0.3), 7: (-1.0, 0.0, 0.0)}`.
  - `to_blender((1, 2, 3), 0.1)` equals `(0.1, -0.3, 0.2)` within 1e-9.
  - `mix({'a': {1: (1, 0, 0)}, 'b': {1: (0, 2, 0), 2: (0, 0, 1)}}, {'a': 0.5, 'b': 0.5})` equals `{1: (0.5, 1, 0), 2: (0, 0, 0.5)}`.
  - Every unit named in `EXPRESSION_RECIPES` exists as `<name>.target` in `$FACEUNITS_DIR`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:blender`
Expected: FAIL (`targets` module missing), exit code 1.

- [ ] **Step 3: Implement `targets.py` and `run_tests.py`** (discover `tools/blender/tests/test_*.py`; `sys.exit(0 if result.wasSuccessful() else 1)`).

- [ ] **Step 4: Bake expressions in `build_base.py`.**
  - Timing: after the T-pose rest bake, before helper deletion. The target indices address the full 19,158-vertex basemesh.
  - Add each recipe mix as a shape key on `Body`, scaling with the basemesh's own `scale_factor`, never a hard-coded 0.1.
  - Transfer to Brows, Lashes, Teeth and Tongue:
    1. Add a Surface Deform modifier targeting `Body` and bind it.
    2. For each `ex_*` key: set only that key to 1 on `Body`, evaluate the proxy, and store the evaluated coordinates as the proxy's key.
    3. Reset the key and remove the modifier.
  - Register the VRM binds through `vrm1.expressions.preset.<name>.morph_target_binds.add()`, setting `node.bpy_object`, `index` = key name and `weight` = 1.0.

- [ ] **Step 5: Run the Blender tests, the build and the expression e2e**

Run: `npm run test:blender && npm run assets:base && npx vitest run tests/tools/build-base.test.ts && npm run e2e -- e2e/avatar.spec.ts -g "expressions"`
Expected: PASS. Then screenshot each expression in portrait framing and check:

- `wink` closes the character's left eye (on screen right when facing the camera).
- The lashes follow the eyelid.
- Nothing pokes through the eyeballs.

Tune recipe weights if needed and note any changes in the commit message.

- [ ] **Step 6: Commit**

```bash
git add tools/blender tools/build-base.ts tests/tools e2e package.json
git commit -m "feat(base): happy/relaxed/surprised/blinkLeft baked from faceunits01 and bound as VRM presets"
```

### Task 5: Body-shape morphs and height data

**Files:**

- Create: `tools/blender/bake.py`, `tools/blender/tests/test_bake.py`
- Modify:
  - `tools/blender/build_base.py`.
  - `tools/build-base.ts`: run every validator check; validate and copy `base.json`.
  - `tests/tools/build-base.test.ts`: drop the last flag; `base.json` parses with `baseMetaSchema`.

**Interfaces:**

- Produces in `bake.py` (numpy arrays shaped `(N, 3)`, Blender Z-up):
  - `head_mask(head_weights: np.ndarray) -> np.ndarray`: returns `1 − clip(w, 0, 1)` per vertex.
  - `masked_delta(variant, base, mask) -> np.ndarray`.
  - `height_and_min(coords) -> tuple[float, float]`: (max z − min z, min z).
- Produces in `build_base.py`, a probe per target name. Each probe is a fresh human with the same base settings plus one change, rigged with `game_engine`, T-posed, evaluated, then deleted. The change per morph:

  | Morph                                          | How the probe is made                                                        |
  | ---------------------------------------------- | ---------------------------------------------------------------------------- |
  | `body_gender_max`                              | macro gender 1.0                                                             |
  | `body_weight_min/max`                          | macro weight 0.0 / 1.0                                                       |
  | `body_muscle_min/max`                          | macro muscle 0.0 / 1.0                                                       |
  | `body_bust_min/max`                            | macro cupsize 0.0 / 1.0                                                      |
  | `body_shoulders_min/max`                       | target `torso/measure-shoulder-dist-decr` / `-incr` at weight 1              |
  | `body_waist_min/max`                           | `torso/measure-waist-circ-decr` / `-incr`                                    |
  | `body_hips_min/max`                            | `torso/measure-hips-circ-decr` / `-incr`                                     |
  | `body_legLength_min/max`                       | `legs/measure-upperleg-height-decr` + `legs/measure-lowerleg-height-decr`, and the `-incr` pair |
  | `body_armLength_min/max`                       | `arms/measure-upperarm-length-decr` + `arms/measure-lowerarm-length-decr`, and the `-incr` pair |

  Confirm the macro keys in `get_default_macro_info_dict()` and each target path under MPFB's `data/targets`.
- Produces `<work>/base.json` matching `baseMetaSchema`: `heightM` and `minY` of the final Body; per target, `morphHeightDelta` and `morphMinYDelta` in metres. Convert Blender z to glTF y.

- [ ] **Step 1: Write the failing tests** (`test_bake.py`):
  - `head_mask(np.array([0, 0.5, 1, 1.2]))` equals `[1, 0.5, 0, 0]`.
  - `masked_delta` with base zeros, variant ones and mask `[1, 0]` gives `[[1,1,1],[0,0,0]]`.
  - `height_and_min(np.array([[0,0,-0.1],[0,0,1.6]]))` equals `(1.7, -0.1)`.

- [ ] **Step 2: Run them to see them fail** — `npm run test:blender`, expected FAIL.

- [ ] **Step 3: Implement `bake.py` and the probes in `build_base.py`.**
  - Head weights come from the final Body's `head` vertex group, plus `neck_01` at half weight.
  - Probe coordinates include helper vertices; drop them with the same index mask used for deletion before diffing.
  - Add each masked delta as a shape key named per the contract, after the expression keys and before helper deletion.
  - Log the largest error of four combined corners against a probe with both changes: gender+weight max, gender+muscle max, weight min+muscle max, weight max+bust max. This is informational and doesn't gate the build.
  - Add the post-build Blender assertion `assert_head_still(body)`: every body key's delta is ≤1e-6 m on vertices whose head weight is ≥0.999 (Review Focus 3).

- [ ] **Step 4: Run tests and the build**

Run: `npm run test:blender && npm run assets:base && npx vitest run tests/tools/build-base.test.ts`
Expected: PASS. The build log lists 17 body targets, the corner errors, and `head untouched by body morphs: OK`.

- [ ] **Step 5: Commit**

```bash
git add tools/blender tools/build-base.ts
git commit -m "feat(base): 17 body-shape targets from MakeHuman probes, head-masked; height metadata"
```

### Task 6: Skin, eyes, base layer, region IDs and the size budget

**Files:**

- Modify: `tools/blender/bake.py`, `tools/blender/tests/test_bake.py`, `tools/blender/build_base.py`, `tools/build-base.ts`, `tools/glb/textures.ts` (add `resizeImages(doc, maxFor: (imageName: string, materialName: string) => number)`), `tests/tools/glb/textures.test.ts`

**Interfaces:**

- Produces in `bake.py`:
  - `classify_regions(group_weights: dict[str, np.ndarray], z: np.ndarray, hem_z: float) -> np.ndarray[int]`: per vertex. The dominant group decides: spine_01–03 and clavicles → torso 1; pelvis → 2; thigh with z ≥ `hem_z` → pelvis 2; thigh below → thighs 5; upperarm → 3; lowerarm → 4; calf → 6; foot or ball → 7; neck_01 → 8; anything else (head, hands, fingers) → 0.
  - `face_regions(vertex_regions, faces) -> np.ndarray`: majority per face, ties broken toward the lower code.
  - `rasterise(uv_faces, values, size) -> np.ndarray[uint8]`: fills each face's UV polygon with its value, no antialiasing.
- Produces in `<work>/`:
  - `regions.png`: R channel = region code, 1024².
  - `baselayer.png`, 2048² RGBA: undershirt `#e9e6e1` on torso faces, shorts `#2f2f33` on pelvis faces, alpha 255 there and 0 elsewhere.
  - `eyes/<preset>.png` for the six presets. Map each to the nearest MakeHuman eye texture by hue and record the mapping in the script.
- Hem: `hem_z` = crotch height − 0.08 m. Crotch height is the lowest Body vertex in the pelvis group on the midline.
- Post-process in `tools/build-base.ts`:
  - Neutralise: `Skin` with `divideByMedian`; `Brows` and `Lashes` with `luminance`.
  - `resizeImages`: Skin 2048, everything else 1024.
  - Then `sparsifyMorphTargets`, `convertImagesToWebp`, `pruneUnused`, `validateBase` and the budget check.
  - Write `baselayer.webp` (quality 90), `regions.png` (kept PNG, lossless), and `eyes/<preset>.webp` at 512².
  - Print every output with its size.

- [ ] **Step 1: Write the failing tests.**
  - `test_bake.py`:
    - `classify_regions({'spine_02': [1, 0], 'thigh_l': [0, 1]}, z=[1.2, 0.85], hem_z=0.8)` equals `[1, 2]`.
    - The same call with z `[1.2, 0.7]` gives `[1, 5]`.
    - `face_regions([1, 1, 2, 0], [[0, 1, 2], [1, 2, 3]])` equals `[1, 0]`. The second face has one each of 1, 2 and 0, so the tie goes to the lower code.
    - `rasterise` of one triangle `[(0,0),(1,0),(0,1)]` with value 3 at size 8: pixel (1,1) is 3, pixel (7,7) is 0.
  - `textures.test.ts`: `resizeImages` with `maxFor` returning 2048 for Skin and 1024 otherwise leaves a 2048² Skin image at 2048 and shrinks a 2048² Brows image to 1024.

- [ ] **Step 2: Run them to see them fail**

Run: `npm run test:blender; npx vitest run tests/tools/glb/textures.test.ts`
Expected: both FAIL.

- [ ] **Step 3: Implement**, then build.

Run: `npm run test:blender && npx vitest run tests/tools && npm run assets:base`
Expected: PASS; `base.vrm` ≤ 6 MB; the build lists `base.json`, `baselayer.webp`, `regions.png` and 6 eye textures.

- [ ] **Step 4: Inspect `regions.png` and `baselayer.png`.** Open them and confirm:
  - The undershirt covers the whole torso.
  - The shorts cover the whole hip area down to the hem.
  - No skin gaps at the seams. Widen the masks by one UV pixel if there are gaps.

- [ ] **Step 5: Commit**

```bash
git add tools
git commit -m "feat(base): neutral skin, per-preset eye textures, base-layer and region-ID textures, 6 MB budget"
```

### Task 7: `AvatarParams` v2, catalog v2, attribute-only analysis retired

**Files:**

- Modify:
  - `src/catalog/params.ts`, `src/catalog/catalog.ts`, `tools/build-catalog.ts`.
  - `src/analysis/mapping/index.ts`, `src/analysis/mapping/hairstyle.ts`, `src/analysis/analyze.ts`.
  - `src/ui/dev/AnalysisPage.tsx`, `src/ui/dev/ParamsPanel.tsx` (the hair select drops its `base` filter), `src/ui/strings.ts`.
  - `tools/lineup.ts`.
  - `src/store/useAppStore.ts`: no behaviour change; types follow.
  - `package.json`:
    - `assets` = `npm run assets:base && npm run assets:catalog`.
    - `assets:dev` = `npm run blender:setup && npm run assets:models && npm run assets`. Setup is idempotent, so the extra CI run is a no-op.
    - Remove `assets:fetch-dev`, `assets:hair` and `assets:synth`.
- Delete:
  - `src/analysis/mapping/{brows,lips,faceShape}.ts`, `src/analysis/calibration.ts`, `src/analysis/calibration.json`, `tools/calibrate-canonical.ts`, and their tests.
  - `assets/source/base-a/` and `assets/source/hair/*` (the VRoid dev sources).
- Test: `tests/catalog/params.test.ts`, `tests/catalog/catalog.test.ts`, `tests/analysis/analyzeToParams.test.ts`, `tests/ui/AnalysisPage.test.tsx`, `tests/tools/build-catalog.test.ts`

**Interfaces:**

- Produces `avatarParamsSchema` v2 exactly as spec §5:
  - `body`: `heightCm` 140..210, `gender` 0..1, other morphs −1..1.
  - `face`: `'photo' | 'default'`.
  - `extras`: `{ glasses?: string }`.
  - Removed: `base`, `lipTint`, `brows`, `faceShape`.
  - `Region` gains `'pelvis'`.
  - `defaultParams.body = { heightCm: 165, gender: 0, …all others 0 }`; `face: 'default'`.
- Produces `catalogSchema` v2: `{ version: 2, base: { name, url, meta }, hair: HairStyle[] }`; `HairStyle` loses `base`.
- `rankHairstyles(tags, catalog)` loses its `base` parameter.
- `analyzeToParams` keeps skin, hair colour, eye colour and hairstyle. `AnalysisDebug` loses `ratios`, `zScores`, `brows` and `swatches.lips`. `AnalyzeOptions` loses `calibration` and `base`.

- [ ] **Step 1: Update the tests first.**
  - `params.test.ts`:
    - `defaultParams` parses.
    - `body.heightCm` 139 and 211 are rejected.
    - `body.gender` −0.1 is rejected.
    - `body.weight` 1.01 is rejected.
    - A v1-shaped object (with `faceShape`) is rejected.
  - `catalog.test.ts`: a v2 catalog parses; `version: 1` is rejected.
  - `analyzeToParams.test.ts`: the existing fixture still yields its skin, hair colour, eye colour and hair results; the params have no `faceShape` key.
  - `AnalysisPage.test.tsx`: the calibration buttons are gone.
  - `build-catalog.test.ts`: with no hair sources, `base.url` is `BASE_URL` and `hair` is `[]`; a missing `base.vrm` throws "run assets:base".

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/catalog tests/analysis tests/ui/AnalysisPage.test.tsx tests/tools/build-catalog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the schema changes, delete the retired modules, and fix every reference** until `npm run typecheck` passes. `grep -rn "faceShape\|lipTint\|calibration\|brows" src tools tests e2e` should return only intended hits, such as the word "brows" in eyebrow material names.

- [ ] **Step 4: Run the full unit suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src tools tests assets/source package.json
git commit -m "refactor(params): AvatarParams v2 and catalog v2; retire face-shape, brow, lip and calibration mapping"
```

### Task 8: Body morphs, height and grounding at runtime

**Files:**

- Create: `src/avatar/body.ts`, `tests/avatar/body.test.ts`
- Modify: `src/avatar/AvatarModel.tsx` (load `BaseMeta` from `BASE_META_URL` with `baseMetaSchema`, apply body, measure from the head bone and `heightCm`)

**Interfaces:**

- Consumes: `BaseMeta`, `morphTargetNames`, `BODY_MORPHS`.
- Produces:
  - `applyBodyMorphs(root: Object3D, body: AvatarParams['body']): void`:
    - Signed morph `w` (clamped to −1..1): `_max` = max(w, 0), `_min` = max(−w, 0).
    - `gender`: `_max` = clamp 0..1.
    - Applied on every mesh that has the targets.
  - `bodyInfluences(body): Record<string, number>`: the same mapping as data.
  - `avatarScale(body, meta: BaseMeta): number` = (`heightCm`/100) / (`meta.heightM` + Σ influence × `morphHeightDelta`).
  - `groundOffset(body, meta, scale): number` = −(`meta.minY` + Σ influence × `morphMinYDelta`) × scale.
  - `applyBody(vrm: VRM, body, meta): void`: morphs, then `vrm.scene.scale.setScalar(scale)` and `vrm.scene.position.y = groundOffset`.
  - Metrics after a body change: `{ headY: head bone world y, height: heightCm / 100 }`.

- [ ] **Step 1: Write the failing tests** (`body.test.ts`, with a fixture meta `{ heightM: 1.65, minY: 0, morphHeightDelta: { body_legLength_max: 0.18, body_legLength_min: -0.13 }, morphMinYDelta: { body_legLength_max: -0.1 } }`):
  - Influences:
    - `bodyInfluences({…zero, weight: 0.6}).body_weight_max === 0.6` and `body_weight_min === 0`.
    - `weight: -0.3` gives `body_weight_min === 0.3`.
    - `weight: 1.5` is clamped to 1.
    - `gender: 2` is clamped to 1.
  - Scale:
    - `avatarScale({…zero, heightCm: 165}, meta) === 1`.
    - With `legLength: 1`, it equals `1.65/1.83` within 1e-9.
  - Grounding: with `legLength: 1` at scale 1, `groundOffset` is `0.1`.
  - Review Focus 1: for every combination of all signed morphs at −1 or +1, with gender 0 or 1 and `heightCm` 140 or 210, `avatarScale` is finite and > 0 and `groundOffset` is finite.
  - Review Focus 2: `heightCm` 210 with `legLength: -1` → (`meta.heightM` + delta) × scale equals 2.10 within 1e-9.
  - `applyBodyMorphs` on a `Mesh` with `morphTargetDictionary` `{ body_waist_min: 0, body_waist_max: 1 }` and `waist: -0.4` sets influences `[0.4, 0]`.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/avatar/body.test.ts`, expected FAIL.

- [ ] **Step 3: Implement `body.ts` and wire `AvatarModel`.** Load meta alongside the VRM; a meta failure is an avatar load error. Re-apply the body and refresh metrics when `params.body` changes.

- [ ] **Step 4: Run** — `npx vitest run tests/avatar && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/avatar tests/avatar
git commit -m "feat(avatar): body morphs, height scaling and grounding from base metadata"
```

### Task 9: Standard-material skin, eyes and brows at runtime

**Files:**

- Create: `src/avatar/bodyTexture.ts`, `src/avatar/baseMaterials.ts`, `tests/avatar/bodyTexture.test.ts`, `tests/avatar/baseMaterials.test.ts`
- Modify: `src/avatar/applyParams.ts`, `tests/avatar/applyParams.test.ts`, `e2e/avatar.spec.ts` (restore "skin tone changes the render")
- Delete: `src/avatar/vroidNames.ts`, `tests/avatar/vroidNames.test.ts`. `HairModel` keeps its own hair-material matcher, moved into `HairModel.tsx`.
- Spec amendment: `docs/superpowers/specs/2026-11-08-dressup-game-design.md` §7. Eyes switch between six shipped eye textures instead of tinting a greyscale iris. The base layer ships as an overlay texture composited over the tinted skin at runtime, so the tint never colours it.

**Interfaces:**

- Produces in `bodyTexture.ts`:
  - `composeBodyAlbedo(skin: ImageData, baseLayer: ImageData, tint: string): ImageData`, a pure function on same-size inputs:
    - `out = skin × tint / 255` per RGB channel.
    - Then `baseLayer` is composited over it with its alpha (straight alpha).
    - Output alpha is 255.
  - `class SkinTexture { constructor(skinImage: CanvasImageSource, baseLayer: ImageData); update(tint: string): CanvasTexture }`: one 2048² canvas, reused; `colorSpace = SRGBColorSpace`, `flipY = false`.
- Produces in `baseMaterials.ts`:
  - `standardMaterial(root: Object3D, name: string): MeshStandardMaterial | undefined`.
  - `class EyeTextures { set(material: MeshStandardMaterial, preset): void }`: cached loads; the latest request wins if loads finish out of order.
- `applyParams(vrm, params, ctx: { skin: SkinTexture; eyes: EyeTextures; meta: BaseMeta })`:
  - Skin → the map from `skin.update`.
  - Eyes → `eyes.set`.
  - `Brows` and `Lashes` → `color.set(hairColor)`.
  - `applyBody`, then `setExpression`.
  - Idempotent.

- [ ] **Step 1: Write the failing tests.**
  - `bodyTexture.test.ts`, on 2×1 `ImageData`s:
    - Skin `(200,100,50)`, base-layer alpha 0, tint `#ffffff` → `(200,100,50,255)`.
    - The same with tint `#808080` → `(100,50,25)` ±1.
    - A pixel with base-layer `(233,230,225,255)` → exactly that colour, whatever the tint.
    - Base-layer alpha 128 → halfway between the two ±1.
  - `baseMaterials.test.ts`:
    - With two loads where the first resolves last, the material ends with the second texture. Use injected loader promises.
  - `applyParams.test.ts`:
    - Applying the same params twice leaves `Brows.color` and the skin canvas pixels identical to applying once.
    - Morph influences match `bodyInfluences`.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/avatar`, expected FAIL.

- [ ] **Step 3: Implement**, and wire `AvatarModel`:
  - Load `BASE_LAYER_URL` into `ImageData`.
  - Build `SkinTexture` from the Skin material's loaded map image.
  - Pass the context to `applyParams`.
  - Dispose the canvas texture on unmount.
  - Apply the spec amendment.

- [ ] **Step 4: Run** — `npx vitest run tests/avatar && npm run typecheck && npm run e2e -- e2e/avatar.spec.ts -g "skin tone"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/avatar tests/avatar e2e docs/superpowers/specs/2026-11-08-dressup-game-design.md
git commit -m "feat(avatar): skin tint composited under the base layer, eye texture presets, brow/lash tint"
```

### Task 10: Dev panel body sliders and the e2e suite

**Files:**

- Modify: `src/ui/dev/ParamsPanel.tsx`, `tests/ui/ParamsPanel.test.tsx`, `e2e/avatar.spec.ts`, `e2e/export.spec.ts` (only if it references removed params)

**Interfaces:**

- Consumes: `BODY_MORPHS`, `defaultParams`.
- Produces test ids:
  - `param-body-heightCm` (range 140..210, step 1).
  - `param-body-<morph>`: `gender` 0..1, others −1..1, all step 0.05.
  - Removed: `param-lipTint` and `param-faceShape-*`.
  - The hair select lists `catalog.hair` with no base filter.

- [ ] **Step 1: Write the failing tests.**
  - `ParamsPanel.test.tsx`:
    - Changing `param-body-waist` to −0.5 sets `params.body.waist` to −0.5 and leaves the other body values unchanged.
    - `param-body-heightCm` to 180 sets `heightCm` 180.
    - No element with a `param-faceShape-` test id exists.
  - `e2e/avatar.spec.ts`:
    - Keep the existing cases: "skin tone", "an unknown hair id…", "expressions change the face" and "portrait framing".
    - Add "every expression differs from neutral": happy, relaxed, surprised and wink each differ by >100 px in portrait framing.
    - Add "body weight changes the render": weight −1 vs +1, >2000 px.
    - Add "height scales the avatar": head-bone metrics at `heightCm` 150 vs 190 have a ratio of 190/150 ± 2%.
    - Add "all body extremes keep the avatar grounded" (Review Focus 1):
      - Set every signed morph to +1 with gender 1, then all to −1.
      - Each time, `data-status` stays `ready`, `avatarMetrics` are finite, and `headY` is between 1.2 and 2.1 at `heightCm` 175.
    - Add "eye colour changes the eyes": brown vs blue in portrait, >50 px.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/ui/ParamsPanel.test.tsx && npm run e2e -- e2e/avatar.spec.ts`, expected FAIL on the new cases.

- [ ] **Step 3: Implement the panel changes.**

- [ ] **Step 4: Run the whole pipeline**

Run: `npm run ci`
Expected: lint, typecheck, unit, Blender tests, build and e2e all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui tests/ui e2e
git commit -m "feat(dev): body sliders in the dev panel; e2e for body, height, extremes, expressions and eyes"
```

### Task 11: Retire the VRoid pipeline; licences and docs

**Files:**

- Delete:
  - `tools/fetch-dev-samples.sh`, `tools/synth-variants.ts`, `tools/build-hair.ts`
  - `tools/glb/{removeHair,extractHair,hairNames,removePhysics,addMorphTargets}.ts`
  - Their tests, plus any other `tools/glb` module no remaining code imports (check with `grep`)
- Modify:
  - `assets/LICENSES.md`:
    - Remove the VRoid sample rows.
    - Add MakeHuman system assets (CC0; list the skin, eyes, eyebrows, eyelashes, teeth and tongue used), faceunits01 (CC0) and the MakeHuman core targets (CC0).
    - Add MPFB (GPL-3.0-or-later, build-time only) and the VRM add-on (MIT/GPL-3.0-or-later, build-time only).
  - `README.md` (setup: `npm run assets:dev`; first run downloads ~900 MB into `.blender/`), `assets/source/README.md` (rewrite for the new layout: hair sources return in M3).

- [ ] **Step 1: Delete the retired files and update licences and docs.**

- [ ] **Step 2: Verify nothing references them**

Run: `grep -rn "fetch-dev-samples\|synth-variants\|build-hair\|removeHair\|extractHair\|addMorphTargets\|vroidNames\|BASE_A_URL" src tools tests e2e package.json .github README.md`
Expected: no output.

- [ ] **Step 3: Run everything from a clean asset state**

Run: `rm -rf public/assets/base public/assets/catalog.json && npm run assets:dev && npm run ci`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A tools tests assets README.md
git commit -m "chore: retire the VRoid pipeline tools; licences and docs for the MakeHuman base"
```

---

## Self-review notes

- Spec §16 M2 coverage:

  | M2 item                       | Task |
  | ----------------------------- | ---- |
  | MPFB2 → VRM pipeline          | 1, 3 |
  | Body-morph shape keys         | 5    |
  | Expressions                   | 4    |
  | Region IDs (incl. `pelvis`)   | 6    |
  | Realistic skin                | 6, 9 |
  | Height scaling                | 5, 8 |
  | Dev-panel body sliders        | 10   |
  | Default face                  | 3 (the base head as built) |
  | Within budget                 | 6 (6 MB gate) |
  | Done check (base renders across body shapes and expressions) | 10 (e2e) |

- Not covered by any task, on purpose: joint offsets (M5), region transparency (M4), hair (M3), likeness (M3).
