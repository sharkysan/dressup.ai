# M1 likeness gate — the lineup test

Spec §15 says M1 passes when a stranger can pick the right avatar for a photo. This is the protocol.

## What you need

- **10 consented photos.** Each subject has agreed, in writing, to their photo being used to test this
  project and knows the photo stays on the tester's machine. Adults only. Mix skin tones, hair
  lengths, face shapes and glasses/no glasses; well-lit, roughly frontal (|yaw| ≤ 30°), face at
  least ~120 px wide after the longest edge is scaled to 1024.
- **One judge** who has not seen the avatars being built and does not know the subjects.
- The MediaPipe models under `public/models/` (`npm run assets:models`) and a built app.

## Run

```sh
npm run build && npm run preview -- --port 4173 &
npm run lineup -- --photos ~/consented-photos --out lineup-out --seed 1
```

`lineup-out/` (git-ignored) then holds, per photo, `<id>.params.json` and `<id>.avatar.png`
(portrait framing), plus:

- `sheet-01.png … sheet-10.png` — the photo on the left, three avatars numbered 1–3 on the right.
  Two of the three are decoys drawn from the other subjects (assignment is seeded; the same seed
  reproduces the same sheets).
- `answers.json` — which number is the real match for each sheet. **Do not show the judge.**
- `summary.md` — what analysed, what failed and why.

Photos that fail the gates (no face, too small, turned) are listed in `summary.md` and dropped from
the sheets; replace them and re-run rather than lowering the gates.

## Score

Show the judge each sheet in order and record the number they pick. Then compare with
`answers.json`.

| Result | Meaning |
| --- | --- |
| ≥ 7/10 correct | **Pass.** M1 ships; note the score and seed in `docs/superpowers/plans/…-m1b…` |
| 5–6/10 | Borderline. Look at the misses: same hair length confusions → hairstyle rules; skin swatches off → `src/analysis/mapping/skin.ts`; faces all look alike → calibration (below). Fix, re-run with a **new seed**. |
| ≤ 4/10 | Fail. Chance is 3.3/10, so the pipeline is not carrying likeness. Re-examine `ratiosToFaceShape` weights before touching assets. |

Record misses with the judge's reason in one line each; those become the M1b follow-up list.

## Calibration (do this once before the first scored run)

The z-score means in `src/analysis/calibration.json` are seeded from the canonical face model, not
from photos. On `#analysis`, load each consented photo, press **Add to calibration set**, then
**Export calibration.json** and replace the file. Means from ≥ 10 real faces spread the
`faceShape` values across the range instead of bunching near zero.

## Privacy

Nothing in this run leaves the machine: analysis is in-browser, `lineup-out/` and
`e2e/fixtures/photos/` are git-ignored, and the sheets contain the photos — delete `lineup-out/`
when the test is scored and recorded.
