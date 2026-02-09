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
