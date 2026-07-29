import iconv from 'iconv-lite';

import { decodeFb2, decodeFb2Document, detectFb2Encoding, encodeFb2, isFb2EncodingSupported } from './fb2-encoding.utils';

function declaration(encoding: string | null): string {
  const attr = encoding ? ` encoding="${encoding}"` : '';
  return `<?xml version="1.0"${attr}?>\n<FictionBook><description/></FictionBook>`;
}

describe('detectFb2Encoding', () => {
  it('defaults to utf-8 when the declaration omits an encoding', () => {
    const encoding = detectFb2Encoding(Buffer.from(declaration(null), 'utf8'));
    expect(encoding).toMatchObject({ name: 'utf-8', declared: null, byteAligned: true, bomLength: 0 });
  });

  it('normalizes the declared label so casing and spacing do not matter', () => {
    expect(detectFb2Encoding(Buffer.from(declaration('UTF-8'), 'utf8')).name).toBe('utf-8');
    expect(detectFb2Encoding(Buffer.from(declaration('Windows-1251'), 'latin1')).name).toBe('windows-1251');
    expect(detectFb2Encoding(Buffer.from(declaration('KOI8_R'), 'latin1')).name).toBe('koi8-r');
  });

  it('keeps the raw declared label alongside the normalized name', () => {
    expect(detectFb2Encoding(Buffer.from(declaration('Windows-1251'), 'latin1')).declared).toBe('Windows-1251');
  });

  it('reports a utf-8 BOM length so byte offsets stay correct', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(declaration('utf-8'), 'utf8')]);
    expect(detectFb2Encoding(withBom)).toMatchObject({ name: 'utf-8', bomLength: 3, byteAligned: true });
  });

  it('detects utf-16 from a BOM and marks it as not byte aligned', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(declaration(null), 'utf16le')]);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('x')]);
    expect(detectFb2Encoding(le)).toMatchObject({ name: 'utf-16le', byteAligned: false });
    expect(detectFb2Encoding(be)).toMatchObject({ name: 'utf-16be', byteAligned: false });
  });

  it('marks a declared utf-16 as not byte aligned even without a BOM', () => {
    expect(detectFb2Encoding(Buffer.from(declaration('utf-16'), 'latin1')).byteAligned).toBe(false);
    expect(detectFb2Encoding(Buffer.from(declaration('UTF-32LE'), 'latin1')).byteAligned).toBe(false);
    expect(detectFb2Encoding(Buffer.from(declaration('ucs-2'), 'latin1')).byteAligned).toBe(false);
  });

  it('ignores an encoding attribute that appears after the declaration', () => {
    const xml = `<?xml version="1.0"?>\n<FictionBook><description encoding="windows-1251"/></FictionBook>`;
    expect(detectFb2Encoding(Buffer.from(xml, 'utf8')).declared).toBeNull();
  });
});

describe('isFb2EncodingSupported', () => {
  it('accepts single-byte encodings iconv-lite knows', () => {
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('utf-8'), 'utf8')))).toBe(true);
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('windows-1251'), 'latin1')))).toBe(true);
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('koi8-r'), 'latin1')))).toBe(true);
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('iso-8859-5'), 'latin1')))).toBe(true);
  });

  it('rejects utf-16 because ASCII markup is not byte aligned', () => {
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('utf-16'), 'latin1')))).toBe(false);
  });

  it('rejects encodings iconv-lite cannot handle', () => {
    expect(isFb2EncodingSupported(detectFb2Encoding(Buffer.from(declaration('made-up-codec-9000'), 'latin1')))).toBe(false);
  });
});

describe('decodeFb2 / encodeFb2', () => {
  it('round-trips cyrillic through windows-1251 without loss', () => {
    const encoding = detectFb2Encoding(Buffer.from(declaration('windows-1251'), 'latin1'));
    const text = 'Мастер и Маргарита';
    const bytes = encodeFb2(text, encoding);
    expect(bytes.length).toBe(text.length);
    expect(decodeFb2(bytes, encoding)).toBe(text);
  });

  it('round-trips cyrillic through koi8-r without loss', () => {
    const encoding = detectFb2Encoding(Buffer.from(declaration('koi8-r'), 'latin1'));
    const text = 'Булгаков';
    expect(decodeFb2(encodeFb2(text, encoding), encoding)).toBe(text);
  });

  it('decodes windows-1251 bytes that utf-8 would mangle', () => {
    const encoding = detectFb2Encoding(Buffer.from(declaration('windows-1251'), 'latin1'));
    const bytes = iconv.encode('Привет', 'win1251');
    expect(bytes.toString('utf8')).not.toBe('Привет');
    expect(decodeFb2(bytes, encoding)).toBe('Привет');
  });
});

describe('decodeFb2Document', () => {
  it('decodes a windows-1251 document using its declared encoding', () => {
    const xml = `<?xml version="1.0" encoding="windows-1251"?><FictionBook><book-title>Мастер</book-title></FictionBook>`;
    const { text, encoding } = decodeFb2Document(iconv.encode(xml, 'win1251'));
    expect(encoding.name).toBe('windows-1251');
    expect(text).toContain('<book-title>Мастер</book-title>');
  });

  it('decodes a plain utf-8 document', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?><FictionBook><book-title>Über</book-title></FictionBook>`;
    const { text, encoding } = decodeFb2Document(Buffer.from(xml, 'utf8'));
    expect(encoding.name).toBe('utf-8');
    expect(text).toContain('Über');
  });

  it('falls back to utf-8 when the declared encoding is unknown', () => {
    const xml = `<?xml version="1.0" encoding="made-up-codec-9000"?><FictionBook><book-title>Plain</book-title></FictionBook>`;
    const { text, encoding } = decodeFb2Document(Buffer.from(xml, 'utf8'));
    expect(encoding.name).toBe('utf-8');
    expect(text).toContain('Plain');
  });
});
