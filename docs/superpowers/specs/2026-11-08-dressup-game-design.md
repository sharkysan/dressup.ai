# Kiss — photo-to-avatar dress-up game: design spec

Date: 2026-11-08 · Revised: 2026-11-09 (realistic double, see §17) · Status: draft for review · Scope: v1 (core loop)

## 1. Purpose and success criteria

A web app for adults (18+) that turns an uploaded photo into a realistic 3D double of the person: their own face, taken from the photo, on a lifelike body shaped to their proportions. The user dresses it from a wardrobe, puts it in poses, and exports an image or share link.

v1 is a real, launchable product, not a prototype, but deliberately limited to the core loop. No accounts, no payments, no server.

Success for v1:

- A first-time user uploads a photo and, within ~30 s including model download, sees an avatar they recognise as "that's me": their face, their colouring, their build (likeness gate, §15).
- They can dress and pose it without instructions and share a picture within a few minutes.
- Per-user running cost is ~0: static hosting, all computation in the browser.
- The photo never leaves the device.

## 2. Scope

In v1:

- Photo → realistic avatar: the face photo projected onto a head fitted to the person's face; body shape measured from the photo plus the user's height (all in-browser).
- One realistic base (MakeHuman) with continuous body-shape morphs, realistic hairstyle library, colour controls, body-shape sliders for correction.
- Wardrobe with slots, collections, colourable garments that follow body shape, permanent base layer.
- Static pose library (~25 poses), expressions, three fine-tune sliders.
- Scene: orbit camera, two framings, flat backdrops.
- Export PNG, share link (params only, no face), continue-later on the device.
- Dev tooling: debug page, pose editor, asset pipeline, catalogue linter.

Not in v1 (candidates for later): accounts and cloud save, payments and premium items, drag-to-pose IK, hair/cloth physics, animation playback, glasses/facial-hair/head-covering detection, props and backgrounds beyond flat colours, user-generated poses or garments, social feed, a stylised/cartoon mode, faces in share links.

## 3. Audience, consent, content and privacy rules

- Audience: adults, 18+. Landing page has an 18+ confirmation (stored in localStorage).
- Photos may be of the user or of other people. Landing shows the consent line "Only upload photos of yourself or people who've agreed" with a required checkbox (per session), and "Your photo never leaves your device."
- Privacy: the photo is held in memory only, drawn to an offscreen canvas for analysis, and released when analysis completes. It is never persisted, never placed in the URL, never sent anywhere. Analysis produces two outputs: `AvatarParams` (§5), which may be persisted and shared, and `Likeness` (§5: the projected face texture and head shape), which is derived from the photo and is treated like it: kept in memory and in IndexedDB on the device for continue-later, deleted by "Start over", never placed in the URL, never sent anywhere. A privacy page states exactly this. No analytics event may carry image or likeness data; if analytics are added they are privacy-preserving (e.g. Plausible) and event-only.
- Content: because the avatar is a realistic likeness of a real person, and photos of other people are allowed, these rules are fixed for v1 (see §17 for what would have to change to relax them). Avatars always have a permanent base layer, a texture overlay composited over the tinted skin (a fitted sports crop top and short shorts), still permanent and always visible; clearing every slot never produces an undressed avatar. The midriff between the top and the shorts is bare skin, and the chest is smooth under the top by design: the top reads as compression fabric. Garments never cover less than the base layer; no lingerie, no sleepwear/nightwear, no fetish gear. Costume collections (Halloween etc.) are party-costume register. The pose library is fashion, editorial, dance and everyday; no poses framed around the crotch or rear. All garment and character designs are original: no named characters, logos, wordmarks or signature colourways from films, comics, games or anime.
- Base-layer mechanics: the baked sports crop top lies within the `torso` region and the baked short shorts within the `pelvis` region (§5). A body region only turns transparent under a garment that fully covers it (§8), so `torso` can only be hidden by a `top` or `full` item and `pelvis` only by a `bottom` or `full` item, and whatever is worn, the base layer or something at least as covering is always visible. Shoes, head items and short jackets list only the regions they fully cover (often none).
- Enforcement is in code: the catalogue linter (§13) rejects garments without `slot`/`covers`, rejects `torso` in `covers` outside `top`/`full` and `pelvis` outside `bottom`/`full`, rejects poses outside the allowed categories, and rejects catalogue names and tags that match a denylist (character/brand names; lingerie, sleepwear and nightwear terms). Whether a garment really covers what its `covers` claims is checked by the screenshot regression (§15) and code review. Changes to the catalogue go through code review.
- Terms of use prohibit using a person's likeness without their agreement and prohibit sexual or harassing use of exports.

## 4. Architecture

Single-page app, no backend. Static hosting (Cloudflare Pages or Vercel). Everything runs in the browser.

Stack:

- Vite, React 19, TypeScript (strict).
- `three`, `@react-three/fiber` matching the React major, `@react-three/drei`.
- `@pixiv/three-vrm` (VRM 1.0 loading, humanoid normalised bones, expressions). The base is a MakeHuman character exported as VRM 1.0 with standard PBR materials (not MToon), so the rig, posing and expression machinery stay as built.
- `@mediapipe/tasks-vision`: `FaceLandmarker` (478 landmarks, 52 blendshapes, facial transformation matrix), `PoseLandmarker` (33 body landmarks, full model) and `ImageSegmenter` with the multiclass selfie model (background, hair, body-skin, face-skin, clothes, others). Model files are self-hosted under `/models/` and lazy-loaded.
- `zustand` for app state. `fflate` as a fallback for deflate where `CompressionStream` is unavailable. IndexedDB (thin wrapper, no library required) for `Likeness`.
- Build-time tools: Blender (headless Python) with MPFB2 (MakeHuman Plugin for Blender) and the VRM add-on, `@gltf-transform/core`, Node scripts.

Data flow: photo → `analysis` → `AvatarParams` + `Likeness` → `avatar` (applies both to the VRM) ← `wardrobe` and `posing` (catalogue-driven) → `export` (PNG, URL). The UI reads and mutates `AvatarParams` only; it never touches the scene directly. `Likeness` is set once per analysis and only replaced by a new analysis or cleared by "Start over".

Modules (folders under `src/`, each with its own tests):

