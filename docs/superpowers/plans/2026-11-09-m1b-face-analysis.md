# M1b Face Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an uploaded photo into `AvatarParams` entirely in the browser — MediaPipe face landmarks and segmentation → skin/hair/eye/lip colours, face-shape morph weights, brow shape, nearest hairstyle — with a debug page to inspect every step, a calibration workflow, and lineup-test tooling for the M1 go/no-go.

**Architecture:** `analysis/mediapipe.ts` is the only file that touches MediaPipe (models self-hosted, lazy-loaded with progress, GPU→CPU fallback). Everything after detection is pure functions over `FaceObservation` + `CategoryMask` + `RgbaImage`, unit-tested on deterministic fixtures synthesised from MediaPipe's canonical face model. `analysis/analyze.ts` orchestrates decode → detect → gates → segment → `analyzeToParams`. The dev page at `#analysis` drives it, records fixtures, and exports calibration; `tools/lineup.ts` batch-renders avatars for the human lineup test.

**Tech Stack:** `@mediapipe/tasks-vision` (FaceLandmarker 478 pts + blendshapes + transform matrix; ImageSegmenter multiclass selfie: 0 bg, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others); existing `color/oklab.ts`, `catalog`, store, Viewer; Vitest (jsdom + node), Playwright, `pngjs`.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md` — §6 Analysis (gates, extraction table, calibration), §13 debug page, §14 error cases, §15 likeness gate, §16 M1.

## Global Constraints

- The photo never leaves the browser and is never persisted; only `AvatarParams` persists (spec §3). No analytics; no network calls at runtime except the app's own static files and self-hosted models under `/models/` and `/mediapipe/wasm/` (spec §4, §6).
- Gates (spec §6): largest face must be ≥120 px wide in the ≤1024 px downscaled image; |yaw| and |pitch| ≤ 30°. Failure → user-facing message + "start from a default avatar" path.
- Extraction rules exactly as spec §6: skin = trimmed (20%) OKLab median of face-skin pixels; hair colour = median of the brighter half of hair pixels; eye colour snapped to the 6 presets; face ratios → z-score → clamp −1..1 → ×0.8; hairstyle = nearest by tags; brows → one of 4 shapes + thickness; glasses / facial hair / head covering **not** detected (toggles later).
- All user-facing copy in `src/ui/strings.ts` (spec §11); the debug page may use literals for developer-only labels.
- Model files (~6–8 MB) are fetched, never committed; CI fetches them. This sandbox cannot reach the model host, so detection-dependent e2e tests must **skip when the model files are absent** and run in CI.
- Deterministic unit tests: no ML in Vitest; fixtures come from `tests/fixtures/face_model_with_iris.obj` (Apache-2.0, committed, licence row added).
- Performance target (not asserted): analysis < 0.5 s after models load; model download shows progress.

## Review Focus

1. A photo with several people → the largest face is used and the crop shown; other faces' hair/skin must not contaminate samples. Test in Task 5 (`pickLargest` + mask restricted to 2.5× face box — unit on a two-face fixture).
2. No visible hair (shaved, hijab, hat) → `hair: 'none'`, hair colour falls back to the brow colour, no crash. Test in Task 4 (fixture with empty hair mask).
3. A tiny or far-away face → `face_too_small` message, no params emitted. Test in Task 5 (orchestrator with a mocked adapter returning a 60 px face).
4. A head tilted (roll) 20° → identical face ratios to the upright photo (roll correction), so the avatar doesn't get a crooked face. Test in Task 2 (canonical fixture rotated 20°).
5. Model download fails or is slow → progress UI, then a clear retry message; the viewer still works with the default avatar. Test in Task 5 (RTL with a rejecting `loadModels`) and Task 6 e2e (route `/models/*` to 500 → message).

---

## File structure

```
tools/
├── fetch-models.sh                 → public/models/{face_landmarker.task, selfie_multiclass_256x256.tflite}; warns & exits 0 when the host is unreachable
├── copy-mediapipe-wasm.ts          → public/mediapipe/wasm/* from node_modules/@mediapipe/tasks-vision/wasm
├── calibrate-canonical.ts          → src/analysis/calibration.json seeded from the canonical face model
├── lineup/assign.ts                pure: assignLineups(ids, seed)
└── lineup.ts                       Playwright batch: photos → params + avatar renders → lineup sheets
src/analysis/
├── types.ts                        FaceObservation, CategoryMask, MASK, RgbaImage, Box, Analysis
├── image.ts                        fitWithin, decodePhoto, DecodeError
├── mediapipe.ts                    loadModels, detectFaces, segment (the only MediaPipe import)
├── landmarks.ts                    LM indices, toPixels, headPose, rollCorrected, faceBox, polygonMask
├── masks.ts                        categoryEquals, resampleMask, restrictToBox, andMasks, countOnes, lowestRow, coverage
├── color.ts                        medianColorTrimmed, nearestEyeColor
├── calibration.ts                  Calibration type, DEFAULT_CALIBRATION (json), accumulateCalibration
├── calibration.json                shipped stats
├── mapping/faceShape.ts            RATIO_KEYS, measureRatios, ratiosToFaceShape
├── mapping/skin.ts  hair.ts  eyes.ts  lips.ts  brows.ts  hairstyle.ts
├── mapping/index.ts                analyzeToParams(analysis, opts) → { params, debug }
└── analyze.ts                      AnalysisError, pickLargest, analyzePhoto (orchestrator)
src/ui/dev/AnalysisPage.tsx          #analysis route: upload → analyse → overlays, attributes, apply, record fixture, calibration
src/ui/dev/PhotoCanvas.tsx           photo + landmark/mask overlays
src/ui/strings.ts                    (modify) analysis.* strings
src/App.tsx                          (modify) route #analysis → AnalysisPage
tests/fixtures/face_model_with_iris.obj
tools/test-fixtures/canonicalFace.ts  synthesise FaceObservation / masks / RgbaImage from the OBJ
tests/analysis/**  tests/tools/lineup/assign.test.ts  tests/ui/AnalysisPage.test.tsx
e2e/analysis.spec.ts
docs/superpowers/m1-lineup-test.md    protocol for the human gate
```

Key types (Task 1 produces; everything else consumes):

```ts
export type Point3 = { x: number; y: number; z: number };              // normalised image coords 0..1
export type Point2 = { x: number; y: number };                         // pixels
export type Box = { x: number; y: number; width: number; height: number }; // pixels
export type FaceObservation = { landmarks: Point3[]; matrix: number[]; blendshapes: Record<string, number>; imageWidth: number; imageHeight: number };
export const MASK = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, others: 5 } as const;
export type CategoryMask = { width: number; height: number; data: Uint8Array };
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };
export type Analysis = { face: FaceObservation; mask: CategoryMask; image: RgbaImage; faceBox: Box };
```

---

### Task 1: Model plumbing, image decode, and the MediaPipe adapter

**Files:**
- Create: `tools/fetch-models.sh`, `tools/copy-mediapipe-wasm.ts`, `src/analysis/types.ts`, `src/analysis/image.ts`, `src/analysis/mediapipe.ts`
- Modify: `package.json` (scripts `assets:models`, add to `assets:dev`), `.gitignore` (`public/models/`, `public/mediapipe/`), `.github/workflows/ci.yml` (models fetched before e2e), `assets/LICENSES.md` (MediaPipe models + canonical face model, Apache-2.0), `src/ui/strings.ts`
- Test: `tests/analysis/image.test.ts`

**Interfaces:**
- Produces (`image.ts`):
  ```ts
  export const MAX_EDGE = 1024;
  export function fitWithin(width: number, height: number, maxEdge?: number): { width: number; height: number };   // never upscales; integer; keeps aspect
  export class DecodeError extends Error {}
  export async function decodePhoto(file: Blob): Promise<{ canvas: HTMLCanvasElement; image: RgbaImage }>;        // createImageBitmap(file, { imageOrientation: 'from-image' }) → fitWithin → canvas → getImageData; DecodeError on failure
  ```
- Produces (`mediapipe.ts`):
  ```ts
  export const MODEL_URLS = { faceLandmarker: '/models/face_landmarker.task', segmenter: '/models/selfie_multiclass_256x256.tflite', wasm: '/mediapipe/wasm' } as const;
  export type ModelProgress = (fraction: number) => void;       // 0..1 across both downloads
  export async function loadModels(onProgress?: ModelProgress): Promise<void>;   // idempotent (cached promise); fetches each model with a streaming reader to report progress, passes bytes as modelAssetBuffer; FaceLandmarker: runningMode IMAGE, numFaces 4, outputFaceBlendshapes, outputFacialTransformationMatrixes, delegate GPU → retries CPU on failure; ImageSegmenter: IMAGE, outputCategoryMask true, outputConfidenceMasks false
  export function modelsReady(): boolean;
  export function detectFaces(canvas: HTMLCanvasElement): FaceObservation[];   // every face, largest face box first; blendshapes keyed by categoryName
  export function segment(canvas: HTMLCanvasElement): CategoryMask;           // copies getAsUint8Array() then closes the MPMask
  export function resetModelsForTests(): void;
  ```
- Strings added: `analysis.loadingModels: 'Preparing face analysis…'`, `analysis.analysing: 'Analysing your photo…'`, `analysis.noFace: "We couldn't find a face. Try a well-lit photo, facing the camera."`, `analysis.faceTooSmall: 'The face is too small. Try a closer photo.'`, `analysis.faceTurned: 'Please face the camera more directly.'`, `analysis.decodeFailed: "We couldn't read that image. Please use a JPEG or PNG."`, `analysis.modelsFailed: "The face analysis files didn't download. Check your connection and try again."`, `analysis.privacy: 'Your photo never leaves your device.'`, `analysis.retry: 'Try again'`, `analysis.useDefault: 'Start from a default avatar'`.

- [ ] **Step 1: Write the failing tests** — `tests/analysis/image.test.ts`:
```ts
test('fitWithin downsizes the long edge to 1024 and keeps aspect', () => expect(fitWithin(4032, 3024)).toEqual({ width: 1024, height: 768 }));
test('fitWithin never upscales', () => expect(fitWithin(640, 480)).toEqual({ width: 640, height: 480 }));
test('fitWithin handles portrait', () => expect(fitWithin(3000, 4000)).toEqual({ width: 768, height: 1024 }));
test('decodePhoto rejects with DecodeError when the bitmap cannot be created', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('nope')));
  await expect(decodePhoto(new Blob([1]))).rejects.toBeInstanceOf(DecodeError);
});
```
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `types.ts`, `image.ts`, `mediapipe.ts`, the two scripts, scripts/ignore/CI/licence/strings edits. `fetch-models.sh` uses the official URLs (`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`), is idempotent, prints a clear warning and exits 0 when a download fails (analysis e2e then skips). `copy-mediapipe-wasm.ts` copies the four wasm files. `assets:models` = both; `assets:dev` runs it first.
- [ ] **Step 4: Run** `npm run assets:models` (expect the warning here, success in CI), `npm test`, lint, typecheck → PASS.
- [ ] **Step 5: Commit** — `feat(analysis): MediaPipe adapter, model plumbing, photo decode`.

---

### Task 2: Landmark geometry, face ratios and calibration

**Files:**
- Create: `tests/fixtures/face_model_with_iris.obj` (from the mediapipe repo, `mediapipe/modules/face_geometry/data/`), `tools/test-fixtures/canonicalFace.ts`, `src/analysis/landmarks.ts`, `src/analysis/mapping/faceShape.ts`, `src/analysis/calibration.ts`, `src/analysis/calibration.json`, `tools/calibrate-canonical.ts`
- Test: `tests/analysis/landmarks.test.ts`, `tests/analysis/faceShape.test.ts`, `tests/analysis/calibration.test.ts`

**Interfaces:**
- Fixture (`canonicalFace.ts`):
  ```ts
  export type SynthOptions = { width?: number; height?: number; scale?: number; rollDeg?: number; yawDeg?: number; centre?: Point2;
    hair?: { length: 'none' | 'short' | 'medium' | 'long'; bangs?: boolean; parting?: 'left' | 'center' | 'right'; volume?: 'low' | 'medium' | 'high' };
    colors?: { skin?: string; hair?: string; iris?: string; lips?: string; background?: string }; secondFace?: { scale: number; centre: Point2 } };
  export function synthFace(opts?: SynthOptions): { face: FaceObservation; mask: CategoryMask; image: RgbaImage; faces: FaceObservation[] };
  ```
  Projection: canonical points (cm, +z toward viewer) rotated by yaw/roll, orthographic, `scale` px/cm (default 4), centred; z kept. `matrix` = the 4×4 of that rotation (column-major). Masks at ¼ resolution: face-skin = ellipse of the face oval; hair = region above/around the face per `hair` option (length controls how far below the chin it extends; bangs fill the forehead band; parting leaves a gap on one side); body-skin = neck strip; clothes below. Image: fill regions with the given colours, irises as discs at iris centres, lips via the outer-lip polygon.
- `landmarks.ts`:
  ```ts
  export const LM = { faceTop: 10, chin: 152, cheekR: 234, cheekL: 454, jawR: 172, jawL: 397, noseBridge: 168, noseBottom: 2, nostrilR: 48, nostrilL: 278,
    eyeR: { outer: 33, inner: 133, top: 159, bottom: 145 }, eyeL: { inner: 362, outer: 263, top: 386, bottom: 374 },
    irisR: [468, 469, 470, 471, 472], irisL: [473, 474, 475, 476, 477], lipTop: 0, lipBottom: 17, mouthR: 61, mouthL: 291,
    outerLips: [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146],
    browR: { upper: [70, 63, 105, 66, 107], lower: [46, 53, 52, 65, 55] }, browL: { upper: [300, 293, 334, 296, 336], lower: [276, 283, 282, 295, 285] },
    faceOval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
    cheekPatchR: [50, 101, 118, 117, 123, 187, 205, 36], cheekPatchL: [280, 330, 347, 346, 352, 411, 425, 266], foreheadPatch: [10, 338, 297, 332, 333, 299, 337, 151, 108, 69, 104, 103, 67, 109] } as const;
  export function toPixels(face: FaceObservation): Point2[];
  export function headPose(matrix: number[]): { yaw: number; pitch: number; roll: number };   // degrees from the rotation block
  export function rollCorrected(points: Point2[], rollDeg: number, about: Point2): Point2[];
  export function faceBox(points: Point2[]): Box;                                          // bounds of LM.faceOval
  export function dist(a: Point2, b: Point2): number;
  export function polygonMask(points: Point2[], indices: readonly number[], width: number, height: number): Uint8Array;  // scanline fill
  ```
- `faceShape.ts`:
  ```ts
  export const RATIO_KEYS = ['faceAspect', 'jawToCheek', 'chinLength', 'noseWidth', 'noseLength', 'eyeSpacing', 'eyeAspect', 'lipHeight'] as const;
  export type RatioKey = (typeof RATIO_KEYS)[number];  export type Ratios = Record<RatioKey, number>;
  export function measureRatios(face: FaceObservation): Ratios;
  // on roll-corrected pixels: faceW = dist(234,454); faceH = dist(10,152);
  // faceAspect = faceW/faceH; jawToCheek = dist(172,397)/faceW; chinLength = dist(17,152)/faceH; noseWidth = dist(48,278)/faceW;
  // noseLength = dist(168,2)/faceH; eyeSpacing = dist(468,473)/faceW; eyeAspect = mean(dist(159,145)/dist(33,133), dist(386,374)/dist(362,263)); lipHeight = dist(0,17)/faceH
  export const RATIO_TO_PARAM: Record<RatioKey, keyof AvatarParams['faceShape']> = { faceAspect: 'faceWidth', jawToCheek: 'jawWidth', chinLength: 'chinLength', noseWidth: 'noseWidth', noseLength: 'noseLength', eyeSpacing: 'eyeSpacing', eyeAspect: 'eyeSize', lipHeight: 'lipFullness' };
  export function ratiosToFaceShape(ratios: Ratios, calibration: Calibration): { faceShape: AvatarParams['faceShape']; zScores: Ratios };  // z=(r−mean)/std; weight = clamp(z,−1,1)×0.8
  ```
- `calibration.ts`:
  ```ts
  export type Calibration = { version: 1; samples: number; stats: Record<RatioKey, { mean: number; std: number }> };
  export const DEFAULT_CALIBRATION: Calibration;    // imported from calibration.json
  export function accumulateCalibration(samples: Ratios[]): Calibration;  // population mean/std; std floored at 5% of |mean|; throws on < 2 samples
  export const calibrationSchema: z.ZodType<Calibration>;
  ```
  `tools/calibrate-canonical.ts` writes `calibration.json` from the canonical fixture: means = canonical ratios, std = 8% of mean, `samples: 0` (marks it as a seed). Spec §6 wants 30–50 real photos; the debug page (Task 5) exports a replacement.

- [ ] **Step 1: Write the failing tests**
`landmarks.test.ts`: `headPose(identity)` → all 0; `headPose(rotZ 20°)` → roll ≈ 20; `rollCorrected` of a rotated fixture restores the chin directly below the forehead (|Δx| < 0.5 px); `faceBox` of the default fixture is centred where `synthFace` put it; `polygonMask` fills ~π/4 of a square's area for an inscribed circle (±5%).
`faceShape.test.ts`: `measureRatios(synthFace().face)` values are all finite and within (0, 2); rolled 20° fixture gives ratios within 1% of upright (Review Focus 4); a fixture scaled ×2 gives identical ratios (scale invariance); with `DEFAULT_CALIBRATION`, the canonical face maps to all-zero `faceShape` (|w| < 1e-6) and a fixture with `faceAspect` widened by +3σ maps `faceWidth` to 0.8; `RATIO_TO_PARAM` covers all 8 keys.
`calibration.test.ts`: `accumulateCalibration` of two known samples → exact mean and std; std floor applies for identical samples; `calibrationSchema` accepts `calibration.json`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** fixture, `landmarks.ts`, `faceShape.ts`, `calibration.ts`, run `tsx tools/calibrate-canonical.ts` to produce `calibration.json`. Add the OBJ licence row.
- [ ] **Step 4: Run tests, lint, typecheck** → PASS.
- [ ] **Step 5: Commit** — `feat(analysis): landmark geometry, face ratios, seeded calibration`.

---

### Task 3: Colour extraction — skin, hair colour, eyes, lips

**Files:**
- Create: `src/analysis/masks.ts`, `src/analysis/color.ts`, `src/analysis/mapping/skin.ts`, `src/analysis/mapping/eyes.ts`, `src/analysis/mapping/lips.ts`, `src/analysis/mapping/hairColor.ts`
- Test: `tests/analysis/masks.test.ts`, `tests/analysis/color.test.ts`, `tests/analysis/colors.test.ts`

**Interfaces:**
```ts
// masks.ts (all masks are Uint8Array of 0/1 at image resolution unless noted)
export function categoryEquals(mask: CategoryMask, value: number): Uint8Array;                     // at mask resolution
export function resampleMask(data: Uint8Array, fromW: number, fromH: number, toW: number, toH: number): Uint8Array;  // nearest neighbour
export function restrictToBox(mask: Uint8Array, width: number, height: number, box: Box): Uint8Array;
export function andMasks(a: Uint8Array, b: Uint8Array): Uint8Array;
export function countOnes(mask: Uint8Array): number;
export function lowestRow(mask: Uint8Array, width: number, height: number): number;               // −1 when empty
export function coverage(mask: Uint8Array, width: number, height: number, box: Box): number;        // set pixels ÷ box pixels, 0..1
export function expandBox(box: Box, factor: number, width: number, height: number): Box;           // about centre, clamped to image
// color.ts
export function medianColorTrimmed(image: RgbaImage, mask: Uint8Array, trim?: number): string | null;  // OKLab; drop the darkest and brightest `trim` (default 0.2) fraction by L; null when fewer than 20 pixels
export function nearestEyeColor(hex: string): AvatarParams['eyeColor'];                             // OKLab distance to EYE_COLORS
// mapping/skin.ts
export function extractSkin(image: RgbaImage, faceSkin: Uint8Array, pixels: Point2[]): string;     // cheek + forehead patches ∧ faceSkin; fallback faceSkin ∧ faceBox; fallback defaultParams.skin
// mapping/hairColor.ts
export function extractHairColor(image: RgbaImage, hair: Uint8Array): string | null;                // brighter half by L, then plain median
// mapping/eyes.ts
export function extractEyeColor(image: RgbaImage, pixels: Point2[]): { preset: AvatarParams['eyeColor']; sample: string | null };  // per eye: centre 468/473, r = dist(469,471)/2; annulus 0.45r..0.95r; drop L > 0.85; median of both eyes
// mapping/lips.ts
export function extractLipTint(image: RgbaImage, pixels: Point2[]): string;                         // outer-lip polygon median; fallback defaultParams.lipTint
```

- [ ] **Step 1: Write the failing tests**
`masks.test.ts`: `categoryEquals` picks one class; `resampleMask` of a 2×2 checker to 4×4 keeps quadrants; `restrictToBox` zeroes outside; `lowestRow` returns the bottom-most set row and −1 for empty; `coverage` of a half-filled box = 0.5; `expandBox` clamps at image edges.
`color.test.ts`: trimmed median of a uniform patch returns that colour (±1/255); a patch with 15% pure-white specular pixels returns the base colour; fewer than 20 pixels → null; `nearestEyeColor('#4a76b0')` → 'blue', `'#3b2314'` → 'darkBrown'.
`colors.test.ts` (on `synthFace({ colors: { skin: '#8d5524', hair: '#2b1b12', iris: '#4a76b0', lips: '#b35a5a' } })`): `extractSkin` within ΔE(OKLab) < 0.03 of `#8d5524`; `extractHairColor` within 0.05 of `#2b1b12`; `extractEyeColor().preset` = 'blue'; `extractLipTint` within 0.05 of `#b35a5a`; with `hair: { length: 'none' }` `extractHairColor` is null.
- [ ] **Step 2: Run to verify failure.**  **Step 3: Implement.**  **Step 4: Tests, lint, typecheck PASS.**
- [ ] **Step 5: Commit** — `feat(analysis): skin, hair, eye and lip colour extraction`.

---

### Task 4: Hair tags, hairstyle selection, brows, and `analyzeToParams`

**Files:**
- Create: `src/analysis/mapping/hair.ts`, `src/analysis/mapping/hairstyle.ts`, `src/analysis/mapping/brows.ts`, `src/analysis/mapping/index.ts`
- Test: `tests/analysis/hair.test.ts`, `tests/analysis/hairstyle.test.ts`, `tests/analysis/brows.test.ts`, `tests/analysis/analyzeToParams.test.ts`

**Interfaces:**
```ts
// mapping/hair.ts
export type HairTags = { present: boolean; length: 'short' | 'medium' | 'long'; volume: 'low' | 'medium' | 'high'; bangs: boolean; parting: 'left' | 'center' | 'right' | 'none' };
export function hairTags(hair: Uint8Array, width: number, height: number, pixels: Point2[]): HairTags;
// region = hair ∧ expandBox(faceBox, 2.5); present = area ≥ 0.02 × faceBox area;
// length: lowestRow < chinY → short; < chinY + 0.9·faceH → medium; else long
// volume: area ÷ faceBox area: < 0.6 low; < 1.4 medium; else high
// forehead band = { x: faceBox.x, y: faceBox.y, width: faceBox.width, height: browY − faceBox.y } (browY = mean y of all brow landmarks); bangs = coverage(band) > 0.4
// parting: coverage of left vs right halves of the band; if !bangs → 'none'; |Δ| ≤ 0.25 → 'center'; else the side with LESS hair ('left' = subject's left = image right)
// mapping/hairstyle.ts
export function hairDistance(tags: HairTags, style: HairStyle): number;   // |lengthIdx Δ|×2 + |volumeIdx Δ| + (bangs≠ ? 1.5 : 0) + (parting≠ && neither 'none' ? 1 : 0)
export function rankHairstyles(tags: HairTags, catalog: Catalog, base: 'a' | 'b'): { style: HairStyle; distance: number }[];   // ascending, base-filtered
export function nearestHairstyle(tags: HairTags, catalog: Catalog | null, base: 'a' | 'b'): string;   // 'none' when !present or no catalog/candidates
// mapping/brows.ts
export function extractBrows(pixels: Point2[]): AvatarParams['brows'];
// thickness = mean over both brows of mean(dist(upper_i, lower_i)) ÷ faceH, mapped linearly [0.012, 0.040] → [0, 1], clamped
// shape from the upper curve: chord = inner→outer; h = max perpendicular distance of upper points above chord ÷ chord length; peakIndex = argmax
//   h < 0.08 → 'straight'; h ≥ 0.16 → 'arched'; peakIndex is one of the two outer points → 'angled'; else 'soft'
// mapping/index.ts
export type AnalysisDebug = { pose: { yaw: number; pitch: number; roll: number }; faceBox: Box; ratios: Ratios; zScores: Ratios; hairTags: HairTags;
  hairCandidates: { id: string; name: string; distance: number }[]; swatches: { skin: string; hair: string | null; lips: string; eyeSample: string | null } };
export function analyzeToParams(analysis: Analysis, opts: { calibration: Calibration; catalog: Catalog | null; base: 'a' | 'b'; current?: AvatarParams }): { params: AvatarParams; debug: AnalysisDebug };
// params = { ...(current ?? defaultParams), base, skin, hairColor (fallback: brow-region median, then defaultParams.hairColor), eyeColor, lipTint, hair: nearestHairstyle, brows, faceShape, pose: 'stand_neutral', expression: 'neutral' }; validated with avatarParamsSchema (throws on bug)
```

- [ ] **Step 1: Write the failing tests**
`hair.test.ts` on synth fixtures: long+bangs → `{ present: true, length: 'long', bangs: true }`; short no bangs → `{ length: 'short', bangs: false, parting: 'none' }`; parting 'left' fixture → `parting: 'left'`; `hair: { length: 'none' }` → `present: false`; two-face fixture: second face's hair outside the 2.5× box doesn't change `volume`.
`hairstyle.test.ts`: distance 0 for matching tags; long vs short = 4 before other terms; `nearestHairstyle` returns the closest id, filters by base, 'none' when `present` is false or catalog null.
`brows.test.ts`: canonical fixture gives a shape in the 4-set and thickness in [0, 1]; a fixture whose upper-brow points are lifted by 12% of the chord → 'arched'; lifted only at the outer point → 'angled'.
`analyzeToParams.test.ts`: on the default fixture returns schema-valid params with `base: 'a'`, `faceShape` ≈ 0, `expression: 'neutral'`; with a 1-entry catalog and long-hair fixture picks that id; with no hair → `hair: 'none'` and `hairColor` equals the brow-region median (Review Focus 2); debug has 8 ratios and 8 z-scores.
- [ ] **Step 2: Run to verify failure.**  **Step 3: Implement.**  **Step 4: Tests, lint, typecheck PASS.**
- [ ] **Step 5: Commit** — `feat(analysis): hair tags, hairstyle ranking, brows, analyzeToParams`.

---

### Task 5: Orchestrator and the analysis debug page

**Files:**
- Create: `src/analysis/analyze.ts`, `src/ui/dev/AnalysisPage.tsx`, `src/ui/dev/PhotoCanvas.tsx`, `src/ui/dev/analysisRoute.ts`
- Modify: `src/App.tsx` (hash `#analysis` → `AnalysisPage`, which embeds `<Viewer />`), `src/ui/dev/devFlag.ts` (`isAnalysisRoute()`), `e2e`/`window.__kiss` gets `analysis: { analyzePhoto, loadModels }`
- Test: `tests/analysis/analyze.test.ts`, `tests/ui/AnalysisPage.test.tsx`

**Interfaces:**
```ts
// analyze.ts
export type AnalysisErrorCode = 'models' | 'decode' | 'no_face' | 'face_too_small' | 'face_turned';
export class AnalysisError extends Error { code: AnalysisErrorCode }
export const GATES = { minFaceWidthPx: 120, maxYawDeg: 30, maxPitchDeg: 30 } as const;
export function pickLargest(faces: FaceObservation[]): FaceObservation | undefined;
export function applyGates(face: FaceObservation): void;    // throws AnalysisError face_too_small / face_turned
export type AnalyzeResult = { params: AvatarParams; debug: AnalysisDebug; face: FaceObservation; mask: CategoryMask; preview: HTMLCanvasElement; faceBox: Box };
export async function analyzePhoto(file: Blob, opts: { calibration?: Calibration; catalog: Catalog | null; base: 'a' | 'b'; current?: AvatarParams; onProgress?: ModelProgress;
  adapter?: { loadModels: typeof loadModels; detectFaces: typeof detectFaces; segment: typeof segment } }): Promise<AnalyzeResult>;
// loadModels (→ AnalysisError 'models') → decodePhoto (→ 'decode') → detectFaces → pickLargest (→ 'no_face') → applyGates → segment → analyzeToParams. The adapter option exists for tests.
export function messageFor(code: AnalysisErrorCode): string;   // strings.analysis.*
```
Debug page (`#analysis`), developer-facing, two columns: left `PhotoCanvas` (photo with toggles: landmarks, face box, hair mask, face-skin mask) and controls; right `<Viewer />` with the avatar. Controls: file input (`accept="image/*" capture="user"`, `data-testid="photo-input"`), status line (`data-analysis="idle|loading|analysing|done|error"`, error text from `messageFor`), *Apply to avatar* (`store.setParams(result.params)`; auto-applied on success), *Record fixture* (downloads `fixture-<timestamp>.json`: `{ face, mask: { width, height, data: base64 }, image: { width, height }, faceBox, params, debug }` — no pixels), calibration: *Add to calibration set* (keeps `ratios` in component state), count shown, *Export calibration.json* (`accumulateCalibration` → download), *Clear*. Attribute panel: swatches (skin/hair/lips/eye sample), pose, the 8 ratios with z-scores, hair tags, top-3 hairstyle candidates with distances, brows. Model-load progress bar while loading.

- [ ] **Step 1: Write the failing tests**
`analyze.test.ts` (mock adapter; `decodePhoto` stubbed via `vi.mock('../../src/analysis/image')` to return a synth image/canvas): happy path returns schema-valid params and calls `segment` once; `pickLargest` picks the biggest face box; adapter returning no faces → `AnalysisError('no_face')`; a 60 px-wide face → `face_too_small` (Review Focus 3); yaw 40° matrix → `face_turned`; `loadModels` rejecting → `'models'` (Review Focus 5); `decodePhoto` throwing `DecodeError` → `'decode'`; `messageFor` maps every code to a non-empty string from `strings`.
`AnalysisPage.test.tsx` (mock `analyzePhoto`): idle shows the privacy line and the input; a rejecting `analyzePhoto` with `'models'` shows `strings.analysis.modelsFailed` and a *Try again* button; a resolving one sets `data-analysis="done"`, shows 8 ratio rows and calls `store.setParams` with the returned params; *Add to calibration set* increments the counter.
- [ ] **Step 2: Run to verify failure.**  **Step 3: Implement.**  **Step 4: Tests, lint, typecheck PASS.**
- [ ] **Step 5: Commit** — `feat(dev): analysis debug page and photo → params orchestrator`.

---

### Task 6: End-to-end wiring tests and lineup-test tooling

**Files:**
- Create: `e2e/analysis.spec.ts`, `tools/lineup/assign.ts`, `tools/lineup.ts`, `docs/superpowers/m1-lineup-test.md`
- Modify: `README.md` (analysis section: models, debug page, calibration, lineup), `package.json` (`lineup` script)
- Test: `tests/tools/lineup/assign.test.ts`

**Interfaces:**
```ts
// tools/lineup/assign.ts
export type Lineup = { photo: string; options: string[]; answer: number };   // options = 3 avatar ids incl. the photo's own, shuffled; answer = index of the correct one
export function assignLineups(ids: string[], seed: number): Lineup[];        // deterministic (mulberry32); requires ≥ 3 ids; decoys never repeat within a lineup
```
`tools/lineup.ts` (Playwright, `tsx tools/lineup.ts --photos DIR --out DIR [--seed 1]`): starts/uses the preview server, opens `#analysis`, for each photo: `setInputFiles`, waits for `[data-analysis="done"]` (60 s) or `error` (recorded, skipped), reads `window.__kiss.store.getState().params`, sets `scene.framing: 'portrait'`, screenshots the canvas → `out/<name>.avatar.png`, `out/<name>.params.json`; then `assignLineups` → one sheet PNG per photo (photo left, three avatars right, numbered 1–3, no names) via `pngjs` compositing, plus `out/answers.json` and `out/summary.md` (errors listed). Photos never leave the machine; the out dir is git-ignored (`lineup-out/`).

`docs/superpowers/m1-lineup-test.md`: protocol — 10 consented frontal photos (vary skin tone, hair type/length, glasses, facial hair, age); run the tool; show each sheet to a person who hasn't seen the avatars, ask "which avatar is this photo?"; record hits in `answers.json`; pass ≥ 7/10 (spec §15); on failure, use the debug page's z-scores and hair candidates to see what missed, adjust mapping constants or calibration, re-run; note that the base avatar is still the dev placeholder with synthetic morphs, so face-shape hits will be weak until the real base and variants exist.

- [ ] **Step 1: Write the failing tests**
`assign.test.ts`: 5 ids → 5 lineups, each with 3 distinct options including its own, `answer` pointing at it; same seed → same output; different seed → different order; 2 ids → throws.
`e2e/analysis.spec.ts`:
```ts
const modelsPresent = fs.existsSync('public/models/face_landmarker.task') && fs.existsSync('public/models/selfie_multiclass_256x256.tflite');
test('analysis page renders with the viewer and privacy line', async ({ page }) => { await page.goto('/#analysis'); await expect(page.getByTestId('photo-input')).toBeVisible(); await expect(page.getByText(strings.analysis.privacy)).toBeVisible(); await expect(page.getByTestId('viewer')).toHaveAttribute('data-status', 'ready', { timeout: 45_000 }); });
test('model download failure shows a retry message', async ({ page }) => { await page.route('**/models/*', (r) => r.fulfill({ status: 500 })); await page.goto('/#analysis'); await page.getByTestId('photo-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: solidPngBuffer(64, 64) }); await expect(page.getByText(strings.analysis.modelsFailed)).toBeVisible({ timeout: 30_000 }); });
test.describe('with models', () => {
  test.skip(!modelsPresent, 'model files not fetched (sandbox); runs in CI');
  test('models load and a blank image reports no face', async ({ page }) => { await page.goto('/#analysis'); await page.getByTestId('photo-input').setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: solidPngBuffer(512, 512) }); await expect(page.getByText(strings.analysis.noFace)).toBeVisible({ timeout: 90_000 }); });
  test('a photo in e2e/fixtures/photos, when present, yields valid params', async ({ page }) => { const dir = 'e2e/fixtures/photos'; const photo = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => /\.(jpe?g|png)$/i.test(f)) : undefined; test.skip(!photo, 'no consented test photo present'); ... setInputFiles(path) → expect [data-analysis="done"] → params parse with avatarParamsSchema → faceShape values within −0.8..0.8 });
});
```
(`e2e/fixtures/photos/` is git-ignored; only the developer's machine has photos.)
- [ ] **Step 2: Run to verify failure.**  **Step 3: Implement** `assign.ts`, `lineup.ts`, the protocol doc, README, script, `.gitignore` entries (`lineup-out/`, `e2e/fixtures/photos/`).
- [ ] **Step 4: Run** `npm run ci` (the "with models" tests skip here; confirm they run in GitHub Actions after push) → PASS.
- [ ] **Step 5: Commit** — `feat(dev): analysis e2e wiring and lineup-test tooling`.

---

## Self-review notes

- Spec §6 coverage: input decode/downscale ✔ T1; detection + gates ✔ T1/T5; extraction table — skin ✔ T3, hair colour ✔ T3, eye colour ✔ T3, lip tint ✔ T3, face shape ✔ T2, hairstyle ✔ T4, brows ✔ T4, base not inferred ✔ T4 (`base` passed in), extras not detected ✔; calibration stats + recompute ✔ T2/T5 (seeded from the canonical model until real photos exist — a documented ruling); output = complete params ✔ T4; model lazy-load with progress ✔ T1/T5. Worker execution is deferred (main thread; MediaPipe's GPU delegate wants the page context) — ledger it. §13 debug page ✔ T5 (fixture recording, calibration batch). §14 error rows for analysis ✔ T5. §15 likeness gate: tooling + protocol ✔ T6; the human run is outside the plan.
- Names cross-checked: `FaceObservation`, `CategoryMask`, `RgbaImage`, `Box`, `Analysis`, `LM`, `measureRatios`, `ratiosToFaceShape`, `Calibration`, `DEFAULT_CALIBRATION`, `accumulateCalibration`, `hairTags`/`HairTags`, `nearestHairstyle`/`rankHairstyles`, `extractBrows`, `analyzeToParams`/`AnalysisDebug`, `analyzePhoto`/`AnalysisError`/`messageFor`, `assignLineups`, `strings.analysis.*`.
- Review Focus 1–5 → tests in T5, T4, T5, T2, T5+T6.
- Sandbox limitation stated in Global Constraints: real-model tests skip without the model files and run in CI; visual tuning on real photos happens on the developer's machine via the debug page.
