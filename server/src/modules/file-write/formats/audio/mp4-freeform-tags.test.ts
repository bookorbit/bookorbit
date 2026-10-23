import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { writeMp4FreeformTags } from './mp4-freeform-tags';

const MDAT = box('mdat', Buffer.from('audio-payload-that-must-not-move'));
const FTYP = box('ftyp', Buffer.from('M4A \0\0\0\0isomM4A '));
const TRAK = box('trak', box('tkhd', Buffer.alloc(16)));

describe('writeMp4FreeformTags', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookorbit-mp4-freeform-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends freeform atoms to the iTunes metadata without moving the audio', async () => {
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta(stringAtom('©nam', 'Title')))));

    await writeMp4FreeformTags(target, [
      { name: 'SUBTITLE', value: 'Second Book' },
      { name: 'ASIN', value: 'B0TEST' },
    ]);

    const bytes = await readFile(target);
    expect(bytes.subarray(0, FTYP.length + MDAT.length)).toEqual(Buffer.concat([FTYP, MDAT]));
    expect(readTags(bytes)).toEqual([
      { type: '©nam', value: 'Title' },
      { type: '----', name: 'SUBTITLE', value: 'Second Book' },
      { type: '----', name: 'ASIN', value: 'B0TEST' },
    ]);
  });

  it('writes the atom layout FFmpeg reads: iTunes mean, name, and a UTF-8 data atom', async () => {
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta())));

    await writeMp4FreeformTags(target, [{ name: 'PUBLISHER', value: 'Ünïcode Press' }]);

    const ilst = findPath(await readFile(target), ['moov', 'udta', 'meta', 'ilst'])!;
    expect(ilst.body).toEqual(freeform('PUBLISHER', 'Ünïcode Press'));
  });

  it('creates the user data and iTunes metadata when the file has none', async () => {
    const target = await mp4File('target.m4b', moov(TRAK));

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }]);

    const bytes = await readFile(target);
    expect(readTags(bytes)).toEqual([{ type: '----', name: 'SERIES', value: 'Saga' }]);
    expect(handlerType(bytes)).toBe('mdir');
  });

  it('adds iTunes metadata beside other user data', async () => {
    const target = await mp4File('target.m4b', moov(TRAK, udta(box('chpl', Buffer.from('nero-chapters')))));

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }]);

    const bytes = await readFile(target);
    expect(findPath(bytes, ['moov', 'udta', 'chpl'])?.body.toString()).toBe('nero-chapters');
    expect(readTags(bytes)).toEqual([{ type: '----', name: 'SERIES', value: 'Saga' }]);
  });

  it('replaces its own earlier atoms instead of piling up copies on every write', async () => {
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta())));

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'First' }]);
    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Second' }]);

    expect(readTags(await readFile(target))).toEqual([{ type: '----', name: 'SERIES', value: 'Second' }]);
  });

  it('keeps the movie box valid when other boxes follow the user data', async () => {
    const trailing = box('meta', Buffer.from('trailing-sibling'));
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta()), trailing));

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }]);

    const bytes = await readFile(target);
    const moovStart = FTYP.length + MDAT.length;
    expect(bytes.readUInt32BE(moovStart)).toBe(bytes.length - moovStart);
    expect(bytes.subarray(bytes.length - trailing.length)).toEqual(trailing);
    expect(readTags(bytes)).toEqual([{ type: '----', name: 'SERIES', value: 'Saga' }]);
  });

  it('updates a 64-bit movie box size', async () => {
    const body = Buffer.concat([TRAK, udta(itunesMeta())]);
    const largeMoov = Buffer.concat([uint32(1), Buffer.from('moov'), uint64(16 + body.length), body]);
    const target = await mp4File('target.m4b', largeMoov);

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }]);

    const bytes = await readFile(target);
    const moovStart = FTYP.length + MDAT.length;
    expect(bytes.readUInt32BE(moovStart)).toBe(1);
    expect(Number(bytes.readBigUInt64BE(moovStart + 8))).toBe(bytes.length - moovStart);
    expect(readTags(bytes)).toEqual([{ type: '----', name: 'SERIES', value: 'Saga' }]);
  });

  it('carries over freeform tags from the source that the write does not manage', async () => {
    const source = await mp4File(
      'source.m4b',
      moov(TRAK, udta(itunesMeta(freeform('AUDIBLE_ACR', 'CR!ABC'), freeform('SUBTITLE', 'Old'), stringAtom('©nam', 'Old Title')))),
    );
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta(stringAtom('©nam', 'New Title')))));

    await writeMp4FreeformTags(target, [{ name: 'SUBTITLE', value: 'New' }], { carryOverFrom: source });

    expect(readTags(await readFile(target))).toEqual([
      { type: '©nam', value: 'New Title' },
      { type: '----', name: 'AUDIBLE_ACR', value: 'CR!ABC' },
      { type: '----', name: 'SUBTITLE', value: 'New' },
    ]);
  });

  it('drops source copies the write supersedes, whatever their case or alias', async () => {
    const source = await mp4File(
      'source.m4b',
      moov(
        TRAK,
        udta(
          itunesMeta(
            freeform('subtitle', 'lower-case copy'),
            freeform('PART', '9'),
            freeform('Series_Part', '9'),
            freeform('TITLE', 'shadows the native title'),
            freeform('iTunSMPB', ' 00000000 00000840'),
            freeform('PUBLISHER', 'Cleared Press'),
          ),
        ),
      ),
    );
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta())));

    await writeMp4FreeformTags(
      target,
      [
        { name: 'SUBTITLE', value: 'Fresh' },
        { name: 'SERIES-PART', value: '3' },
        { name: 'PUBLISHER', value: '' },
      ],
      { carryOverFrom: source },
    );

    expect(readTags(await readFile(target))).toEqual([
      { type: '----', name: 'SUBTITLE', value: 'Fresh' },
      { type: '----', name: 'SERIES-PART', value: '3' },
    ]);
  });

  it('carries nothing over from a source without readable iTunes metadata', async () => {
    const quicktimeKeys = await mp4File(
      'keys.m4b',
      moov(TRAK, udta(fullBox('meta', box('hdlr', uint32(0), uint32(0), Buffer.from('mdta')), box('ilst')))),
    );
    const truncated = join(dir, 'truncated.m4b');
    await writeFile(truncated, Buffer.concat([FTYP, uint32(4096), Buffer.from('moov')]));
    const target = await mp4File('target.m4b', moov(TRAK, udta(itunesMeta())));

    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }], { carryOverFrom: quicktimeKeys });
    await writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }], { carryOverFrom: truncated });

    expect(readTags(await readFile(target))).toEqual([{ type: '----', name: 'SERIES', value: 'Saga' }]);
  });

  it('refuses a file whose movie box is not last, leaving it untouched', async () => {
    const target = join(dir, 'faststart.m4b');
    const original = Buffer.concat([FTYP, moov(TRAK, udta(itunesMeta())), MDAT]);
    await writeFile(target, original);

    await expect(writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }])).rejects.toThrow('MP4 movie box is not at the end of the file');
    expect(await readFile(target)).toEqual(original);
  });

  it('refuses to put freeform atoms into QuickTime keys metadata', async () => {
    const target = await mp4File(
      'target.m4b',
      moov(TRAK, udta(fullBox('meta', box('hdlr', uint32(0), uint32(0), Buffer.from('mdta')), box('ilst')))),
    );

    await expect(writeMp4FreeformTags(target, [{ name: 'SERIES', value: 'Saga' }])).rejects.toThrow('MP4 metadata is not in iTunes form');
  });

  async function mp4File(name: string, moovBox: Buffer): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, Buffer.concat([FTYP, MDAT, moovBox]));
    return path;
  }
});