| Module             | Responsibility                                                                                                                               | Depends on                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `analysis/`        | photo → `AvatarParams` + `Likeness`. Pure mapping functions over landmark and mask data; MediaPipe behind one adapter.                       | MediaPipe adapter, calibration data        |
| `likeness/`        | face texture projection (photo → head UV), head-shape fit (landmarks → head vertex offsets), de-lighting and skin matching; IndexedDB store. | analysis outputs, base correspondence data |
| `avatar/`          | load the VRM base, apply colours, body morphs, height, likeness, hair, extras; own the skeleton and raw-bone lookup.                         | three-vrm, catalogue, likeness             |
| `wardrobe/`        | garment catalogue, load/attach/detach to the skeleton, body-morph following, region masks.                                                   | avatar                                     |
| `posing/`          | pose catalogue, apply pose to normalised bones, fine-tune sliders, expressions, heel handling.                                               | avatar, catalogue                          |
| `export/`          | PNG render, params ↔ URL, localStorage.                                                                                                      | params schema                              |
| `ui/`              | screens and panels.                                                                                                                          | zustand store                              |
| `catalog/`         | types and loader for `catalog.json`.                                                                                                         | —                                          |
| `assets/` (public) | VRM base, hair and garment GLBs, pose JSON, thumbnails, models, correspondence data, `catalog.json`.                                         | built by `tools/`                          |
| `tools/`           | asset pipeline scripts, catalogue builder and linter, thumbnail renderer, Mixamo pose extractor, body-measurement calibration.               | Blender + MPFB2, gltf-transform            |

## 5. Core data model

### `AvatarParams` (persisted and shared)

```ts
type BodyMorph =
  | 'gender' // 0 feminine .. 1 masculine (MakeHuman macro); not inferred
  | 'weight'
  | 'muscle'
  | 'shoulders'
  | 'bust'
  | 'waist'
  | 'hips'
  | 'legLength'
  | 'armLength';

type AvatarParams = {
  version: 2;
  body: { heightCm: number } & Record<BodyMorph, number>; // morphs -1..1 except gender 0..1; heightCm 140..210
  skin: string; // hex, continuous; tints the body to match the projected face
  hairColor: string; // hex, continuous
  eyeColor: 'brown' | 'darkBrown' | 'hazel' | 'green' | 'blue' | 'grey';
  hair: string; // hairstyle id, or 'none'
  face: 'photo' | 'default'; // 'photo' when a Likeness is present on this device
  extras: { glasses?: string };
  outfit: Partial<Record<Slot, { id: string; color?: string }>>;
  pose: string; // pose id
  poseTweak: { headTurn: number; headTilt: number; torsoLean: number }; // -1..1
  expression: 'neutral' | 'happy' | 'relaxed' | 'surprised' | 'wink';
  scene: { backdrop: string; framing: 'full' | 'portrait' };
};
```

Removed from version 1: `base` (one base now), `lipTint`, `brows` and `faceShape` (the photo supplies lips and brows; the fitted head replaces the eight face sliders), `extras.facialHair` (projected from the photo).

### `Likeness` (device only)

```ts
type Likeness = {
  version: 1;
  faceTexture: Blob; // WebP (PNG where the browser can't encode WebP), 1024², in the base head's UV layout; alpha = feathered face-region mask
  headOffsets: Float32Array; // per-vertex position offsets for the head region of the body mesh (base topology)
  sourceSkin: string; // hex sampled from the photo, used to tint the body to match
};
```

Supporting types used throughout:

```ts
type Slot = 'top' | 'bottom' | 'full' | 'shoes' | 'outer' | 'head';
type Region = 'torso' | 'pelvis' | 'upperArms' | 'forearms' | 'thighs' | 'calves' | 'feet' | 'neck';
```

Regions are fixed body areas, independent of the base layer's cut: `torso` is the area of the original full undershirt, and `pelvis` the hips, groin and seat down to 8 cm below the crotch; `thighs` starts below that. The base layer's sports crop top and short shorts (§3) lie inside them.

Rules: `full` and (`top` or `bottom`) are mutually exclusive; the store enforces it when setting either. Unknown ids fall back to defaults with a toast. `version` drives migrations for share links and localStorage; version 1 was never released, so a version-1 link or stored state resets to the default avatar with a message rather than migrating. The schemas are validated with `zod` at every boundary (URL, localStorage, IndexedDB, analysis output).

## 6. Analysis: photo → avatar

