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
- Content: because the avatar is a realistic likeness of a real person, and photos of other people are allowed, these rules are fixed for v1 (see §17 for what would have to change to relax them). Avatars always have a permanent base layer, a texture overlay composited over the tinted skin (undershirt and shorts), still permanent and always visible; clearing every slot never produces an undressed avatar. Garments never cover less than the base layer; no lingerie, no sleepwear/nightwear, no fetish gear. Costume collections (Halloween etc.) are party-costume register. The pose library is fashion, editorial, dance and everyday; no poses framed around the crotch or rear. All garment and character designs are original: no named characters, logos, wordmarks or signature colourways from films, comics, games or anime.
- Base-layer mechanics: the baked undershirt occupies the `torso` region and the baked shorts the `pelvis` region (§5). A body region only turns transparent under a garment that fully covers it (§8), so `torso` can only be hidden by a `top` or `full` item and `pelvis` only by a `bottom` or `full` item, and whatever is worn, the base layer or something at least as covering is always visible. Shoes, head items and short jackets list only the regions they fully cover (often none).
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
  faceTexture: Blob; // WebP, 1024², in the base head's UV layout; alpha = feathered face-region mask
  headOffsets: Float32Array; // per-vertex position offsets for the head region of the body mesh (base topology)
  sourceSkin: string; // hex sampled from the photo, used to tint the body to match
};
```

Supporting types used throughout:

```ts
type Slot = 'top' | 'bottom' | 'full' | 'shoes' | 'outer' | 'head';
type Region = 'torso' | 'pelvis' | 'upperArms' | 'forearms' | 'thighs' | 'calves' | 'feet' | 'neck';
```

`torso` is the undershirt area and `pelvis` the shorts area (hips, groin, seat, down to the shorts' hem); `thighs` starts below the hem.

Rules: `full` and (`top` or `bottom`) are mutually exclusive; the store enforces it when setting either. Unknown ids fall back to defaults with a toast. `version` drives migrations for share links and localStorage; version 1 was never released, so a version-1 link or stored state resets to the default avatar with a message rather than migrating. The schemas are validated with `zod` at every boundary (URL, localStorage, IndexedDB, analysis output).

## 6. Analysis: photo → avatar

Input: a file from `<input type="file" accept="image/*">`. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`. Keep the full-resolution bitmap until analysis completes (needed for the face crop), and draw a copy downscaled to a 1024 px long edge to an `OffscreenCanvas` for detection. iOS supplies JPEG for HEIC originals when `accept="image/*"`; other HEIC files fail decoding and show "Please use a JPEG or PNG".

The expected photo is one full-length, front-facing shot, face clearly visible. The upload step shows tips: stand straight facing the camera, whole body in frame, fitted clothes if possible, even light, neutral expression, glasses off, hair off the face. The user also enters their height (cm, or ft/in toggled), because a single photo does not give scale.

Detection and gates (on the 1024 px copy unless stated):

- Run `FaceLandmarker` (image mode, `numFaces: 4`). Choose the largest face by bounding box. Show the crop used so the user sees which face was picked.
- Face gates: |yaw| and |pitch| ≤20° from the facial transformation matrix; face width ≥256 px **in the full-resolution image** (projection quality). Too turned → message with tips. Too small → ask for an additional close-up photo of the same person's face (optional; that photo supplies only the face texture and head shape, and gets the same face gates), or continue with the default face.
- Run `PoseLandmarker` on the same image, choosing the pose whose nose landmark lies inside the chosen face box. Body gate: shoulders, hips, knees and ankles each with visibility ≥0.5, and the shoulder line within 25° of facing the camera (from landmark depth). Fail → continue with a default body for the entered height and open the body sliders on the Reveal screen; the face is still used.
- Run `ImageSegmenter` for hair / face-skin / body-skin / clothes masks (confidence masks, threshold 0.5), restricted to the chosen person (the union of a 2.5× face box and the pose bounding box with margin) so other people do not contaminate samples.

