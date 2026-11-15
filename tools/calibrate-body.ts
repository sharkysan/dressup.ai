/**
 * calibrate-body: fits the body regression (spec §6) on renders of the avatar analysed by the app
 * itself, so it inverts the morphs as the app applies them, through the same detection, segmentation
 * and measurement as a photo.
 *   tsx tools/calibrate-body.ts [--train 600] [--holdout 100] [--seed 20261115] [--pages 4] [--url http://…]
 * Without --url it serves the app with Vite's dev server on a free port, closed at the end. The training
 * bodies come from the seed, the held-out ones from seed + 1. It writes src/analysis/body-calibration.json
 * and tests/fixtures/body-holdout.json, prints the held-out error per morph at both degrees, and exits 1
 * when a kept morph is off by more than 0.15 (after writing, so the numbers can be inspected).
 */
import { chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { createServer, type ViteDevServer } from 'vite';
import { CALIBRATION } from '../src/analysis/body/calibrationSetup';
import {
  CALIBRATED_MORPHS,
  designRow,
  estimateMorphs,
  type BodyCalibration,
  type CalibratedMorph,
} from '../src/analysis/body/estimate';
import { BODY_FEATURES, WIDTH_FEATURES, type BodyFeatures } from '../src/analysis/body/measure';
import type { AvatarParams } from '../src/catalog/params';
import type { CalibrationSample } from '../src/ui/dev/calibrationHook';
import { writeAtomically } from './base/writeAtomically';
import { chooseLambda, fitRidge, standardize } from './calibration/ridge';
import { sampleBodies } from './calibration/sample';
import { cli } from './cli';
import { SWIFTSHADER_ARGS } from './swiftshader';

const CALIBRATION_FILE = path.resolve('src/analysis/body-calibration.json');
const HOLDOUT_FILE = path.resolve('tests/fixtures/body-holdout.json');
/** Spec §15: every recovered morph within ±0.15 of the truth on the held-out renders. */
const TOLERANCE = 0.15;
/** The share of samples that may be dropped (an analysis error, or a body gate other than 'ok'). */
const MAX_DROPPED = 0.02;
const READY_TIMEOUT_MS = 120_000;

type Input = { body: AvatarParams['body']; skin: string };
type Measured = { body: AvatarParams['body']; features: BodyFeatures };
type Score = { maxAbsError: Record<CalibratedMorph, number>; rms: Record<CalibratedMorph, number> };
type Fit = { cal: BodyCalibration; lambdas: Record<CalibratedMorph, number>; score: Score };

async function main() {
  const args = cli(['train', 'holdout', 'seed', 'pages', 'url'] as const, [] as const, {
    train: '600',
    holdout: '100',
    seed: '20261115',
    pages: '4',
  });
  const train = count(args.train, 'train');
  const holdout = count(args.holdout, 'holdout');
  const pages = count(args.pages, 'pages');
  const seed = Number(args.seed);
  if (!Number.isInteger(seed)) throw new Error(`--seed must be an integer, got ${args.seed}`);

  const inputs = [...sampleBodies(train, seed), ...sampleBodies(holdout, seed + 1)];
  const server = args.url ? null : await serve();
  const url = args.url ?? server!.resolvedUrls!.local[0]!.replace(/\/$/, '');
  let samples: (CalibrationSample | string)[];
  try {
    samples = await collect(url, inputs, pages);
  } finally {
    await server?.close();
  }

  const kept: (Measured | null)[] = samples.map((s, i) =>
    typeof s !== 'string' && s.error === null && s.bodyGate === 'ok' && s.features
      ? { body: inputs[i]!.body, features: s.features }
      : null,
  );
  reportDropped(samples, kept);
  const trainSet = kept.slice(0, train).filter((s) => s !== null);
  const holdoutSet = kept.slice(train).filter((s) => s !== null);

  const setup = {
    train,
    holdout,
    seed,
    armDownDeg: CALIBRATION.armDownDeg,
    render: [CALIBRATION.render.width, CALIBRATION.render.height] as [number, number],
  };
  const fits = ([1, 2] as const).map((degree) => {
    const fitted = fit(trainSet, degree, setup);
    return { ...fitted, score: score(fitted.cal, holdoutSet) };
  });
  const worst = (f: Fit) => Math.max(...CALIBRATED_MORPHS.map((m) => f.score.maxAbsError[m]));
  const best = worst(fits[1]!) < worst(fits[0]!) ? fits[1]! : fits[0]!;
  const calibration: BodyCalibration = {
    ...best.cal,
    holdout: { n: holdoutSet.length, maxAbsError: best.score.maxAbsError },
  };

  await writeJson(CALIBRATION_FILE, calibration);
  await writeJson(HOLDOUT_FILE, {
    samples: holdoutSet.map((s) => ({
      gender: s.body.gender,
      features: s.features,
      truth: perMorph((m) => s.body[m]),
    })),
  });
  console.log(
    `\nKept ${trainSet.length}/${train} training and ${holdoutSet.length}/${holdout} held-out samples.`,
  );
  for (const f of fits) printTable(f, f === best, worst(f));
  printWorst(best.cal, holdoutSet);
  console.log(
    `\nWrote ${path.relative('.', CALIBRATION_FILE)} and ${path.relative('.', HOLDOUT_FILE)}.`,
  );
  if (worst(best) > TOLERANCE) {
    console.error(
      `A kept morph's held-out error is over ${TOLERANCE}: the calibration misses the target (spec §15).`,
    );
    process.exitCode = 1;
  }
}

function count(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

/** The app on Vite's dev server, on a free port, without HMR (a file edited mid-run never reloads a page). */
async function serve(): Promise<ViteDevServer> {
  const server = await createServer({
    // forwardConsole: the pages' console stays out of the run's output.
    server: { port: 0, strictPort: true, hmr: false, forwardConsole: false },
    // Its own dependency cache, apart from any dev server already running on the same checkout.
    cacheDir: 'node_modules/.vite-calibrate',
    logLevel: 'warn',
  });
  await server.listen();
  return server;
}

/**
 * Every input's sample, in order, shared out over `pages` pages: a CalibrationSample, or the message of
 * the error that broke the sample twice (the page is reopened before the second try).
 */
async function collect(
  url: string,
  inputs: Input[],
  pages: number,
): Promise<(CalibrationSample | string)[]> {
  const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });
  const out: (CalibrationSample | string)[] = new Array(inputs.length);
  const started = Date.now();
  let next = 0;
  let done = 0;
  const worker = async () => {
    let page = await openPage(browser, url);
    for (let i = next++; i < inputs.length; i = next++) {
      try {
        out[i] = await sampleOn(page, inputs[i]!);
      } catch (error) {
        console.warn(`sample ${i}: ${message(error)}; reopening its page`);
        await page.close().catch(() => undefined);
        page = await openPage(browser, url);
        out[i] = await sampleOn(page, inputs[i]!).catch(message);
      }
      done++;
      if (done % 20 === 0 || done === inputs.length) progress(done, inputs.length, started);
    }
  };
  try {
    console.log(`Rendering ${inputs.length} bodies on ${pages} pages at ${url}`);
    await Promise.all(Array.from({ length: Math.min(pages, inputs.length) }, worker));
  } finally {
    await browser.close();
  }
  return out;
}

