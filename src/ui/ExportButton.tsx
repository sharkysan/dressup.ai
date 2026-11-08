import { useState } from 'react';
import { downloadBlob } from '../export/download';
import { computeExportSize } from '../export/exportSize';
import { renderPng } from '../export/renderPng';
import { getViewerHandle } from '../scene/viewerHandle';
import { useAppStore } from '../store/useAppStore';
import { strings } from './strings';

export const EXPORT_FILENAME = 'avatar.png';

export function ExportButton() {
  const status = useAppStore((s) => s.avatarStatus);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    const handle = getViewerHandle();
    if (!handle) return;
    setBusy(true);
    try {
      const canvas = handle.gl.domElement;
      const size = computeExportSize(canvas.clientWidth, canvas.clientHeight);
      const blob = await renderPng(handle, size);
      downloadBlob(blob, EXPORT_FILENAME);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="export-button"
      disabled={status !== 'ready' || busy}
      onClick={handleClick}
      style={buttonStyle}
    >
      {strings.saveImage}
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid #c9c4b8',
  background: '#ffffff',
  fontSize: 14,
  cursor: 'pointer',
};
