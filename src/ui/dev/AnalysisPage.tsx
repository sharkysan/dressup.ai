import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import {
  analyzePhoto,
  AnalysisError,
  messageFor,
  type AnalyzeResult,
} from '../../analysis/analyze';
import type { BodyGate } from '../../analysis/body/gate';
import { BODY_FEATURES } from '../../analysis/body/measure';
import { BODY_MORPHS } from '../../catalog/params';
import { downloadBlob } from '../../export/download';
import { loadCorrespondence } from '../../likeness/correspondence';
import { FACE_TEXTURE_SIZE } from '../../likeness/faceTexture';
import { Viewer } from '../../scene/Viewer';
import { useAppStore } from '../../store/useAppStore';
import { strings } from '../strings';
import { PhotoCanvas } from './PhotoCanvas';

type Status = 'idle' | 'loading' | 'analysing' | 'done' | 'error';

/**
 * Developer page (#analysis): photo → params and likeness with every intermediate visible (spec §13).
 * Records landmark/mask fixtures (no pixels).
 */
export function AnalysisPage() {
  const catalog = useAppStore((s) => s.catalog);
  const params = useAppStore((s) => s.params);
  const setParams = useAppStore((s) => s.setParams);
  const setLikeness = useAppStore((s) => s.setLikeness);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [heightText, setHeightText] = useState(() =>
    String(useAppStore.getState().params.body.heightCm),
  );
  const lastFile = useRef<File | null>(null);

  async function run(file: File) {
    lastFile.current = file;
    const typed = Number(heightText);
    const heightCm =
      heightText.trim() !== '' && Number.isFinite(typed)
        ? Math.min(210, Math.max(140, typed))
        : useAppStore.getState().params.body.heightCm;
    setStatus('loading');
    setError(null);
    try {
      const res = await analyzePhoto(file, {
        catalog,
        current: params,
        heightCm,
        onProgress: (f) => {
          setProgress(f);
          if (f >= 1) setStatus('analysing');
        },
      });
      setResult(res);
      setParams(res.params);
      setLikeness(res.likeness);
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setError(e instanceof AnalysisError ? messageFor(e.code) : String(e));
      // Spec §3: no measurements in logs. An AnalysisError's message holds the face's width in px or
      // its yaw and pitch, so only its code is logged; any other error, its message, not the object.
      console.warn(
        'analysis failed:',
        e instanceof AnalysisError ? e.code : e instanceof Error ? e.message : String(e),
      );
    }
  }

  function recordFixture() {
    if (!result) return;
    const fixture = {
      face: result.face,
      mask: {
        width: result.mask.width,
        height: result.mask.height,
        data: toBase64(result.mask.data),
      },
      image: { width: result.preview.width, height: result.preview.height },
      faceBox: result.faceBox,
      pose: result.pose,
      body: { gate: result.body.gate },
      params: result.params,
      debug: result.debug,
    };
    downloadBlob(
      new Blob([JSON.stringify(fixture)], { type: 'application/json' }),
      `fixture-${Date.now()}.json`,
    );
  }

  const statusText =
    status === 'loading'
      ? `${strings.analysis.loadingModels} ${Math.round(progress * 100)}%`
      : status === 'analysing'
        ? strings.analysis.analysing
        : status === 'error'
          ? error
          : status === 'done'
            ? 'Done'
            : strings.analysis.privacy;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)',
        height: '100%',
        gap: 12,
        padding: 12,
        boxSizing: 'border-box',
      }}
    >
      <section style={{ overflow: 'auto', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Analysis debug</h2>
        <label style={{ display: 'block', margin: '0 0 6px' }}>
          Height (cm){' '}
          <input
            data-testid="height-input"
            type="number"
            min={140}
            max={210}
            value={heightText}
            onChange={(e) => setHeightText(e.target.value)}
            style={{ width: 70 }}
          />
        </label>
        <input
          data-testid="photo-input"
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void run(file);
          }}
        />
        <p
          data-testid="analysis-status"
          data-analysis={status}
          role={status === 'error' ? 'alert' : 'status'}
          style={{ margin: '8px 0' }}
        >
          {statusText}
        </p>
        {status === 'error' && (
          <button type="button" onClick={() => lastFile.current && void run(lastFile.current)}>
            {strings.analysis.retry}
          </button>
        )}
        {result && (
          <>
            <PhotoCanvas
              preview={result.preview}
              face={result.face}
              mask={result.mask}
              faceBox={result.faceBox}
              pose={result.pose}
              measurement={result.body.measurement}
            />
            <BodyPanel result={result} />
            <Attributes result={result} />
            <LikenessPanel result={result} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => {
                  setParams(result.params);
                  setLikeness(result.likeness);
                }}
              >
                Apply to avatar
              </button>
              <button type="button" onClick={recordFixture}>
                Record fixture
              </button>
            </div>
          </>
        )}
      </section>
      <section style={{ position: 'relative', minHeight: 400 }}>
        <Viewer />
      </section>
    </div>
  );
}

