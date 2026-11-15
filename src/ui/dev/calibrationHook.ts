import {
  AnalysisError,
  analyzePhoto,
  type AnalysisErrorCode,
  type AnalyzeResult,
} from '../../analysis/analyze';
import { CALIBRATION } from '../../analysis/body/calibrationSetup';
import type { BodyGate } from '../../analysis/body/gate';
import type { BodyFeatures } from '../../analysis/body/measure';
import { getAvatarVrm } from '../../avatar/avatarHandle';
import { setArmsDown } from '../../avatar/calibrationPose';
import type { AvatarParams } from '../../catalog/params';
import { renderPng } from '../../export/renderPng';
import { getViewerHandle } from '../../scene/viewerHandle';
import { useAppStore } from '../../store/useAppStore';

/** What the analysis made of one full-length render of the avatar. */
export type CalibrationSample = {
  /** The analysis's error code when it rejected, else null. */
  error: AnalysisErrorCode | null;
  poseFound: boolean;
  likenessGate: AnalyzeResult['likenessGate'] | null;
  /** The body gate (AnalyzeResult.body.gate), null when the analysis rejected. */
  bodyGate: BodyGate | null;
  /** The body's features when the gate passed, else null. */
  features: BodyFeatures | null;
};

/** How long a sample waits for the hair to come off. */
const HAIR_TIMEOUT_MS = 10_000;

/** Lowers the avatar's arms from the T-pose by `degrees`; false when no avatar is shown. */
function armsDown(degrees: number): boolean {
  const vrm = getAvatarVrm();
  if (!vrm) return false;
  setArmsDown(vrm, degrees);
  return true;
}

/** The scene rendered at width × height, as a PNG. */
function render(width: number, height: number): Promise<Blob> {
  const handle = getViewerHandle();
  if (!handle) return Promise.reject(new Error('calibration: no viewer'));
  return renderPng(handle, { width, height });
}

/**
 * Renders the avatar full-length with `body` and `skin` — bald, in the base layer, neutral, its arms
 * lowered by CALIBRATION.armDownDeg — at CALIBRATION.render, and runs the photo analysis on the render,
 * with the store's params as the current ones (so it keeps their gender). The result never reaches the
 * store; the params set for the render stay.
 */
async function sample(input: {
  body: AvatarParams['body'];
  skin: string;
}): Promise<CalibrationSample> {
  const store = useAppStore;
  const { scene } = store.getState().params;
  store.getState().setParams({
    body: input.body,
    skin: input.skin,
    hair: 'none',
    outfit: {},
    expression: 'neutral',
    scene: { ...scene, framing: 'full' },
  });
  await until(
    () => store.getState().attachedHair === 'none',
    HAIR_TIMEOUT_MS,
    'the hair to detach',
  );
  if (!armsDown(CALIBRATION.armDownDeg)) throw new Error('calibration: no avatar');
  await animationFrames(2);
  const blob = await render(CALIBRATION.render.width, CALIBRATION.render.height);
  try {
    const result = await analyzePhoto(blob, {
      catalog: null,
      current: store.getState().params,
      heightCm: input.body.heightCm,
    });
    return {
      error: null,
      poseFound: result.pose !== null,
      likenessGate: result.likenessGate,
      bodyGate: result.body.gate,
      features: result.body.measurement?.features ?? null,
    };
  } catch (error) {
    if (error instanceof AnalysisError) {
      return {
        error: error.code,
        poseFound: false,
        likenessGate: null,
        bodyGate: null,
        features: null,
      };
    }
    throw error;
  }
}

/** Resolves once `predicate` holds for the store, rejecting after `timeoutMs`. */
function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const unsubscribe = useAppStore.subscribe(() => {
      if (!predicate()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`calibration: timed out waiting for ${what}`));
    }, timeoutMs);
  });
}

function animationFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });
}

/** Dev/e2e: the body calibration's view of the avatar, as `window.__kiss.calibration`. */
export const calibrationHook = { armsDown, render, sample };
