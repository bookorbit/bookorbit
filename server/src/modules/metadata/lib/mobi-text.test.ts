import { collectMobiIsbnHits, decompressPalmDoc, readMobiTextWindows } from './mobi-text';

const ISBN_13 = '9780306406157';
const ISBN_HUMAN = '978-0-306-40615-7';

interface MobiTextOptions {
  compression?: number;
  encryption?: number;
  encoding?: number;
  extraFlags?: number;
}

/** A PalmDB with a record 0 header and the given text records, plus the record offsets. */
function buildMobi(records: Buffer[], options: MobiTextOptions = {}): { buf: Buffer; offsets: number[] } {
  const headerLength = 0xe8;
  const rec0 = Buffer.alloc(16 + headerLength);
  rec0.writeUInt16BE(options.compression ?? 1, 0);
  rec0.writeUInt16BE(records.length, 8);
  rec0.writeUInt16BE(4096, 10);
  rec0.writeUInt16BE(options.encryption ?? 0, 12);
  rec0.write('MOBI', 16, 'ascii');
  rec0.writeUInt32BE(headerLength, 20);
  rec0.writeUInt32BE(options.encoding ?? 65001, 28);
  rec0.writeUInt16BE(options.extraFlags ?? 0, 0xf2);

  const all = [rec0, ...records];
  const listStart = 78;
  const dataStart = listStart + all.length * 8;
  const header = Buffer.alloc(dataStart);
  header.writeUInt16BE(all.length, 76);
  const offsets: number[] = [];
  let offset = dataStart;
  all.forEach((record, index) => {
    header.writeUInt32BE(offset, listStart + index * 8);
    offsets.push(offset);
    offset += record.length;
  });
  return { buf: Buffer.concat([header, ...all]), offsets };
}

function html(text: string): Buffer {
  return Buffer.from(`<html><body><p>${text}</p></body></html>`, 'utf8');
}

describe('decompressPalmDoc', () => {
  it('copies literals and expands a back-reference', () => {
    expect(decompressPalmDoc(Buffer.from([0x61, 0x62, 0x63, 0x80, 0x18])).toString('latin1')).toBe('abcabc');
  });

  it('expands a space-plus-character byte', () => {
    expect(decompressPalmDoc(Buffer.from([0x61, 0xc1])).toString('latin1')).toBe('a A');
  });

  it('copies a literal run of high bytes', () => {
    expect([...decompressPalmDoc(Buffer.from([0x02, 0xe9, 0xe8]))]).toEqual([0xe9, 0xe8]);
  });

  it('stops at a back-reference to before the start of the output', () => {
    expect(decompressPalmDoc(Buffer.from([0x61, 0x80, 0x18, 0x62])).toString('latin1')).toBe('a');
  });
});

describe('readMobiTextWindows', () => {
  it('reads uncompressed text records', () => {
    const { buf, offsets } = buildMobi([html(`ISBN ${ISBN_HUMAN}`)]);
    expect(collectMobiIsbnHits(buf, offsets)).toMatchObject([{ value: ISBN_13, labeled: true }]);
  });

  it('reads PalmDOC text records', () => {
    const { buf, offsets } = buildMobi([html(`Copyright. ISBN ${ISBN_HUMAN}`)], { compression: 2 });
    expect(collectMobiIsbnHits(buf, offsets)).toMatchObject([{ value: ISBN_13, labeled: true }]);
  });

  it('finds an ISBN split across two records', () => {
    const { buf, offsets } = buildMobi([Buffer.from('<p>ISBN 978-0-306-'), Buffer.from('40615-7</p>')]);
    expect(collectMobiIsbnHits(buf, offsets)).toMatchObject([{ value: ISBN_13 }]);
  });

  it('strips trailing entries before reading the text', () => {
    const indexEntry = Buffer.from([0x37, 0x37, 0x83]);
    const multibyte = Buffer.from([0x30]);
    const { buf, offsets } = buildMobi([Buffer.concat([Buffer.from(`ISBN ${ISBN_HUMAN}`), multibyte, indexEntry])], { extraFlags: 0b11 });
    expect(collectMobiIsbnHits(buf, offsets)).toMatchObject([{ value: ISBN_13, labeled: true }]);
  });

  it('decodes CP1252 text', () => {
    const { buf, offsets } = buildMobi([Buffer.from([0x63, 0x61, 0x66, 0xe9])], { encoding: 1252 });
    expect(readMobiTextWindows(buf, offsets)).toEqual(['café']);
  });

  it('reads only the front and back records of a long book', () => {
    const records = Array.from({ length: 40 }, (_, index) => html(index === 25 ? `ISBN ${ISBN_HUMAN}` : `page ${index}`));
    const middle = buildMobi(records);
    expect(collectMobiIsbnHits(middle.buf, middle.offsets)).toEqual([]);

    records[35] = html(`ISBN ${ISBN_HUMAN}`);
    const back = buildMobi(records);
    expect(collectMobiIsbnHits(back.buf, back.offsets)).toMatchObject([{ value: ISBN_13 }]);
  });

  it('returns null for an encrypted book', () => {
    const { buf, offsets } = buildMobi([html(`ISBN ${ISBN_HUMAN}`)], { encryption: 2 });
    expect(readMobiTextWindows(buf, offsets)).toBeNull();
  });

  it('returns null for HUFF/CDIC compression', () => {
    const { buf, offsets } = buildMobi([html(`ISBN ${ISBN_HUMAN}`)], { compression: 17480 });
    expect(collectMobiIsbnHits(buf, offsets)).toBeNull();
  });

  it('returns no passages for a book without text records', () => {
    const { buf, offsets } = buildMobi([]);
    expect(readMobiTextWindows(buf, offsets)).toEqual([]);
  });
});
