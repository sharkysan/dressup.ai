import { useEffect, useRef, useState } from 'react';
import { LM, toPixels } from '../../analysis/landmarks';
import { categoryEquals, resampleMask, restrictToBox } from '../../analysis/masks';
import { personRegion, type BodyMeasurement } from '../../analysis/body/measure';
import { POSE, posePixels } from '../../analysis/pose';
import {
  MASK,
  type Box,
  type CategoryMask,
  type FaceObservation,
  type PoseObservation,
} from '../../analysis/types';

type Props = {
  preview: HTMLCanvasElement;
  face: FaceObservation;
  mask: CategoryMask;
  faceBox: Box;
  pose: PoseObservation | null;
  measurement: BodyMeasurement | null;
};

/** The skeleton's segments: shoulders, arms, torso, legs. */
const SKELETON: [number, number][] = [
  [POSE.shoulderL, POSE.shoulderR],
  [POSE.shoulderL, POSE.elbowL],
  [POSE.elbowL, POSE.wristL],
  [POSE.shoulderR, POSE.elbowR],
  [POSE.elbowR, POSE.wristR],
  [POSE.shoulderL, POSE.hipL],
  [POSE.shoulderR, POSE.hipR],
  [POSE.hipL, POSE.hipR],
  [POSE.hipL, POSE.kneeL],
  [POSE.kneeL, POSE.ankleL],
  [POSE.hipR, POSE.kneeR],
  [POSE.kneeR, POSE.ankleR],
];

const TOGGLES = ['landmarks', 'box', 'hair', 'skin', 'pose', 'body', 'silhouette'] as const;

/**
 * The analysed photo with toggleable overlays: landmarks, face box, hair and face-skin masks, the pose's
 * skeleton, the person region and the silhouette the body measurement reads (whenever there is a pose),
 * and the measurement's lines (when there is one). All in the analysed image's pixels.
 */
export function PhotoCanvas({ preview, face, mask, faceBox, pose, measurement }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [show, setShow] = useState<Record<(typeof TOGGLES)[number], boolean>>({
    landmarks: true,
    box: true,
    hair: true,
    skin: false,
    pose: true,
    body: true,
    silhouette: false,
  });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const { width, height } = preview;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom in unit tests
    ctx.drawImage(preview, 0, 0);

    const tint = (categories: number[], rgba: string, within?: Box) => {
      const resampled = resampleMask(
        categoryUnion(mask, categories),
        mask.width,
        mask.height,
        width,
        height,
      );
      const m = within ? restrictToBox(resampled, width, height, within) : resampled;
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
    if (show.hair) tint([MASK.hair], '80,60,220,0.45');
    if (show.skin) tint([MASK.faceSkin], '40,200,120,0.35');

    // The person region the measurement reads, from the pose and the face box: drawn with or without a
    // measurement, since a body measureBody can't measure is the one most worth seeing.
    const region = pose ? personRegion(pose, faceBox, width, height) : null;
    if (show.silhouette && region) {
      // What the measurement reads: body and hair within the person region.
      tint([MASK.hair, MASK.bodySkin, MASK.faceSkin, MASK.clothes], '255,140,0,0.35', region);
    }

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
    if (show.pose && pose) {
      const px = posePixels(pose);
      ctx.strokeStyle = '#7CFC00';
      ctx.lineWidth = 2;
      for (const [a, b] of SKELETON) {
        ctx.beginPath();
        ctx.moveTo(px[a]!.x, px[a]!.y);
        ctx.lineTo(px[b]!.x, px[b]!.y);
        ctx.stroke();
      }
      ctx.fillStyle = '#7CFC00';
      for (const p of px) ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    if (show.body && region) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(region.x, region.y, region.width, region.height);
    }
    if (show.body && measurement) {
      const { region: within, headTopY, ankleY, lines } = measurement;
      const hline = (y: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(within.x, y);
        ctx.lineTo(within.x + within.width, y);
        ctx.stroke();
      };
      hline(headTopY, '#ff00ff');
      hline(ankleY, '#ff00ff');
      ctx.strokeStyle = '#ff8c00';
      ctx.lineWidth = 2;
      for (const { a, b } of lines) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }, [preview, face, mask, faceBox, pose, measurement, show]);

  return (
    <div>
      <canvas
        ref={ref}
        data-testid="photo-canvas"
        style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }}
      />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginTop: 6 }}>
        {TOGGLES.map((key) => (
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

/** 0/1 mask of the pixels whose category is any of `categories`. */
function categoryUnion(mask: CategoryMask, categories: number[]): Uint8Array {
  const out = categoryEquals(mask, categories[0]!);
  for (const c of categories.slice(1)) {
    const m = categoryEquals(mask, c);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! | m[i]!;
  }
  return out;
}
