import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegexMetadataService } from './regex-metadata.service';
import { prepareRegexMetadataPath } from './regex-metadata-path';
import { mergeRegexMetadata } from './merge-regex-metadata';
import type { ParsedBookData } from '../extractors/format-extractor.interface';

describe('RegexMetadataService', () => {
  let service: RegexMetadataService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [RegexMetadataService] }).compile();
    service = module.get(RegexMetadataService);
  });
  afterEach(async () => service.onModuleDestroy());

  it('validates rules without a path and returns indexed diagnostics', async () => {
    expect(await service.check({ rules: [{ pattern: '(?<title>.+)', flags: '' }] })).toEqual({ valid: true, diagnostics: [] });
    expect(
      await service.check({
        rules: [
          { pattern: '[', flags: '' },
          { pattern: '(?<helper>.+)', flags: '' },
          { pattern: '(?<author>.+)(?<authors>.+)', flags: '' },
        ],
      }),
    ).toEqual({
      valid: false,
      diagnostics: [
        { code: 'invalid_pattern', ruleIndex: 0 },
        { code: 'missing_group', ruleIndex: 1 },
        { code: 'conflicting_authors', ruleIndex: 2 },
      ],
    });
    await service.onModuleDestroy();
    expect(await service.check({ rules: [{ pattern: '(?<title>.+)', flags: '' }] })).toEqual({
      valid: false,
      diagnostics: [{ code: 'worker_failed' }],
    });
  });

  it.each(['epub', 'PDF', 'm4b', 'KEPUB.EPUB'])('matches the relative filename without %s', async (extension) => {
    const result = await service.preview(
      { rules: [{ pattern: '^(?<author>[^/]+)/(?<series>[^/]+)/(?<seriesIndex>\\d+) - (?<title>.+)$', flags: 'u' }] },
      `Änne/Dr. Who/08 - My.Book.${extension}`,
    );
    expect(result.inputPath).toBe('Änne/Dr. Who/08 - My.Book');
    expect(result.metadata).toEqual({ authors: ['Änne'], seriesName: 'Dr. Who', seriesIndex: '08', title: 'My.Book' });
  });

  it.each([
    ['decomposed path, composed rule', 'A\u0308nne/Book.epub', '^(?<author>Änne)/'],
    ['composed path, decomposed rule', 'Änne/Book.epub', '^(?<author>A\u0308nne)/'],
  ])('matches across Unicode normalization forms: %s', async (_label, path, pattern) => {
    const result = await service.preview({ rules: [{ pattern, flags: 'u' }] }, path);
    expect(result.metadata.authors).toEqual(['Änne']);
    expect(result.inputPath).toBe('Änne/Book');
  });

  it('skips unusable matches and selects only the first usable rule', async () => {
    const result = await service.preview(
      {
        rules: [
          { pattern: '^(?<publishedYear>\\d+)', flags: '' },
          { pattern: '^(?<title>.+)$', flags: '' },
          { pattern: '^(?<series>.+)$', flags: '' },
        ],
      },
      '999-title.epub',
    );
    expect(result.ruleIndex).toBe(1);
    expect(result.metadata).toEqual({ title: '999-title' });
    expect(result.diagnostics).toContainEqual({ code: 'invalid_value', ruleIndex: 0, field: 'publishedYear' });
  });

  it('normalizes authors and gives a valid date precedence over the captured year', async () => {
    const result = await service.preview(
      { rules: [{ pattern: '^(?<authors>[^/]+)/(?<publishedYear>\\d+)/(?<publishedDate>.+)$', flags: '' }] },
      'Ann ; Bob; Ann/2020/2024-02-29.epub',
    );
    expect(result.metadata).toEqual({ authors: ['Ann', 'Bob'], publishedYear: 2024, publishedDate: '2024-02-29' });
  });

  it('rejects impossible dates without preventing other valid fields', async () => {
    const result = await service.preview({ rules: [{ pattern: '^(?<title>[^/]+)/(?<publishedDate>.+)$', flags: '' }] }, 'Book/2023-02-29.epub');
    expect(result.metadata).toEqual({ title: 'Book' });
    expect(result.diagnostics[0].code).toBe('invalid_value');
  });

  it.each([
    ['08', '08'],
    ['1.5', '1.5'],
    ['1,5', '1.5'],
  ])('keeps series index %s as %s', async (captured, expected) => {
    const result = await service.preview({ rules: [{ pattern: '^(?<title>[^/]+)/(?<seriesIndex>.+)$', flags: '' }] }, `Book/${captured}.epub`);
    expect(result.metadata).toEqual({ title: 'Book', seriesIndex: expected });
  });

  it.each(['IV', '2a', '1-2', '1,5,2', '.5'])('skips series index %s that the column would reject', async (captured) => {
    const result = await service.preview({ rules: [{ pattern: '^(?<title>[^/]+)/(?<seriesIndex>.+)$', flags: '' }] }, `Book/${captured}.epub`);
    expect(result.metadata).toEqual({ title: 'Book' });
    expect(result.diagnostics).toEqual([{ code: 'invalid_value', ruleIndex: 0, field: 'seriesIndex' }]);
  });

  it.each([
    ['[', 'invalid_pattern'],
    ['(?<helper>.+)', 'missing_group'],
    ['(?<author>.+)(?<authors>.*)', 'conflicting_authors'],
  ])('validates pattern %s without saving it', async (pattern, code) => {
    const config = { rules: [{ pattern, flags: '' }] };
    const result = await service.preview(config, 'Book.epub');
    expect(result.diagnostics).toContainEqual({ code, ruleIndex: 0 });
    await expect(service.validate(config)).rejects.toThrow('Invalid regex metadata configuration');
  });

  it('terminates a pathological expression, keeps the event loop responsive, and recovers', async () => {
    let timerRan = false;
    const timer = setTimeout(() => {
      timerRan = true;
    }, 20);
    const result = await service.preview({ rules: [{ pattern: '^(?<title>(a+)+)$', flags: '' }] }, `${'a'.repeat(200)}!.epub`);
    clearTimeout(timer);
    expect(result.diagnostics).toEqual([{ code: 'timeout' }]);
    expect(timerRan).toBe(true);
    const recovered = await service.preview({ rules: [{ pattern: '^(?<title>.+)$', flags: '' }] }, 'Recovered.epub');
    expect(recovered.metadata.title).toBe('Recovered');
  });

  it('does not mistake a stalled event loop for a slow expression', async () => {
    const config = { rules: [{ pattern: '^(?<series>[^/]+)/', flags: '' }] };
    await service.preview(config, 'warm/up.epub');

    const pending = service.preview(config, 'Series/Book.epub');
    // Holds the main thread past the time limit while the worker answers. Stalling in the check phase
    // makes the next loop turn run the expired timer before it reads the answer, as a busy scan can.
    setImmediate(() => {
      const until = Date.now() + 300;
      while (Date.now() < until) {
        // busy
      }
    });

    expect(await pending).toMatchObject({ matched: true, metadata: { seriesName: 'Series' }, diagnostics: [] });
  });

  it('bounds queued work and resolves pending requests on shutdown', async () => {
    const config = { rules: [{ pattern: '^(?<title>.+)$', flags: '' }] };
    const tasks = Array.from({ length: 40 }, () => service.preview(config, 'Book.epub'));
    await service.onModuleDestroy();
    const results = await Promise.all(tasks);
    expect(results.some((result) => result.diagnostics[0]?.code === 'busy')).toBe(true);
    expect(results.every((result) => result.diagnostics.length > 0)).toBe(true);
  });

  it('never refuses scanner evaluation for a full queue', async () => {
    const config = { rules: [{ pattern: '^(?<title>.+)$', flags: '' }] };
    const results = await Promise.all(Array.from({ length: 40 }, () => service.evaluate(config, 'Book.epub')));
    expect(results.every((result) => result.metadata.title === 'Book')).toBe(true);
  });

  it('retries a pool failure once before reporting it', async () => {
    const config = { rules: [{ pattern: '^(?<title>.+)$', flags: '' }] };
    const run = vi.spyOn(service as any, 'run').mockResolvedValueOnce({ diagnostics: [{ code: 'timeout' }] });
    const result = await service.evaluate(config, 'Book.epub');
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.metadata).toEqual({ title: 'Book' });
  });

  it('reports a pool failure on save as unavailable rather than invalid rules', async () => {
    vi.spyOn(service as any, 'run').mockResolvedValue({ diagnostics: [{ code: 'worker_failed' }] });
    await expect(service.validate({ rules: [{ pattern: '(?<title>.+)', flags: '' }] })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects excessive rules, pattern length, and stateful flags', async () => {
    for (const config of [
      { rules: Array.from({ length: 21 }, () => ({ pattern: '(?<title>.+)', flags: '' })) },
      { rules: [{ pattern: 'a'.repeat(2049), flags: '' }] },
      { rules: [{ pattern: '(?<title>.+)', flags: 'g' }] },
    ])
      await expect(service.validate(config)).rejects.toThrow();
  });
});

