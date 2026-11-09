/**
 * Seeds src/analysis/calibration.json from the canonical face model: means = canonical ratios,
 * std = 8% of each mean, samples = 0. Replace with a real-photo calibration exported from the
 * #analysis debug page (spec §6 asks for 30–50 frontal photos).
 */
import fs from 'node:fs';
import { measureRatios, RATIO_KEYS } from '../src/analysis/mapping/faceShape';
import { synthFace } from './test-fixtures/canonicalFace';

const ratios = measureRatios(synthFace().face);
const stats = Object.fromEntries(
  RATIO_KEYS.map((k) => [k, { mean: ratios[k], std: 0.08 * ratios[k] }]),
);
const out = { version: 1, samples: 0, stats };
fs.writeFileSync('src/analysis/calibration.json', JSON.stringify(out, null, 2) + '\n');
console.log('wrote src/analysis/calibration.json (seed from the canonical face model)');
console.table(stats);
