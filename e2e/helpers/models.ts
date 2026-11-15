import fs from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { MODEL_FILES } from '../../src/analysis/modelFiles';

const MODELS_DIR = path.resolve('public/models');

/** Whether every model the photo analysis loads (`MODEL_FILES`) is under `public/models/`. */
export const modelsPresent = Object.values(MODEL_FILES).every((name) =>
  fs.existsSync(path.join(MODELS_DIR, name)),
);

/**
 * Skips the enclosing file or `describe` unless the models are present. Call it where `test.skip`
 * would go. Models are fetched by `npm run assets:models` (CI) and git-ignored; skip, don't fail,
 * where absent.
 */
export function skipWithoutModels() {
  test.skip(!modelsPresent, 'MediaPipe models not present under public/models');
}
