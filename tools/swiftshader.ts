/** Chromium flags for software WebGL (SwiftShader), so the 3D scene renders headless and in CI. */
export const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
