# Kiss — photo-to-avatar dress-up game: design spec

Date: 2026-11-08 · Status: draft for review · Scope: v1 (core loop)

## 1. Purpose and success criteria

A web app for adults (18+) that turns an uploaded photo into a stylized 3D avatar that recognisably resembles the person, lets the user dress it from a wardrobe and put it in poses, and exports an image or share link.

v1 is a real, launchable product, not a prototype, but deliberately limited to the core loop. No accounts, no payments, no server.

Success for v1:

- A first-time user uploads a photo and, within ~30 s including model download, sees an avatar they recognise as "cartoon me" (lineup test, §15).
- They can dress and pose it without instructions and share a picture within a few minutes.
- Per-user running cost is ~0: static hosting, all computation in the browser.
- The face photo never leaves the device.

## 2. Scope

In v1:

- Photo → stylized avatar (face analysis in-browser, attribute-driven avatar).
- Two body bases, hairstyle library, face shape morphs, colour controls.
- Wardrobe with slots, collections, colourable garments, permanent base layer.
- Static pose library (~25 poses), expressions, three fine-tune sliders.
- Scene: orbit camera, two framings, flat backdrops.
- Export PNG, share link (params only), continue-later via localStorage.
- Dev tooling: debug page, pose editor, asset pipeline, catalogue linter.

Not in v1 (candidates for later): accounts and cloud save, payments and premium items, drag-to-pose IK, hair/cloth physics, animation playback, glasses/facial-hair/head-covering detection, body-shape sliders, props and backgrounds beyond flat colours, user-generated poses or garments, social feed.

## 3. Audience, consent, content and privacy rules

- Audience: adults, 18+. Landing page has an 18+ confirmation (stored in localStorage).
- Photos may be of the user or of other people. Landing shows the consent line "Only upload photos of yourself or people who've agreed" with a required checkbox (per session), and "Your photo never leaves your device."
- Privacy: the photo is held in memory only, drawn to an offscreen canvas for analysis, and released when analysis completes. It is never persisted, never placed in the URL, never sent anywhere. The only persisted or shared state is `AvatarParams` (§5). A privacy page states exactly this. No analytics event may carry image data; if analytics are added they are privacy-preserving (e.g. Plausible) and event-only.
- Content: avatars always have a permanent base layer baked into the body texture (fitted undershirt and shorts); clearing every slot never produces an undressed avatar. Garments never cover less than the base layer; no lingerie-as-outfit, no fetish gear. Costume collections (Halloween etc.) are party-costume register. The pose library is fashion, editorial, dance and everyday; no poses framed around the crotch or rear. All garment and character designs are original: no named characters, logos, wordmarks or signature colourways from films, comics, games or anime.
- Enforcement is in code: the catalogue linter (§13) rejects garments without `slot`/`covers`, rejects poses outside the allowed categories, and rejects catalogue names that match a denylist of character/brand names. Changes to the catalogue go through code review.
- Terms of use prohibit using a person's likeness without their agreement and prohibit sexual or harassing use of exports.

## 4. Architecture

Single-page app, no backend. Static hosting (Cloudflare Pages or Vercel). Everything runs in the browser.

Stack:

- Vite, React 18+ (19 for a fresh start), TypeScript (strict).
- `three` (r167+), `@react-three/fiber` matching the React major, `@react-three/drei`.
- `@pixiv/three-vrm` (VRM 1.0 loading, humanoid normalised bones, expressions, MToon material).
- `@mediapipe/tasks-vision`: `FaceLandmarker` (478 landmarks, 52 blendshapes, facial transformation matrix) and `ImageSegmenter` with the multiclass selfie model (background, hair, body-skin, face-skin, clothes, others). Model files are self-hosted under `/models/` and lazy-loaded.
- `zustand` for app state. `fflate` as a fallback for deflate where `CompressionStream` is unavailable.
- Build-time tools: Blender (headless Python) with the VRM add-on, `@gltf-transform/cli`, Node scripts.

Data flow: photo → `analysis` → `AvatarParams` → `avatar` (applies params to the VRM) ← `wardrobe` and `posing` (catalogue-driven) → `export` (PNG, URL). The UI reads and mutates `AvatarParams` only; it never touches the scene directly.

Modules (folders under `src/`, each with its own tests):

