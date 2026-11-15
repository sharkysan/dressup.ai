# M3b Body From the Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-length photo analysed on the `#analysis` page shapes the avatar's body to the person's proportions at their entered height. The body is measured from MediaPipe pose landmarks and the person's silhouette, turned into body morphs by a regression calibrated on renders of the avatar itself, and guarded by a body gate that falls back to a default body.

**Architecture:**
- **Detection.** `PoseLandmarker` (full model) joins the MediaPipe adapter. FaceLandmarker on the whole photo misses faces as small as a full-length shot's (spike below). So for each pose whose nose no detected face covers, FaceLandmarker runs again on a head crop of the full-resolution photo placed from that pose, and the face it finds is mapped back into the photo's coordinates. The largest face is chosen as before, then the pose whose nose lies in its box.
- **Measurement.** Pure functions in `src/analysis/body/` take the chosen pose and the segmenter's mask:
  - the body gate;
  - the person's silhouette within their region;
  - ten ratios to the body's height in pixels.
- **Estimation.** A ridge regression (degree 1 or 2) from the ratios and the current gender to the eight morphs. The coefficients ship in `src/analysis/body-calibration.json`.
- **Calibration.** `tools/calibrate-body.ts` drives the app in headless Chromium:
  - random bodies in the base layer, arms lowered;
  - rendered by the app's export path;
  - analysed by the app's own `analyzePhoto`, the same code path as a photo end to end;
  - then it fits the regression in Node and writes the coefficients and a held-out fixture.
- **Debug page.** A height input, the body gate's line, the ratios and morphs, and pose and measurement overlays.

**Tech Stack:** TypeScript, `@mediapipe/tasks-vision` (PoseLandmarker), three.js / @pixiv/three-vrm (normalised bones for the calibration pose), zod, Vitest, Playwright (e2e and the calibration driver), Vite's `createServer` (the calibration driver). No Blender changes.

**Spec:** `docs/superpowers/specs/2026-11-08-dressup-game-design.md`. The governing sections:
- §6: detection, gates, the `body.*` rows, calibration.
- §12: pipeline step 7.
- §14: the body row.
- §15: body estimator accuracy.
- §16: M3b.
- §3: privacy.

**Spike (plan author, 2026-11-15).** The avatar was rendered full-length in the dev app, arms lowered 70° from the T-pose, at 700×1100 and 1400×2200.
- **FaceLandmarker on the whole image** (the 1024 px copy, as today) found no face at either size, with hair or bald. The face is ~65 px wide in the 1024 copy, too small a part of the frame for its short-range detector.
- **A square head crop** of the full-resolution render, centred on pose landmarks 0–10 with a side of 2, 3 or 4 × the ear-to-ear distance, found the face every time. Its cheek-to-cheek width was 161 px at 1400×2200.
- **PoseLandmarker (full)** returned all 33 landmarks:
  - visibility ≥ 0.96 for the shoulders, elbows, wrists, hips, knees and ankles, and 0.71 for the heels;
  - world shoulders 1.6° from facing the camera.
- **The segmenter's category mask** comes back at the input size. It labelled skin 2 and the base layer 4 (clothes), and arms 20° from the body leave a background gap beside the waist and hips.
- **So the M1 gate fails on the spec's own photo.** On a full-length shot, the hard gate "face box ≥ 120 px in the 1024 px copy" rejects every photo. This plan measures that gate at full resolution instead (ruling 1).

**Plan author's rulings.** These are spec changes; the task that makes each one writes it into the spec.
1. **Head-crop face detection, and the 120 px gate at full resolution (Task 1).** Why: the spike above. Faces large in the frame (portraits) are still found on the whole image, as today. The projection gate (≥ 256 px at full resolution) is unchanged. Two-photo capture was the alternative: it would make M3c's close-up prompt mandatory for every user.
2. **Calibration renders the runtime avatar in the browser (Task 4).** `tools/calibrate-body.ts` replaces `tools/calibrate-body.py`. Why: the regression must invert the morphs as the app applies them, which are linear shape keys (MPFB's macros don't combine linearly; see `BODY_CORNERS` in `build_base.py`). Only the browser runs MediaPipe, so the renders go through the same detection, segmentation and measurement as a photo.
3. **Three extra widths and gender as an input (Tasks 2–3).**
   - Thigh, calf and upper-arm widths join the spec's seven ratios, because weight, muscle and hips change the limbs as well as the trunk.
   - Gender is never inferred, but its slider changes the build. The estimate therefore takes it as given: the analysis passes the current gender, and M6's Reveal can re-estimate when it changes.
