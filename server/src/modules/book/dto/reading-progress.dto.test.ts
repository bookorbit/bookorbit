import 'reflect-metadata';

import { READING_PROGRESS_MAX_WRITES } from '@bookorbit/types';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { ReadingProgressQueryDto, ReadingProgressWritesDto } from './reading-progress.dto';

async function errorsFor<T extends object>(cls: new () => T, value: Record<string, unknown>) {
  return validate(plainToInstance(cls, value), { whitelist: true, forbidNonWhitelisted: true });
}

const write = {
  fileId: 64,
  kind: 'text',
  percentage: 7.99,
  editedAt: '2026-10-22T09:30:00.123Z',
  text: { cfi: 'epubcfi(/6/22!/4/108/1:0)', page: null },
  narration: { seconds: 812.4, fragment: 'c9R.xhtml#s12', sectionIndex: 9 },
  kobo: { source: 'OEBPS/c9R.xhtml', type: null, value: null, contentPercent: 50 },
  koreader: null,
};

describe('Reading progress DTO validation', () => {
  it('accepts a full write and a bare one', async () => {
    expect(await errorsFor(ReadingProgressWritesDto, { writes: [write] })).toHaveLength(0);
    expect(await errorsFor(ReadingProgressWritesDto, { writes: [{ fileId: 64, percentage: 0 }] })).toHaveLength(0);
  });

  it('rejects an empty batch, an oversized one, and a file named twice', async () => {
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [] })).length).toBeGreaterThan(0);
    const tooMany = Array.from({ length: READING_PROGRESS_MAX_WRITES + 1 }, (_, i) => ({ fileId: i + 1, percentage: 1 }));
    expect((await errorsFor(ReadingProgressWritesDto, { writes: tooMany })).length).toBeGreaterThan(0);
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [write, { ...write, percentage: 9 }] })).length).toBeGreaterThan(0);
  });

  it('rejects an unknown kind, an out-of-range percentage and a loose edit time', async () => {
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, kind: 'audio' }] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, percentage: 101 }] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, editedAt: 'yesterday' }] })).length).toBeGreaterThan(0);
  });

  it('rejects fields the grouped shape does not have, at either level', async () => {
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, cfi: 'epubcfi(/6/2)' }] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, text: { pageNumber: 3 } }] })).length).toBeGreaterThan(0);
  });

  it('holds each string to its column', async () => {
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, text: { cfi: 'x'.repeat(2001) } }] })).length).toBeGreaterThan(0);
    expect((await errorsFor(ReadingProgressWritesDto, { writes: [{ ...write, kobo: { type: 'x'.repeat(65) } }] })).length).toBeGreaterThan(0);
  });

  it('reads query ids as numbers', async () => {
    const query = plainToInstance(ReadingProgressQueryDto, { fileId: '64' });
    expect(await validate(query)).toHaveLength(0);
    expect(query.fileId).toBe(64);
    expect((await errorsFor(ReadingProgressQueryDto, { bookId: 'abc' })).length).toBeGreaterThan(0);
  });
});