| Module | Responsibility | Depends on |
|---|---|---|
| `analysis/` | photo → `AvatarParams`. Pure mapping functions over landmark and mask data; MediaPipe behind one adapter. | MediaPipe adapter, calibration stats |
| `avatar/` | load VRM base, apply colours, morphs, hair, extras; own the skeleton and raw-bone lookup. | three-vrm, catalogue |
| `wardrobe/` | garment catalogue, load/attach/detach to the skeleton, region masks. | avatar |
| `posing/` | pose catalogue, apply pose to normalised bones, fine-tune sliders, expressions, heel handling. | avatar, catalogue |
| `export/` | PNG render, params ↔ URL, localStorage. | params schema |
| `ui/` | screens and panels. | zustand store |
| `catalog/` | types and loader for `catalog.json`. | — |
| `assets/` (public) | VRM bases, hair and garment GLBs, pose JSON, thumbnails, models, `catalog.json`. | built by `tools/` |
| `tools/` | asset pipeline scripts, catalogue builder and linter, thumbnail renderer, Mixamo pose extractor. | Blender, gltf-transform |

## 5. Core data model: `AvatarParams`

```ts
type AvatarParams = {
  version: 1;
  base: 'a' | 'b';                       // body base (a: feminine, b: masculine proportions)
  skin: string;                          // hex, continuous
  hairColor: string;                     // hex, continuous
  eyeColor: 'brown' | 'darkBrown' | 'hazel' | 'green' | 'blue' | 'grey';
  lipTint: string;                       // hex, applied at low strength
  hair: string;                          // hairstyle id, or 'none'
  brows: { shape: 'straight' | 'arched' | 'soft' | 'angled'; thickness: number }; // 0..1
  faceShape: {                           // morph weights, each -1..1
    faceWidth: number; jawWidth: number; chinLength: number; noseWidth: number;
    noseLength: number; eyeSpacing: number; eyeSize: number; lipFullness: number;
  };
  extras: { glasses?: string; facialHair?: string };
  outfit: Partial<Record<'top' | 'bottom' | 'full' | 'shoes' | 'outer' | 'head', { id: string; color?: string }>>;
  pose: string;                          // pose id
  poseTweak: { headTurn: number; headTilt: number; torsoLean: number };  // -1..1
  expression: 'neutral' | 'happy' | 'relaxed' | 'surprised' | 'wink';
  scene: { backdrop: string; framing: 'full' | 'portrait' };
};
```

Supporting types used throughout:

```ts
type Slot = 'top' | 'bottom' | 'full' | 'shoes' | 'outer' | 'head';
type Region = 'torso' | 'upperArms' | 'forearms' | 'thighs' | 'calves' | 'feet' | 'neck';
```

Rules: `full` and (`top` or `bottom`) are mutually exclusive; the store enforces it when setting either. Unknown ids fall back to defaults with a toast. `version` drives migrations for share links and localStorage. The schema is validated with `zod` at every boundary (URL, localStorage, analysis output).

## 6. Analysis: photo → avatar

Input: a file from `<input type="file" accept="image/*" capture="user">`. Decode with `createImageBitmap(file, { imageOrientation: 'from-image' })`, downscale so the long edge is ≤1024 px, draw to an `OffscreenCanvas`. iOS supplies JPEG for HEIC originals when `accept="image/*"`; other HEIC files fail decoding and show "Please use a JPEG or PNG".

Detection and gates:

- Run `FaceLandmarker` (image mode, `numFaces: 4`). Choose the largest face by bounding box.
- Gates: face width ≥120 px in the downscaled image; |yaw| and |pitch| ≤30° from the facial transformation matrix. Fail → message with tips and a "Start from a default avatar" button.
- Run `ImageSegmenter` on the same canvas for hair / face-skin / body-skin / clothes masks (confidence masks, threshold 0.5), restricted to a region around the chosen face (2.5× face box) so other people in the photo do not contaminate the samples.
- Show the crop used so the user sees which face was picked.

Extraction (all pure functions in `analysis/mapping/`, unit-tested on fixtures):

