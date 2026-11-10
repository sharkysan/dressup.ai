import { Vector3, type Camera, type Scene, type WebGLRenderer } from 'three';

/** The live renderer/scene/camera, published by the Viewer so the export module can re-render. */
export type ViewerHandle = { gl: WebGLRenderer; scene: Scene; camera: Camera };

let handle: ViewerHandle | null = null;

export function setViewerHandle(next: ViewerHandle | null): void {
  handle = next;
}

export function getViewerHandle(): ViewerHandle | null {
  return handle;
}

/** Dev/e2e: a named scene node's position in canvas CSS pixels (origin top-left) with the canvas CSS size, or null if unavailable. */
export function nodeScreenPoint(
  name: string,
): { x: number; y: number; width: number; height: number } | null {
  const h = handle;
  const node = h?.scene.getObjectByName(name);
  if (!h || !node) return null;
  h.scene.updateMatrixWorld(true);
  const p = node.getWorldPosition(new Vector3()).project(h.camera);
  const { clientWidth: w, clientHeight: ht } = h.gl.domElement;
  return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * ht, width: w, height: ht };
}
