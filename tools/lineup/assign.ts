export type Lineup = { photo: string; options: string[]; answer: number };

/** Small deterministic PRNG so sheets are reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** For each photo: its own avatar plus two distinct decoys, shuffled; `answer` is the index of its own. */
export function assignLineups(ids: string[], seed: number): Lineup[] {
  if (ids.length < 3) throw new Error('need at least 3 photos for a 3-way lineup');
  const rand = mulberry32(seed);
  return ids.map((photo) => {
    const others = ids.filter((id) => id !== photo);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [others[i], others[j]] = [others[j]!, others[i]!];
    }
    const options = [photo, others[0]!, others[1]!];
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [options[i], options[j]] = [options[j]!, options[i]!];
    }
    return { photo, options, answer: options.indexOf(photo) };
  });
}