function Attributes({ result }: { result: AnalyzeResult }) {
  const { debug, params } = result;
  const sw = (hex: string | null) => (
    <span
      style={{
        display: 'inline-block',
        width: 14,
        height: 14,
        background: hex ?? 'transparent',
        border: '1px solid #999',
        verticalAlign: 'middle',
        marginRight: 4,
      }}
    />
  );
  return (
    <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
      <div>
        <b>Swatches</b>
        <div>
          {sw(debug.swatches.skin)} skin {debug.swatches.skin}
        </div>
        <div>
          {sw(debug.swatches.hair)} hair {debug.swatches.hair ?? '— (no hair)'} → {params.hairColor}
        </div>
        <div>
          {sw(debug.swatches.eyeSample)} eye {debug.swatches.eyeSample ?? '—'} → {params.eyeColor}
        </div>
        <b>Pose</b>
        <div>
          yaw {debug.pose.yaw.toFixed(1)}° pitch {debug.pose.pitch.toFixed(1)}° roll{' '}
          {debug.pose.roll.toFixed(1)}°
        </div>
        <b>Hair</b>
        <div>{JSON.stringify(debug.hairTags)}</div>
        <ol style={{ margin: '4px 0', paddingLeft: 18 }}>
          {debug.hairCandidates.slice(0, 3).map((c) => (
            <li key={c.id}>
              {c.name}{' '}
              <small>
                ({c.id}, d={c.distance})
              </small>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** The body gate's line (a Record, so a new outcome needs its line). */
const BODY_GATE_LINES: Record<BodyGate, string> = strings.analysis.bodyGate;

/** The body: the gate, with a measurement its ten ratios, and the body parameters the analysis chose. */
function BodyPanel({ result }: { result: AnalyzeResult }) {
  const { gate, measurement } = result.body;
  const { body } = result.params;
  return (
    <div style={{ marginTop: 10 }}>
      <b>Body</b>
      <div data-testid="body-gate">{BODY_GATE_LINES[gate]}</div>
      {measurement && (
        <div style={{ marginTop: 4 }}>
          {BODY_FEATURES.map((f) => (
            <div key={f} data-testid={`feature-${f}`}>
              {f} {measurement.features[f].toFixed(3)}
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        {BODY_MORPHS.map((m) => (
          <div key={m} data-testid={`body-morph-${m}`}>
            {m} {body[m].toFixed(2)}
          </div>
        ))}
        <div>heightCm {body.heightCm}</div>
      </div>
    </div>
  );
}

/** The projection gate's line, one per outcome (a Record, so a new outcome needs its line). */
const GATE_LINES: Record<AnalyzeResult['likenessGate'], string> = {
  ok: strings.analysis.likenessOk,
  too_small: strings.analysis.likenessTooSmall,
  failed: strings.analysis.likenessFailed,
};

/**
 * The likeness: the projection gate, and with a likeness its face texture, the head fit (residuals and
 * a front view of the aligned landmarks over the canonical ones) and the step timings, against the
 * 400 ms budget for fit + projection.
 */
function LikenessPanel({ result }: { result: AnalyzeResult }) {
  const { likeness, likenessGate, likenessDebug: debug } = result;
  return (
    <div style={{ marginTop: 10 }}>
      <b>Photo face</b>
      <div data-testid="likeness-gate">{GATE_LINES[likenessGate]}</div>
      {likeness && debug && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <figure style={{ margin: 0 }}>
            <BlobImage
              blob={likeness.faceTexture}
              data-testid="face-texture"
              alt="Face texture"
              width={256}
              height={256}
              style={{ background: '#777', display: 'block' }}
            />
            <figcaption style={{ maxWidth: 256 }}>
              Face texture, {FACE_TEXTURE_SIZE}² in the head's UV square: the face lies on its side
              there (forehead left, chin right). {likeness.faceTexture.type}, sourceSkin{' '}
              {likeness.sourceSkin}.
            </figcaption>
          </figure>
          <figure style={{ margin: 0 }}>
            <FitOverlay aligned={debug.aligned} />
            <figcaption style={{ maxWidth: 256 }}>
              Head fit, front view: canonical landmarks grey, the photo's aligned to them red.
            </figcaption>
          </figure>
          <div data-testid="likeness-timings">
            <div>
              residual RMS {debug.residualRmsMm.toFixed(1)} mm · max offset{' '}
              {debug.maxOffsetMm.toFixed(1)} mm
            </div>
            <div>
              fit {debug.ms.fit.toFixed(0)} ms · project {debug.ms.project.toFixed(0)} ms · encode{' '}
              {debug.ms.encode.toFixed(0)} ms
            </div>
            <div>
              fit + project {(debug.ms.fit + debug.ms.project).toFixed(0)} ms (budget 400 ms)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** An image of a blob through an object URL, revoked when the blob changes or the image unmounts. */
function BlobImage({ blob, ...props }: { blob: Blob } & ImgHTMLAttributes<HTMLImageElement>) {
  const show = useCallback(
    (img: HTMLImageElement) => {
      const url = URL.createObjectURL(blob);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [blob],
  );
  return <img ref={show} {...props} />;
}

const OVERLAY_SIZE = 256;

/**
 * A 256² front view (x right, y up, both in cm) of MediaPipe's canonical landmarks in grey and the
 * photo's landmarks, similarity-aligned to them, in red: what the head fit reads as the face's shape.
 */
function FitOverlay({ aligned }: { aligned: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [canonical, setCanonical] = useState<number[] | null>(null);
  useEffect(() => {
    let live = true;
    // Cached: the analysis loaded it.
    loadCorrespondence().then(
      (corr) => live && setCanonical(corr.canonical),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return; // jsdom in unit tests
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OVERLAY_SIZE, OVERLAY_SIZE);
    const sets = canonical ? [canonical, aligned] : [aligned];
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const points of sets) {
      for (let i = 0; i + 2 < points.length; i += 3) {
        minX = Math.min(minX, points[i]!);
        maxX = Math.max(maxX, points[i]!);
        minY = Math.min(minY, points[i + 1]!);
        maxY = Math.max(maxY, points[i + 1]!);
      }
    }
    const margin = 8;
    const scale = (OVERLAY_SIZE - 2 * margin) / Math.max(maxX - minX, maxY - minY, 1e-6);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const plot = (points: ArrayLike<number>, color: string) => {
      ctx.fillStyle = color;
      for (let i = 0; i + 2 < points.length; i += 3) {
        const x = OVERLAY_SIZE / 2 + (points[i]! - cx) * scale;
        const y = OVERLAY_SIZE / 2 - (points[i + 1]! - cy) * scale;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    };
    if (canonical) plot(canonical, '#9a9a9a');
    plot(aligned, '#e0245e');
  }, [aligned, canonical]);
  return (
    <canvas
      ref={ref}
      data-testid="fit-overlay"
      width={OVERLAY_SIZE}
      height={OVERLAY_SIZE}
      style={{ display: 'block', border: '1px solid #ccc' }}
    />
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