Input: a file from `<input type="file" accept="image/*">`. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`. Keep the full-resolution bitmap until analysis completes (needed for the face crop), and draw a copy downscaled to a 1024 px long edge to an `OffscreenCanvas` for detection. iOS supplies JPEG for HEIC originals when `accept="image/*"`; other HEIC files fail decoding and show "Please use a JPEG or PNG".

The expected photo is one full-length, front-facing shot, face clearly visible. The upload step shows tips: stand straight facing the camera, whole body in frame, fitted clothes if possible, even light, neutral expression, glasses off, hair off the face. The user also enters their height (cm, or ft/in toggled), because a single photo does not give scale.

Detection and gates (on the 1024 px copy unless stated):

- Run `FaceLandmarker` (image mode, `numFaces: 4`) and `PoseLandmarker` (full model, image mode, `numPoses: 4`, no segmentation masks) on the 1024 px copy.
- The head crop: a full-length photo's face is too small a part of the frame for `FaceLandmarker` on the 1024 px copy, so for each pose whose nose landmark lies in no found face's box, run `FaceLandmarker` again on a head crop of the full-resolution photo. The crop is a square centred on the mean of pose landmarks 0–10 (nose, eyes, ears, mouth), its side 3 × the ear-to-ear distance and at least 96 px, shifted inside the photo at its edges and drawn at most 1024 px on a side. The faces found there are mapped back into the photo's coordinates. Faces large in the frame (portraits) are found on the whole image, with no crop.
- Choose the largest face of all, whole-image or head-crop, by bounding box; then the pose whose nose landmark lies inside the chosen face box (the nearest the box's centre when several do). Show the crop used so the user sees which face was picked.
- Face gates, on the chosen face:
  - Hard gates: |yaw| and |pitch| ≤20° from the facial transformation matrix (too turned → message with tips), and the face-oval box ≥120 px wide in the full-resolution image (too small → message).
  - Projection gate: the face-oval box ≥256 px wide **in the full-resolution image** (projection quality). Below it the analysis still returns params, with no `Likeness` and `face: 'default'`. M3c adds the close-up prompt: ask for an additional close-up photo of the same person's face (optional; that photo supplies only the face texture and head shape, and gets the same face gates), or continue with the default face.
- Body gate, on the chosen pose: shoulders, hips, knees and ankles each with visibility ≥0.5, and the shoulder line within 25° of facing the camera (from landmark depth). Fail → continue with a default body for the entered height and open the body sliders on the Reveal screen; the face is still used.
- Run `ImageSegmenter` for hair / face-skin / body-skin / clothes masks (confidence masks, threshold 0.5), restricted to the chosen person's region so other people do not contaminate samples: the union of the face box grown 2.5× and the pose landmarks' bounding box, grown by 10% of that box's height on every side, within the image.

Extraction (pure functions in `analysis/mapping/` and `likeness/`, unit-tested on fixtures):

| Output                 | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Mapping                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------   | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skin`                 | face-skin mask pixels converted to OKLab; drop the darkest and brightest 20% by L; median                                                                                                                                                                                                                                                                                                                                                                                                                                            | hex; also stored as `Likeness.sourceSkin`                                                                                                                                                     |
| `hairColor`            | hair mask pixels, brighter half by L; median in OKLab                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | hex. If hair mask area < 2% of face box area → `hair: 'none'` suggested.                                                                                                                      |
| `eyeColor`             | iris landmarks (468–477), disc of radius 0.6 × iris radius, median in OKLab                                                                                                                                                                                                                                                                                                                                                                                                                                                          | snapped to the nearest of 6 presets (selects one of 6 eye-colour preset textures; the photo's eyes are not projected, see §7)                                                                 |
| `hair`                 | hair mask geometry relative to the face box: length class, volume, bangs, parting side (as built in M1)                                                                                                                                                                                                                                                                                                                                                                                                                              | nearest hairstyle by tag distance; ties broken by volume                                                                                                                                      |
| `Likeness.headOffsets` | the 468 face landmarks (the iris left out) in image space (x·W, −y·H, −z·W), aligned to MediaPipe's canonical landmarks by a least-squares similarity (Umeyama). What the similarity leaves over, the residuals, is the person's face shape.                                                                                                                                                                                                                                                                                         | residuals in base space (depth at half weight, each clamped to 15 mm), spread over the head by a Gaussian RBF on the landmarks (§12), held at zero behind the ears, faded by head weight      |
| `Likeness.faceTexture` | full-resolution face crop. For each triangle of MediaPipe's face-mesh triangulation, warp the photo triangle (landmark image positions) into the same triangle's position in the base head's UV layout (correspondence data, §12), on the CPU (a triangle rasteriser). Hair pixels (segmenter) and the eye and inner-mouth regions (landmark polygons) are masked out and filled from their surroundings. De-light: divide by a heavily blurred luminance, multiply by the median skin L. Feathered alpha at the face-region border. | WebP 1024²; PNG where the browser can't encode WebP (Safari)                                                                                                                                  |
| `body.*`               | pose landmarks + the person silhouette (body-skin ∪ face-skin ∪ clothes masks, the hair mask kept apart), resampled to the 1024 px copy and restricted to the person region. Ten ratios, left and right averaged: shoulder, bust, waist, hip, thigh, calf and upper-arm widths, leg length and arm length, each ÷ height in pixels; silhouette area ÷ height². Height: head top to ankle line (mean y of landmarks 27, 28). The head top comes from the face, not the silhouette, so hair never changes it: face landmark 10 raised by `headTopFactor` × its distance from landmark 152, `headTopFactor` being the base's (skull top − y₁₀) ÷ (y₁₀ − y₁₅₂) from `correspondence.json` (the skull top: the highest head vertex of weight ≥0.999; 0.412 today). Torso widths: t = 0 at the shoulder line and 1 at the hip line (mean y of 11/12, of 23/24); on each row, the span of body ∪ hair through the midline (the line through the mid-shoulder and mid-hip points), bridging background gaps up to 1% of the height, one the midline lies in too, with the hair then trimmed off both ends; a row whose span does not hold the midline (it lies in a wider gap, or in hair with the body on one side only) is skipped and never reaches the band's reducer. Bands and reducers: shoulder t −0.05..0.1, the widest row, the span as it is (the arms hang from there); bust 0.3..0.4, the median; waist 0.55..0.85, the narrowest; hip 0.9..1.1, the widest. Arms, in the bust, waist and hip bands: a side whose arm axis (shoulder→elbow, or elbow→wrist below the elbow) lies inside the span ends at the background between arm and torso when the span bridged some (the first gap from the axis toward the midline, the hair there trimmed off), so a gap under the bridge is never measured into the torso; that gap must start within 1.5 × the upper-arm width of the axis, about the arm's own extent, and the side must then reach ¾ of the other side's half-width and 0.7 × the half-width from its own arm (its axis less half the upper-arm width), since a hole farther in (a strap, an accessory, a speckle) is the torso's own; otherwise the arm touches, and the side takes the other side's half-width; when both touch, each side ends at its axis less half the upper-arm width, and such a row reaches the band's reducer only when the band has no other row. Limb widths: at ½ along shoulder→elbow and ⅓ along hip→knee and knee→ankle, twice the shorter of the two walks along the perpendicular over the body (no hair) to the background, so a hand on the thigh or touching legs never widen it. Leg length: hip→knee→ankle; arm length: shoulder→elbow→wrist. Area: the body's pixels (no hair) on the rows from the shoulder line to the ankle line. No measurement when a torso band has no row left, the height in pixels is ≤0, the hip line is not below the shoulder line, or a ratio is not finite and >0 (an upper arm the segmenter takes for an accessory measures 0 wide): the body gate then reports the body as not visible, and the default body is used.                                                                                                                                                                                                      | calibrated regression (below) → morph values, clamped -1..1                                                                                                                                   |
| `body.heightCm`        | user input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | as entered                                                                                                                                                                                    |
| `body.gender`          | not inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | default 0; the Reveal screen shows the slider                                                                                                                                                 |
| `extras`               | not detected in v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | toggles in the editor                                                                                                                                                                         |

Body calibration: generated, not photographed. `tools/calibrate-body.ts` (`npm run calibrate:body`) renders the runtime avatar in the app, in headless Chromium: full-length at 1400×2200, front view, bald, in the base layer, neutral, the arms lowered 70° from the T-pose, at 165 cm. Each render goes through the app's own analysis, so the ratios come from the same detection, segmentation and measurement as a photo's, and the regression inverts the morphs as the app applies them. 600 training and 100 held-out bodies (from another seed), sampled uniformly: each morph in −1..1, gender in 0..1, the skin one of six tones; a render the analysis rejects or whose body gate fails is dropped, at most 2% of them. Gender is an input to the regression beside the ten ratios: it is never inferred, but its slider changes the build, so the estimate takes the current gender as given. The regression, per morph: ridge on the inputs standardised over the training set, of degree 1 or 2 (the inputs, then their squares and pairwise products), λ by 5-fold cross-validation; the degree whose worst held-out outline ratio is lower is kept (each held-out estimate is rendered and measured again). Real clothes are looser than the base layer, so widths read high; each photographed width is divided by 1 + its clothing allowance before the regression. The allowance is 0 for every width until M3c tunes it on the test-photo set (§16); it is in the calibration file, so tuning it changes no code. Only the calibration ships, in `analysis/body-calibration.json`: the allowance, the standardisation, the degree, the coefficients, the held-out outline error per ratio and the maximum error per morph. The held-out samples are a unit-test fixture, `tests/fixtures/body-holdout.json`: each held-out render's ratios, its truth, the estimate and the ratios of the estimate's render, only numbers measured on renders of the avatar.

Output: a complete `AvatarParams` with `face: 'photo'` (or `'default'`), `outfit` set to the default outfit, `pose: 'stand_neutral'`, `expression: 'neutral'`; and a `Likeness` when the face passed its gates.

Performance: models (~30 MB with `PoseLandmarker`: face 3.8 MB, pose 9.4 MB, segmenter 16.4 MB) download when the user reaches the upload step, with a progress bar; analysis runs in a Web Worker where OffscreenCanvas is available, otherwise on the main thread with the UI in a loading state. Target: < 1.5 s analysis including texture projection on a mid-range phone after models are loaded.

## 7. Avatar

- One base, a MakeHuman character built with MPFB2 and exported as VRM 1.0 by `tools/blender/build_base.py` (Blender headless, driven by `tools/build-base.ts`):
  - Body mesh keeps MakeHuman's topology (≈13k vertices) so landmark correspondences and garment fitting are stable. Shape keys for each `BodyMorph` are created from the matching MakeHuman modifiers (both directions for -1..1 morphs) and exported as morph targets. Body morphs never move the head: each shape key's offsets are zeroed above the neck, blended to full strength over the neck so there is no seam. The head's shape comes only from the likeness, so the correspondence data (§12) built on the base head stays valid at every body shape.
  - Expressions: MPFB2 face poses for the five expressions are baked to shape keys and registered as VRM expression presets.
  - Eyes, teeth and tongue are separate meshes from the MakeHuman system assets. The eyeballs switch between six shipped eye textures, one per `eyeColor` preset, instead of tinting a greyscale iris.
  - Body texture: realistic skin albedo from the MakeHuman system assets (the M2 base ships the albedo only; a normal map is an M7 realism item), neutralised to a mid skin tone, plus a region-ID texture (R channel codes: torso, pelvis, upperArms, forearms, thighs, calves, feet, neck). The base layer (sports crop top and short shorts) ships as an overlay texture in the body's UV layout, composited over the tinted skin at runtime, so the tint never colours it.
  - No hair on the base; hairstyles are separate assets.
  - Rig: MPFB2's game-engine skeleton, mapped to VRM humanoid bones in the export.
- Applying params and likeness:
  - `body.*` morphs → morph target influences on the body mesh and on every attached garment and hairstyle (same morph names, §8). `heightCm` → uniform scale of the avatar root relative to the base's height at the current morphs.
  - `skin` → multiplier on the neutral skin albedo in linear light, under the base layer, so the body matches `Likeness.sourceSkin` (or `skin` when there is no likeness). A calibrated gain, per channel 1 / the neutral skin's median in linear light over the texels the base layer leaves clear, is the Skin material's colour; the skin canvas holds the albedo divided by it, so nothing on it clips and the rendered skin's median is `skin` itself. The face follows skin edits: the face texture is multiplied by `skin` / `Likeness.sourceSkin` (linear, per channel), so at `skin` = `sourceSkin` it renders as projected.
  - `Likeness.headOffsets` → added to the body mesh as one extra runtime morph target at influence 1, so expression morphs still compose on top. Head-attached assets (hairstyles, `head` items, glasses) follow the same fit: each carries a head binding (§8), and on attach, or when the likeness changes, a runtime "likeness" morph target is built for the asset from `headOffsets` through that binding.
  - `Likeness.faceTexture` → composited over the head region of the body albedo on a 2048² canvas using its alpha; recomposited only when likeness, `skin` or the outfit changes.
  - `face: 'default'` (no likeness on this device, e.g. a shared link) → the base head with no offsets and no projected texture.
  - `hairColor` → tint on greyscale hair textures; `eyeColor` → that preset's eye texture; `hair`, `extras`, `outfit` → attach assets (§8).
- Body region visibility: the body material uses `alphaMode: MASK`; the composited body texture sets alpha 0 where the region-ID matches any region in the union of equipped garments' `covers`. Recomposited only when the outfit changes.
- Raw vs normalised bones: skinned assets bind to the raw bones; poses are applied to three-vrm normalised humanoid bones and propagated by `vrm.update()`.
- No spring-bone physics in v1: hair and skirts are rigidly skinned. Still images do not need settling, and skipping physics keeps hair and garments modular. Physics is a v2 candidate.

## 8. Wardrobe

Slots: `top`, `bottom`, `full` (dress/jumpsuit; excludes `top` and `bottom`), `shoes`, `outer`, `head`. Hairstyles use an internal `hair` slot with the same attach mechanism; a `head` item may declare `hidesHair: true` (hijab, full helmet).

Garment asset: a GLB containing one or more `SkinnedMesh` skinned to the same raw skeleton and bind pose as the base, standard PBR material, textures ≤1024², meshopt-compressed, typically 100–600 KB. Every garment and hairstyle carries a morph target for each `BodyMorph` direction, generated at build time (`tools/build-garments.py`: bind the garment to the base body with Blender's Surface Deform, evaluate each body shape key, store the result as a garment shape key). Until M4 adds garments, the stock hairstyles are built by `tools/blender/build_base.py` (not `tools/build-garments.py`), as plain skinned GLBs with body morphs and no meshopt (decision log 2026-11-10); `tools/build-base.ts` adds their head binding (M3), and `head` items and glasses get theirs when they exist. Hairstyles, `head` items and glasses also carry a head binding: for each vertex, the three nearest base-head vertices (the Body vertices of the correspondence's head, §12) and inverse-distance weights, w ∝ 1/(d + 0.1 mm), normalised. It is a vertex attribute pair on every primitive, built by the same tool: `_HEADBIND_IDX` (UNSIGNED_SHORT VEC4, tightly packed: the Body vertex indices in the first three components, the 4th always 0 and unused, because glTF 2.0 §3.6.2.4 starts every vertex-attribute element on a 4-byte boundary and a VEC3 of shorts is 6 bytes) and `_HEADBIND_W` (FLOAT VEC3, weights summing to 1); three.js's GLTFLoader lowercases them to `_headbind_idx` and `_headbind_w`. The base's own head meshes carry the same binding, so that they follow the likeness too: the brows and lashes per vertex; each eyeball, the teeth and the tongue rigidly, every vertex taking the binding of its part's centroid, so that they move without deforming. Sources: MakeHuman clothes and hair assets (`.mhclo`, fitted to the base by MPFB2) with an acceptable licence (§12), or garments modelled in Blender on the base.

Catalogue entry:

```ts
type Garment = {
  id: string;
  slot: Slot;
  name: string;
  thumb: string;
  collection: 'everyday' | 'street' | 'cosplay' | 'heroine' | 'halloween';
  covers: Region[]; // body regions the garment fully covers; made transparent while worn
  colorable: boolean;
  palette?: string[]; // tint presets when colorable
  hidesHair?: boolean; // head items
  heelHeight?: number;
  heelAngle?: number; // shoes, metres and degrees
  tags: string[];
};
```

Runtime attach: load the GLB (cached by URL), for each `SkinnedMesh` build a `THREE.Skeleton` whose bones are the avatar's raw bones looked up by the garment skeleton's bone names, reuse the garment's own `boneInverses` (identical bind pose), call `mesh.bind(skeleton, mesh.bindMatrix)`, add the mesh under the avatar root, copy the current body morph influences, apply tint if `colorable`. Body morph changes update every attached mesh. Detach removes and disposes geometry, materials and textures. Missing bones or missing body morphs abort the attach with a toast and keep the previous item.

Clipping strategy: garments are modelled 3–6 mm proud of the body, and `covers` hides the skin under them. The screenshot-regression suite (§15) renders every garment in four poses at three body shapes (default, and two extremes of weight/bust/hips) to catch regressions.

Shoes: `heelHeight` raises the hips by that amount in standing poses; `heelAngle` overrides the foot bones' pitch after a pose is applied.

Collections and v1 inventory (one base):

| Collection      | Items                                               | Examples (all original designs)                                                                                                         |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Everyday        | 4 tops, 4 bottoms, 2 full, 3 shoes, 2 outer, 2 head | tee, shirt, knit, hoodie; jeans, chinos, skirt, joggers; dress, jumpsuit; sneakers, boots, heels; jacket, coat; cap, beanie             |
| Cosplay & anime | 2 full, 1 top, 1 bottom, 1 outer, 1 head, 1 shoes   | magical-girl dress, sailor-collar uniform set, maid-café apron set, shrine-maiden robes, idol stage top, ninja wrap, yukata, knee boots |
| Super-heroine   | 2 full, 1 outer, 1 head, 1 shoes                    | two original suits with emblem placeholders, cape, domino mask, armoured boots; colourable                                              |
| Halloween       | 3 full, 1 outer, 1 head, 1 shoes                    | witch dress, vampire gown, devil set, cat set, pirate set; cloak; hat/horns/ears; boots                                                 |

Total ≈ 35 items. All four collections are in v1. Everyday items come from the MakeHuman libraries where a suitable one exists; everything else, including all themed items, is modelled for this project in Blender by scripted modelling (Blender Python), on the base and through the same pipeline (§12). The everyday collection is required for launch; themed collections can ship with fewer items if asset work runs long. `colorable` palettes are the cheap way to add variety. The wardrobe UI groups by collection and shows slot chips.

Design rule for themed collections: archetypes, not characters. Names and descriptions must not reference an existing character or franchise; emblems are original marks; colourways avoid signature combinations. The linter denylist is a starting safeguard, not a substitute for review.

## 9. Posing

Poses are static. A pose file is JSON:

```ts
type Pose = {
  id: string;
  name: string;
  category: 'standing' | 'sitting' | 'lying' | 'action' | 'dance' | 'editorial';
  tags: string[];
  thumb: string;
  hips: { position: [number, number, number]; rotation: [number, number, number, number] };
  bones: Partial<Record<VRMHumanBoneName, [number, number, number, number]>>; // local quaternions, normalised bones
  expression?: AvatarParams['expression'];
  camera?: 'full' | 'portrait';
};
```

Applying: for each bone set the normalised bone node's quaternion; set hips position offset (scaled by the avatar's height scale); then apply `poseTweak` (head turn/tilt on `head`, lean on `spine`, each ±25°); then shoe `heelAngle` on `leftFoot`/`rightFoot` and `heelHeight` on hips when the pose is standing; then `vrm.update()`. Expressions are VRM expression presets set via `expressionManager` (`neutral`, `happy`, `relaxed`, `surprised`, and `wink` mapped to `blinkLeft`).

