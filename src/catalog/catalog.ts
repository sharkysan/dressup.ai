import { z } from 'zod';

/** Hairstyle tags drive nearest-style selection from photo analysis (spec §6) and the UI filters. */
export const hairStyleSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  thumb: z.string().optional(),
  tags: z.object({
    length: z.enum(['short', 'medium', 'long']),
    volume: z.enum(['low', 'medium', 'high']),
    bangs: z.boolean(),
    parting: z.enum(['left', 'center', 'right', 'none']),
  }),
});
export type HairStyle = z.infer<typeof hairStyleSchema>;

export const catalogSchema = z.object({
  version: z.literal(2),
  base: z.object({ name: z.string(), url: z.string(), meta: z.string() }),
  hair: z.array(hairStyleSchema),
});
export type Catalog = z.infer<typeof catalogSchema>;

export const CATALOG_URL = '/assets/catalog.json';

/** Fetches and validates the built catalog. Throws on network or schema failure. */
export async function loadCatalog(url: string = CATALOG_URL): Promise<Catalog> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`catalog ${url}: HTTP ${response.status}`);
  return catalogSchema.parse(await response.json());
}

export function findHair(catalog: Catalog, id: string): HairStyle | undefined {
  return catalog.hair.find((h) => h.id === id);
}