interface ParsedBox {
  type: string;
  body: Buffer;
}

function parseChildren(bytes: Buffer, start: number, end: number): ParsedBox[] {
  const boxes: ParsedBox[] = [];
  for (let offset = start; offset + 8 <= end;) {
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    }
    boxes.push({ type: bytes.toString('latin1', offset + 4, offset + 8), body: bytes.subarray(offset + header, offset + size) });
    offset += size;
  }
  return boxes;
}

function findPath(bytes: Buffer, path: string[]): ParsedBox | undefined {
  let current: ParsedBox | undefined = { type: '', body: bytes };
  for (const type of path) {
    if (!current) return undefined;
    // The iTunes meta box carries version and flags before its children.
    const start = current.type === 'meta' ? 4 : 0;
    current = parseChildren(current.body, start, current.body.length).find((child) => child.type === type);
  }
  return current;
}

function readTags(bytes: Buffer): Array<{ type: string; name?: string; value: string }> {
  const ilst = findPath(bytes, ['moov', 'udta', 'meta', 'ilst']);
  if (!ilst) return [];
  return parseChildren(ilst.body, 0, ilst.body.length).map((atom) => {
    const children = parseChildren(atom.body, 0, atom.body.length);
    const data = children.find((child) => child.type === 'data')!;
    const value = data.body.subarray(8).toString('utf8');
    if (atom.type !== '----') return { type: atom.type, value };
    const name = children
      .find((child) => child.type === 'name')!
      .body.subarray(4)
      .toString('utf8');
    return { type: atom.type, name, value };
  });
}

function handlerType(bytes: Buffer): string {
  return findPath(bytes, ['moov', 'udta', 'meta', 'hdlr'])!.body.toString('latin1', 8, 12);
}

function moov(...children: Buffer[]): Buffer {
  return box('moov', ...children);
}

function udta(...children: Buffer[]): Buffer {
  return box('udta', ...children);
}

function itunesMeta(...atoms: Buffer[]): Buffer {
  return fullBox('meta', box('hdlr', uint32(0), uint32(0), Buffer.from('mdirappl'), Buffer.alloc(9)), box('ilst', ...atoms));
}

function stringAtom(type: string, value: string): Buffer {
  return box(type, box('data', uint32(1), uint32(0), Buffer.from(value, 'utf8')));
}

function freeform(name: string, value: string): Buffer {
  return box(
    '----',
    box('mean', uint32(0), Buffer.from('com.apple.iTunes')),
    box('name', uint32(0), Buffer.from(name, 'utf8')),
    box('data', uint32(1), uint32(0), Buffer.from(value, 'utf8')),
  );
}

function fullBox(type: string, ...children: Buffer[]): Buffer {
  return box(type, uint32(0), ...children);
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([uint32(8 + body.length), Buffer.from(type, 'latin1'), body]);
}

function uint32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value, 0);
  return bytes;
}

function uint64(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value), 0);
  return bytes;
}
