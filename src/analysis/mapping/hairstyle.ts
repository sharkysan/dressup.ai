import type { Catalog, HairStyle } from '../../catalog/catalog';
import type { HairTags } from './hair';

const LENGTH = ['short', 'medium', 'long'] as const;
const VOLUME = ['low', 'medium', 'high'] as const;

/** Tag distance (spec §6): |lengthΔ|×2 + |volumeΔ| + bangs mismatch 1.5 + parting mismatch 1 (when both have one). */
export function hairDistance(tags: HairTags, style: HairStyle): number {
  const t = style.tags;
  let d = Math.abs(LENGTH.indexOf(tags.length) - LENGTH.indexOf(t.length)) * 2;
  d += Math.abs(VOLUME.indexOf(tags.volume) - VOLUME.indexOf(t.volume));
  if (tags.bangs !== t.bangs) d += 1.5;
  if (tags.parting !== t.parting && tags.parting !== 'none' && t.parting !== 'none') d += 1;
  return d;
}

export function rankHairstyles(
  tags: HairTags,
  catalog: Catalog,
  base: 'a' | 'b',
): { style: HairStyle; distance: number }[] {
  return catalog.hair
    .filter((h) => h.base === base)
    .map((style) => ({ style, distance: hairDistance(tags, style) }))
    .sort((a, b) => a.distance - b.distance || a.style.id.localeCompare(b.style.id));
}

export function nearestHairstyle(tags: HairTags, catalog: Catalog | null, base: 'a' | 'b'): string {
  if (!tags.present || !catalog) return 'none';
  return rankHairstyles(tags, catalog, base)[0]?.style.id ?? 'none';
}
