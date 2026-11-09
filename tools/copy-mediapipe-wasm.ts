/** Copies the tasks-vision wasm runtime into public/ so nothing is fetched from a third-party CDN. */
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('node_modules/@mediapipe/tasks-vision/wasm');
const dest = path.resolve('public/mediapipe/wasm');
fs.mkdirSync(dest, { recursive: true });
let count = 0;
for (const file of fs.readdirSync(src)) {
  fs.copyFileSync(path.join(src, file), path.join(dest, file));
  count++;
}
console.log(`copied ${count} wasm runtime files to ${dest}`);
