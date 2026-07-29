import { decodeMobiText, encodeMobiText, MOBI_ENCODING_CP1252, MOBI_ENCODING_UTF8 } from './mobi-text-encoding';

describe('encodeMobiText with UTF-8 files', () => {
  it('encodes multi-byte characters without loss', () => {
    const result = encodeMobiText('Übergrößen Café — 東京物語', MOBI_ENCODING_UTF8);

    expect(result.lossyChars).toBe(0);
    expect(result.buffer.toString('utf8')).toBe('Übergrößen Café — 東京物語');
  });

  it('treats any unknown encoding as UTF-8', () => {
    expect(encodeMobiText('café', 0).buffer.toString('utf8')).toBe('café');
  });
});

describe('encodeMobiText with Windows-1252 files', () => {
  it('encodes ASCII and latin1 characters as single bytes', () => {
    const result = encodeMobiText('Café àéîõü', MOBI_ENCODING_CP1252);

    expect(result.lossyChars).toBe(0);
    expect(result.buffer).toHaveLength('Café àéîõü'.length);
    expect(result.buffer[3]).toBe(0xe9);
  });

  it.each([
    ['€', 0x80],
    ['‚', 0x82],
    ['„', 0x84],
    ['…', 0x85],
    ['Š', 0x8a],
    ['Œ', 0x8c],
    ['‘', 0x91],
    ['’', 0x92],
    ['“', 0x93],
    ['”', 0x94],
    ['•', 0x95],
    ['–', 0x96],
    ['—', 0x97],
    ['™', 0x99],
    ['œ', 0x9c],
    ['Ÿ', 0x9f],
  ])('maps %s into the 0x80-0x9F range', (char, expected) => {
    const result = encodeMobiText(char, MOBI_ENCODING_CP1252);

    expect(result.lossyChars).toBe(0);
    expect(result.buffer).toEqual(Buffer.from([expected]));
  });

  it('substitutes ? for characters the code page cannot represent and counts them', () => {
    const result = encodeMobiText('東京物語', MOBI_ENCODING_CP1252);

    expect(result.lossyChars).toBe(4);
    expect(result.buffer.toString('latin1')).toBe('????');
  });

  it('only counts the characters that were actually lost', () => {
    const result = encodeMobiText('Café 東京', MOBI_ENCODING_CP1252);

    expect(result.lossyChars).toBe(2);
    expect(result.buffer.toString('latin1')).toBe('Caf\xe9 ??');
  });

  it('counts astral-plane characters once rather than per code unit', () => {
    const result = encodeMobiText('😀', MOBI_ENCODING_CP1252);

    expect(result.lossyChars).toBe(1);
    expect(result.buffer).toEqual(Buffer.from([0x3f]));
  });
});

describe('decodeMobiText', () => {
  it('round-trips UTF-8 text', () => {
    const encoded = encodeMobiText('Übergrößen 東京', MOBI_ENCODING_UTF8);
    expect(decodeMobiText(encoded.buffer, MOBI_ENCODING_UTF8)).toBe('Übergrößen 東京');
  });

  it('round-trips cp1252 text including the special high range', () => {
    const encoded = encodeMobiText('Café — “quoted” €', MOBI_ENCODING_CP1252);
    expect(decodeMobiText(encoded.buffer, MOBI_ENCODING_CP1252)).toBe('Café — “quoted” €');
  });
});
