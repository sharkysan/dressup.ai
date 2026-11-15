/**
 * calibrate-body: fits the body regression (spec §6) on renders of the avatar analysed by the app
 * itself, so it inverts the morphs as the app applies them, through the same detection, segmentation
 * and measurement as a photo.
 *   tsx tools/calibrate-body.ts [--train 600] [--holdout 100] [--seed 20261115] [--pages 4] [--url http://…]
 * Without --url it serves the app with Vite's dev server on a free port, closed at the end. The training
 * bodies come from the seed, the held-out ones from seed + 1. After fitting both degrees it renders each
 * held-out estimate at both and measures it again; the degree whose worst outline ratio (outlineError)
 * is lower is kept. It writes src/analysis/body-calibration.json and tests/fixtures/body-holdout.json,
 * prints the held-out error per morph and per ratio at both degrees, and exits 1 (after writing, so the
 * numbers can be inspected) when a held-out estimate's re-render fails or a kept ratio's outline error
 * is over OUTLINE_TOLERANCE (spec §15). A sample that takes over SAMPLE_TIMEOUT_MS (a stuck page) is
 * retried once on a reopened page.
 *
 * The app parses src/analysis/body-calibration.json when it loads, and this CLI runs the app: after a
 * change to bodyCalibrationSchema, migrate the shipped file by hand first, or no page starts and the run
 * can't regenerate it.
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
import {
  BODY_FEATURES,
  WIDTH_FEATURES,
  type BodyFeature,
  type BodyFeatures,
} from '../src/analysis/body/measure';
import type { AvatarParams } from '../src/catalog/params';
import type { CalibrationSample } from '../src/ui/dev/calibrationHook';
import { writeAtomically } from './base/writeAtomically';
import { OUTLINE_TOLERANCE, outlineError, spread } from './calibration/outline';
import { chooseLambda, fitRidge, standardize } from './calibration/ridge';
import { sampleBodies } from './calibration/sample';
import { cli } from './cli';
import { SWIFTSHADER_ARGS } from './swiftshader';

const CALIBRATION_FILE = path.resolve('src/analysis/body-calibration.json');
const HOLDOUT_FILE = path.resolve('tests/fixtures/body-holdout.json');
/** The share of samples that may be dropped (an analysis error, or a body gate other than 'ok'). */
const MAX_DROPPED = 0.02;
const READY_TIMEOUT_MS = 120_000;
/**
 * The longest one sample may take; one takes under a minute on its page, even with four pages under
 * load. Past it the page is taken as stuck (a lost WebGL context, a model that never starts) and goes
 * through the reopen-and-retry path.
 */
const SAMPLE_TIMEOUT_MS = 180_000;

