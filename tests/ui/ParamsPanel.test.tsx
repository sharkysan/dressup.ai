import { fireEvent, render, screen } from '@testing-library/react';
import type { Catalog } from '../../src/catalog/catalog';
import { defaultParams } from '../../src/catalog/params';
import { useAppStore } from '../../src/store/useAppStore';
import { ParamsPanel } from '../../src/ui/dev/ParamsPanel';

const catalog: Catalog = {
  version: 2,
  base: { name: 'A', url: '/a.vrm', meta: '/a.json' },
  hair: [
    {
      id: 'hair_a',
      name: 'Hair A',
      url: '/a.glb',
      tags: { length: 'short', volume: 'low', bangs: false, parting: 'none' },
    },
    {
      id: 'hair_b',
      name: 'Hair B',
      url: '/b.glb',
      tags: { length: 'long', volume: 'high', bangs: true, parting: 'left' },
    },
  ],
};

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.getState().setCatalog(catalog);
});

test('hair select lists none plus every catalog entry', () => {
  render(<ParamsPanel />);
  const options = Array.from((screen.getByTestId('param-hair') as HTMLSelectElement).options).map(
    (o) => o.value,
  );
  expect(options).toEqual(['none', 'hair_a', 'hair_b']);
});

test('Reset restores defaultParams', () => {
  render(<ParamsPanel />);
  fireEvent.change(screen.getByTestId('param-skin'), { target: { value: '#112233' } });
  expect(useAppStore.getState().params.skin).toBe('#112233');
  fireEvent.click(screen.getByText('Reset'));
  expect(useAppStore.getState().params).toEqual(defaultParams);
});

test('framing select switches between full and portrait', () => {
  render(<ParamsPanel />);
  fireEvent.change(screen.getByTestId('param-framing'), { target: { value: 'portrait' } });
  expect(useAppStore.getState().params.scene.framing).toBe('portrait');
});

test('a body slider changes only its own morph', () => {
  render(<ParamsPanel />);
  fireEvent.change(screen.getByTestId('param-body-waist'), { target: { value: '-0.5' } });
  expect(useAppStore.getState().params.body).toEqual({ ...defaultParams.body, waist: -0.5 });
});

test('the height slider sets heightCm', () => {
  render(<ParamsPanel />);
  fireEvent.change(screen.getByTestId('param-body-heightCm'), { target: { value: '180' } });
  expect(useAppStore.getState().params.body.heightCm).toBe(180);
});

test('body sliders have the documented ranges', () => {
  render(<ParamsPanel />);
  const range = (id: string) => {
    const el = screen.getByTestId(id) as HTMLInputElement;
    return [el.min, el.max, el.step];
  };
  expect(range('param-body-heightCm')).toEqual(['140', '210', '1']);
  expect(range('param-body-gender')).toEqual(['0', '1', '0.05']);
  expect(range('param-body-weight')).toEqual(['-1', '1', '0.05']);
});

test('the removed face-shape and lip controls stay gone', () => {
  render(<ParamsPanel />);
  expect(screen.queryByTestId(/^param-faceShape-/)).toBeNull();
  expect(screen.queryByTestId('param-lipTint')).toBeNull();
});