Camera: `full` fits the avatar's world bounding box with margin so lying poses are not cropped; `portrait` frames head and shoulders. Orbit controls allow rotate and zoom; pan disabled.

Authoring:

1. `tools/pose-from-mixamo.ts`: loads a Mixamo FBX, retargets to the VRM rig with three-vrm's Mixamo bone map, samples a frame, writes pose JSON.
2. Dev pose editor at `/dev/poses` (dev build only): avatar, bone picker, rotation gizmos, hips-offset handle, floor-contact helper (translates hips so the lowest foot/hand/knee sits at y=0), mirror left↔right, load/save JSON, thumbnail preview. Used to recreate reference-sheet poses and to fix Mixamo poses that read badly.

v1 list (~25): standing — neutral, hand on hip, arms crossed, wave, peace sign, thinking, lean, over-the-shoulder hand on hip, hand to cheek; sitting — back on hands knee up, kneeling on one hand, kneeling arms behind head; lying — on front propped on elbow; action — mid-stride, jump, pointing; dance — Hip Pop, Body Wave, Squat Dance, Hair Flip, two generic dance poses; editorial — Overhead, Kneel Arch, Turn Pose, Floor Flow, Reach Up. Mirrored variants are generated, not hand-made. Every pose is reviewed on the realistic body against the §3 pose rule before it ships (§18).