async function openPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { ...CALIBRATION.viewport } });
  page.on('pageerror', (error) => console.error(`page error: ${error.message}`));
  await page.goto(`${url}/#dev`);
  await page.waitForFunction(
    () => {
      const state = window.__kiss?.store.getState();
      return state?.avatarStatus === 'ready' && state.avatarMetrics !== null;
    },
    undefined,
    { timeout: READY_TIMEOUT_MS },
  );
  return page;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sampleOn(page: Page, input: Input): Promise<CalibrationSample> {
  return page.evaluate((i) => window.__kiss!.calibration.sample(i), input);
}

function progress(done: number, total: number, started: number) {
  const each = (Date.now() - started) / 1000 / done;
  const left = ((total - done) * each) / 60;
  console.log(`${done}/${total} samples, ${each.toFixed(1)} s each, ~${left.toFixed(0)} min left`);
}

/** Throws when more than MAX_DROPPED of the samples are dropped, naming why they were. */
function reportDropped(samples: (CalibrationSample | string)[], kept: (Measured | null)[]) {
  const reasons = new Map<string, number>();
  samples.forEach((s, i) => {
    if (kept[i]) return;
    const why =
      typeof s === 'string'
        ? `failed: ${s}`
        : s.error
          ? `analysis error ${s.error}`
          : `body gate ${s.bodyGate}`;
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  });
  const dropped = [...reasons.values()].reduce((a, b) => a + b, 0);
  if (dropped === 0) return;
  const lines = [...reasons].map(([why, n]) => `  ${n} × ${why}`).join('\n');
  console.log(`Dropped ${dropped}/${samples.length} samples:\n${lines}`);
  if (dropped > MAX_DROPPED * samples.length) {
    throw new Error(`more than ${MAX_DROPPED * 100} % of the samples were dropped`);
  }
}

