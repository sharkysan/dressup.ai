import { FACE_SHAPE_KEYS } from '../../avatar/applyParams';
import { EYE_COLORS } from '../../avatar/eyeColors';
import { defaultParams, type AvatarParams } from '../../catalog/params';
import { useAppStore } from '../../store/useAppStore';

const EXPRESSIONS: AvatarParams['expression'][] = [
  'neutral',
  'happy',
  'relaxed',
  'surprised',
  'wink',
];

/** Development controls for AvatarParams. Not user-facing; the real editor UI arrives in M4. */
export function ParamsPanel() {
  const params = useAppStore((s) => s.params);
  const catalog = useAppStore((s) => s.catalog);
  const setParams = useAppStore((s) => s.setParams);

  const hairOptions = (catalog?.hair ?? []).filter((h) => h.base === params.base);

  return (
    <aside style={panelStyle} data-testid="params-panel">
      <strong style={{ display: 'block', marginBottom: 8 }}>Dev params</strong>

      <Row label="Skin">
        <input
          data-testid="param-skin"
          type="color"
          value={params.skin}
          onChange={(e) => setParams({ skin: e.target.value })}
        />
      </Row>
      <Row label="Hair colour">
        <input
          data-testid="param-hairColor"
          type="color"
          value={params.hairColor}
          onChange={(e) => setParams({ hairColor: e.target.value })}
        />
      </Row>
      <Row label="Lip tint">
        <input
          data-testid="param-lipTint"
          type="color"
          value={params.lipTint}
          onChange={(e) => setParams({ lipTint: e.target.value })}
        />
      </Row>
      <Row label="Eyes">
        <select
          data-testid="param-eyeColor"
          value={params.eyeColor}
          onChange={(e) => setParams({ eyeColor: e.target.value as AvatarParams['eyeColor'] })}
        >
          {Object.keys(EYE_COLORS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Hair">
        <select
          data-testid="param-hair"
          value={params.hair}
          onChange={(e) => setParams({ hair: e.target.value })}
        >
          <option value="none">none</option>
          {hairOptions.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Framing">
        <select
          data-testid="param-framing"
          value={params.scene.framing}
          onChange={(e) =>
            setParams({
              scene: {
                ...params.scene,
                framing: e.target.value as AvatarParams['scene']['framing'],
              },
            })
          }
        >
          <option value="full">full</option>
          <option value="portrait">portrait</option>
        </select>
      </Row>
      <Row label="Expression">
        <select
          data-testid="param-expression"
          value={params.expression}
          onChange={(e) => setParams({ expression: e.target.value as AvatarParams['expression'] })}
        >
          {EXPRESSIONS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </Row>

      {FACE_SHAPE_KEYS.map((key) => (
        <Row key={key} label={key}>
          <input
            data-testid={`param-faceShape-${key}`}
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={params.faceShape[key]}
            onChange={(e) =>
              setParams({ faceShape: { ...params.faceShape, [key]: Number(e.target.value) } })
            }
          />
        </Row>
      ))}

      <button type="button" onClick={() => setParams(defaultParams)} style={{ marginTop: 8 }}>
        Reset
      </button>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        marginBottom: 4,
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  width: 260,
  padding: 10,
  borderRadius: 8,
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid #c9c4b8',
  fontFamily: 'system-ui, sans-serif',
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
};