type Input = { body: AvatarParams['body']; skin: string };
type Measured = Input & { features: BodyFeatures };
type Score = { maxAbsError: Record<CalibratedMorph, number>; rms: Record<CalibratedMorph, number> };
type Outline = {
  /** outlineError over the held-out estimates that re-rendered. */
  error: Record<BodyFeature, number>;
  /** |re-render − original| ÷ original, its mean and maximum. */
  meanRel: Record<BodyFeature, number>;
  maxRel: Record<BodyFeature, number>;
};
type Fit = {
  cal: BodyCalibration;
  lambdas: Record<CalibratedMorph, number>;
  score: Score;
  /** Per held-out sample: the clamped estimate, and the features of its render (null: it failed). */
  estimates: Record<CalibratedMorph, number>[];
  reprojected: (BodyFeatures | null)[];
  outline: Outline;
};
type Pool = {
  collect: (inputs: Input[], what: string) => Promise<(CalibrationSample | string)[]>;
  close: () => Promise<void>;
};

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
  const pool = await openPool(url, pages);
  let trainSet: Measured[];
  let holdoutSet: Measured[];
  let fits: Fit[];
  try {
    const samples = await pool.collect(inputs, 'bodies');
    const kept = samples.map((s, i) => {
      const features = featuresOf(s);
      return features ? { ...inputs[i]!, features } : null;
    });
    reportDropped(samples, kept);
    trainSet = kept.slice(0, train).filter((s) => s !== null);
    holdoutSet = kept.slice(train).filter((s) => s !== null);

    const setup = {
      train,
      holdout,
      seed,
      armDownDeg: CALIBRATION.armDownDeg,
      render: [CALIBRATION.render.width, CALIBRATION.render.height] as [number, number],
    };
    const fitted = ([1, 2] as const).map((degree) => {
      const f = fit(trainSet, degree, setup);
      const estimates = holdoutSet.map((s) => estimateMorphs(s.features, s.body.gender, f.cal));
      return { ...f, score: score(estimates, holdoutSet), estimates };
    });
    // Each held-out estimate rendered as the original was: its gender and skin, the calibration height.
    const rendered = await pool.collect(
      fitted.flatMap((f) =>
        holdoutSet.map((s, i) => ({
          body: { heightCm: CALIBRATION.heightCm, gender: s.body.gender, ...f.estimates[i]! },
          skin: s.skin,
        })),
      ),
      'held-out estimates',
    );
    fits = fitted.map((f, k) => {
      const reprojected = rendered
        .slice(k * holdoutSet.length, (k + 1) * holdoutSet.length)
        .map(featuresOf);
      return { ...f, reprojected, outline: outline(holdoutSet, reprojected) };
    });
  } finally {
    await pool.close();
    await server?.close();
  }

  const worst = (f: Fit) => Math.max(...BODY_FEATURES.map((r) => f.outline.error[r]));
  const best = worst(fits[1]!) < worst(fits[0]!) ? fits[1]! : fits[0]!;
  const calibration: BodyCalibration = {
    ...best.cal,
    holdout: {
      n: holdoutSet.length,
      outlineError: best.outline.error,
      maxAbsError: best.score.maxAbsError,
    },
  };

  await writeJson(CALIBRATION_FILE, calibration);
  await writeJson(HOLDOUT_FILE, {
    samples: holdoutSet.map((s, i) => ({
      gender: s.body.gender,
      features: s.features,
      truth: perMorph((m) => s.body[m]),
      estimate: best.estimates[i],
      reprojected: best.reprojected[i],
    })),
  });
  console.log(
    `\nKept ${trainSet.length}/${train} training and ${holdoutSet.length}/${holdout} held-out samples.`,
  );
  for (const f of fits) printTables(f, f === best, worst(f));
  printWorst(best, holdoutSet);
  console.log(
    `\nWrote ${path.relative('.', CALIBRATION_FILE)} and ${path.relative('.', HOLDOUT_FILE)}.`,
  );
  const failed = fits.flatMap((f) =>
    f.reprojected.flatMap((r, i) => (r ? [] : [`#${i} at degree ${f.cal.degree}`])),
  );
  if (failed.length > 0) {
    console.error(`These held-out estimates' re-renders failed: ${failed.join(', ')}.`);
    process.exitCode = 1;
  }
  if (worst(best) > OUTLINE_TOLERANCE) {
    console.error(
      `A kept ratio's outline error is over ${OUTLINE_TOLERANCE} of its spread: the calibration misses the target (spec §15).`,
    );
    process.exitCode = 1;
  }
}

