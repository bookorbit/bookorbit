import { canonicalId, canonicalIsbn, canonicalJson, canonicalRegion, canonicalText } from './canonicalize';

describe('canonicalize', () => {
  it('normalizes text to NFC, collapses whitespace and keeps case and diacritics', () => {
    const decomposed = 'Cafe\u0301  au\u00a0lait ';
    expect(canonicalText(decomposed)).toBe('Caf\u00e9 au lait');
    expect(canonicalText('Łódź')).toBe('Łódź');
    expect(canonicalText('Dune')).not.toBe(canonicalText('dune'));
  });

  it('treats blank text as absent', () => {
    expect(canonicalText('   ')).toBeUndefined();
    expect(canonicalText(undefined)).toBeUndefined();
    expect(canonicalText(42)).toBeUndefined();
  });

  it('strips ISBN separators without converting between ISBN-10 and ISBN-13', () => {
    expect(canonicalIsbn('978-0-441-17271-9')).toBe('9780441172719');
    expect(canonicalIsbn('0 441 17271 x')).toBe('044117271X');
    expect(canonicalIsbn('')).toBeUndefined();
  });

  it('matches provider ids exactly apart from surrounding space', () => {
    expect(canonicalId(' B00ABC ')).toBe('B00ABC');
    expect(canonicalId('b00abc')).toBe('b00abc');
    expect(canonicalId(' ')).toBeUndefined();
  });

  it('makes the default region explicit', () => {
    expect(canonicalRegion(undefined, 'us')).toBe('us');
    expect(canonicalRegion(' UK ', 'us')).toBe('uk');
  });

  it('serializes equal inputs identically regardless of key order or undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, undefined] } })).toBe(canonicalJson({ a: { c: [2, null] }, b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }));
  });
});
