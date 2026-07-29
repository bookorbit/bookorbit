import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import { MOBI_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import { extractMobiCover, parseMobiBuffer } from '../../../metadata/lib/mobi-parser';
import type { BookWritePayload, BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { Azw3FormatWriter, AzwFormatWriter, MobiEbookFormatWriter } from './mobi-format-writer';
import { buildMobiFixture } from './mobi-test-fixtures';

const FULL_MASK: ReadonlySet<BookWritePayloadKey> = new Set(MOBI_BOOK_FILE_WRITE_FIELDS);

const PAYLOAD: BookWritePayload = {
  title: 'Written Title',
  authors: [{ name: 'Ada Lovelace', sortName: 'Lovelace, Ada' }],
  publisher: 'BookOrbit Press',
};

let testRoot: string;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-mobi-write-'));
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function writeFixture(name = 'book.mobi', options: Parameters<typeof buildMobiFixture>[0] = {}): Promise<string> {
  const path = join(testRoot, name);
  await writeFile(path, buildMobiFixture(options));
  return path;
}

function options(overrides: Partial<{ dryRun: boolean; fieldMask: ReadonlySet<BookWritePayloadKey> }> = {}) {
  return { fieldMask: new Set(overrides.fieldMask ?? FULL_MASK), dryRun: overrides.dryRun ?? false };
}

describe('MobiFormatWriter', () => {
  it('registers the format it handles', () => {
    expect(new MobiEbookFormatWriter().format).toBe('mobi');
    expect(new Azw3FormatWriter().format).toBe('azw3');
    expect(new AzwFormatWriter().format).toBe('azw');
  });

  it('writes metadata into the file on disk', async () => {
    const path = await writeFixture();

    const result = await new MobiEbookFormatWriter().write(path, PAYLOAD, options());

    expect(result.status).toBe('success');
    expect(result.fieldsWritten.sort()).toEqual(['authors', 'publisher', 'title']);
    const parsed = parseMobiBuffer(await readFile(path));
    expect(parsed.title).toBe('Written Title');
    expect(parsed.authors).toEqual(['Ada Lovelace']);
    expect(parsed.publisher).toBe('BookOrbit Press');
  });

  it('reports a duration', async () => {
    const path = await writeFixture();

    const result = await new MobiEbookFormatWriter().write(path, PAYLOAD, options());

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('leaves no temporary files behind', async () => {
    const path = await writeFixture();

    await new MobiEbookFormatWriter().write(path, PAYLOAD, options());

    expect(await readdir(testRoot)).toEqual(['book.mobi']);
  });

  it('does not touch the file on a dry run but still reports the fields', async () => {
    const path = await writeFixture();
    const before = await readFile(path);

    const result = await new MobiEbookFormatWriter().write(path, PAYLOAD, options({ dryRun: true }));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('dry-run');
    expect(result.fieldsWritten.sort()).toEqual(['authors', 'publisher', 'title']);
    expect(await readFile(path)).toEqual(before);
  });

  it('skips when there is nothing to write', async () => {
    const path = await writeFixture();
    const before = await readFile(path);

    const result = await new MobiEbookFormatWriter().write(path, {}, options());

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no metadata to write');
    expect(result.fieldsWritten).toEqual([]);
    expect(await readFile(path)).toEqual(before);
  });

  it('skips when every payload field is masked out', async () => {
    const path = await writeFixture();

    const result = await new MobiEbookFormatWriter().write(path, PAYLOAD, options({ fieldMask: new Set(['seriesName']) }));

    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no metadata to write');
  });

  it('writes the cover and thumbnail through to disk', async () => {
    const path = await writeFixture();
    const coverBytes = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 8, g: 90, b: 180 } } })
      .png()
      .toBuffer();

    const result = await new MobiEbookFormatWriter().write(path, { coverBytes }, options());

    expect(result.fieldsWritten).toEqual(['coverBytes']);
    const written = await extractMobiCover(path);
    expect(written).not.toBeNull();
    expect((await sharp(written!).metadata()).format).toBe('jpeg');
  });

  it('leaves the original file intact when the write fails', async () => {
    const path = await writeFixture('drm.mobi', { encryption: 1 });
    const before = await readFile(path);

    await expect(new MobiEbookFormatWriter().write(path, PAYLOAD, options())).rejects.toThrow(/DRM encrypted/);

    expect(await readFile(path)).toEqual(before);
    expect(await readdir(testRoot)).toEqual(['drm.mobi']);
  });

  it('propagates a missing file as an error rather than reporting success', async () => {
    await expect(new MobiEbookFormatWriter().write(join(testRoot, 'absent.mobi'), PAYLOAD, options())).rejects.toThrow();
  });

  it('produces a file that survives a second write unchanged', async () => {
    const path = await writeFixture();
    const writer = new MobiEbookFormatWriter();

    await writer.write(path, PAYLOAD, options());
    const afterFirst = await readFile(path);
    await writer.write(path, PAYLOAD, options());

    expect(await readFile(path)).toEqual(afterFirst);
  });

  it('writes azw3 files through the same path', async () => {
    const path = await writeFixture('book.azw3', { fileVersion: 8, mobiHeaderLength: 264 });

    const result = await new Azw3FormatWriter().write(path, PAYLOAD, options());

    expect(result.status).toBe('success');
    expect(parseMobiBuffer(await readFile(path)).title).toBe('Written Title');
  });
});
