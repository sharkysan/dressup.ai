/** Feature detection for the 3D viewer (spec §14: show a message instead of a blank page). */
export function supportsWebGL2(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}