describe('regex metadata worker', () => {
  // CI runs server tests without building @bookorbit/types, and a worker thread cannot see the test alias.
  it.each(['regex-metadata-engine.ts', 'regex-metadata.worker.ts'])('%s imports only types from the shared package', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).not.toMatch(/^import (?!type )[^;]*'@bookorbit\/types'/m);
  });
});

describe('relative regex paths', () => {
  it.each(['/books/a.epub', '../a.epub', 'a/../../b.epub', 'C:\\books\\a.epub', 'C:a.epub', '\\\\server\\a.epub', 'a\0.epub', 'a/'.repeat(2050)])(
    'rejects unsafe input',
    (path) => {
      expect(() => prepareRegexMetadataPath(path)).toThrow();
    },
  );
  it('preserves dots in folders and filenames and normalizes separators', () => {
    expect(prepareRegexMetadataPath('Dr. Author\\Vol. 1\\My.Book.epub')).toBe('Dr. Author/Vol. 1/My.Book');
    expect(prepareRegexMetadataPath('Author/Book')).toBe('Author/Book');
  });
});

describe('regex metadata precedence', () => {
  const base: ParsedBookData = {
    title: 'Embedded',
    authors: [{ name: 'Author', sortName: null }],
    seriesName: 'Original',
    genres: ['Novel'],
    cover: Buffer.from('cover'),
  };
  it('overrides only captured fields when regex has priority', () => {
    expect(mergeRegexMetadata(base, { seriesName: 'Regex' }, true)).toEqual({ ...base, seriesName: 'Regex' });
  });
  it('fills missing values when the file source has priority', () => {
    expect(mergeRegexMetadata(base, { title: 'Regex', seriesIndex: '08' }, false)).toEqual({ ...base, seriesIndex: '08' });
  });
  it('lets a run-year series from the path name the same run more precisely than the file', () => {
    expect(mergeRegexMetadata({ ...base, seriesName: 'Batman' }, { seriesName: 'Batman (2016)', seriesIndex: '3' }, false)).toMatchObject({
      seriesName: 'Batman (2016)',
    });
    expect(mergeRegexMetadata({ ...base, seriesName: 'Detective Comics' }, { seriesName: 'Batman (2016)' }, false).seriesName).toBe(
      'Detective Comics',
    );
  });
  it('does not keep a lower-priority date when regex overrides the year', () => {
    expect(mergeRegexMetadata({ ...base, publishedDate: '2020-01-01', publishedYear: 2020 }, { publishedYear: 2024 }, true)).toMatchObject({
      publishedYear: 2024,
      publishedDate: undefined,
    });
  });
});