Sitting, kneeling and lying poses get no collision handling in v1 (no physics, rigid garments and hair). Minor clipping into the floor or between garment and body is acceptable if it is not prominent from the pose's default camera; the screenshot review is the judge. A pose that clips badly with common garments is fixed in the pose editor or dropped, not solved with per-pose corrective shapes.

## 10. Export and share

- Save image: render the current view to an offscreen target at 2× the canvas resolution (capped at 2048 px long edge), read back to a canvas, `toBlob('image/png')`; download on desktop, `navigator.share({ files })` on mobile when available, falling back to download. Optional transparent background when the backdrop is "none". The image shows the projected face; it is created on the device and only leaves it if the user shares it.
- Copy link: `location.origin + '/#p=' + base64url(deflateRaw(JSON.stringify(params)))`. Opening a link validates with the zod schema, runs migrations by `version`, and loads the avatar with `face: 'default'`: the recipient sees the body, colouring, hair, outfit and pose, with the default face. Links never carry the photo or the likeness. The Export sheet says so next to Copy link.
- Continue later: params are written to `localStorage` on every change (debounced); `Likeness` is written to IndexedDB once per analysis. On launch, if present, the Studio opens directly with a "Start over" affordance, which deletes both.

## 11. Screens

Mobile-first; desktop uses the same layout with side panels instead of a bottom sheet.

1. Landing — one-line pitch, Upload a full-length photo (camera or gallery), photo tips, height input, 18+ confirmation, consent checkbox and line, privacy line, "Try a default avatar" link.
2. Analysing — model download progress, then analysis spinner; photo preview with the face crop and body outline used. If the face is too small, the close-up prompt (§6) appears here.
3. Reveal — avatar spins in; quick-fix row: skin swatches (analysed colour first, then 8 presets), hairstyle carousel, hair colour, eye colour, body sliders (height, gender, weight, muscle, shoulders, bust, waist, hips, leg and arm length; open by default when the body gate failed), glasses toggle; buttons: Continue, Start over.
4. Studio — viewer; bottom sheet with tabs Body · Hair · Outfit · Pose · Scene; Body has skin, eye colour, the body sliders and "Use a new photo"; Outfit shows collection filter, slot chips, thumbnail grid, colour swatches for colourable items; Pose shows category filter, thumbnails, tweak sliders, expression picker; Scene shows backdrop and framing; Share/Export button top-right.
5. Export sheet — preview, Save image, Share, Copy link (with the "links show the default face" note).

