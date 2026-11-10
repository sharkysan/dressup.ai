import { useRef, useState } from 'react';
import {
  analyzePhoto,
  AnalysisError,
  messageFor,
  type AnalyzeResult,
} from '../../analysis/analyze';
import { downloadBlob } from '../../export/download';
import { Viewer } from '../../scene/Viewer';
import { useAppStore } from '../../store/useAppStore';
import { strings } from '../strings';
import { PhotoCanvas } from './PhotoCanvas';

type Status = 'idle' | 'loading' | 'analysing' | 'done' | 'error';

/**
 * Developer page (#analysis): photo → params with every intermediate visible (spec §13).
 * Records landmark/mask fixtures (no pixels).
 */
export function AnalysisPage() {
  const catalog = useAppStore((s) => s.catalog);
  const params = useAppStore((s) => s.params);
  const setParams = useAppStore((s) => s.setParams);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const lastFile = useRef<File | null>(null);

  async function run(file: File) {
    lastFile.current = file;
    setStatus('loading');
    setError(null);
    try {
      const res = await analyzePhoto(file, {
        catalog,
        current: params,
        onProgress: (f) => {
          setProgress(f);
          if (f >= 1) setStatus('analysing');
        },
      });
      setResult(res);
      setParams(res.params);
      setStatus('done');
    } catch (e) {
      setStatus('error');
      setError(e instanceof AnalysisError ? messageFor(e.code) : String(e));
      console.warn('analysis failed:', e);
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
            />
            <Attributes result={result} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" onClick={() => setParams(result.params)}>
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

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
