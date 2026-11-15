/**
 * How the body calibration renders the avatar (spec §6): the viewport the app is opened at, the size
 * of the full-length render that is analysed, how far the arms are lowered from the T-pose, and the
 * height entered for it.
 */
export const CALIBRATION = {
  viewport: { width: 700, height: 1100 },
  render: { width: 1400, height: 2200 },
  armDownDeg: 70,
  heightCm: 165,
} as const;
