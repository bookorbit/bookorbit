import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { FB2_BOOK_FILE_WRITE_FIELDS } from '@bookorbit/types';
import type { BookWritePayloadKey } from '../../interfaces/book-write-payload.interface';
import { Fb2FormatWriter } from './fb2-format-writer';

const FULL_MASK = new Set<BookWritePayloadKey>(FB2_BOOK_FILE_WRITE_FIELDS);

const CONTENT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">',
  '<description>',
  '  <title-info>',
  '    <genre>antique</genre>',
  '    <book-title>Old Title</book-title>',
  '    <lang>en</lang>',
  '  </title-info>',
  '</description>',
  '<body><section><p>Text</p></section></body>',
  '</FictionBook>',
  '',
].join('\n');

let testRoot: string;
let writer: Fb2FormatWriter;

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'bookorbit-fb2-writer-'));
  writer = new Fb2FormatWriter();
});

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

async function makeFile(content = CONTENT): Promise<string> {
  const path = join(testRoot, 'book.fb2');
  await writeFile(path, content, 'utf8');
  return path;
}

describe('Fb2FormatWriter', () => {
  it('registers itself for the fb2 format', () => {
    expect(writer.format).toBe('fb2');
  });

  it('returns success with the fields it wrote', async () => {
    const path = await makeFile();

    const result = await writer.write(path, { title: 'New Title', language: 'de' }, { fieldMask: FULL_MASK, dryRun: false });

    expect(result.status).toBe('success');
    expect(result.fieldsWritten).toEqual(['title', 'language']);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(await readFile(path, 'utf8')).toContain('<book-title>New Title</book-title>');
  });

  it('reports a skip reason and the fields a real write would touch on dry-run', async () => {
    const path = await makeFile();
    const before = await readFile(path, 'utf8');

    const result = await writer.write(path, { title: 'New Title' }, { fieldMask: FULL_MASK, dryRun: true });

    expect(result).toMatchObject({ status: 'skipped', reason: 'dry-run', fieldsWritten: ['title'] });
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('skips a document it cannot write and leaves it unchanged', async () => {
    const path = await makeFile('<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook><body><section><p>x</p></section></body></FictionBook>');
    const before = await readFile(path, 'utf8');

    const result = await writer.write(path, { title: 'New Title' }, { fieldMask: FULL_MASK, dryRun: false });

    expect(result).toMatchObject({ status: 'skipped', reason: 'no description block found', fieldsWritten: [] });
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('propagates errors for a missing file so the service can log a failure', async () => {
    await expect(writer.write(join(testRoot, 'nope.fb2'), { title: 'T' }, { fieldMask: FULL_MASK, dryRun: false })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('honours the field mask handed down by the service', async () => {
    const path = await makeFile();

    const result = await writer.write(
      path,
      { title: 'New Title', language: 'de' },
      { fieldMask: new Set<BookWritePayloadKey>(['language']), dryRun: false },
    );

    expect(result.fieldsWritten).toEqual(['language']);
    const updated = await readFile(path, 'utf8');
    expect(updated).toContain('<book-title>Old Title</book-title>');
    expect(updated).toContain('<lang>de</lang>');
  });
});