4. **The clothing allowance is 0 for every width** until M3c tunes it on the test-photo set, which doesn't exist yet. It is in the calibration file, so tuning it changes no code.
5. **The head top comes from the face landmarks, not the silhouette.** It is landmark 10 raised by `headTopFactor` × the landmark 10→152 distance. That factor is the base's proportion, read from `correspondence.json` (0.412 today). Hair volume therefore never changes the measured height. This holds on renders and photos alike.
6. **The body target is the outline (Task 4b; the owner's decision, 2026-11-15).** It replaces "every morph within ±0.15", which the full calibration missed on every morph (bust worst, at 1.01): a front view cannot separate the morphs. Each held-out estimate is rendered and measured again, and every ratio's RMS error over the held-out bodies must be at most half that ratio's spread across them (spec §15). The degree whose worst ratio is lower is kept.

## Global Constraints

- **Node commands.** Prefix every npm/npx/tsx command with `export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH" &&`.
- **Git hygiene.**
  - Never stage or delete the untracked `scarlet.webp`. Stage explicit paths only.
  - End every commit with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Don't push.
- **Install locations.** Nothing is installed outside the repo. Models are fetched into the git-ignored `public/models/` by `tools/fetch-models.sh`.
- **Privacy (§3).**
  - The photo, crops, masks, landmarks and measurements stay in memory. M3b writes none of them to storage, the URL, logs or the network.
  - No `console.*` call prints pixels, landmarks or measurements.
  - The calibration file and its fixture hold only numbers measured on renders of the avatar.
  - Real photos live only in the git-ignored `e2e/fixtures/photos/`.
- **`AvatarParams` is unchanged (version 2).**
  - Morphs are clamped to −1..1.
  - `gender` is 0..1 and never inferred: the analysis keeps the current value.
  - `heightCm` is 140..210, as entered.
- **Face gates (§6, after Task 1).**
  - |yaw| and |pitch| ≤ 20° is a hard gate (`face_turned`).
  - The face box ≥ 120 px wide **at full resolution** is a hard gate (`face_too_small`).
  - The face box ≥ 256 px at full resolution is the projection gate, unchanged.
- **Body gate (§6).**
  - Shoulders (11, 12), hips (23, 24), knees (25, 26) and ankles (27, 28) each need visibility ≥ 0.5.
  - The shoulder line must be within 25° of facing the camera, from the world landmarks' depth.
  - If the gate fails, every morph is 0, `gender` is kept and `heightCm` is as entered. The photo face is unaffected.
- **Pose landmarks.** MediaPipe's 33, with L/R the subject's:
  - nose 0; eyes and ears 1–8; mouth 9–10;
  - shoulders 11L/12R, elbows 13/14, wrists 15/16;
  - hips 23/24, knees 25/26, ankles 27/28.
- **Model.** `pose_landmarker_full.task` from `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task` (9.4 MB, Apache-2.0).
  - It is self-hosted at `/models/` and loaded with the other two.
  - The GPU→CPU fallback works as today.
- **Accuracy (§15).** The outline target of ruling 6.

## Review Focus

1. **A full-length photo, with the face small in the frame.** The face is found through the head crop, and the analysis neither rejects the photo nor picks the wrong person. Task 1: an `analyzePhoto` test with no whole-image face, and an e2e test on a full-length render.
2. **Arms touching the torso, or hands on the hips.** The torso widths exclude the arm. Task 2: `synthBody` tests with one arm touching and with both touching.
3. **Long hair over the shoulders or chest.** The widths ignore hair at a span's ends, and the area ignores hair. Task 2: a `synthBody` test with hair hanging past the shoulders.
4. **A body cut off at the knees, turned, or with no pose at all.** The gate names the reason, the body is the default at the entered height, and the photo face is still built. Task 2: gate tests per reason, and an `analyzePhoto` test where the gate fails while the likeness is `'ok'`.
5. **A second person beside the chosen one.** The pose is the one under the chosen face, and the other person's silhouette outside the region changes nothing. Task 1: a `pickPose` test. Task 2: a `synthBody` test with a second figure.

---

### Task 1: Pose detection and the head-crop face

**Files:**
- Create: `src/analysis/pose.ts`, `src/avatar/avatarHandle.ts`, `src/avatar/calibrationPose.ts`, `src/analysis/body/calibrationSetup.ts`, `src/ui/dev/calibrationHook.ts`, `tests/analysis/pose.test.ts`, `tests/avatar/calibrationPose.test.ts`, `e2e/body.spec.ts`
- Modify: `tools/fetch-models.sh`, `assets/LICENSES.md` (a row like the face landmarker's), `src/analysis/types.ts`, `src/analysis/mediapipe.ts`, `src/analysis/image.ts`, `src/analysis/analyze.ts`, `src/avatar/AvatarModel.tsx`, `src/App.tsx`, `src/ui/strings.ts`, `e2e/analysis.spec.ts` (`modelsPresent` also needs the pose model), `e2e/helpers/avatar.ts` (`openAvatar(page, viewport?)`), the spec
- Test: `tests/analysis/analyze.test.ts` (the fake adapter gains `detectPoses: vi.fn().mockReturnValue([])`), `tests/avatar/AvatarModel.test.tsx`

**Interfaces:**
- Produces:
  - `types.ts`:
    - `PoseLandmark = Point3 & { visibility: number }`.
    - `PoseObservation = { landmarks: PoseLandmark[]; world: Point3[]; imageWidth: number; imageHeight: number }`. Both arrays hold 33 points: `landmarks` normalised like the face's, and `world` in MediaPipe's metric, hip-centred frame.
  - `mediapipe.ts`:
    - `MODEL_URLS.poseLandmarker = '/models/pose_landmarker_full.task'`.
    - `detectPoses(canvas: HTMLCanvasElement): PoseObservation[]`, with `numPoses: 4`, IMAGE mode and no segmentation masks.
    - `loadModels` loads all three models. Its progress is loaded ÷ total bytes over the three downloads (or the mean of their fractions while a `content-length` is missing).
    - `modelsReady()` needs all three.
  - `pose.ts`:
    - `POSE` (the indices above).
    - `HEAD_CROP = { earMultiple: 3, minSidePx: 96, maxEdge: 1024 } as const`.
    - `posePixels(pose): Point2[]` (analysed pixels).
    - `pickPose(poses: PoseObservation[], faceBox: Box): PoseObservation | null`.
    - `headCropRect(pose: PoseObservation, full: { width: number; height: number }): Box` (full-resolution pixels).
    - `faceFromCrop(face: FaceObservation, rect: Box, full: { width; height }, analysed: { width; height }): FaceObservation`.
  - `image.ts`: `cropCanvas(bitmap: ImageBitmap, rect: Box, maxEdge = HEAD_CROP.maxEdge): HTMLCanvasElement`. It only scales down.
  - `analyze.ts`:
    - `Adapter` gains `detectPoses`.
    - `applyGates(face: FaceObservation, fullScale: number)`, where fullScale = full-resolution width ÷ analysed width.
    - `analyzePhoto` takes `opts.heightCm?: number`. Task 2 uses it; Task 1 only threads it through.
    - `AnalyzeResult.pose: PoseObservation | null`.
  - `avatarHandle.ts`: `setAvatarVrm(vrm: VRM | null): void`, `getAvatarVrm(): VRM | null`. `AvatarModel` sets the VRM once ready and null on unmount.
  - `calibrationPose.ts`: `setArmsDown(vrm: VRM, degrees: number): void`. It rotates the normalised `leftUpperArm` by −degrees and `rightUpperArm` by +degrees about z, replacing their rotation.
  - `calibrationSetup.ts`: `CALIBRATION = { viewport: { width: 700, height: 1100 }, render: { width: 1400, height: 2200 }, armDownDeg: 70, heightCm: 165 } as const`.
  - `calibrationHook.ts`: `calibrationHook = { armsDown, render, sample }`, exposed as `window.__kiss.calibration`.
    - `armsDown(degrees): boolean` is false without an avatar.
    - `render(width, height): Promise<Blob>` calls `renderPng` on the viewer handle.
    - `sample(input: { body: AvatarParams['body']; skin: string }): Promise<CalibrationSample>`:
      1. Sets params `{ body, skin, hair: 'none', outfit: {}, expression: 'neutral', scene: { ...current, framing: 'full' } }`.
      2. Waits until `attachedHair` is `'none'` (10 s timeout), lowers the arms by `CALIBRATION.armDownDeg` and waits two animation frames.
      3. Renders `CALIBRATION.render` and runs `analyzePhoto(blob, { catalog: null, current: <the store's params>, heightCm: body.heightCm })`. Passing `current` gives the estimate the rendered gender. It never writes the result to the store.
    - `CalibrationSample = { error: AnalysisErrorCode | null; poseFound: boolean; likenessGate: AnalyzeResult['likenessGate'] | null }`. Task 2 adds `bodyGate` and `features`; Task 4 adds `body`.

- [ ] **Step 1: Write the failing tests**

`tests/analysis/pose.test.ts`:
- `pickPose`:
  - It returns the pose whose nose (landmark 0, in analysed pixels) lies inside `faceBox`.
  - With two noses inside, it returns the one nearest the box centre.
  - With none inside, it returns `null`.
- `headCropRect` on a 3000×4000 photo:
  - The rect is centred on the mean of landmarks 0–10 in full-resolution pixels.
  - Its side is `3 × |ear7 − ear8|`, or 96 when that is smaller.
  - A head 20 px from the left edge gets a rect with `x === 0` and the same side (shifted, not shrunk).
- `faceFromCrop`:
  - A crop landmark (0.5, 0.5, 0.1) in rect `{ x: 1000, y: 400, width: 300, height: 300 }` of a 3000×4000 photo maps to `x = 1150/3000`, `y = 550/4000` and `z = 0.1 × 300/3000`.
  - `imageWidth` and `imageHeight` become the analysed size.
  - `matrix` and `blendshapes` are unchanged.

`tests/analysis/analyze.test.ts`:
- **A face found only through the crop.** The whole-image `detectFaces` (first call) returns `[]` and one pose is detected. The second `detectFaces` call returns a face, and the analysis returns that face mapped by `faceFromCrop`. `cropCanvas` receives `headCropRect(pose, full)`.
- **No crop for a covered pose.** A pose whose nose lies inside a whole-image face's box gets no crop: `detectFaces` is called once.
- **No face anywhere.** The analysis rejects with `no_face`.
- **The 120 px gate at full resolution**, on a photo 2× the analysed size:
  - A face 70 px wide in the analysed image passes (140 px at full resolution).
  - A face 50 px wide is rejected with `face_too_small`.
- **The chosen pose.** `result.pose` is the pose under the chosen face, and `null` when no pose is detected.

`tests/avatar/calibrationPose.test.ts`: with a fake humanoid whose `getNormalizedBoneNode` returns `Object3D`s, `setArmsDown(vrm, 70)` sets the left z rotation to −70° and the right to +70°. Calling it twice with 70 gives the same result.

`tests/avatar/AvatarModel.test.tsx`: `getAvatarVrm()` is the loaded VRM once ready, and `null` after unmount.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/analysis/pose.test.ts tests/analysis/analyze.test.ts tests/avatar`
Expected: FAIL. The new modules and exports don't exist, and the 70 px face is rejected by the 1024-copy gate.

- [ ] **Step 3: Implement**

The analysis order: decode, then `detectFaces(canvas)` and `detectPoses(canvas)`.
1. For each pose whose nose lies in no found face's box, crop and detect: `cropCanvas(bitmap, headCropRect(pose, full))`, then `detectFaces(crop)`, then `faceFromCrop`.
2. `pickLargest` over all the faces.
3. `applyGates(face, bitmap.width / image.width)`.
4. `pickPose(poses, faceBox)`, then segmentation and the rest, as today.

`faceFromCrop` scales z by `rect.width / full.width`, because MediaPipe's z shares x's scale.

Lower the arms by setting `rotation.z` on the normalised bone nodes. `vrm.update()` copies them to the raw bones every frame.

Change `strings.analysis.faceTooSmall` to `'The face is too small. Try a closer or higher-resolution photo.'` and `loadingModels` to `'Preparing photo analysis…'`.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/analysis tests/avatar`
Expected: PASS.

- [ ] **Step 5: e2e on a full-length render**

`e2e/body.spec.ts` skips unless all three models are present. Its test, "a full-length render of the avatar is analysed through the head crop":
1. `openAvatar(page, CALIBRATION.viewport)`.
2. `sample({ body: defaultParams.body, skin: defaultParams.skin })` through `page.evaluate`.
3. Expect `error: null`, `poseFound: true` and `likenessGate: 'too_small'`.

Run: `npx playwright test e2e/body.spec.ts e2e/analysis.spec.ts`
Expected: PASS.

- [ ] **Step 6: Spec**

- §6 detection: the whole-image face pass, the pose pass, the head crop per uncovered pose (centred on landmarks 0–10, side 3 × the ear distance, from the full-resolution photo), then the largest face and its pose.
- §6 hard gate: "≥ 120 px wide in the full-resolution image".
- §6 performance: models "~30 MB with `PoseLandmarker`" (3.8 + 9.4 + 16.4 MB).
- §17: a 2026-11-15 entry for ruling 1, with the spike's numbers.

- [ ] **Step 7: Commit**

```bash
git add tools/fetch-models.sh assets/LICENSES.md src/analysis src/avatar src/App.tsx src/ui tests/analysis tests/avatar e2e docs/superpowers/specs/2026-11-08-dressup-game-design.md
git commit -m "feat(analysis): PoseLandmarker, and faces found on a head crop of full-length photos"
```

### Task 2: Body measurement and the body gate

**Files:**
- Create: `src/analysis/body/gate.ts`, `src/analysis/body/measure.ts`, `tools/test-fixtures/body.ts`, `tests/analysis/bodyGate.test.ts`, `tests/analysis/bodyMeasure.test.ts`
- Modify: `src/analysis/analyze.ts`, `src/ui/dev/calibrationHook.ts`, `tests/analysis/analyze.test.ts`

**Interfaces:**
- Consumes: Task 1's `PoseObservation`, `POSE`, `posePixels`, `pickPose`, `AnalyzeResult.pose`, `opts.heightCm`.
- Produces:
  - `gate.ts`:
    - `BODY_GATE = { minVisibility: 0.5, maxShoulderTurnDeg: 25 } as const`.
    - `type BodyGate = 'ok' | 'no_pose' | 'not_visible' | 'turned'`.
    - `checkBodyGate(pose: PoseObservation | null): BodyGate`. Checks run in that order. The turn is `atan2(|zL − zR|, |xL − xR|)` over the world shoulders.
  - `measure.ts`:
    - `BODY_FEATURES = ['shoulderWidth', 'bustWidth', 'waistWidth', 'hipWidth', 'thighWidth', 'calfWidth', 'upperArmWidth', 'legLength', 'armLength', 'area'] as const`, with `BodyFeature`, `BodyFeatures = Record<BodyFeature, number>`, and `WIDTH_FEATURES` (the first seven).
    - `MEASURE` (the constants below).
    - `headTopFactor(corr: Correspondence): number`, computed as `(skullTop − y₁₀) / (y₁₀ − y₁₅₂)`. `skullTop` is the highest head vertex with weight ≥ 0.999; `y₁₀` and `y₁₅₂` are the base positions of landmarks 10 and 152.
    - `headTopY(face: FaceObservation, factor: number): number` (analysed pixels).
    - `personRegion(pose, faceBox: Box, width, height): Box`.
    - `measureBody(input: { pose: PoseObservation; mask: CategoryMask; faceBox: Box; headTopY: number; width: number; height: number }): BodyMeasurement | null` (null: see the torso span).
    - `BodyMeasurement = { features; heightPx; headTopY; ankleY; region: Box; armsTouching: { left: boolean; right: boolean }; lines: { feature: BodyFeature; a: Point2; b: Point2 }[] }`. `lines` holds where each width was measured, for the overlay.
  - `analyze.ts`:
    - `AnalyzeResult.body: { gate: BodyGate; measurement: BodyMeasurement | null }`.
    - `params.body` is `{ ...defaultParams.body, gender: current gender, heightCm: opts.heightCm ?? current heightCm }` whatever the gate says. Task 4 swaps in the estimate when the gate is `'ok'`.
  - `CalibrationSample` gains `bodyGate: BodyGate | null` and `features: BodyFeatures | null`.

**Measurement**, in analysed pixels, with left/right averaged:

```ts
export const MEASURE = {
  regionFaceExpand: 2.5, // the person region: this face box multiple ∪ the pose landmarks' box …
  regionMargin: 0.1, // … grown by this fraction of that box's height on every side (§6)
  gapFraction: 0.01, // of heightPx: background gaps a torso span bridges
  // t = 0 at the shoulder line, 1 at the hip line (mean y of 11/12, of 23/24)
  bands: { shoulder: [-0.05, 0.1], bust: [0.3, 0.4], waist: [0.55, 0.85], hip: [0.9, 1.1] },
  limbAt: { upperArm: 0.5, thigh: 1 / 3, calf: 1 / 3 }, // along shoulder→elbow, hip→knee, knee→ankle
} as const;
```

- **Height.** `heightPx` = ankle line (mean y of 27 and 28) − `headTopY`.
- **Silhouette.** `body` = bodySkin ∪ faceSkin ∪ clothes, with hair kept as a separate mask. Both are resampled to the analysed size and restricted to `personRegion`.
- **Torso span at row y.** The midline runs through the mid-shoulder and mid-hip points.
  - The span is the longest interval of body ∪ hair through the midline in which every background gap is ≤ `gapFraction × heightPx`, one the midline lies in included.
  - Hair pixels are then trimmed off both ends.
  - A row whose span does not contain the midline (it lies in a wider gap, or in hair with the body on one side only) is skipped: it never reaches the reducers.
  - `measureBody` returns null when any torso band has no row left, when `heightPx` ≤ 0, or when the hip line is not below the shoulder line. `analyzePhoto` then reports `body.gate: 'not_visible'` with `measurement: null` and the default body.
  - The shoulder band takes the span as it is: the arms hang from there.
- **Arms in the bust, waist and hip bands.**
  - A side touches when its arm axis lies inside the span. The axis at row y is shoulder→elbow, or elbow→wrist below the elbow.
  - A touching side takes the other side's half-width.
  - When both sides touch, each side ends at its axis minus `upperArmWidth / 2`.
- **Torso band reducers.** shoulder = max, bust = median, waist = min, hip = max of the span widths over the band's rows.
- **Limb widths.** At `limbAt` along each limb, walk the perpendicular to its axis outward both ways over `body` (hair excluded) until background. The width is 2 × the smaller half, averaged over both sides. The smaller half means a hand on the thigh or legs that touch never widen it.
- **Lengths.**
  - `legLength` = |hip−knee| + |knee−ankle|.
  - `armLength` = |shoulder−elbow| + |elbow−wrist|.
- **Area.** The `body` pixels (hair excluded) from the shoulder line to the ankle line.
- **Normalising.** Widths and lengths ÷ `heightPx`; area ÷ `heightPx²`.

- [ ] **Step 1: Write the fixture and the failing tests**

`tools/test-fixtures/body.ts`: `synthBody(opts)` draws a front-facing figure into a `CategoryMask` and returns `{ pose, mask, faceBox, headTopY, expected: BodyFeatures }`. The figure has:
- a head disc;
- a torso whose half-width profile passes through set values at each band;
- arms as thick segments, clear of the torso or touching;
- legs as thick segments, with a gap or touching;
- the base layer drawn as clothes and the rest as body skin;
- the matching 33 landmarks (visibility 1, world shoulders level).

Options:
- the half-widths;
- `arms: 'clear' | 'leftTouching' | 'bothTouching'`;
- `legsTouching`;
- `hairPastShoulders`;
- `secondPerson` (a full figure beside it, outside the region).

`expected` is computed from the drawn shapes.

`tests/analysis/bodyMeasure.test.ts`:
- A clear figure gives every feature within 1 px ÷ `heightPx` of `expected`, and the area within 1 %.
- With `leftTouching` or `bothTouching`, the bust, waist and hip widths match the clear figure's within 1 px. `armsTouching` reports the touching sides.
- With `hairPastShoulders`, the shoulder and bust widths and the area equal the hairless figure's.
- `secondPerson` leaves every feature unchanged.
- With `legsTouching`, `thighWidth` still matches `expected`.
- `headTopFactor` on a minimal correspondence (landmark 10 at y 1.5, 152 at y 1.4, the top head vertex at y 1.54) is 0.4.

`tests/analysis/bodyGate.test.ts`:
- No pose → `'no_pose'`.
- One ankle at visibility 0.49 → `'not_visible'`.
- World shoulders turned 30° → `'turned'`, and 20° → `'ok'`.
- A gate that fails for both reasons reports `'not_visible'`.

`tests/analysis/analyze.test.ts`:
- **Gate `'ok'`.** `body.measurement` is non-null, and `params.body` has every morph 0, the current gender and `heightCm: 180` from `opts.heightCm`.
- **Gate `'not_visible'`.** `measurement` is `null`, and `likenessGate` is still `'ok'` for a large face.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/analysis`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Implement `gate.ts` and `measure.ts`, and wire them into `analyzePhoto` and `sample()`**

`analyzePhoto` gets `headTopFactor` from the correspondence it already loads.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/analysis` and `npx playwright test e2e/body.spec.ts`
Expected: PASS. Extend the Task 1 e2e test to expect `bodyGate: 'ok'` and all ten features finite and positive.

- [ ] **Step 5: Spec**

- §6 `body.*` row: the ten ratios, the band and reducer rules, the arm and hair rules, the head top (ruling 5) and the area's rows.
- §6 detection: the person region's definition (`regionMargin`).

- [ ] **Step 6: Commit**

```bash
git add src/analysis tools/test-fixtures/body.ts src/ui/dev/calibrationHook.ts tests/analysis e2e/body.spec.ts docs/superpowers/specs/2026-11-08-dressup-game-design.md
git commit -m "feat(analysis): body gate and body measurement from pose landmarks and the silhouette"
```

### Task 3: The body estimator

**Files:**
- Create: `src/analysis/body/estimate.ts`, `tools/calibration/ridge.ts`, `tests/analysis/bodyEstimate.test.ts`, `tests/tools/calibration/ridge.test.ts`

**Interfaces:**
- Consumes: `BODY_FEATURES`, `WIDTH_FEATURES`, `BodyFeatures` (Task 2); `BODY_MORPHS` (`src/catalog/params.ts`).
- Produces:
  - `estimate.ts`:
    - `CALIBRATED_MORPHS`: `BODY_MORPHS` without `'gender'` (8), with `CalibratedMorph`.
    - `bodyCalibrationSchema` and `BodyCalibration`: `{ version: 1; degree: 1 | 2; features: BodyFeature[]; allowance: Record<WidthFeature, number>; mean: number[]; scale: number[]; coefficients: Record<CalibratedMorph, number[]>; holdout: { n: number; outlineError: Record<BodyFeature, number>; maxAbsError: Record<CalibratedMorph, number> }; setup: { train: number; holdout: number; seed: number; armDownDeg: number; render: [number, number] } }`. The schema enforces:
      - `features` equals `BODY_FEATURES` in order;
      - `allowance` ≥ 0;
      - `mean` and `scale` are 11 long (10 features + gender), with `scale` > 0;
      - each coefficient array is `1 + designLength(degree)` long, intercept first.
    - `designLength(degree): number`: 11, or 11 + 66 = 77.
    - `designRow(features, gender, cal): number[]`, built as:
      1. raw inputs `[...BODY_FEATURES.map(f => width ? x / (1 + allowance[f]) : x), gender]`;
      2. standardised `(x − mean) / scale`;
      3. with degree 2, appended products `x_i·x_j` for `i ≤ j` in row-major order.
    - `estimateMorphs(features, gender, cal): Record<CalibratedMorph, number>`: intercept + coefficients · row, clamped to −1..1.
  - `ridge.ts`:
    - `standardize(rows: number[][]): { mean: number[]; scale: number[] }`, with the population std and 1 where std < 1e-12.
    - `fitRidge(X: number[][], y: number[], lambda: number): number[]`: `[intercept, ...slopes]`. X is already standardised. The intercept is unpenalised, and the solve uses Cholesky on XᵀX + λI.
    - `LAMBDAS`: 10^k for k = −4, −3.5, …, 2.
    - `chooseLambda(X, y, lambdas = LAMBDAS, folds = 5, seed = 1): number`: the least mean squared error over seeded k-fold splits.

- [ ] **Step 1: Write the failing tests**

`bodyEstimate.test.ts`:
- `designRow` with degree 1 returns the standardised 11 inputs.
- With degree 2, its length is 77 and entry 11 is x₀², entry 12 is x₀·x₁, and the last is x₁₀².
- An allowance of 0.25 on `waistWidth` divides only that input by 1.25.
- `estimateMorphs` with intercepts only returns them, and clamps an intercept of 1.7 to 1.
- The schema rejects reordered features and a coefficient array one too short.

`ridge.test.ts`:
- Noiseless data `y = 0.3 + 2x₀ − x₁` with λ = 1e-8 recovers `[0.3, 2, −1]` within 1e-6.
- λ = 100 shrinks the slopes but keeps the intercept at mean(y).
- `chooseLambda` picks ≤ 1e-3 on noiseless data and ≥ 10 when y is noise uncorrelated with X.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/analysis/bodyEstimate.test.ts tests/tools/calibration`
Expected: FAIL.

- [ ] **Step 3: Implement both modules**

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/analysis/bodyEstimate.test.ts tests/tools/calibration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/body/estimate.ts tools/calibration/ridge.ts tests/analysis/bodyEstimate.test.ts tests/tools/calibration
git commit -m "feat(analysis): body estimator (calibration schema, design rows, ridge fit)"
```

### Task 4: Calibration run, and the estimate in the analysis

**Files:**
- Create: `tools/calibrate-body.ts`, `tools/calibration/sample.ts`, `tools/swiftshader.ts`, `src/analysis/body-calibration.json` (generated), `tests/fixtures/body-holdout.json` (generated), `tests/analysis/bodyCalibration.test.ts`, `tests/tools/calibration/sample.test.ts`
- Modify: `package.json` (`"calibrate:body": "tsx tools/calibrate-body.ts"`), `playwright.config.ts` and `tools/lineup.ts` (import `SWIFTSHADER_ARGS`), `src/analysis/analyze.ts`, `src/ui/dev/calibrationHook.ts`, `e2e/body.spec.ts`, the spec

**Interfaces:**
- Consumes: `calibrationHook.sample` (Tasks 1–2); `CALIBRATION`; `designRow`, `estimateMorphs`, `bodyCalibrationSchema` (Task 3); `standardize`, `fitRidge`, `chooseLambda` (Task 3); `writeAtomically` (`tools/base/writeAtomically.ts`).
- Produces:
  - `sample.ts`:
    - `SKIN_TONES = ['#f1d3b8', '#e0b48f', '#c68642', '#a0663a', '#7a4a2a', '#4a2a1a']`.
    - `sampleBodies(n: number, seed: number): { body: AvatarParams['body']; skin: string }[]` (mulberry32). Each of the 8 morphs is uniform in −1..1, gender uniform in 0..1, `heightCm` is `CALIBRATION.heightCm`, and the skin is a uniform pick.
  - `swiftshader.ts`: `SWIFTSHADER_ARGS` (the four Chromium flags now in `playwright.config.ts`).
  - The CLI: `tsx tools/calibrate-body.ts [--train 600] [--holdout 100] [--seed 20261115] [--pages 4] [--url http://…]`. Without `--url`, it starts Vite's `createServer` on a free port and closes it at the end.
  - `analyzePhoto`: when the body gate is `'ok'`, `params.body = { ...estimateMorphs(features, gender, calibration), gender, heightCm }`. The calibration is imported as JSON and parsed once with the schema.
  - `CalibrationSample` gains `body: AvatarParams['body'] | null`.

- [ ] **Step 1: Write the failing tests**

`sample.test.ts`:
- The same seed gives the same list, and every value is in range.
- The training seed and `seed + 1` (the held-out set) share no body.

`bodyCalibration.test.ts`:
- `body-calibration.json` parses.
- The held-out accuracy test: the outline target of ruling 6 (Task 4b).
- The recomputed per-morph maximum errors equal `holdout.maxAbsError` within 1e-9.

`analyze.test.ts`: with the gate `'ok'`, `params.body`'s morphs equal `estimateMorphs` on the measured features.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/tools/calibration tests/analysis/bodyCalibration.test.ts`
Expected: FAIL, because the files don't exist yet.

- [ ] **Step 3: Implement `sample.ts`, `swiftshader.ts` and the CLI**

The CLI:
1. Opens `--pages` pages at `CALIBRATION.viewport` on `/#dev`, each waiting for the avatar to be ready.
2. Shares out `sampleBodies(train, seed)` and `sampleBodies(holdout, seed + 1)` and collects each `sample()`.
3. Drops samples with an error or a gate other than `'ok'`, and fails if more than 2 % are dropped.
4. Fits degree 1 and degree 2, standardising on the training set and choosing λ per morph with `chooseLambda`.
5. Re-renders both degrees' held-out estimates and measures them again, and keeps the degree with the lower worst outline ratio (`outlineError`, ruling 6); ties go to degree 1. The clamped maximum absolute error per morph is recorded for information only.
6. Writes both files with `writeAtomically`, then prints the per-morph table for both degrees.
7. Exits 1 if the kept degree misses the target of ruling 6. It writes the files first, so the numbers can be inspected.

- [ ] **Step 4: Run the calibration**

Run: `npm run calibrate:body` (expect 20–40 min).
Expected: exit 0 (ruling 6).

**If the kept degree misses the target of ruling 6:**
- Do not loosen the test, change the bands, or drop a morph.
- Report BLOCKED with both tables and the five worst held-out samples. Which body measurements are reachable from a front view is the owner's call.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run tests/tools/calibration tests/analysis`
Expected: PASS.

- [ ] **Step 6: e2e: a rendered body analyses back to itself**

Add to `e2e/body.spec.ts`, for two bodies through `sample()`:
- all morphs 0 with gender 0;
- `{ gender: 0.2, weight: 0.5, muscle: -0.3, shoulders: 0.4, bust: -0.4, waist: 0.3, hips: -0.5, legLength: 0.4, armLength: -0.3 }`.

Expect `bodyGate: 'ok'`, and the outline of ruling 6 (Task 4b: `body`, rendered again, measures as the original render).

Run: `npx playwright test e2e/body.spec.ts`
Expected: PASS.

- [ ] **Step 7: Spec**

- §6 calibration paragraph (rulings 2–4):
  - rendered in the app by `tools/calibrate-body.ts`;
  - 600 training and 100 held-out bodies, sampled uniformly;
  - gender as an input;
  - degree 1 or 2 ridge, λ by 5-fold CV;
  - allowance 0 until M3c.
- §12 step 7: `tools/calibrate-body.ts` (`npm run calibrate:body`, on demand).
- §16 M3b: "Done when a full-length photo analysed on the debug page shapes the avatar's body at the entered height, and the held-out accuracy test passes."
- §17: entries for rulings 2 and 3.

- [ ] **Step 8: Commit**

```bash
git add tools/calibrate-body.ts tools/calibration tools/swiftshader.ts tools/lineup.ts playwright.config.ts package.json src/analysis tests/fixtures/body-holdout.json tests/analysis tests/tools/calibration src/ui/dev/calibrationHook.ts e2e/body.spec.ts docs/superpowers/specs/2026-11-08-dressup-game-design.md
git commit -m "feat(analysis): body calibration on renders of the avatar; the analysis estimates the body"
```

### Task 5: The debug page

**Files:**
- Modify: `src/ui/dev/AnalysisPage.tsx`, `src/ui/dev/PhotoCanvas.tsx`, `src/ui/strings.ts`, `tests/ui/AnalysisPage.test.tsx`, `e2e/analysis.spec.ts`

**Interfaces:**
- Consumes: `AnalyzeResult.pose` and `AnalyzeResult.body` (Tasks 1–2); `BodyGate`; `BodyMeasurement`; `POSE`.
- Produces:
  - `strings.analysis.bodyGate: Record<BodyGate, string>`:
    - `ok`: 'Body measured from the photo';
    - `no_pose`: 'No body found — using a default body for your height';
    - `not_visible`: 'Body not fully visible — using a default body for your height';
    - `turned`: 'Body turned from the camera — using a default body for your height'.
  - `PhotoCanvas` props gain `pose: PoseObservation | null` and `measurement: BodyMeasurement | null`. The toggles become `landmarks`, `box`, `hair`, `skin`, `pose`, `body`, `silhouette`:
    - `pose` draws the skeleton's segments and points;
    - `body` draws the measurement lines, the head-top and ankle lines and the region box;
    - `silhouette` tints body ∪ hair within the region.

- [ ] **Step 1: Write the failing tests**

`tests/ui/AnalysisPage.test.tsx`:
- The height input (`data-testid="height-input"`, min 140, max 210, default the store's `heightCm`) is passed to `analyzePhoto` as `heightCm`. A value of 182 reaches it.
- `data-testid="body-gate"` shows `strings.analysis.bodyGate[gate]` for each of the four gates.
- With a measurement, the body panel lists the ten features (3 decimals) and the eight morphs and gender of `params.body`.
- The recorded fixture includes `pose` and `body.gate`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/ui/AnalysisPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the height input, the body panel, the overlays and the fixture fields**

- [ ] **Step 4: Run them and see them pass, then run the consented-photo e2e test**

Extend the consented-photo test in `e2e/analysis.spec.ts`:
1. Fill the height input with 172.
2. Expect `body-gate` to show one of the four lines, `params.body.heightCm` to be 172, and every morph to be within −1..1.

Run: `npx vitest run tests/ui && npx playwright test e2e/analysis.spec.ts`
Expected: PASS, with the photo test skipped while there's no photo.

- [ ] **Step 5: Run the full check**

Run: `npm run ci`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ui tests/ui e2e/analysis.spec.ts
git commit -m "feat(dev): analysis page height input, body gate, ratios and pose/measurement overlays"
```