| Attribute | Source | Mapping |
|---|---|---|
| `skin` | face-skin mask pixels converted to OKLab; drop the darkest and brightest 20% by L; median | hex. Shade colour for MToon is derived (L −0.18, chroma +10%). |
| `hairColor` | hair mask pixels, brighter half by L; median in OKLab | hex. If hair mask area < 2% of face box area → `hair: 'none'` suggested and colour defaults to a neutral derived from brows. |
| `eyeColor` | iris landmarks (468–477), disc of radius 0.6 × iris radius, median in OKLab | snapped to the nearest of 6 presets |
| `lipTint` | lip-region landmarks polygon; median | hex, applied at 35% strength |
| `faceShape.*` | landmarks transformed by the inverse facial transformation matrix (pose-normalised), ratios: face width ÷ face height, jaw width ÷ cheekbone width, chin length ÷ face height, nose width ÷ face width, nose length ÷ face height, inter-pupil distance ÷ face width, eye height ÷ eye width, (upper + lower lip height) ÷ face height | z-score against calibration mean/std → clamp −1..1 → ×0.8 so extremes stay stylised |
| `hair` | hair mask geometry relative to the face box: length class (lowest hair pixel above chin / between chin and shoulder line / below), volume (hair area ÷ face area, 3 bins), bangs (coverage of the forehead band between brow line and face-box top > 40%), parting side (left/right asymmetry of that band) | nearest hairstyle by tag distance among styles tagged for the chosen base; ties broken by volume |
| `brows` | brow landmark contours: mean vertical thickness ÷ face height → `thickness`; angle of the outer third vs inner third → shape | shape from 4 presets, thickness 0..1 |
| `base` | not inferred | default `'a'`; the Reveal screen shows a one-tap toggle. |
| `extras` | not detected in v1 | toggles in the editor |

Calibration: means and standard deviations for the eight ratios come from a set of 30–50 frontal photos (free-licence stock such as Unsplash/Pexels plus friends with consent). Only the derived statistics ship, in `analysis/calibration.json`, with a script to recompute them.

Output: a complete `AvatarParams` with `outfit` set to the base's default outfit, `pose: 'stand_neutral'`, `expression: 'neutral'`.

Performance: models (~6–8 MB) download when the user reaches the upload step, with a progress bar; analysis runs in a Web Worker where OffscreenCanvas is available, otherwise on the main thread with the UI in a loading state. Target: < 0.5 s analysis on a mid-range phone after models are loaded.

## 7. Avatar

- Bases are VRM 1.0 files exported from VRoid Studio (one per body base), post-processed by `tools/build-base.py`:
  - Face mesh gains 8 shape morph targets built by exporting the VRoid base at each slider's min and max and diffing vertices (VRoid keeps topology constant across sliders). Existing VRM expression morphs are preserved.
  - Body texture is replaced by: albedo + baked base layer (undershirt and shorts) + a region-ID texture (R channel codes: torso, upperArms, forearms, thighs, calves, feet, neck).
  - Hair is removed from the base; hairstyles are separate assets.
- Applying params:
  - `skin` → MToon `color` and `shadeColor` on skin materials (face and body share one skin material).
  - `hairColor` → tint on the greyscale hair textures; `eyeColor` → iris texture tint; `lipTint` → lip decal strength.
  - `faceShape` → morph target influences, −1..1 mapped onto paired min/max morphs.
  - `brows` → brow decal texture selection and scale.
  - `hair`, `extras`, `outfit` → attach assets (§8).
- Face texture compositing: the face albedo is composited at runtime on a 1024² canvas from the skin base, the selected brow decal (scaled by `brows.thickness`), the lip decal at `lipTint` strength, and the optional facial-hair decal tinted with `hairColor`. Recomposited only when one of those params changes.
- Body region visibility: the body material uses `alphaMode: MASK`. A 1024² canvas composites the body texture at runtime, setting alpha 0 where the region-ID matches any region in the union of equipped garments' `covers`. Recomposited only when the outfit changes.
- Raw vs normalised bones: skinned assets bind to the VRoid raw bones (e.g. `J_Bip_C_Hips`); poses are applied to three-vrm normalised humanoid bones and propagated by `vrm.update()`.
- No spring-bone physics in v1: hair and skirts are rigidly skinned. Still images do not need settling, and skipping physics keeps hair and garments modular. Physics is a v2 candidate.

## 8. Wardrobe

Slots: `top`, `bottom`, `full` (dress/jumpsuit; excludes `top` and `bottom`), `shoes`, `outer`, `head`. Hairstyles use an internal `hair` slot with the same attach mechanism; a `head` item may declare `hidesHair: true` (hijab, full helmet).