/**
 * The regression at `degree`: the inputs standardised on the training set, and per morph a ridge fit
 * with λ chosen by 5-fold cross-validation (chooseLambda). The clothing allowance is 0 for every width
 * (spec §6) until M3c tunes it on photos.
 */
function fit(
  train: Measured[],
  degree: 1 | 2,
  setup: BodyCalibration['setup'],
): { cal: BodyCalibration; lambdas: Record<CalibratedMorph, number> } {
  const inputs = BODY_FEATURES.length + 1;
  const raw: BodyCalibration = {
    version: 1,
    degree: 1,
    features: [...BODY_FEATURES],
    allowance: Object.fromEntries(
      WIDTH_FEATURES.map((f) => [f, 0]),
    ) as BodyCalibration['allowance'],
    mean: new Array<number>(inputs).fill(0),
    scale: new Array<number>(inputs).fill(1),
    coefficients: perMorph(() => []),
    holdout: { n: 0, maxAbsError: perMorph(() => 0) }, // scored on the held-out set by main
    setup,
  };
  // At degree 1 with mean 0 and scale 1, designRow is the raw inputs: the widths net of the allowance,
  // and gender.
  const standard = standardize(train.map((s) => designRow(s.features, s.body.gender, raw)));
  const cal: BodyCalibration = { ...raw, degree, ...standard };
  const X = train.map((s) => designRow(s.features, s.body.gender, cal));
  const truth = (m: CalibratedMorph) => train.map((s) => s.body[m]);
  const lambdas = perMorph((m) => chooseLambda(X, truth(m)));
  const coefficients = perMorph((m) => fitRidge(X, truth(m), lambdas[m]));
  return { cal: { ...cal, coefficients }, lambdas };
}

/** The held-out error per morph of the clamped estimate: its maximum and its RMS. */
function score(cal: BodyCalibration, holdout: Measured[]): Score {
  const errors = holdout.map((s) => {
    const estimate = estimateMorphs(s.features, s.body.gender, cal);
    return perMorph((m) => Math.abs(estimate[m] - s.body[m]));
  });
  return {
    maxAbsError: perMorph((m) => Math.max(0, ...errors.map((e) => e[m]))),
    rms: perMorph((m) => Math.sqrt(errors.reduce((sum, e) => sum + e[m] ** 2, 0) / errors.length)),
  };
}

const perMorph = <T>(value: (m: CalibratedMorph) => T) =>
  Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, value(m)])) as Record<CalibratedMorph, T>;

function printTable(f: Fit, kept: boolean, worst: number) {
  console.log(
    `\nDegree ${f.cal.degree}${kept ? ' (kept)' : ''}: held-out worst ${worst.toFixed(3)}`,
  );
  console.log(
    `  ${'morph'.padEnd(10)} ${'lambda'.padStart(8)} ${'max'.padStart(7)} ${'rms'.padStart(7)}`,
  );
  for (const m of CALIBRATED_MORPHS) {
    const max = f.score.maxAbsError[m];
    console.log(
      `  ${m.padEnd(10)} ${f.lambdas[m].toExponential(1).padStart(8)} ${max.toFixed(3).padStart(7)} ${f.score.rms[m].toFixed(3).padStart(7)}${max > TOLERANCE ? '  over' : ''}`,
    );
  }
}

/** The five held-out samples with the largest error on any morph, under the kept fit. */
function printWorst(cal: BodyCalibration, holdout: Measured[]) {
  const rows = holdout.map((s, i) => {
    const estimate = estimateMorphs(s.features, s.body.gender, cal);
    const errors = CALIBRATED_MORPHS.map((m) => ({ m, error: Math.abs(estimate[m] - s.body[m]) }));
    const worst = errors.reduce((a, b) => (b.error > a.error ? b : a));
    return { i, s, estimate, worst };
  });
  rows.sort((a, b) => b.worst.error - a.worst.error);
  console.log('\nWorst held-out samples (kept degree): truth → estimate');
  for (const { i, s, estimate, worst } of rows.slice(0, 5)) {
    const morphs = CALIBRATED_MORPHS.map(
      (m) => `${m} ${s.body[m].toFixed(2)}→${estimate[m].toFixed(2)}`,
    ).join(', ');
    console.log(
      `  #${i}: ${worst.m} off by ${worst.error.toFixed(3)}; gender ${s.body.gender.toFixed(2)}; ${morphs}`,
    );
  }
}

/** `value` as JSON, formatted as the repo's Prettier config formats it, written atomically. */
async function writeJson(file: string, value: unknown) {
  const options = (await resolveConfig(file)) ?? {};
  const text = await format(JSON.stringify(value), { ...options, filepath: file });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomically(file, new TextEncoder().encode(text));
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exit(1);
});
