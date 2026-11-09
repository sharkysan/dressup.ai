import { fireEvent, render, screen } from '@testing-library/react';
import { FACE_SHAPE_KEYS } from '../../src/avatar/applyParams';
import type { Catalog } from '../../src/catalog/catalog';
import { defaultParams } from '../../src/catalog/params';
import { useAppStore } from '../../src/store/useAppStore';
import { ParamsPanel } from '../../src/ui/dev/ParamsPanel';

const catalog: Catalog = {
  version: 1,
  bases: [{ id: 'a', name: 'A', url: '/a.vrm' }],
  hair: [
    {
      id: 'hair_a',
      name: 'Hair A',
      base: 'a',
      url: '/a.glb',
      tags: { length: 'short', volume: 'low', bangs: false, parting: 'none' },
    },
    {
      id: 'hair_b',
      name: 'Hair B',
      base: 'b',
      url: '/b.glb',
      tags: { length: 'long', volume: 'high', bangs: true, parting: 'left' },
    },
  ],
};

beforeEach(() => {
  useAppStore.getState().reset();
  useAppStore.getState().setCatalog(catalog);
});

test('renders one range input per face-shape key', () => {
  render(<ParamsPanel />);
  for (const key of FACE_SHAPE_KEYS)
    expect(screen.getByTestId(`param-faceShape-${key}`)).toBeInTheDocument();
  expect(FACE_SHAPE_KEYS).toHaveLength(8);
});

test('changing a face-shape slider updates the store', () => {
  render(<ParamsPanel />);
  fireEvent.change(screen.getByTestId('param-faceShape-jawWidth'), { target: { value: '0.5' } });
  expect(useAppStore.getState().params.faceShape.jawWidth).toBe(0.5);
});

test('hair select lists none plus catalog entries for the current base only', () => {
  render(<ParamsPanel />);
  const options = Array.from((screen.getByTestId('param-hair') as HTMLSelectElement).options).map(
    (o) => o.value,
  );
  expect(options).toEqual(['none', 'hair_a']);
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
