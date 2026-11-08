import { PerspectiveCamera, Vector2 } from 'three';
import type { ViewerHandle } from '../scene/viewerHandle';
import type { ExportSize } from './exportSize';

/**
 * Renders the scene at `size` on the live canvas and captures it as a PNG, then restores
 * the on-screen size. The capture must happen synchronously after the render, before the
 * browser gets a chance to clear the drawing buffer — hence toBlob inside the Promise executor.
 */
export async function renderPng(
  { gl, scene, camera }: ViewerHandle,
  size: ExportSize,
): Promise<Blob> {
  const previousSize = gl.getSize(new Vector2());
  const previousRatio = gl.getPixelRatio();
  const perspective = camera instanceof PerspectiveCamera ? camera : null;
  const previousAspect = perspective?.aspect;

  try {
    gl.setPixelRatio(1);
    gl.setSize(size.width, size.height, false);
    if (perspective) {
      perspective.aspect = size.width / size.height;
      perspective.updateProjectionMatrix();
    }
    gl.render(scene, camera);
    const blob = await new Promise<Blob | null>((resolve) =>
      gl.domElement.toBlob((result) => resolve(result), 'image/png'),
    );
    if (!blob) throw new Error('Canvas produced no image');
    return blob;
  } finally {
    gl.setPixelRatio(previousRatio);
    gl.setSize(previousSize.x, previousSize.y, false);
    if (perspective && previousAspect !== undefined) {
      perspective.aspect = previousAspect;
      perspective.updateProjectionMatrix();
    }
    gl.render(scene, camera);
  }
}