function count(value: string | undefined, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

/** A sample's features when it measured a body: no analysis error, the body gate 'ok'. */
function featuresOf(s: CalibrationSample | string): BodyFeatures | null {
  return typeof s !== 'string' && s.error === null && s.bodyGate === 'ok' ? s.features : null;
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
 * Up to `size` pages of the app in one browser, opened on first use and kept for the next collection.
 * `collect` gives every input's sample, in order, shared out over the pages: a CalibrationSample, or the
 * message of the error that broke the sample twice (the page is reopened before the second try).
 */
async function openPool(url: string, size: number): Promise<Pool> {
  const browser = await chromium.launch({ args: SWIFTSHADER_ARGS });
  const pages: (Page | undefined)[] = new Array(size);
  const collect = async (inputs: Input[], what: string) => {
    const out: (CalibrationSample | string)[] = new Array(inputs.length);
    const started = Date.now();
    let next = 0;
    let done = 0;
    const worker = async (w: number) => {
      for (let i = next++; i < inputs.length; i = next++) {
        let page = (pages[w] ??= await openPage(browser, url));
        try {
          out[i] = await sampleOn(page, inputs[i]!);
        } catch (error) {
          console.warn(`sample ${i}: ${message(error)}; reopening its page`);
          await page.close().catch(() => undefined);
          page = pages[w] = await openPage(browser, url);
          out[i] = await sampleOn(page, inputs[i]!).catch(message);
        }
        done++;
        if (done % 20 === 0 || done === inputs.length) progress(done, inputs.length, started);
      }
    };
    console.log(`Rendering ${inputs.length} ${what} on ${size} pages at ${url}`);
    await Promise.all(Array.from({ length: Math.min(size, inputs.length) }, (_, w) => worker(w)));
    return out;
  };
  return { collect, close: () => browser.close() };
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

/** The page's sample of `input`; throws when it takes over SAMPLE_TIMEOUT_MS. */
async function sampleOn(page: Page, input: Input): Promise<CalibrationSample> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no sample after ${SAMPLE_TIMEOUT_MS / 1000} s`)),
      SAMPLE_TIMEOUT_MS,
    );
  });
  try {
    // A stuck evaluate settles, rejected, when the retry path closes its page.
    return await Promise.race([
      page.evaluate((i) => window.__kiss!.calibration.sample(i), input),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
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
    // Scored on the held-out set by main.
    holdout: { n: 0, outlineError: perRatio(() => 0), maxAbsError: perMorph(() => 0) },
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

/** The held-out error per morph of the clamped estimates: its maximum and its RMS. */
function score(estimates: Record<CalibratedMorph, number>[], holdout: Measured[]): Score {
  const errors = holdout.map((s, i) => perMorph((m) => Math.abs(estimates[i]![m] - s.body[m])));
  return {
    maxAbsError: perMorph((m) => Math.max(0, ...errors.map((e) => e[m]))),
    rms: perMorph((m) => Math.sqrt(errors.reduce((sum, e) => sum + e[m] ** 2, 0) / errors.length)),
  };
}

/** The outline of the held-out estimates that re-rendered, against their originals. */
function outline(holdout: Measured[], reprojected: (BodyFeatures | null)[]): Outline {
  const pairs = holdout.flatMap((s, i) => {
    const r = reprojected[i];
    return r ? [{ features: s.features, reprojected: r }] : [];
  });
  const rel = (f: BodyFeature) =>
    pairs.map((p) => Math.abs(p.reprojected[f] - p.features[f]) / p.features[f]);
  return {
    error: outlineError(pairs),
    meanRel: perRatio((f) => rel(f).reduce((a, b) => a + b, 0) / pairs.length),
    maxRel: perRatio((f) => Math.max(...rel(f))),
  };
}

const perMorph = <T>(value: (m: CalibratedMorph) => T) =>
  Object.fromEntries(CALIBRATED_MORPHS.map((m) => [m, value(m)])) as Record<CalibratedMorph, T>;
const perRatio = <T>(value: (f: BodyFeature) => T) =>
  Object.fromEntries(BODY_FEATURES.map((f) => [f, value(f)])) as Record<BodyFeature, T>;

function printTables(f: Fit, kept: boolean, worst: number) {
  const morphs = Math.max(...CALIBRATED_MORPHS.map((m) => f.score.maxAbsError[m]));
  console.log(
    `\nDegree ${f.cal.degree}${kept ? ' (kept)' : ''}: held-out worst outline ratio ${worst.toFixed(3)}, worst morph ${morphs.toFixed(3)}`,
  );
  console.log(
    `  ${'morph'.padEnd(10)} ${'lambda'.padStart(8)} ${'max'.padStart(7)} ${'rms'.padStart(7)}`,
  );
  for (const m of CALIBRATED_MORPHS) {
    console.log(
      `  ${m.padEnd(10)} ${f.lambdas[m].toExponential(1).padStart(8)} ${f.score.maxAbsError[m].toFixed(3).padStart(7)} ${f.score.rms[m].toFixed(3).padStart(7)}`,
    );
  }
  console.log(
    `  ${'ratio'.padEnd(13)} ${'score'.padStart(7)} ${'mean rel'.padStart(9)} ${'max rel'.padStart(8)}`,
  );
  for (const r of BODY_FEATURES) {
    const error = f.outline.error[r];
    const pct = (v: number) => `${(100 * v).toFixed(1)} %`;
    console.log(
      `  ${r.padEnd(13)} ${error.toFixed(3).padStart(7)} ${pct(f.outline.meanRel[r]).padStart(9)} ${pct(f.outline.maxRel[r]).padStart(8)}${error > OUTLINE_TOLERANCE ? '  over' : ''}`,
    );
  }
}

/** The five held-out samples whose re-render is furthest off on a ratio, in units of its spread. */
function printWorst(f: Fit, holdout: Measured[]) {
  const sd = spread(holdout.map((s) => s.features));
  const rows = holdout.flatMap((s, i) => {
    const r = f.reprojected[i];
    if (!r) return [];
    const errors = BODY_FEATURES.map((ratio) => ({
      ratio,
      error: Math.abs(r[ratio] - s.features[ratio]) / sd[ratio],
      rel: Math.abs(r[ratio] - s.features[ratio]) / s.features[ratio],
    }));
    return [{ i, worst: errors.reduce((a, b) => (b.error > a.error ? b : a)) }];
  });
  rows.sort((a, b) => b.worst.error - a.worst.error);
  console.log('\nWorst held-out outlines (kept degree):');
  for (const { i, worst } of rows.slice(0, 5)) {
    console.log(
      `  #${i}: ${worst.ratio} off by ${worst.error.toFixed(2)} × its spread (${(100 * worst.rel).toFixed(1)} %)`,
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
