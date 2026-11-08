import { supportsWebGL2 } from '../../src/scene/supportsWebGL2';

function fakeDoc(ctx: unknown): Document {
  return { createElement: () => ({ getContext: () => ctx }) } as unknown as Document;
}

test('true when a webgl2 context is available', () => {
  expect(supportsWebGL2(fakeDoc({}))).toBe(true);
});

test('false when getContext returns null', () => {
  expect(supportsWebGL2(fakeDoc(null))).toBe(false);
});

test('false when getContext throws', () => {
  const doc = {
    createElement: () => ({
      getContext: () => {
        throw new Error('x');
      },
    }),
  } as unknown as Document;
  expect(supportsWebGL2(doc)).toBe(false);
});
