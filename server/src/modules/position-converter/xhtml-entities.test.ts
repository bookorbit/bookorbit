import { describe, expect, it } from 'vitest';

import { decodeNamedEntities } from './xhtml-entities';

describe('decodeNamedEntities', () => {
  it('resolves named entities an XML parser would leave literal', () => {
    expect(decodeNamedEntities('a&nbsp;b')).toBe('a b');
    expect(decodeNamedEntities('pa&shy;sakyti')).toBe('pa­sakyti');
    expect(decodeNamedEntities('a&thinsp;b')).toBe('a b');
    expect(decodeNamedEntities('a&mdash;b&hellip;')).toBe('a—b…');
    expect(decodeNamedEntities('caf&eacute;')).toBe('café');
  });

  it('leaves the predefined XML entities to the parser', () => {
    const markup = '&amp;&lt;&gt;&quot;&apos;';
    expect(decodeNamedEntities(markup)).toBe(markup);
  });

  it('leaves aliases that would resolve to markup-significant characters', () => {
    // &LT; and &AMP; are HTML-only aliases; resolving them here would inject markup.
    const markup = '&LT;p&GT; &AMP; &QUOT;';
    expect(decodeNamedEntities(markup)).toBe(markup);
  });

  it('does not turn escaped entity text into a character', () => {
    expect(decodeNamedEntities('&amp;nbsp;')).toBe('&amp;nbsp;');
    expect(decodeNamedEntities('&amp;lt;')).toBe('&amp;lt;');
  });

  it('leaves numeric character references to the parser', () => {
    expect(decodeNamedEntities('a&#160;b&#x2014;c')).toBe('a&#160;b&#x2014;c');
  });

  it('leaves unknown and unterminated references untouched', () => {
    expect(decodeNamedEntities('&notanentity; &nbsp x&y')).toBe('&notanentity; &nbsp x&y');
  });

  it('never partially matches a legacy entity inside a longer reference', () => {
    // HTML text decoding would read the `&not` prefix and leave the rest behind.
    expect(decodeNamedEntities('&nota;')).toBe('&nota;');
    expect(decodeNamedEntities('&notify;')).toBe('&notify;');
    expect(decodeNamedEntities('&notin;')).toBe('∉');
  });

  it('resolves references that expand to two code points', () => {
    expect(decodeNamedEntities('&fjlig;')).toBe('fj');
  });

  it('leaves references longer than the named character table untouched', () => {
    const overlong = `&${'a'.repeat(200)};`;
    expect(decodeNamedEntities(overlong)).toBe(overlong);
  });

  it('resolves the longest reference in the named character table', () => {
    expect(decodeNamedEntities('&CounterClockwiseContourIntegral;')).toBe('∳');
  });

  it('keeps entity references inside CDATA sections literal', () => {
    const markup = '<style><![CDATA[ .a::after { content: "&nbsp;" } ]]></style><p>a&nbsp;b</p>';
    expect(decodeNamedEntities(markup)).toBe('<style><![CDATA[ .a::after { content: "&nbsp;" } ]]></style><p>a b</p>');
  });

  it('resolves references in attribute values', () => {
    expect(decodeNamedEntities('<img alt="caf&eacute;"/>')).toBe('<img alt="café"/>');
  });

  it('is a no-op for markup without named references', () => {
    const markup = '<p>plain text with numbers 1 &amp; 2</p>';
    expect(decodeNamedEntities(markup)).toBe(markup);
  });
});
