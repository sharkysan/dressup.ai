import { hexToOklab, oklabToHex } from '../color/oklab';

/** Perceptual (OKLab) mix of two hex colours; t = 0 → a, t = 1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const la = hexToOklab(a);
  const lb = hexToOklab(b);
  return oklabToHex({
    L: la.L + (lb.L - la.L) * t,
    a: la.a + (lb.a - la.a) * t,
    b: la.b + (lb.b - la.b) * t,
  });
}