Extraction (pure functions in `analysis/mapping/` and `likeness/`, unit-tested on fixtures):

| Output                 | Source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Mapping                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skin`                 | face-skin mask pixels converted to OKLab; drop the darkest and brightest 20% by L; median                                                                                                                                                                                                                                                                                                                                                                                                                         | hex; also stored as `Likeness.sourceSkin`                                                                                                                                                     |
| `hairColor`            | hair mask pixels, brighter half by L; median in OKLab                                                                                                                                                                                                                                                                                                                                                                                                                                                             | hex. If hair mask area < 2% of face box area → `hair: 'none'` suggested.                                                                                                                      |
| `eyeColor`             | iris landmarks (468–477), disc of radius 0.6 × iris radius, median in OKLab                                                                                                                                                                                                                                                                                                                                                                                                                                       | snapped to the nearest of 6 presets (selects one of 6 eye-colour preset textures; the photo's eyes are not projected, see §7)                                                                 |
| `hair`                 | hair mask geometry relative to the face box: length class, volume, bangs, parting side (as built in M1)                                                                                                                                                                                                                                                                                                                                                                                                           | nearest hairstyle by tag distance; ties broken by volume                                                                                                                                      |
| `Likeness.headOffsets` | the 478 landmarks transformed by the inverse facial transformation matrix (pose-normalised, metric). Similarity-align them to the canonical landmarks; the residuals are the person's face shape.                                                                                                                                                                                                                                                                                                                 | residuals at the landmark-corresponding head vertices (correspondence data, §12), spread to the rest of the head with RBF interpolation, falling to zero at the ears and the back of the head |
| `Likeness.faceTexture` | full-resolution face crop. For each triangle of MediaPipe's face-mesh triangulation, warp the photo triangle (landmark image positions) into the same triangle's position in the base head's UV layout (correspondence data, §12), on a WebGL canvas. Hair pixels (segmenter) and the eye and inner-mouth regions (landmark polygons) are masked out and filled with surrounding skin. De-light: divide by a heavily blurred luminance, multiply by the median skin L. Feathered alpha at the face-region border. | WebP 1024²                                                                                                                                                                                    |
| `body.*`               | pose landmarks + the person silhouette (body-skin ∪ clothes ∪ hair masks). Ratios: shoulder width, bust width, waist width and hip width (silhouette width at heights interpolated between landmarks) each ÷ height in pixels (top of head to ankle line); leg length ÷ height; arm length ÷ height; silhouette area ÷ height².                                                                                                                                                                                   | calibrated regression (below) → morph values, clamped -1..1                                                                                                                                   |
| `body.heightCm`        | user input                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | as entered                                                                                                                                                                                    |
| `body.gender`          | not inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | default 0; the Reveal screen shows the slider                                                                                                                                                 |
| `extras`               | not detected in v1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | toggles in the editor                                                                                                                                                                         |

Body calibration: generated, not photographed. `tools/calibrate-body.py` renders MakeHuman bodies across a grid of morph values in the default base outfit, front view, measures the same ratios on the rendered silhouettes with the same code path, and fits a linear (ridge) regression from ratios to morphs. Real clothes are looser than the base layer, so widths read high; a per-ratio clothing allowance is applied before regression, tuned on a small set of consented real photos with known measurements. Only the regression coefficients ship, in `analysis/body-calibration.json`.

Output: a complete `AvatarParams` with `face: 'photo'` (or `'default'`), `outfit` set to the default outfit, `pose: 'stand_neutral'`, `expression: 'neutral'`; and a `Likeness` when the face passed its gates.

Performance: models (~15 MB with `PoseLandmarker`) download when the user reaches the upload step, with a progress bar; analysis runs in a Web Worker where OffscreenCanvas is available, otherwise on the main thread with the UI in a loading state. Target: < 1.5 s analysis including texture projection on a mid-range phone after models are loaded.

## 7. Avatar

- One base, a MakeHuman character built with MPFB2 and exported as VRM 1.0 by `tools/blender/build_base.py` (Blender headless, driven by `tools/build-base.ts`):
  - Body mesh keeps MakeHuman's topology (≈13k vertices) so landmark correspondences and garment fitting are stable. Shape keys for each `BodyMorph` are created from the matching MakeHuman modifiers (both directions for -1..1 morphs) and exported as morph targets. Body morphs never move the head: each shape key's offsets are zeroed above the neck, blended to full strength over the neck so there is no seam. The head's shape comes only from the likeness, so the correspondence data (§12) built on the base head stays valid at every body shape.
  - Expressions: MPFB2 face poses for the five expressions are baked to shape keys and registered as VRM expression presets.
  - Eyes, teeth and tongue are separate meshes from the MakeHuman system assets. The eyeballs switch between six shipped eye textures, one per `eyeColor` preset, instead of tinting a greyscale iris.
  - Body texture: realistic skin albedo from the MakeHuman system assets (the M2 base ships the albedo only; a normal map is an M7 realism item), neutralised to a mid skin tone, plus a region-ID texture (R channel codes: torso, pelvis, upperArms, forearms, thighs, calves, feet, neck). The base layer (undershirt and shorts) ships as an overlay texture in the body's UV layout, composited over the tinted skin at runtime, so the tint never colours it.
  - No hair on the base; hairstyles are separate assets.
  - Rig: MPFB2's game-engine skeleton, mapped to VRM humanoid bones in the export.
- Applying params and likeness:
  - `body.*` morphs → morph target influences on the body mesh and on every attached garment and hairstyle (same morph names, §8). `heightCm` → uniform scale of the avatar root relative to the base's height at the current morphs.
  - `skin` → multiplier on the neutral skin albedo, under the base layer, so the body matches `Likeness.sourceSkin` (or `skin` when there is no likeness).
  - `Likeness.headOffsets` → added to the body mesh as one extra runtime morph target at influence 1, so expression morphs still compose on top. Head-attached assets (hairstyles, `head` items, glasses) follow the same fit: each carries a head binding (§8), and on attach, or when the likeness changes, a runtime "likeness" morph target is built for the asset from `headOffsets` through that binding.
  - `Likeness.faceTexture` → composited over the head region of the body albedo on a 2048² canvas using its alpha; recomposited only when likeness, `skin` or the outfit changes.
  - `face: 'default'` (no likeness on this device, e.g. a shared link) → the base head with no offsets and no projected texture.
  - `hairColor` → tint on greyscale hair textures; `eyeColor` → that preset's eye texture; `hair`, `extras`, `outfit` → attach assets (§8).
- Body region visibility: the body material uses `alphaMode: MASK`; the composited body texture sets alpha 0 where the region-ID matches any region in the union of equipped garments' `covers`. Recomposited only when the outfit changes.
- Raw vs normalised bones: skinned assets bind to the raw bones; poses are applied to three-vrm normalised humanoid bones and propagated by `vrm.update()`.
- No spring-bone physics in v1: hair and skirts are rigidly skinned. Still images do not need settling, and skipping physics keeps hair and garments modular. Physics is a v2 candidate.

## 8. Wardrobe

Slots: `top`, `bottom`, `full` (dress/jumpsuit; excludes `top` and `bottom`), `shoes`, `outer`, `head`. Hairstyles use an internal `hair` slot with the same attach mechanism; a `head` item may declare `hidesHair: true` (hijab, full helmet).

Garment asset: a GLB containing one or more `SkinnedMesh` skinned to the same raw skeleton and bind pose as the base, standard PBR material, textures ≤1024², meshopt-compressed, typically 100–600 KB. Every garment and hairstyle carries a morph target for each `BodyMorph` direction, generated at build time (`tools/build-garments.py`: bind the garment to the base body with Blender's Surface Deform, evaluate each body shape key, store the result as a garment shape key). Hairstyles, `head` items and glasses also carry a head binding: for each vertex, the three nearest base-head vertices and inverse-distance weights (a vertex attribute pair, built by the same tool). Sources: MakeHuman clothes and hair assets (`.mhclo`, fitted to the base by MPFB2) with an acceptable licence (§12), or garments modelled in Blender on the base.

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

Correspondence data (`public/assets/base/correspondence.json`, built once per base): for each of MediaPipe's 478 canonical landmarks, the nearest point on the base head surface (vertex index + barycentrics) and its UV; plus MediaPipe's face-mesh triangulation. Built by `tools/build-correspondence.py`: align the MediaPipe canonical face model to the base head (similarity transform from a few hand-picked anchor landmarks, then closest-point projection), with a review render that overlays the projected landmarks on the head.

Pipeline (`npm run assets`, idempotent):

1. `tools/blender/build_base.py` (Blender headless, MPFB2; driven by `tools/build-base.ts`): create the base human, add body-morph shape keys, bake expressions, neutralise skin, bake base layer and region-ID texture, export VRM 1.0.
2. `tools/build-correspondence.py`: as above.
3. `tools/build-garments.py` (Blender headless): fit each garment or hairstyle source to the base, verify skeleton compatibility, transfer body-morph shape keys, export GLB.
4. `gltf-transform`: meshopt compression (for the base an M7 performance item: base.vrm is ~4.4 MB uncompressed today), texture resize (≤2048² for the body, ≤1024² for everything else), WebP textures.
5. `tools/pose-from-mixamo.ts` for Mixamo-sourced poses.
6. `tools/build-catalog.ts`: validates every entry, renders thumbnails (256 px, neutral outfit for poses, neutral pose for garments) with headless Chromium via Playwright, writes `catalog.json`.
7. `tools/calibrate-body.py` (on demand): body-measurement regression (§6).

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
- Body estimator accuracy (automated, on generated data): on held-out renders of known bodies in the base outfit, recovered morphs are within ±0.15 of the truth for every morph.
- Integration (Playwright): debug page over a small consented/free-licence photo set asserting detection, gates and parameter ranges; screenshot regression of every garment × four poses × three body shapes and every pose in the neutral outfit, with a pixel-diff threshold.
- Likeness gate (human): for 10 diverse consented full-length photos, a third person shown the photo picks the matching avatar out of three (rendered full-length, same outfit and pose for all three). Pass: ≥9/10. Below that: fix projection, head fit or body mapping before the wardrobe milestone. Protocol and tooling as in `docs/superpowers/m1-lineup-test.md`.
- Manual device pass: iOS Safari (iOS 16+), Android Chrome, desktop Chrome/Firefox/Safari.
- Budgets: interactive < 3 s on 4G excluding models; models with visible progress; garment/pose swap < 1 s; JS < 600 KB gzipped; base avatar + default outfit < 8 MB.

## 16. Milestones

Each milestone gets its own implementation plan.

- M0 Scaffold — done.
- M1 Face → avatar, attribute version — done, partly superseded by the 2026-11-09 revision. Carried forward: MediaPipe adapter, photo decode, skin/hair/eye colour extraction, hairstyle ranking, debug page, lineup tooling, attach machinery. Retired: VRoid base build, synthetic face morphs, face-shape/brow/lip mapping, MToon materials, two-base model.
- M2 Realistic base — MPFB2 → VRM pipeline, body-morph shape keys, expressions, region IDs, realistic skin, height scaling, body sliders in the dev panel, default face. Done when the base renders in the app at a range of body shapes and expressions, within budget.
- Test-photo collection (runs alongside M2 and M3; owner not yet decided) — consent wording (written, adults, photos stay on the tester's machine, deleted after scoring), recruit at least 10 adults spread across skin tones, body types, hair types and genders, one full-length photo each plus height and bust/waist/hip measurements, and a judge who doesn't know them. M3 cannot be signed off until this set exists.
- M3 Photo likeness and gate — `PoseLandmarker`, body measurement and calibration, correspondence data, face projection, head fit, de-lighting and skin match, `Likeness` store, close-up fallback, debug page updates, ≥3 realistic starter hairstyles. Done when the likeness gate passes.
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
