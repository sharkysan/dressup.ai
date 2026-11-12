# M3a Photo Face Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A photo analysed on the `#analysis` page puts that person's face on the avatar: their face texture projected onto the head, the head fitted to their face shape, and the body's skin matched to the face, with hair, eyes, lashes and teeth following the fitted head.

**Architecture:**
- **Build.** `tools/build-base.ts` gains a correspondence step that runs on the exported, post-processed base, so every index is a glTF vertex index of the shipped Body mesh. It aligns MediaPipe's canonical face model to the base head (automatic anchors, similarity transform), projects the 468 face landmarks onto the head surface, and writes `public/assets/base/correspondence.json` plus a review render. The same step adds head-binding attributes to the base's head meshes and to every hairstyle GLB.
- **Analysis.** Pure functions in `src/likeness/` turn the chosen face into a `Likeness`:
  - `fitHead`: landmarks → similarity-aligned residuals → Gaussian RBF over the head → `headOffsets`.
  - `projectFace`: a CPU triangle rasteriser warps the full-resolution face crop into the head's UV square, masks hair, eyes and the inner mouth, fills them with skin, de-lights the result and feathers the face border.
- **Runtime.**
  - `headOffsets` becomes a `likeness` morph target on the Body and, through each mesh's head binding, on the eyes, lashes, teeth, tongue and hair.
  - The 3D brows hide, because the photo carries the brows.
  - The face texture is composited into the skin canvas.
  - The skin gains a calibrated material colour, so the tinted body matches the face (this also fixes M2's "skin renders 15–18 % dark").

**Tech Stack:** TypeScript tools (`tools/glb/*`, sharp), three.js 0.187 / @pixiv/three-vrm, zustand, zod, Vitest, Playwright. No Blender changes.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md`. The governing sections:
- §6: face gates, the `Likeness.headOffsets` and `Likeness.faceTexture` rows.
- §7: applying the likeness.
- §8: head binding.
- §12: correspondence data.
- §3: privacy.
- §15: testing.
- §16: milestones.

**M3 split (plan author's ruling).** M3 is three plans:
- **M3a** (this plan): the photo face.
- **M3b**: the body from the photo — `PoseLandmarker`, measurement, calibration, the body gate.
- **M3c**: the `Likeness` IndexedDB store, the close-up fallback, the ≥3 realistic starter hairstyles, and the likeness gate run with the test-photo set.

## Global Constraints

- **Node commands.** Prefix every npm/npx command with `export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH" &&`.
- **Git hygiene.**
  - Never stage or delete the untracked `scarlet.webp`. Stage explicit paths only.
  - End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.
- **Install locations.** Nothing is installed or written outside the repo.
- **Privacy (§3).**
  - The photo, the face crop and the `Likeness` stay in memory. M3a never writes them to localStorage, IndexedDB (that is M3c), the URL, logs or the network.
  - No `console.*` call may print pixel data or offsets.
  - Real photos for tests live only in the git-ignored `e2e/fixtures/photos/`.
- **`Likeness` shape (§5).**
  - `{ version: 1; faceTexture: Blob; headOffsets: Float32Array; sourceSkin: string }`.
  - `faceTexture` is 1024² in the head's UV square (`faceUvRect`), with alpha as the feathered face mask. It is `image/webp`, or `image/png` where the browser cannot encode WebP (Safari).
  - `headOffsets.length === 3 × correspondence.head.vertices.length`, in metres, in the base's bind space.
- **Face gates (§6), on the chosen face.**
  - |yaw| and |pitch| ≤ 20° is a hard gate (`face_turned`, as today).
  - The face-oval box ≥ 256 px wide in the full-resolution image is the projection gate. Below it, analysis still returns params, with `likeness: null` and `face: 'default'`; M3c adds the close-up prompt.
  - M1's 120 px downscaled `face_too_small` gate stays.
- **Body morphs never move the head (§7).** Unchanged. The likeness is the only thing that moves head vertices.
- **Budgets.**
  - Each hairstyle GLB ≤ `HAIR_BUDGET_BYTES` (1 MiB) after the binding attributes are added.
  - `correspondence.json` ≤ 400 KB.
  - The likeness steps (`fitHead` + `projectFace`, without encoding) ≤ 400 ms on the dev machine. The debug page shows the timing, which stands in for spec §6's 1.5 s mid-range-phone target.
- **Content rules (§3).** Unchanged. The base layer still composites over everything, including the face.

## Review Focus

1. **A real photo with bangs, glasses glare or side light.** The face texture has no hair smears and no dark blotches, and the forehead under bangs reads as skin. Task 4 unit tests cover the synthetic cases (bangs, a brightness ramp). Task 6 renders the consented photos into the review shots.
2. **Expressions and blinks on a fitted head.** The VRM expressions compose on top of the likeness morph: eyelids still close over the moved eyeballs, and the mouth opens without tearing. Task 2 unit test: the likeness target is appended, never replacing expression indices. Task 6 e2e: every expression renders with a likeness applied.
3. **Switching hairstyle after a likeness is applied, or applying a likeness while hair is loading.** Whatever hair ends up attached carries the current likeness morph. Task 6 unit test on HairModel's attach order.
4. **No likeness (default face, shared link).** The render matches M2b's: no likeness target is added, the brows show, and the skin is calibrated. Task 2 unit test: `applyLikeness(root, null)` adds no morph target. Task 5 test: skin with no face.
5. **Body extremes with a likeness.** No seam at the neck, and hair stays seated. Task 3 test: offsets fade with head weight down the neck. Task 6 e2e: weight and bust ±1 with a likeness stay ready and grounded.

---

### Task 1: Correspondence data

**Files:**
- Move: `tests/fixtures/face_model_with_iris.obj` → `assets/source/mediapipe/face_model_with_iris.obj` (`git mv`). Update the path in `tools/test-fixtures/canonicalFace.ts`, and the row in `assets/LICENSES.md` (usage: "build input for correspondence data and test fixtures").
- Create: `src/likeness/correspondence.ts`, `tools/base/canonicalFace.ts`, `tools/base/correspondence.ts`
- Modify: `tools/build-base.ts` (write `correspondence.json`; write the review PNG to `<work>/correspondence-review.png` and print its path), spec §12 and §17
- Test: `tests/likeness/correspondence.test.ts`, `tests/tools/base/correspondence.test.ts`

**Interfaces:**
- Consumes: `readGlb`, `readAccessor`, `writeAtomically`, `findHumanBoneNode`, `BODY_MESH`, and `LM` from `src/analysis/landmarks.ts`.
- Produces:
  - `src/likeness/correspondence.ts`:
    - `correspondenceSchema` (zod), `type Correspondence`.
    - `CORRESPONDENCE_URL = '/assets/base/correspondence.json'`.
    - `loadCorrespondence(): Promise<Correspondence>`, cached per page. It rejects with an Error naming the URL.
  - The schema, exactly:
    ```ts
    {
      version: 1,
      bodyVertexCount: number,          // the Body primitive's vertex count (stale-file guard)
      canonical: number[],              // 468×3, MediaPipe canonical landmarks 0..467, cm
      canonicalToBase: { scale: number; rotation: number[] /* 9, row-major */; translation: [number, number, number] },
      landmarks: { triangle: [number, number, number]; bary: [number, number, number]; uv: [number, number]; position: [number, number, number] }[], // 468, index = landmark
      triangles: [number, number, number][], // face-mesh triangles over landmarks 0..467
      faceUvRect: { u: number; v: number; size: number }, // square, glTF UV (v down), inside [0,1]²
      head: { vertices: number[]; weights: number[]; positions: number[] /* 3 per vertex, m */ },
      zero: number[],                   // indices into head.vertices: RBF zero-displacement points
    }
    ```
  - `tools/base/canonicalFace.ts`: `readCanonicalFace(file: string): { positions: [number, number, number][]; uvs: [number, number][]; triangles: [number, number, number][] }`. It returns 478 positions and uvs, and every OBJ face (0-based).
  - `tools/base/correspondence.ts`:
    - `buildCorrespondence(doc: GlbDoc, face: ReturnType<typeof readCanonicalFace>): { data: Correspondence; review: { data: Uint8Array; width: number; height: number } }`.
    - `headWeights(doc: GlbDoc, mesh: string): Float32Array`: per vertex, the head joint's weight plus 0.5 × the `neck_01` joint's weight, matching build_base.py's `HEAD_GROUPS`.

- [ ] **Step 1: Write the failing tests**
  - `tests/likeness/correspondence.test.ts` (schema):
    - A minimal valid object parses.
    - These fail to parse: a `landmarks` length ≠ 468, a `canonical` length ≠ 1404, and a `faceUvRect` outside [0,1]².
  - `tests/tools/base/correspondence.test.ts`, skipped unless `public/assets/base/base.vrm` exists (the M2b pattern), on the real base:
    - `bodyVertexCount` equals the Body's POSITION count.
    - `landmarks.length === 468`. Every `bary` sums to 1 ± 1e-6 and every entry is ≥ −1e-6.
    - Every landmark `triangle` is a Body triangle in the face island.
    - **Ordering sanity** (base y up, +x = subject's left), from `position`:
      - y(10) > y(168) > y(4) > y(0) > y(17) > y(152).
      - x(33) < x(133) < 0 < x(362) < x(263).
      - |x(4)| < 2 mm.
    - **Surface fit.** The mean distance from each transformed canonical landmark to its projected `position` is < 8 mm, and the max is < 20 mm.
    - `triangles` uses only indices < 468. There are ≥ 850 of them.
    - `faceUvRect` contains every landmark `uv`.
    - **Compositing isolation.** No Body vertex outside the face island has a uv inside the polygon of the `LM.faceOval` landmark uvs, so the face texture can only land on the face. If this fails on the real base, report it as a concern; don't work around it.
    - `head.vertices.length === head.weights.length === head.positions.length / 3`. Every weight is in (0, 1].
    - `zero` is non-empty. Every zero vertex lies behind z_ear − 0.01 m (z_ear as in Step 3).
    - The serialised JSON is ≤ 400 KB.
  - `readCanonicalFace` on the moved OBJ: 478 positions, 478 uvs, and 906 triangles.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/likeness/correspondence.test.ts tests/tools/base/correspondence.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** The algorithm, in base bind space (metres, +Y up, facing +Z, +X = subject's left):
  1. **Body data.** Read the Body primitive's POSITION, TEXCOORD_0, indices and `headWeights`. `head.vertices` = the vertices with weight > 0, in index order.
  2. **Face island.** This is the connected component of Body triangles (adjacent through shared vertex indices; glTF splits vertices at UV seams, so components are UV islands) that contains the nose tip. The nose tip is the vertex with max z among head-weight ≥ 0.999 vertices with |x| < 1 mm.
  3. **Anchors.**
     - Canonical side: iris centres 468 (subject's right) and 473 (left), and the nose tip (argmax z over 0..467).
     - Base side: for each eyeball of the `Eyes` mesh (vertices split by sign of x; +x is the left eye), the vertex with max z; and the Body nose tip.
     - `canonicalToBase` = the Umeyama similarity (with scale) from the three canonical anchors to the three base anchors. Put `umeyama(src, dst): Similarity` and `applySimilarity` in `src/likeness/similarity.ts`; Task 3 reuses them.
     - There is no ICP refinement.
  4. **Projection.** Each transformed canonical landmark 0..467 goes to its closest point on the face island's triangles. Record `triangle`, `bary`, `position`, and `uv` (bary-interpolated TEXCOORD_0).
  5. **`triangles`.** The OBJ faces whose three indices are all < 468.
  6. **`faceUvRect`.** The bounding box of the landmark uvs, made square (side = 1.1 × its longer edge, about the same centre), then shifted (not shrunk) to lie inside [0,1]².
  7. **`zero`.** z_ear is the mean base z of the projected landmarks 234 and 454. Take every head vertex with z < z_ear − 0.01, subsampled by a 0.02 m voxel grid (the first vertex in index order per voxel).
  8. **Review render.** 512² RGBA, front orthographic, image x = base x, image y = −base y. Head vertices are 1 px grey dots, projected landmarks 3 px red, and anchors 5 px blue.
  9. **Number format.** Round positions to 1e-5 and uvs/bary to 1e-6 in the JSON.
  10. **Validate.** Parse the result with `correspondenceSchema` before writing.

- [ ] **Step 4: Rebuild and run the tests.** `npm run assets:base`, then the Step 2 command → PASS. Open `<work>/correspondence-review.png` and confirm the red dots trace the eyes, nose, lips and face oval on the head. Attach it to the report.

- [ ] **Step 5: Update the spec.**
  - §12: correspondence is built by `tools/base/correspondence.ts` inside the base build, from the exported base, with automatic anchors (corneas and nose tip). It covers the 468 face landmarks; the 10 iris points are not on the head surface.
  - §17, dated 2026-11-11: the decision, and why — indices must be glTF vertex indices of the shipped mesh.

- [ ] **Step 6: Commit** the moved OBJ, the new and modified files, and the spec: "feat(likeness): correspondence data from the exported base".

### Task 2: Head bindings and the likeness morph

**Files:**
- Create: `src/likeness/headBinding.ts`, `src/likeness/likenessMorph.ts`
- Modify: `tools/build-base.ts` (bind the base's `Brows`, `Eyes`, `Lashes`, `Teeth`, `Tongue` primitives), `tools/base/buildHair.ts` (bind every hair primitive in `processHair`), `tools/base/validateBase.ts`, `tools/base/validateHair.ts`, spec §8
- Test: `tests/likeness/headBinding.test.ts`, `tests/likeness/likenessMorph.test.ts`, `tests/tools/base/validateBase.test.ts`, `tests/tools/base/validateHair.test.ts`

**Interfaces:**
- Consumes: `Correspondence` (`head.vertices`, `head.positions`) from Task 1, `appendAccessor`, and `BODY_MESH`/`MATERIALS`.
- Produces:
  - `src/likeness/headBinding.ts`:
    - `HEADBIND_IDX = '_HEADBIND_IDX'` and `HEADBIND_W = '_HEADBIND_W'`. GLTFLoader lowercases custom attributes, so `HEADBIND_IDX_ATTR = '_headbind_idx'` and `HEADBIND_W_ATTR = '_headbind_w'` are the three.js names.
    - `headBinding(positions: Float32Array, head: Correspondence['head'], parts?: Int32Array): { idx: Uint16Array; w: Float32Array }`.
  - `src/likeness/likenessMorph.ts`:
    - `LIKENESS_TARGET = 'likeness'`.
    - `expandHeadOffsets(headOffsets: Float32Array, head: Correspondence['head'], vertexCount: number): Float32Array`.
    - `boundOffsets(idx: ArrayLike<number>, w: ArrayLike<number>, full: Float32Array): Float32Array`.
    - `applyLikeness(root: Object3D, full: Float32Array | null): void`.
  - GLB attributes:
    - `_HEADBIND_IDX`: UNSIGNED_SHORT VEC4, tightly packed (Body vertex indices in the first three components; the 4th is 0 and unused, for glTF 2.0's 4-byte alignment of vertex-attribute elements).
    - `_HEADBIND_W`: FLOAT VEC3 (weights summing to 1).

- [ ] **Step 1: Write the failing tests**
  - **`headBinding`** on a toy head (four points):
    - A vertex at a head point → that index with weight ≈ 1.
    - A vertex equidistant from three points → weights ≈ 1/3 each.
    - Every weight triple sums to 1 ± 1e-6.
    - `parts`: every vertex of a part gets the binding of the part's centroid.
  - **`expandHeadOffsets`.** Values land at `head.vertices` and are zero elsewhere.
  - **`boundOffsets`.** Σ w·offset per vertex.
  - **`applyLikeness`** on a scene with a `Body` mesh (two existing morph targets, with normal morphs), a mesh with binding attributes, and a `Brows` mesh:
    - Applying `full` appends exactly one target named `likeness` at index 2 to each, with influence 1. The existing dictionary entries are unchanged, and a zero normal morph is appended where `morphAttributes.normal` exists.
    - The bound mesh's target equals `boundOffsets`.
    - Brows are hidden.
    - Re-applying different offsets updates the values in place (no second target) and calls `geometry.dispose()` once per changed geometry. three.js rebuilds its morph texture only on a count change or a dispose (`WebGLMorphtargets`).
    - `applyLikeness(root, null)` on a fresh scene adds nothing. After a likeness was applied, `null` sets the influence to 0 and shows the brows.
  - **Validators.** `validateBase` reports a head mesh without both attributes, a count mismatch, or an index ≥ the Body's vertex count. `validateHair` does the same for each hair primitive.
  - **Real-asset cases** (skip unless built): every hair GLB has the attributes and is ≤ `HAIR_BUDGET_BYTES`; base.vrm's five head meshes have them.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/likeness/headBinding.test.ts tests/likeness/likenessMorph.test.ts tests/tools/base`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`headBinding`.** The three nearest head vertices by brute force over `head.positions`. w_k ∝ 1/(d_k + 1e-4), normalised.
  - **Rigid parts.**
    - `Eyes` is split by the sign of x (two parts).
    - `Teeth` and `Tongue` are one part each.
    - `Brows`, `Lashes` and hair bind per vertex.
  - **`applyLikeness`.**
    - The Body (`BODY_MESH`) takes `full` directly; meshes with `_headbind_idx` take `boundOffsets`.
    - It sets `visible = full === null` on the mesh whose material is `MATERIALS.brows`.
  - **`buildHair`.** It needs the base's correspondence head, so build-base computes the correspondence before processing hair.
  - **Spec §8.** The attribute names. The base's own head meshes carry the same binding, rigid per eyeball, and for the teeth and tongue.

- [ ] **Step 4: Rebuild and run the tests.** `npm run assets:base`, then the Step 2 command → PASS. Report the bytes for every hairstyle.

- [ ] **Step 5: Commit**: "feat(likeness): head bindings on the base head meshes and hairstyles; likeness morph target".

### Task 3: Head fit

**Files:**
- Create: `src/likeness/headFit.ts` (it uses `src/likeness/similarity.ts` from Task 1)
- Test: `tests/likeness/headFit.test.ts`

**Interfaces:**
- Consumes: `FaceObservation` from `src/analysis/types.ts`, `Correspondence`, `umeyama`/`applySimilarity`, and `synthFace` from `tools/test-fixtures/canonicalFace.ts` (tests only).
- Produces:
  - `HEAD_FIT = { depthGain: 0.5, maxResidualM: 0.015, sigmaM: 0.02, lambda: 0.01 } as const`.
  - `fitHead(face: FaceObservation, corr: Correspondence): { headOffsets: Float32Array; debug: { residualRmsMm: number; maxOffsetMm: number; aligned: Float32Array /* 468×3, canonical cm */ } }`.

- [ ] **Step 1: Write the failing tests.**
  - Unless stated, they use a synthetic `Correspondence` built from the canonical model itself:
    - `canonicalToBase` = scale 0.01, identity rotation.
    - `landmarks[i].position` = canonical × 0.01.
    - The head = the 468 landmark positions (weight 1), then one duplicate of landmark 152's position at weight 0.5, then 60 "back of head" points at z = −0.06 m (weight 1).
    - `zero` = those 60.
  - **Identity.** Landmarks synthesised from the canonical model with yaw 15°, roll 5°, any scale and centre → max |offset| < 0.5 mm.
  - **Jaw widening.** The same, but canonical x × 1.10 for landmarks with y < −4 cm:
    - The head vertex at landmark 172 (`LM.jawR`) moves −x by 2–8 mm.
    - The one at 397 (`LM.jawL`) moves +x by 2–8 mm.
    - The nose tip (4) moves < 1 mm.
    - Every zero point moves < 0.5 mm.
  - **Depth gain.** A pure z residual of 10 mm at the nose gives ≈ 5 mm (± 1 mm) of z offset there.
  - **Clamp.** One landmark displaced by 5 cm → max |offset| ≤ 18 mm.
  - **Neck fade.** Under the jaw widening, the weight-0.5 duplicate of landmark 152 gets half (± 1e-6 m) the offset of landmark 152's own head vertex.
  - **Shape.** `headOffsets.length === 3 × head.vertices.length`, and the function is deterministic.
  - **Real correspondence** (skip unless built): identity synthesis → max |offset| < 0.5 mm, and the call takes < 250 ms.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/likeness/headFit.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `fitHead`.** It works on landmarks 0..467; the iris is ignored.
  1. P_i = (x·W, −y·H, −z·W) with W, H = `imageWidth`, `imageHeight`.
  2. S = `umeyama(P, canonical)`. r_i = S(P_i) − C_i, in cm.
  3. d_i = canonicalToBase.scale × R · (r_x, r_y, depthGain·r_z), in m. Clamp |d_i| to `maxResidualM` by scaling.
  4. Gaussian RBF. Centres are the landmark `position`s (values d_i) and the `zero` head positions (value 0). φ(r) = exp(−r²/σ²). Solve (K + λI)·α = D once, by Cholesky. Evaluate at every head vertex.
  5. `headOffsets[v] = f(v) × head.weights[v]`.
  6. Debug: `residualRmsMm` is the RMS of |d_i| before clamping. `aligned` is S(P_i).

- [ ] **Step 4: Run the tests.** The Step 2 command → PASS.

- [ ] **Step 5: Commit**: "feat(likeness): head fit from face landmarks (similarity residuals, Gaussian RBF)".

### Task 4: Face texture projection

**Files:**
- Create: `src/likeness/faceTexture.ts`
- Modify: spec §6 (the warp runs on the CPU, see Step 5)
- Test: `tests/likeness/faceTexture.test.ts`

**Interfaces:**
- Consumes: `Correspondence` (`landmarks[].uv`, `triangles`, `faceUvRect`), `LM`, `polygonMask`, `RgbaImage`/`Point2`, and `synthFace` (tests).
- Produces:
  - `FACE_TEXTURE_SIZE = 1024`.
  - `FACE_MASKS`:
    - `eyeR: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7]`
    - `eyeL: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249]`
    - `innerMouth: [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95]`
    - `eyeDilatePx: 6`, `mouthDilatePx: 2`, `featherPx: 40`, `delightSigmaPx: 64`, `gainRange: [0.5, 2]`
  - `projectFace(input: { photo: RgbaImage; landmarks: Point2[] /* 478, photo px */; hair: Uint8Array /* photo-sized, 1 = hair */ }, corr: Correspondence, size?: number): RgbaImage`.
  - Steps exported for tests:
    - `uvToTexel(uv: [number, number], rect: Correspondence['faceUvRect'], size: number): Point2`
    - `warpTriangles(...)`
    - `fillHoles(image: RgbaImage, valid: Uint8Array): void` (pull-push)
    - `delight(image: RgbaImage, skin: Uint8Array): void`
    - `featherAlpha(oval: Point2[], size: number, featherPx: number): Uint8Array`

- [ ] **Step 1: Write the failing tests.**
  - They use a synthetic correspondence whose landmark uvs are the canonical OBJ uvs (`readCanonicalFace`), with `faceUvRect = { u: 0, v: 0, size: 1 }`, and a `synthFace` photo with known skin, hair, iris and lip colours.
  - **Affine exactness.** A one-triangle correspondence and a photo with a linear horizontal gradient → the texels inside the destination triangle carry the gradient mapped affinely (±2/255).
  - **Skin.** The texel at landmark 4's `uvToTexel` is within ΔE_OK 0.03 of the synthetic skin colour.
  - **Eyes and mouth.** The texels at the centroids of the destination polygons `FACE_MASKS.eyeR`, `eyeL` and `innerMouth` are filled. They are within ΔE_OK 0.05 of skin, not iris or lip colour.
  - **Bangs.** A synthetic photo with hair over the upper forehead → the forehead texels under the hair are within ΔE_OK 0.05 of skin.
  - **De-light.** A photo multiplied by a left-to-right brightness ramp (0.6 → 1.4) → the mean linear luminance of the left and right cheek patches (`LM.cheekPatchR`/`L`) differs by < 5 % after `projectFace`. Before de-lighting it differs by > 50 %.
  - **Alpha.**
    - 255 at landmark 4.
    - 0 at texel (5, 5) and everywhere outside the face-oval polygon.
    - Within the band at most `featherPx` inside the oval, rising monotonically along the line from landmark 152's texel to landmark 4's.
  - **Size.** 1024 × 1024 by default, and the call is deterministic.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/likeness/faceTexture.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `projectFace`.**
  1. **Warp.** Rasterise each triangle at texel centres in destination (texel) space. Map through barycentrics to the photo, and sample bilinearly; alpha 255. A texel is invalid if any of the four bilinear taps is hair (in `hair`).
  2. **Invalid regions.** Add the eye polygons dilated by `eyeDilatePx` (the 3D lashes and eyes replace them), and the inner-mouth polygon dilated by `mouthDilatePx` (the lips close over it).
  3. **Fill.** `fillHoles` fills every invalid texel and every texel outside the warped area from the valid ones by pull-push.
  4. **De-light.**
     - Y is linear-light luminance.
     - Y_b is a normalised Gaussian blur (σ = `delightSigmaPx`) of Y over the valid texels.
     - Y_t is the median Y of the valid texels inside the oval.
     - gain = clamp(Y_t / Y_b, `gainRange`). Multiply linear RGB by gain.
  5. **Alpha.** `featherAlpha` of the face-oval polygon (`LM.faceOval` texels).

- [ ] **Step 4: Run the tests.** The Step 2 command → PASS.

- [ ] **Step 5: Update the spec and commit.**
  - Spec §6 `Likeness.faceTexture` row: "warp … on the CPU (a triangle rasteriser)" replaces "on a WebGL canvas".
  - §17 entry: the CPU warp is unit-testable, runs in a Worker later, takes no second WebGL context, and is ~0.6 M texels.
  - Commit: "feat(likeness): face texture projection (CPU warp, hole fill, de-light, feathered alpha)".

### Task 5: Skin match and face compositing

**Files:**
- Modify: `src/avatar/bodyTexture.ts`, `src/avatar/applyParams.ts`, spec §7
- Test: `tests/avatar/bodyTexture.test.ts`, `tests/avatar/applyParams.test.ts`

**Interfaces:**
- Consumes: `Correspondence['faceUvRect']`, and `hexToRgb`.
- Produces:
  - `type FaceComposite = { pixels: Pixels /* faceTexture, decoded */; sourceSkin: string; rect: Correspondence['faceUvRect'] }`.
  - `skinGain(skin: Pixels, baseLayer: Pixels): [number, number, number]`: per channel, 1 / the median linear value over texels where the base layer's alpha is 0.
  - `composeBodyAlbedo(skin, baseLayer, tint, gain, out?, face?)`.
  - `SkinTexture`:
    - A `gain` getter.
    - `update(tint: string, face?: FaceComposite | null): CanvasTexture`, which recomposites when the tint or the face object changes.
  - `ApplyContext` gains `face: FaceComposite | null`.
  - `applyParams` sets the Skin material's `color` to `gain` (linear RGB) and passes `ctx.face`.

- [ ] **Step 1: Write the failing tests.**
  - "Rendered albedo" means linear(texel) × gain per channel, back to sRGB. Use a small synthetic neutral skin with a spread of values (median known), a base layer with clear, opaque and half-alpha texels, and a face.
  - **Skin.** At the neutral's median texel (base alpha 0, no face), the rendered albedo equals `tint` ± 2/255 per channel, for `#c68642`, `#8d5524` and `#f1c27d`.
  - **Base layer.** At base-layer alpha 255, the rendered albedo equals the base layer ± 2/255, for any tint.
  - **Face.**
    - At a face texel with alpha 255 and tint = `sourceSkin`, the rendered albedo equals the face texel ± 2/255.
    - With tint ≠ `sourceSkin`, it equals face × (tint / sourceSkin) in linear ± 2/255.
    - The base layer still wins over the face where both are opaque.
  - **No clipping.** No skin texel at or below the neutral's 99th percentile clips at 255 in the canvas.
  - **Recomposite rules.** `update` with the same tint and the same face object does not recomposite; a new face object does.
  - **`applyParams`.** The Skin material's `color` equals `gain`.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/avatar/bodyTexture.test.ts tests/avatar/applyParams.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - The canvas holds the following, composited in this order, each encoded to sRGB:
    - skin = linear(neutral) × linear(tint)
    - face = linear(face) × linear(tint)/linear(sourceSkin) / gain, over the skin by face alpha
    - base layer = linear(baseLayer) / gain, over both by its alpha
  - The face is resampled bilinearly into the canvas square given by `rect` × canvas size.
  - The material colour carries `gain`, so the rendered skin's median is the tint. gain ≥ 1 always, so nothing divided by it overflows.

- [ ] **Step 4: Run the tests.** The Step 2 command, plus `npx vitest run tests/avatar` and `npx playwright test e2e/avatar.spec.ts` → PASS. "skin tone changes the render" and "the base layer always covers torso and pelvis" must still pass.

- [ ] **Step 5: Update the spec and commit.**
  - Spec §7 `skin` bullet: the gain via the material colour, and the face following skin edits by the tint/sourceSkin ratio.
  - Commit: "feat(avatar): calibrated skin gain; face texture composited under the base layer".

### Task 6: The likeness in the app

**Files:**
- Create: `src/likeness/types.ts`, `src/likeness/buildLikeness.ts`, `e2e/likeness.spec.ts`
- Modify:
  - `src/analysis/image.ts`, `src/analysis/masks.ts`, `src/analysis/analyze.ts`
  - `src/store/useAppStore.ts`
  - `src/avatar/AvatarModel.tsx`, `src/avatar/HairModel.tsx`
  - `src/ui/dev/AnalysisPage.tsx`, `src/ui/strings.ts`
  - `src/App.tsx` (the dev hook)
  - `e2e/analysis.spec.ts`
  - spec §6, §16, §17
- Test: `tests/analysis/analyze.test.ts`, `tests/analysis/image.test.ts`, `tests/store/useAppStore.test.ts`, `tests/avatar/AvatarModel.test.tsx`, `tests/avatar/HairModel.test.tsx`, `tests/ui/AnalysisPage.test.tsx`, `tests/likeness/buildLikeness.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:
  - `likenessSchema` (zod) and `type Likeness`, in `src/likeness/types.ts`.
  - **`decodePhoto(file)`** now returns `{ canvas, image, bitmap }`. The full-resolution `bitmap` is closed by `analyzePhoto` in a `finally`.
  - **`cropFace(bitmap: ImageBitmap, rect: Box, maxEdge = 2048): { image: RgbaImage; scale: number }`**, in image.ts.
  - **`maskForCrop(mask: CategoryMask, category: number, rect: Box, scale: number, full: { width: number; height: number }, crop: { width: number; height: number }): Uint8Array`**, in masks.ts. It samples nearest.
  - **`buildLikeness(...)`**:
    ```ts
    buildLikeness(input: { face: FaceObservation; crop: { image: RgbaImage; landmarks: Point2[]; hair: Uint8Array }; sourceSkin: string }, corr: Correspondence): Promise<{ likeness: Likeness; debug: LikenessDebug }>
    ```
    `LikenessDebug = { residualRmsMm; maxOffsetMm; aligned; ms: { fit; project; encode } }`. It encodes with `toBlob('image/webp', 0.92)` and accepts PNG back.
  - **`GATES`** becomes `{ minFaceWidthPx: 120, maxYawDeg: 20, maxPitchDeg: 20, minProjectionFaceWidthPx: 256 }`.
  - **`AnalyzeResult`** gains:
    - `likeness: Likeness | null`
    - `likenessGate: 'ok' | 'too_small'`
    - `likenessDebug: LikenessDebug | null`
  - **`analyzePhoto`**:
    - It loads the correspondence with the models.
    - A failed correspondence load is `AnalysisError('models')`.
    - It sets `params.face` to `'photo'` iff `likeness` is set.
  - **Store**: `likeness: Likeness | null` and `setLikeness(l: Likeness | null)`. It also sets `params.face`. `reset` clears it.
  - **`HairModel`** gains the prop `likenessOffsets: Float32Array | null` (the expanded Body offsets).
  - **Dev hook** (dev builds, as `window.__kiss.analysis` is): `window.__kiss.likeness = { set(l: Likeness | null): void; status(): { meshes: string[]; browsVisible: boolean } }`. `meshes` lists the meshes whose `likeness` influence is 1.

- [ ] **Step 1: Write the failing tests.**
  - **`analyze.test.ts`** (fake adapter, synthetic face):
    - yaw 25° → `face_turned`.
    - A face 200 px wide in a full-res photo → params with `likeness: null`, `likenessGate: 'too_small'` and `face: 'default'`.
    - A 300 px face → `likeness` set, `face: 'photo'`.
    - The bitmap is closed on success and on every error path.
  - **`buildLikeness.test.ts`**: the `likeness` parses with `likenessSchema`; `headOffsets` and `faceTexture` have the stated shape and type.
  - **`maskForCrop`**: a mask with one hair quadrant maps to the matching crop quadrant.
  - **Store**: `setLikeness(x)` → `params.face === 'photo'`; `setLikeness(null)` → `'default'`.
  - **`AvatarModel`/`HairModel`** (the M2b mocking style):
    - A likeness set before or after load ends with `applyLikeness` called with its expanded offsets, and the face composite passed to `applyParams`.
    - A hair attached after the likeness gets the morph.
    - A newer likeness replacing one mid-decode wins.
  - **`AnalysisPage`**: with a result that has a likeness, the page shows the face texture image, the gate line, the timings and the fit overlay canvas; "Use these params" also sets the likeness.
  - **`e2e/likeness.spec.ts`**, which waits for the avatar and the default hair as avatar.spec does:
    - **Photo texture.** Portrait framing. `__kiss.likeness.set` with a synthetic likeness: an opaque `#20c040` faceTexture, zero offsets, `sourceSkin` = params.skin. The face-centre pixel region turns green-dominant (mean G > mean R + 40), and `status().browsVisible === false`. `set(null)` restores the non-green face and the brows.
    - **Offsets.** offsets of +8 mm x on the subject-left half of the head (transparent texture) → the portrait differs from the baseline in > 1 % of pixels, and `status().meshes` includes `Body`, `Eyes` and the hair mesh.
    - **Expressions.** Every expression with a likeness applied renders and stays ready.
    - **Body extremes.** Weight ±1 and bust ±1 with a likeness stay ready and grounded (reuse avatar.spec's ground check).
  - **`e2e/analysis.spec.ts`**: the existing consented-portrait test (skipped without a photo) also asserts:
    - `likeness` is non-null when the face passes the projection gate.
    - The face texture is 1024².
    - `headOffsets.length === 3 × head.vertices.length`.
    - max |offset| ≤ 18 mm.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run tests/analysis tests/likeness tests/store tests/avatar tests/ui` and `npx playwright test e2e/likeness.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **Crop.** The full-res crop rect is the face box (analysed px, scaled to full res) expanded 1.6× about its centre and clamped. The landmarks map into crop pixels as ((x·fullW − rect.x)·scale, (y·fullH − rect.y)·scale).
  - **Hair.** The hair mask is restricted to `hairRegion` as `analyzeToParams` does, then mapped with `maskForCrop`.
  - **`AvatarModel`.**
    - It loads `loadCorrespondence()` with the VRM, meta and base layer.
    - It subscribes to `likeness`. Each change decodes `faceTexture` to pixels (latest wins) and sets `ctx.face`.
    - It calls `applyLikeness(vrm.scene, expandHeadOffsets(...))`, or `null`.
    - It re-applies params.
    - It passes the expanded offsets to `HairModel`, which calls `applyLikeness` after attach, after `applyBodyMorphs`.
  - **`AnalysisPage`.**
    - The face texture is shown through an object URL, revoked on change.
    - The overlay is a 256² front scatter of `canonical` (grey) and `aligned` (red).
    - The gate line reads `strings.analysis.likenessOk`, or `likenessTooSmall` ("Face too small for a photo face — using the default face").

- [ ] **Step 4: Run the full suite.** `npm run ci` → PASS. If only viewer.spec's "canvas follows the viewport on resize" fails, rerun before investigating (known flake).

- [ ] **Step 5: Review renders.**
  - Render the e2e likeness portraits.
  - Where `e2e/fixtures/photos/` has consented photos, render each photo's avatar too, in portrait and full framing, with the face texture image.
  - Save everything to the report's shots folder. Never commit them.

- [ ] **Step 6: Update the spec.**
  - §6: the gates as built (20° hard, 256 px projection gate; below it the default face until M3c's close-up prompt), and the PNG fallback.
  - §16: M3 split into M3a/M3b/M3c, as in this plan's header.
  - §17: entries for the brows hiding with a photo face, and the M3 split.

- [ ] **Step 7: Commit**: "feat(likeness): photo face on the avatar — analysis builds the Likeness, avatar applies it".
