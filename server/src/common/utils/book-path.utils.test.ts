import { resolveSingleFileBookPath } from './book-path.utils';

describe('resolveSingleFileBookPath', () => {
  it.each(['book_per_folder', 'book_per_file', null, undefined])('separates root files with organizationMode=%s', (mode) => {
    expect(resolveSingleFileBookPath('/library/first.epub', '/library', mode)).toBe('/library/first.epub');
    expect(resolveSingleFileBookPath('/library/second.epub', '/library', mode)).toBe('/library/second.epub');
  });

  it.each(['/library/', '/library/./', '/library/unused/..'])('recognizes equivalent library roots: %s', (root) => {
    expect(resolveSingleFileBookPath('/library/book.epub', root, 'book_per_folder')).toBe('/library/book.epub');
  });

  it.each(['book_per_folder', null, undefined])('groups formats inside a book folder with organizationMode=%s', (mode) => {
    expect(resolveSingleFileBookPath('/library/Author/Book/book.epub', '/library', mode)).toBe('/library/Author/Book');
    expect(resolveSingleFileBookPath('/library/Author/Book/book.pdf', '/library', mode)).toBe('/library/Author/Book');
  });

  it('keeps nested files separate in File as Book mode', () => {
    expect(resolveSingleFileBookPath('/library/Author/book.epub', '/library', 'book_per_file')).toBe('/library/Author/book.epub');
    expect(resolveSingleFileBookPath('/library/Author/book.pdf', '/library', 'book_per_file')).toBe('/library/Author/book.pdf');
  });

  it('does not mistake a nested or similarly prefixed directory for the library root', () => {
    expect(resolveSingleFileBookPath('/library/Author/book.epub', '/library', 'book_per_folder')).toBe('/library/Author');
    expect(resolveSingleFileBookPath('/library-other/Book/book.epub', '/library', 'book_per_folder')).toBe('/library-other/Book');
  });
});
