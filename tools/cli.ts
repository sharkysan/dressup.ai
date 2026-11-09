import { parseArgs } from 'node:util';

/** Minimal flag parser shared by the asset CLIs: `--name value` strings and `--flag` booleans. */
export function cli<S extends readonly string[], B extends readonly string[]>(
  strings: S,
  booleans: B,
  defaults: Partial<Record<S[number], string>> = {},
): Record<S[number], string | undefined> & Record<B[number], boolean> {
  const options: Record<string, { type: 'string' | 'boolean' }> = {};
  for (const s of strings) options[s] = { type: 'string' };
  for (const b of booleans) options[b] = { type: 'boolean' };
  const { values } = parseArgs({ options, strict: true });
  const out: Record<string, unknown> = {};
  for (const s of strings) out[s] = (values[s] as string | undefined) ?? defaults[s as S[number]];
  for (const b of booleans) out[b] = Boolean(values[b]);
  return out as Record<S[number], string | undefined> & Record<B[number], boolean>;
}

export function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`missing required --${name}`);
  return value;
}

export function human(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(0)} kB`;
}
