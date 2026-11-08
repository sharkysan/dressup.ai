export type ExportSize = { width: number; height: number };

/**
 * Export resolution (spec §10): CSS size × `scale` (default 2), capped so the long edge
 * never exceeds `maxLongEdge` (default 2048). Device pixel ratio is deliberately ignored.
 */
export function computeExportSize(
  cssWidth: number,
  cssHeight: number,
  opts: { scale?: number; maxLongEdge?: number } = {},
): ExportSize {
  const { scale = 2, maxLongEdge = 2048 } = opts;
  let width = cssWidth * scale;
  let height = cssHeight * scale;
  const longEdge = Math.max(width, height);
  if (longEdge > maxLongEdge) {
    const factor = maxLongEdge / longEdge;
    width *= factor;
    height *= factor;
  }
  return { width: Math.round(width), height: Math.round(height) };
}
