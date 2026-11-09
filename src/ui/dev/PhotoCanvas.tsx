import { useEffect, useRef, useState } from 'react';
import { LM, toPixels } from '../../analysis/landmarks';
import { categoryEquals, resampleMask } from '../../analysis/masks';
import { MASK, type Box, type CategoryMask, type FaceObservation } from '../../analysis/types';

type Props = {
  preview: HTMLCanvasElement;
  face: FaceObservation;
  mask: CategoryMask;
  faceBox: Box;
};

/** The analysed photo with toggleable overlays: landmarks, face box, hair and face-skin masks. */
export function PhotoCanvas({ preview, face, mask, faceBox }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState({ landmarks: true, box: true, hair: true, skin: false });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { width, height } = preview;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom in unit tests
    ctx.drawImage(preview, 0, 0);

    const tint = (category: number, rgba: string) => {
      const m = resampleMask(
        categoryEquals(mask, category),
        mask.width,
        mask.height,
        width,
        height,
      );
      const img = ctx.getImageData(0, 0, width, height);
      const [r, g, b, a] = rgba.split(',').map(Number) as [number, number, number, number];
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        img.data[i * 4] = Math.round(img.data[i * 4]! * (1 - a) + r * a);
        img.data[i * 4 + 1] = Math.round(img.data[i * 4 + 1]! * (1 - a) + g * a);
        img.data[i * 4 + 2] = Math.round(img.data[i * 4 + 2]! * (1 - a) + b * a);
      }
      ctx.putImageData(img, 0, 0);
    };
    if (show.hair) tint(MASK.hair, '80,60,220,0.45');
    if (show.skin) tint(MASK.faceSkin, '40,200,120,0.35');

    if (show.box) {
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height);
    }
    if (show.landmarks) {
      const px = toPixels(face);
      ctx.fillStyle = '#00e5ff';
      for (const p of px) ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      ctx.fillStyle = '#ff3366';
      for (const i of [...LM.irisR, ...LM.irisL, LM.faceTop, LM.chin, LM.cheekR, LM.cheekL]) {
        const p = px[i]!;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    }
  }, [preview, face, mask, faceBox, show]);

  return (
    <div>
      <canvas
        ref={ref}
        data-testid="photo-canvas"
        style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }}
      />
      <div style={{ display: 'flex', gap: 12, fontSize: 12, marginTop: 6 }}>
        {(['landmarks', 'box', 'hair', 'skin'] as const).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={show[key]}
              onChange={(e) => setShow({ ...show, [key]: e.target.checked })}
            />{' '}
            {key}
          </label>
        ))}
      </div>
    </div>
  );
}