Garment asset: a GLB containing one or more `SkinnedMesh` skinned to the same raw skeleton and bind pose as its body base, MToon or standard material, textures ≤1024², meshopt-compressed, typically 50–400 KB.

Catalogue entry:

```ts
type Garment = {
  id: string; slot: Slot; name: string; thumb: string; base: 'a' | 'b';
  collection: 'everyday' | 'street' | 'cosplay' | 'heroine' | 'halloween';
  covers: Region[];            // body regions made transparent while worn
  colorable: boolean; palette?: string[];   // tint presets when colorable
  hidesHair?: boolean;         // head items
  heelHeight?: number; heelAngle?: number;  // shoes, metres and degrees
  tags: string[];
};
```

Runtime attach: load the GLB (cached by URL), for each `SkinnedMesh` build a `THREE.Skeleton` whose bones are the avatar's raw bones looked up by the garment skeleton's bone names, reuse the garment's own `boneInverses` (identical bind pose), call `mesh.bind(skeleton, mesh.bindMatrix)`, add the mesh under the avatar root, apply tint if `colorable`. Detach removes and disposes geometry, materials and textures. Missing bones abort the attach with a toast and keep the previous item.

Clipping strategy: garments are modelled 3–6 mm proud of the body, and `covers` hides the skin under them. The screenshot-regression suite (§15) renders every garment in four poses to catch regressions.

Shoes: `heelHeight` raises the hips by that amount in standing poses; `heelAngle` overrides the foot bones' pitch after a pose is applied.

Collections and v1 inventory, per base (two bases → double):

| Collection | Items | Examples (all original designs) |
|---|---|---|
| Everyday | 4 tops, 4 bottoms, 2 full, 3 shoes, 2 outer, 2 head | tee, shirt, knit, hoodie; jeans, chinos, skirt, joggers; dress, jumpsuit; sneakers, boots, heels; jacket, coat; cap, beanie |
| Cosplay & anime | 2 full, 1 top, 1 bottom, 1 outer, 1 head, 1 shoes | magical-girl dress, sailor-collar uniform set, maid-café apron set, shrine-maiden robes, idol stage top, ninja wrap, yukata, knee boots |
| Super-heroine | 2 full, 1 outer, 1 head, 1 shoes | two original suits with emblem placeholders, cape, domino mask, armoured boots; colourable |
| Halloween | 3 full, 1 outer, 1 head, 1 shoes | witch dress, vampire gown, devil set, cat set, pirate set; cloak; hat/horns/ears; boots |

Total ≈ 17 + 7 + 5 + 6 = 35 items per base, 70 total. The everyday collection is required for launch; themed collections can ship with fewer items if asset work runs long. `colorable` palettes are the cheap way to add variety. The wardrobe UI filters by current `base`, groups by collection, and shows slot chips.

Design rule for themed collections: archetypes, not characters. Names and descriptions must not reference an existing character or franchise; emblems are original marks; colourways avoid signature combinations. The linter denylist is a starting safeguard, not a substitute for review.

## 9. Posing

Poses are static. A pose file is JSON:

```ts
type Pose = {
  id: string; name: string; category: 'standing' | 'sitting' | 'lying' | 'action' | 'dance' | 'editorial';
  tags: string[]; thumb: string;
  hips: { position: [number, number, number]; rotation: [number, number, number, number] };
  bones: Partial<Record<VRMHumanBoneName, [number, number, number, number]>>; // local quaternions, normalised bones
  expression?: AvatarParams['expression'];
  camera?: 'full' | 'portrait';
};
```

Applying: for each bone set the normalised bone node's quaternion; set hips position offset; then apply `poseTweak` (head turn/tilt on `head`, lean on `spine`, each ±25°); then shoe `heelAngle` on `leftFoot`/`rightFoot` and `heelHeight` on hips when the pose is standing; then `vrm.update()`. Expressions are VRM expression presets set via `expressionManager` (`neutral`, `happy`, `relaxed`, `surprised`, and `wink` mapped to `blinkLeft`).

Camera: `full` fits the avatar's world bounding box with margin so lying poses are not cropped; `portrait` frames head and shoulders. Orbit controls allow rotate and zoom; pan disabled.

Authoring:

