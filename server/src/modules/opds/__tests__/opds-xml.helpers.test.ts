import { esc, xmlEl, xmlLink, fileMimeType } from '../opds-xml.helpers';

describe('esc', () => {
  it('escapes all five XML special characters', () => {
    expect(esc('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('returns empty string for null/undefined', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(esc('')).toBe('');
  });

  it('leaves safe strings unchanged', () => {
    expect(esc('hello world')).toBe('hello world');
  });

  it('strips XML 1.0 illegal control characters from metadata (issue #260)', () => {
    const nul = String.fromCharCode(0);
    const verticalTab = String.fromCharCode(0x0b);
    const formFeed = String.fromCharCode(0x0c);
    const unitSeparator = String.fromCharCode(0x1f);

    expect(esc(`Children of Dune${verticalTab}`)).toBe('Children of Dune');
    expect(esc(`Dune${nul} Chronicles`)).toBe('Dune Chronicles');
    expect(esc(`Acme${formFeed}${unitSeparator} Press`)).toBe('Acme Press');
  });

  it('strips the noncharacters U+FFFE and U+FFFF', () => {
    const noncharA = String.fromCharCode(0xfffe);
    const noncharB = String.fromCharCode(0xffff);
    expect(esc(`A${noncharA}B${noncharB}C`)).toBe('ABC');
  });

  it('preserves the control characters XML 1.0 allows (tab, LF, CR)', () => {
    expect(esc('line1\n\tline2\r')).toBe('line1\n\tline2\r');
  });

  it('strips control characters and escapes entities together', () => {
    const nul = String.fromCharCode(0);
    expect(esc(`Rock${nul} & Roll`)).toBe('Rock &amp; Roll');
  });

  it('strips unpaired surrogates from mis-decoded UTF-16 metadata', () => {
    const loneHigh = String.fromCharCode(0xd800);
    const loneLow = String.fromCharCode(0xdfff);
    expect(esc(`Bad${loneHigh}Title`)).toBe('BadTitle');
    expect(esc(`${loneLow}Edge`)).toBe('Edge');
  });

  it('preserves valid surrogate pairs (astral characters such as emoji)', () => {
    expect(esc('Party 🎉 time')).toBe('Party 🎉 time');
    expect(esc('𝐁𝐨𝐨𝐤')).toBe('𝐁𝐨𝐨𝐤');
  });
});

describe('xmlEl', () => {
  it('wraps text in a tag with escaping', () => {
    expect(xmlEl('title', 'Rock & Roll')).toBe('<title>Rock &amp; Roll</title>');
  });

  it('handles null text', () => {
    expect(xmlEl('title', null)).toBe('<title></title>');
  });
});

describe('xmlLink', () => {
  it('produces a self-closing link element', () => {
    const result = xmlLink('self', '/feed', 'application/atom+xml');
    expect(result).toBe('<link rel="self" href="/feed" type="application/atom+xml"/>');
  });

  it('includes optional title with escaping', () => {
    const result = xmlLink('subsection', '/lib', 'text/html', 'My "Library"');
    expect(result).toContain('title="My &quot;Library&quot;"');
  });

  it('escapes href', () => {
    const result = xmlLink('self', '/feed?a=1&b=2', 'text/xml');
    expect(result).toContain('href="/feed?a=1&amp;b=2"');
  });
});

describe('fileMimeType', () => {
  it.each([
    ['epub', 'application/epub+zip'],
    ['pdf', 'application/pdf'],
    ['djvu', 'image/vnd.djvu'],
    ['DJVU', 'image/vnd.djvu'],
    ['mobi', 'application/x-mobipocket-ebook'],
    ['azw3', 'application/vnd.amazon.ebook'],
    ['fb2', 'application/x-fictionbook+xml'],
    ['cbz', 'application/vnd.comicbook+zip'],
    ['cbr', 'application/vnd.comicbook-rar'],
    ['EPUB', 'application/epub+zip'],
    ['unknown', 'application/octet-stream'],
  ])('maps %s to %s', (format, expected) => {
    expect(fileMimeType(format)).toBe(expected);
  });
});
