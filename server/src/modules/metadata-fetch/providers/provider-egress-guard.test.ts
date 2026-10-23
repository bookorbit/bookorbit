import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Requests that skip the instrumented wrappers are invisible to the metadata cache, which would then
// take a provider's swallowed failure for a complete answer. The cover validator is the one
// exception: it reports itself as an auxiliary request.
const ALLOWED_DIRECT_FETCH = new Set(['google/google-cover-validator.ts']);
const DIRECT_FETCH = /(?:^|[^.\w$])fetch\s*\(|\b(?:globalThis|global|window)\.fetch\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

describe('provider egress guard', () => {
  const files = sourceFiles(__dirname).map((path) => ({ path, name: relative(__dirname, path).split(sep).join('/') }));

  it('finds the provider sources', () => {
    expect(files.map((file) => file.name)).toEqual(expect.arrayContaining(['google/google.provider.ts', 'kobo/kobo.provider.ts']));
  });

  it('sends every provider request through an instrumented wrapper', () => {
    const offenders = files
      .filter((file) => !ALLOWED_DIRECT_FETCH.has(file.name))
      .filter((file) => DIRECT_FETCH.test(readFileSync(file.path, 'utf8')))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('recognises a direct fetch call', () => {
    expect(DIRECT_FETCH.test('const res = await fetch(url);')).toBe(true);
    expect(DIRECT_FETCH.test('await globalThis.fetch(url)')).toBe(true);
    expect(DIRECT_FETCH.test('await fetchWithThrottle(url)')).toBe(false);
    expect(DIRECT_FETCH.test('await this.client.fetchBook(id)')).toBe(false);
  });
});