1. `tools/pose-from-mixamo.ts`: loads a Mixamo FBX, retargets to the VRM rig with three-vrm's Mixamo bone map, samples a frame, writes pose JSON.
2. Dev pose editor at `/dev/poses` (dev build only): avatar, bone picker, rotation gizmos, hips-offset handle, floor-contact helper (translates hips so the lowest foot/hand/knee sits at y=0), mirror left↔right, load/save JSON, thumbnail preview. Used to recreate reference-sheet poses and to fix Mixamo poses that read badly on a stylised body.

v1 list (~25): standing — neutral, hand on hip, arms crossed, wave, peace sign, thinking, lean, over-the-shoulder hand on hip, hand to cheek; sitting — back on hands knee up, kneeling on one hand, kneeling arms behind head; lying — on front propped on elbow; action — mid-stride, jump, pointing; dance — Hip Pop, Body Wave, Squat Dance, Hair Flip, two generic dance poses; editorial — Overhead, Kneel Arch, Turn Pose, Floor Flow, Reach Up. Mirrored variants are generated, not hand-made.

## 10. Export and share

- Save image: render the current view to an offscreen target at 2× the canvas resolution (capped at 2048 px long edge), read back to a canvas, `toBlob('image/png')`; download on desktop, `navigator.share({ files })` on mobile when available, falling back to download. Optional transparent background when the backdrop is "none".
- Copy link: `location.origin + '/#p=' + base64url(deflateRaw(JSON.stringify(params)))`. Opening a link validates with the zod schema, runs migrations by `version`, and loads the avatar. Links never carry the photo.
- Continue later: params are written to `localStorage` on every change (debounced). On launch, if present, the Studio opens directly with a "Start over" affordance.

## 11. Screens

Mobile-first; desktop uses the same layout with side panels instead of a bottom sheet.

1. Landing — one-line pitch, Upload a photo (camera or gallery), 18+ confirmation, consent checkbox and line, privacy line, "Try a default avatar" link.
2. Analysing — model download progress, then analysis spinner; photo preview with the face crop used.
3. Reveal — avatar spins in; quick-fix row: skin swatches (analysed colour first, then 8 presets), hairstyle carousel, hair colour, eye colour, body base toggle, glasses and facial-hair toggles; buttons: Continue, Start over.
4. Studio — viewer; bottom sheet with tabs Face · Hair · Outfit · Pose · Scene; Outfit shows collection filter, slot chips, thumbnail grid, colour swatches for colourable items; Pose shows category filter, thumbnails, tweak sliders, expression picker; Scene shows backdrop and framing; Share/Export button top-right.
5. Export sheet — preview, Save image, Share, Copy link.

Copy is in `ui/strings.ts` for later localisation.

## 12. Assets and pipeline

Inventory (v1): 2 bases; ≥12 hairstyles per base covering buzz/crop, short coily, afro, locs, box braids, bob, medium straight, long straight, long wavy, curly, ponytail, bun; garments per §8; 4 brow shapes; iris texture; 3 glasses; 3 facial-hair decals; ~25 poses; 5 expressions; 4 backdrops; 2 MediaPipe models.

Pipeline (`npm run assets`, idempotent):

1. `tools/build-base.py` (Blender headless): import VRoid exports, build morph targets, bake base layer and region-ID texture, strip hair, export VRM.
2. `tools/build-garments.py` (Blender headless): import each garment source (VRoid export or Blender file), remove body meshes, verify skeleton compatibility against the base, export GLB.
3. `gltf-transform`: meshopt compression, texture resize to ≤1024², WebP textures.
4. `tools/pose-from-mixamo.ts` for Mixamo-sourced poses.
5. `tools/build-catalog.ts`: validates every entry, renders thumbnails (256 px, neutral outfit for poses, neutral pose for garments) with headless Chromium via Playwright, writes `catalog.json`.

Licensing: `assets/LICENSES.md` lists every item, source and licence. VRoid Studio presets are cleared for commercial use unless an item's licence says otherwise; Booth items vary per item; Mixamo clips are used to derive pose data under Adobe's terms; MediaPipe models are Apache-2.0. Themed collections are original designs created for this project.

## 13. Dev tooling