Copy is in `ui/strings.ts` for later localisation.

## 12. Assets and pipeline

Inventory (v1): 1 base; ≥12 realistic hairstyles covering buzz/crop, short coily, afro, locs, box braids, bob, medium straight, long straight, long wavy, curly, ponytail, bun; garments per §8; 6 eye-colour textures; 3 glasses; ~25 poses; 5 expressions; 4 backdrops; 3 MediaPipe models; correspondence data.

Correspondence data (`public/assets/base/correspondence.json`, built with the base): for each of MediaPipe's 468 face landmarks, its point on the base's face (Body triangle + barycentrics), its position and its UV; MediaPipe's face-mesh triangulation over those landmarks; the face texture's UV square; the head vertices with their head weights and bind positions; and the points the head fit holds still. The 10 iris points are not on the head surface and are left out. Built by `tools/base/correspondence.ts` inside the base build, from the exported base: the MediaPipe canonical face model (`assets/source/mediapipe/face_model_with_iris.obj`) is aligned to the base head by a similarity transform fitted to automatic anchors (the iris centres onto the corneas, the nose tip onto the nose tip), then each landmark is projected onto the face's UV island. Most landmarks go to their closest point. The lips and the base of the nose go along the base's view direction (−z), as the frontal photo sees them: from behind a convex lip the closest point is the crease between the lips, which collapsed the upper lip onto it. Their front-view positions come from the canonical model's UV layout, which is fold-free and has a closed mouth like the base's, through an affine map fitted to the landmarks around them; a thin-plate spline then takes the inner lip contours to the edges of the base's mouth slit and the inner mouth corners to its ends. The landmarks around them go along the view too, so the switch to closest point happens on smooth skin. The build writes a review render that overlays the projected landmarks on the head.

Pipeline (`npm run assets`, idempotent):

1. `tools/blender/build_base.py` (Blender headless, MPFB2; driven by `tools/build-base.ts`): create the base human, add body-morph shape keys, bake expressions, neutralise skin, bake base layer and region-ID texture, export VRM 1.0.
2. `tools/base/correspondence.ts`, run by `tools/build-base.ts` on the exported base: the correspondence data, as above.
3. `tools/build-garments.py` (Blender headless): fit each garment or hairstyle source to the base, verify skeleton compatibility, transfer body-morph shape keys, export GLB. Until M4 adds garments, hairstyles are built by `tools/blender/build_base.py`, not `tools/build-garments.py`.
4. `gltf-transform`: meshopt compression (for the base an M7 performance item: base.vrm is ~4.4 MB uncompressed today), texture resize (≤2048² for the body, ≤1024² for everything else), WebP textures.
5. `tools/pose-from-mixamo.ts` for Mixamo-sourced poses.
6. `tools/build-catalog.ts`: validates every entry, renders thumbnails (256 px, neutral outfit for poses, neutral pose for garments) with headless Chromium via Playwright, writes `catalog.json`.
7. `tools/calibrate-body.ts` (`npm run calibrate:body`, on demand): body-measurement regression on renders of the avatar analysed by the app (§6).

Licensing: `assets/LICENSES.md` lists every item, source and licence. MakeHuman core and system assets are CC0. Community MakeHuman assets vary per item: CC0 and CC-BY are accepted (CC-BY items are credited on an in-app credits page); anything else is not used. Mixamo clips are used to derive pose data under Adobe's terms; MediaPipe models are Apache-2.0. MPFB2 itself (GPL v3) runs only at build time and is not shipped. Themed collections and any hair or garments without a suitable library source are original designs created for this project: modelled by scripted Blender (`tools/garments/*.py`, `tools/hair/*.py`, one script per item, re-runnable), with the review renders from the screenshot suite as the quality bar.

## 13. Dev tooling

- Debug page `#analysis`: upload photo; shows face and body landmarks and masks overlaid, extracted swatches, body ratios and the resulting morph values, the projected face texture in UV space, the head fit (landmarks vs fitted head), chosen hairstyle with runner-ups, and the resulting avatar. Used for the likeness gate and for tuning.
- Pose editor `/dev/poses` (§9).
- Catalogue linter (`npm run lint:catalog`, also in CI): schema validity; garment has `slot` and `covers`; `torso` only in `top`/`full` items and `pelvis` only in `bottom`/`full` items; `full` items do not also declare `top`/`bottom`; garments and hairstyles carry every body morph; hairstyles, head items and glasses carry a head binding; pose `category` in the allowed set; names and tags free of denylisted terms; every referenced file exists; thumbnails present.

## 14. Error handling

| Situation                        | Behaviour                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| No face, or face turned          | Message with tips; "Start from a default avatar".                                  |
| Face too small for projection    | Ask for an additional close-up photo; or continue with the default face.           |
| Photo face fails to build        | Default face; the params are kept, and the analysis says so.                       |
| Body not fully visible or turned | Default body for the entered height; body sliders open on Reveal; face still used. |
| Several faces                    | Largest chosen; crop shown.                                                        |
| Model download fails             | Retry button; after two failures offer the default avatar.                         |
| IndexedDB unavailable or full    | Likeness kept for the session only; a note says it won't be there next visit.      |
| WebGL2 unavailable               | Static message with supported browsers list.                                       |
| WebGL context lost               | Renderer recreated on `webglcontextrestored`; params and likeness reapplied.       |
| Garment/hair/pose load fails     | Previous item kept; toast.                                                         |
| Invalid or old share link        | Migrate by `version`; if impossible, reset to default avatar with a message.       |
| Low memory / low-end device      | Pixel ratio ≤2; garments lazy-loaded; textures and geometry disposed on swap.      |

## 15. Testing

- Unit (Vitest): analysis mapping functions on recorded landmark/mask fixtures (no ML in tests); body-ratio extraction and regression; head-offset RBF on fixtures; UV warp triangle mapping; params schema and migrations; URL round-trip; pose application maths; catalogue validation.
- Body estimator accuracy (automated, on generated data): on held-out renders of known bodies in the base outfit, the estimated body, rendered and measured the same way, reproduces each of the ten ratios with an RMS error of at most half that ratio's standard deviation across the held-out bodies (the default body scores about 1). The morphs themselves are not a target: a front view cannot separate them (bust changes depth; weight, muscle and waist trade off in the outline), and the Reveal sliders correct what it cannot see.
- Integration (Playwright): debug page over a small consented/free-licence photo set asserting detection, gates and parameter ranges; screenshot regression of every garment × four poses × three body shapes and every pose in the neutral outfit, with a pixel-diff threshold.
- Likeness gate (human): for 10 diverse consented full-length photos, a third person shown the photo picks the matching avatar out of three (rendered full-length, same outfit and pose for all three). Pass: ≥9/10. Below that: fix projection, head fit or body mapping before the wardrobe milestone. Protocol and tooling as in `docs/superpowers/m1-lineup-test.md`.
- Manual device pass: iOS Safari (iOS 16+), Android Chrome, desktop Chrome/Firefox/Safari.
- Budgets: interactive < 3 s on 4G excluding models; models with visible progress; garment/pose swap < 1 s; JS < 600 KB gzipped; base avatar + default outfit < 8 MB.

