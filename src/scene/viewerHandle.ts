import type { Camera, Scene, WebGLRenderer } from 'three';

/** The live renderer/scene/camera, published by the Viewer so the export module can re-render. */
export type ViewerHandle = { gl: WebGLRenderer; scene: Scene; camera: Camera };

let handle: ViewerHandle | null = null;

export function setViewerHandle(next: ViewerHandle | null): void {
  handle = next;
}

export function getViewerHandle(): ViewerHandle | null {
  return handle;
}