- Debug page `/dev/analysis`: upload photo, shows landmarks and masks overlaid, extracted swatches, ratio values and z-scores, chosen hairstyle with runner-ups, and the resulting avatar. Used for the lineup test and for calibration.
- Pose editor `/dev/poses` (§9).
- Catalogue linter (`npm run lint:catalog`, also in CI): schema validity; garment has `slot` and `covers`; `full` items do not also declare `top`/`bottom`; pose `category` in the allowed set; names and tags free of denylisted character and brand terms; every referenced file exists; thumbnails present.

## 14. Error handling

| Situation | Behaviour |
|---|---|
| No face, face too small or turned | Message with tips; "Start from a default avatar". |
| Several faces | Largest chosen; crop shown. |
| Model download fails | Retry button; after two failures offer the default avatar. |
| WebGL2 unavailable | Static message with supported browsers list. |
| WebGL context lost | Renderer recreated on `webglcontextrestored`; params reapplied. |
| Garment/hair/pose load fails | Previous item kept; toast. |
| Invalid or old share link | Migrate by `version`; if impossible, reset to default avatar with a message. |
| Low memory / low-end device | Pixel ratio ≤2; garments lazy-loaded; textures and geometry disposed on swap. |

## 15. Testing

- Unit (Vitest): analysis mapping functions on recorded landmark/mask fixtures (no ML in tests); params schema and migrations; URL round-trip; pose application maths; catalogue validation.
- Integration (Playwright): debug page over a small CC0/free-licence photo set asserting detection and parameter ranges; screenshot regression of every garment × four poses and every pose in the neutral outfit, with a pixel-diff threshold.
- Likeness gate (human, milestone M1): for 10 diverse photos, a third person shown the photo picks the matching avatar out of three. Pass: ≥7/10. Fail: tune mappings or add morphs before M2.
- Manual device pass: iOS Safari (iOS 16+), Android Chrome, desktop Chrome/Firefox/Safari.
- Budgets: interactive < 3 s on 4G excluding models; models with visible progress; garment/pose swap < 1 s; JS < 600 KB gzipped; base avatar + default outfit < 3 MB.

## 16. Milestones

Each milestone gets its own implementation plan.

- M0 Scaffold — Vite/React/TS, R3F scene, load a raw VRoid export, orbit, PNG export, CI with lint and tests. Done when a VRM renders and a PNG downloads.
- M1 Face → avatar and likeness gate — MediaPipe adapter, mapping functions with fixtures, calibration script, base build with morphs, 6 starter hairstyles, debug page, lineup test. Done when the gate passes.
- M2 Wardrobe — garment pipeline, attach/detach, region masks, catalogue and linter, Outfit tab, ~10 everyday garments on base A. Done when outfits swap without clipping in the regression suite.
- M3 Posing — pose format, Mixamo extractor, pose editor, ~25 poses, expressions, heels, Pose tab. Done when all poses pass screenshot review.
- M4 Product shell — landing, 18+/consent, analysing and reveal screens, studio tabs, export/share, continue-later, base B with its everyday wardrobe, themed collections. Done when the full loop works on phone and desktop.
- M5 Hardening and launch — device matrix, error states, performance budgets, privacy page and terms, final catalogue lint, hosting and domain. Done when the launch checklist is green.

## 17. Decisions log

- Ready Player Me shut down 31 Jan 2026 (Netflix acquisition); Union Avatars followed. Surviving selfie-to-avatar APIs (MetaPerson, Avaturn) start at ~$800/month. Decision: own in-browser pipeline; no vendor dependency for the core.
- Likeness is attribute-based (colours, hairstyle, face-shape morphs), not photo projection or a face scan. Photo-texture projection may come later as an optional mode.
- VRM chosen over plain glTF for the standardised humanoid rig, expressions, toon material and the VRoid authoring path.
- Two body bases rather than one base with body morphs, because VRoid's masculine and feminine bases differ in topology.
- No physics in v1 (static images; modular hair and garments stay simple).
- No backend in v1; share links carry params only.
- Themed collections (cosplay & anime, super-heroine, Halloween) are original archetype designs; no licensed characters.

## 18. Deferred decisions and defaults

- Product name: working title "Kiss"; final name and domain are needed by M5.
- Art style: VRoid's default look leans anime; textures and proportions will be nudged toward a neutral stylised look in M1. Confirm direction on the first rendered base.
- Analytics: none in v1 unless decided at M5; if added, event-only and privacy-preserving.
- Facial-hair, glasses and head-covering detection: toggles in v1; detection is a v2 candidate.