## 16. Milestones

Each milestone gets its own implementation plan.

- M0 Scaffold — done.
- M1 Face → avatar, attribute version — done, partly superseded by the 2026-11-09 revision. Carried forward: MediaPipe adapter, photo decode, skin/hair/eye colour extraction, hairstyle ranking, debug page, lineup tooling, attach machinery. Retired: VRoid base build, synthetic face morphs, face-shape/brow/lip mapping, MToon materials, two-base model.
- M2 Realistic base — MPFB2 → VRM pipeline, body-morph shape keys, expressions, region IDs, realistic skin, height scaling, body sliders in the dev panel, default face. Done when the base renders in the app at a range of body shapes and expressions, within budget.
- M2b Stock hairstyles — MakeHuman's 10 CC0 hairstyles ship as skinned GLBs with body morphs, tinted by `hairColor`, as a stopgap. M3's ≥3 realistic starter hairstyles still stand.
- Test-photo collection (runs alongside M2 and M3; owner not yet decided) — consent wording (written, adults, photos stay on the tester's machine, deleted after scoring), recruit at least 10 adults spread across skin tones, body types, hair types and genders, one full-length photo each plus height and bust/waist/hip measurements, and a judge who doesn't know them. M3 cannot be signed off until this set exists.
- M3 Photo likeness and gate, in three plans. M3 is done when the likeness gate passes.
  - M3a Photo face — correspondence data, head binding of the head meshes and hairstyles, head fit, face projection with de-lighting, skin match, the likeness on the avatar (brows hidden), debug page updates. Done when a photo analysed on the debug page puts its face on the avatar.
  - M3b Body from the photo — `PoseLandmarker`, body measurement and calibration, the body gate. Done when a full-length photo analysed on the debug page shapes the avatar's body at the entered height, and the held-out outline test passes: each held-out estimate, rendered and measured again, reproduces every ratio within half its spread (§15).
  - M3c Likeness store and gate — the `Likeness` IndexedDB store, the close-up fallback, ≥3 realistic starter hairstyles, and the likeness gate run with the test-photo set.
- M4 Wardrobe — garment pipeline with body-morph transfer, attach/detach, region masks, catalogue and linter, Outfit tab, ~10 everyday garments. Done when outfits swap without clipping across body shapes in the regression suite.
- M5 Posing — pose format, Mixamo extractor, pose editor, ~25 poses reviewed on the realistic body, expressions, heels, Pose tab. Done when all poses pass screenshot review.
- M6 Product shell — landing, 18+/consent, height input, analysing and reveal screens, studio tabs, export/share, continue-later with IndexedDB, themed collections. Done when the full loop works on phone and desktop.
- M7 Hardening and launch — device matrix, error states, performance budgets, privacy page and terms, final catalogue lint, credits page, hosting and domain. Done when the launch checklist is green.

## 17. Decisions log

- Ready Player Me shut down 31 Jan 2026 (Netflix acquisition); Union Avatars followed. Surviving selfie-to-avatar APIs (MetaPerson, Avaturn) start at ~$800/month. Decision: own in-browser pipeline; no vendor dependency for the core.
- ~~Likeness is attribute-based (colours, hairstyle, face-shape morphs), not photo projection or a face scan.~~ Superseded 2026-11-09.
- 2026-11-09: The avatar is a realistic double. The face comes from the photo (projected texture on a landmark-fitted head); the body is shaped to proportions measured from the photo plus the entered height. Chosen over a photo on the stylised head (uncanny) and a realistic head on a stylised body (mismatched).
- 2026-11-09: MakeHuman via MPFB2 for the base, hair and clothes: CC0 core assets (commercial use allowed), continuous body modifiers on one topology, glTF/VRM export from Blender. Rejected: MetaHuman (too heavy for the browser, no in-browser creation from a photo, unclear licence outside Unreal), SMPL/SMPL-X (non-commercial licence), VRoid (stylised). Anny (NAVER LABS, Apache 2.0, built on MakeHuman assets) is a reference for body estimation; its SMPL-X-compatible topology file is non-commercial and not used.
- 2026-11-09: VRM 1.0 kept as the runtime container (humanoid rig, normalised bones, expressions) with standard PBR materials instead of MToon.
- 2026-11-09: One base with body morphs replaces two bases; `gender` is a continuous morph, not inferred from the photo.
- 2026-11-09: Uploads of any photo stay (consent checkbox and terms as before), so the content rules stay strict: no lingerie, sleepwear or nightwear. Allowing those would require the likeness to be locked to the person using the app (live camera capture with a liveness check instead of uploads); that trade-off was considered and declined.
- 2026-11-09: Share links carry params only; recipients see the default face. The likeness stays on the device (IndexedDB) for continue-later.
- 2026-11-10: Stock hairstyles ship early, on the owner's request: MakeHuman's 10 CC0 hairstyles (M2b). The default hair is `bob02`. The head binding (§8) moves to M3, where the likeness needs it. meshopt compression moves to M7.
- 2026-11-11: The correspondence data is built by `tools/base/correspondence.ts` inside the base build, from the exported base, with automatic anchors (the corneas and the nose tip), instead of by a separate `tools/build-correspondence.py` with hand-picked anchors. Why: its vertex indices must be glTF vertex indices of the shipped mesh, which exist only once the exporter has split the vertices at UV seams and the build has written base.vrm; and automatic anchors keep the build unattended and repeatable.
- 2026-11-11: The face texture's warp runs on the CPU, as a triangle rasteriser in `src/likeness/faceTexture.ts`, instead of on a WebGL canvas. Why: it is unit-testable without a GPU, can move to a Worker later, and takes no second WebGL context beside the renderer's; and the work is small, ~0.5 M texels (the face oval covers 0.47 M of the 1024² on the base).
- 2026-11-11: M3 is split into three plans (§16): M3a the photo face; M3b the body from the photo; M3c the `Likeness` store, the close-up fallback, the realistic starter hairstyles and the likeness gate run. M3's done-when, the likeness gate, is run in M3c, once all three are in.
- 2026-11-11: With a photo face the 3D brows hide, and they show again with the default face. Why: the projected photo carries the person's own brows, in their shape and place, and the base's brows on top would double them.
- 2026-11-15: Faces in full-length photos are found on a head crop, and the 120 px hard gate is measured at full resolution (§6). The M3b spike rendered the avatar full-length (arms lowered 70°) at 700×1100 and 1400×2200: `FaceLandmarker` on the 1024 px copy found no face at either size, with hair or bald, the face being ~65 px wide there; a square head crop of the full-resolution render, centred on pose landmarks 0–10 with a side of 2, 3 or 4 × the ear-to-ear distance, found it every time (161 px cheek to cheek at 1400×2200); `PoseLandmarker` (full) returned all 33 landmarks, visibility ≥0.96 for the shoulders, elbows, wrists, hips, knees and ankles. So the M1 gate (≥120 px in the 1024 px copy) rejected every full-length photo, the spec's own expected input. Portraits are still found on the whole image, and the projection gate (≥256 px at full resolution) is unchanged. Rejected: two-photo capture, which would make M3c's close-up prompt mandatory for every user.
- 2026-11-15: The body is measured with ten ratios (§6): the shoulder, bust, waist and hip widths, the leg and arm lengths and the area, plus the thigh, calf and upper-arm widths. Why: weight, muscle and hips change the limbs as well as the trunk.
- 2026-11-15: Gender is an input to the body regression (§6), beside the ten ratios. It is still never inferred, but its slider changes the build, so the estimate takes it as given: the analysis passes the current gender, and M6's Reveal can re-estimate when it changes.
- 2026-11-15: The body calibration renders the runtime avatar in the browser (§6, §12): `tools/calibrate-body.ts` replaces `tools/calibrate-body.py`. Why: the regression must invert the morphs as the app applies them, which are linear shape keys (MPFB's macros don't combine linearly; see `BODY_CORNERS` in `build_base.py`), and only the browser runs MediaPipe, so the renders go through the same detection, segmentation and measurement as a photo.
- 2026-11-15: The measured height's top is the head top from the face landmarks, not the silhouette's top (§6): landmark 10 raised by the base's own head proportion, read from `correspondence.json`. Why: hair volume would otherwise change the measured height, and so every ratio; this holds on the calibration renders and photos alike.
- 2026-11-15: A torso row whose span does not hold the midline is skipped, and when a torso band is left with no row, the height in pixels is ≤0 or the hips are not below the shoulders, the body is not measured: the body gate reports it as not visible and the default body is used (§6). Why: such a span covers one side of the torso, which halves the row's width and, with a touching arm, turns it negative, and the narrowest and widest reducers pick exactly those rows; the default body beats one measured from half a torso. The cost: a photo with a wide hole down the midline across a whole band (a belt buckle, a phone, a bag strap) gets the default body.
- 2026-11-15: The body is estimated only when every ratio is finite and >0; otherwise it is not visible and the default body is used (§6). Why: the estimate passes a NaN through to the morphs, and a width of 0 (arms crossed over the torso, an upper arm the segmenter takes for an accessory) is not a measurement.
- 2026-11-15: A torso side ends at the background between arm and torso even when the span bridged it, and a row where both arms touch counts only in a band with no other row (§6). Why: just below the armpits the lowered arms stand 0–12 px off the torso, about the 1% bridge; a gap under it joined the arm to the span and the row was measured from the arm axes, some 45 px wider than the torso alone, so the bust's median flipped between the two as the body changed (held-out renders re-measured up to 25% off on the bust). Rows measured from the axes read wide too (the arm is wider there than its upper-arm width), and the median picked them where they were the majority.
- 2026-11-15: The gap between arm and torso must start within 1.5 × the upper-arm width of the arm's axis (§6); farther in, the arm touches. Why: with an arm merged into the torso, the first background toward the midline was any hole inside the torso on that side (a strap, an accessory, a speckle), and the side ended there; one such row also outvoted the rows read from both axes. On the avatar's held-out renders the gap starts at most 1.19 × the upper-arm width from the axis (the pose's axis sits off the arm's centre, and the arm is wider there), so the bound changes none of their ratios; a hole within it is left to the next entry's agreement.
- 2026-11-15: A side that ends at the gap to its arm must reach ¾ of the other side's half-width and 0.7 × the half-width from its own arm, its axis less half the upper-arm width (§6); shorter, it ends at a hole in the torso, and the arm touches. Why: within the 1.5 × reach a hole inside the torso still read as the gap. On the test figure (800 px tall), a strap 40 px off the midline narrowed the waist from 140 to 110 px, and one speckle there, with both arms touching, to 80 px, since that one row outvoted the rows read from both axes. The torso is about symmetric about the midline, so the other side catches a hole on one side, and the arm catches holes on both sides alike, where the two sides agree. On the 800 renders of the avatar behind the shipped calibration (training, held-out, and the held-out estimates rendered again) a side at a gap reaches at least 0.775 × the other side and 0.74 × its arm, so neither changes any of their ratios. A hole less than about a quarter of the half-width inside the torso's side still reads as the gap, and when the other arm touches too, the row gives that side's half-width to both: so close to the side, it looks like the renders' own gaps.
- 2026-11-15: The body estimate's target is the outline, the owner's decision (§6, §15): the estimated body, rendered and measured again, reproduces each ratio within half its spread across the held-out bodies. Why: the full calibration missed "every recovered morph within ±0.15" on all eight morphs (bust worst, at 1.01), since a front view cannot separate them; rendered again, its estimates reproduced most ratios at 0.09–0.22 of their spread, against about 1 for the default body.
- 2026-11-09: Themed collections (cosplay & anime, super-heroine, Halloween) stay in v1 and are modelled by scripted Blender, accepting simpler shapes than hand-made assets. The sailor-collar uniform set and the maid-café apron set stay in the cosplay collection. The concern that they read as school-uniform and maid costumes on a lifelike double was raised and considered; they follow the same rules as every garment (§3: cover at least the base layer, party-costume register, no fetish styling).
- VRM chosen over plain glTF for the standardised humanoid rig and expressions.
- No physics in v1 (static images; modular hair and garments stay simple).
- No backend in v1; share links carry params only.
- Themed collections (cosplay & anime, super-heroine, Halloween) are original archetype designs; no licensed characters.

## 18. Deferred decisions and defaults

- Product name: working title "Kiss"; final name and domain are needed by M7.
- Realism level: MakeHuman reaches game-quality realism, not photographic. Confirm direction on the first rendered base (M2).
- Realistic hair coverage: free CC0/CC-BY hair for coily, afro, locs and box-braid styles is scarce, so those styles are made by scripted Blender. Hair is the hardest thing to make convincing this way; if a style can't pass screenshot review by the end of M3, decide then whether to commission it or ship without it.
- Pose review: sitting, lying and editorial poses are re-reviewed on the realistic body against the §3 pose rule during M5.
- Analytics: none in v1 unless decided at M7; if added, event-only and privacy-preserving.
- Glasses and head-covering detection: toggles in v1; detection is a v2 candidate. Facial hair comes through the projected photo.
