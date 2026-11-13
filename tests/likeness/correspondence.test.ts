import {
  CORRESPONDENCE_URL,
  correspondenceSchema,
  type Correspondence,
} from '../../src/likeness/correspondence';

/** The smallest object the schema accepts: one Body triangle that every landmark lands on. */
function minimal(): Correspondence {
  return {
    version: 1,
    bodyVertexCount: 3,
    canonical: new Array<number>(1404).fill(0),
    canonicalToBase: {
      scale: 0.01,
      rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      translation: [0, 1.5, 0],
    },
    landmarks: Array.from({ length: 468 }, () => ({
      triangle: [0, 1, 2] as [number, number, number],
      bary: [1, 0, 0] as [number, number, number],
      uv: [0.5, 0.5] as [number, number],
      position: [0, 1.5, 0.1] as [number, number, number],
    })),
    triangles: [[0, 1, 2]],
    faceUvRect: { u: 0.25, v: 0.25, size: 0.5 },
    head: { vertices: [0, 1, 2], weights: [1, 1, 0.5], positions: new Array<number>(9).fill(0) },
    zero: [2],
  };
}

const parses = (value: unknown) => correspondenceSchema.safeParse(value).success;

test('a minimal valid object parses', () => {
  expect(correspondenceSchema.parse(minimal())).toEqual(minimal());
});

test('the whole unit square is a valid face rect', () => {
  expect(parses({ ...minimal(), faceUvRect: { u: 0, v: 0, size: 1 } })).toBe(true);
});

test.each([467, 469])('%i landmarks do not parse', (n) => {
  const c = minimal();
  c.landmarks = Array.from({ length: n }, () => c.landmarks[0]!);
  expect(parses(c)).toBe(false);
});

test.each([1403, 1407])('a canonical of %i numbers does not parse', (n) => {
  expect(parses({ ...minimal(), canonical: new Array<number>(n).fill(0) })).toBe(false);
});

test.each([
  ['past u = 1', { u: 0.8, v: 0.2, size: 0.3 }],
  ['past v = 1', { u: 0.2, v: 0.8, size: 0.3 }],
  ['below u = 0', { u: -0.1, v: 0.2, size: 0.3 }],
  ['below v = 0', { u: 0.2, v: -0.1, size: 0.3 }],
  ['of size 0', { u: 0.2, v: 0.2, size: 0 }],
])('a faceUvRect %s does not parse', (_, faceUvRect) => {
  expect(parses({ ...minimal(), faceUvRect })).toBe(false);
});

test('head arrays of different lengths do not parse', () => {
  const c = minimal();
  c.head.weights = [1, 1];
  expect(parses(c)).toBe(false);
  const d = minimal();
  d.head.positions = new Array<number>(8).fill(0);
  expect(parses(d)).toBe(false);
});

test('indices out of range do not parse', () => {
  expect(parses({ ...minimal(), zero: [3] })).toBe(false); // head.vertices has 3 entries
  expect(parses({ ...minimal(), triangles: [[0, 1, 468]] })).toBe(false);
  const c = minimal();
  c.landmarks[5]!.triangle = [0, 1, 3]; // bodyVertexCount is 3
  expect(parses(c)).toBe(false);
});

describe('loadCorrespondence', () => {
  // A fresh module per test: the loaded file is cached per page, that is, per module instance.
  const load = async () => (await import('../../src/likeness/correspondence')).loadCorrespondence;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetches the file once and validates it', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(minimal()))));
    vi.stubGlobal('fetch', fetch);
    const loadCorrespondence = await load();
    const first = await loadCorrespondence();
    expect(first).toEqual(minimal());
    expect(await loadCorrespondence()).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(CORRESPONDENCE_URL);
  });

  test('an HTTP error rejects naming the URL, and a later call fetches again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(minimal())));
    vi.stubGlobal('fetch', fetch);
    const loadCorrespondence = await load();
    await expect(loadCorrespondence()).rejects.toThrow(`${CORRESPONDENCE_URL}: HTTP 404`);
    await expect(loadCorrespondence()).resolves.toEqual(minimal());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('an invalid file rejects naming the URL', async () => {
    const stale = { ...minimal(), landmarks: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(stale)))),
    );
    const loadCorrespondence = await load();
    const error = await loadCorrespondence().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(CORRESPONDENCE_URL);
  });
});
