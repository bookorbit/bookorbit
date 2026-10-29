import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// `MetadataProviderKey` now includes external providers named at runtime, so a `Record` over it
// collapses to a string index: it stops being exhaustive and every lookup types as defined. A map
// that must list every provider is keyed by `BuiltInMetadataProviderKey`; anything else is a
// `Partial` with a fallback. Adding a provider must never mean editing a map.
const REPO_ROOT = resolve(__dirname, '../../../..');
const ROOTS = ['server/src', 'client/src', 'packages/types/src'];
const EXHAUSTIVE_RECORD = /(?<!Partial<\s*)Record<\s*MetadataProviderKey(?:Type)?\s*,/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|vue)$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry) ? [path] : [];
  });
}

describe('provider key map guard', () => {
  const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root))).map((path) => ({
    path,
    name: relative(REPO_ROOT, path).split(sep).join('/'),
  }));

  it('finds sources in every workspace', () => {
    for (const root of ROOTS) expect(files.some((file) => file.name.startsWith(`${root}/`))).toBe(true);
  });

  it('keys no exhaustive map by the open provider key type', () => {
    const offenders = files.filter((file) => EXHAUSTIVE_RECORD.test(readFileSync(file.path, 'utf8'))).map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('recognises the forbidden form and allows the two safe ones', () => {
    expect(EXHAUSTIVE_RECORD.test('const LABELS: Record<MetadataProviderKey, string> = {')).toBe(true);
    expect(EXHAUSTIVE_RECORD.test('Partial<Record<MetadataProviderKey, string>>')).toBe(false);
    expect(EXHAUSTIVE_RECORD.test('Partial<\n  Record<MetadataProviderKey, string>\n>')).toBe(false);
    expect(EXHAUSTIVE_RECORD.test('Record<BuiltInMetadataProviderKey, string>')).toBe(false);
  });
});
