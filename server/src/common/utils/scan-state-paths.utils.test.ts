import { scanStateInvalidationPaths } from './scan-state-paths.utils';

describe('scanStateInvalidationPaths', () => {
  it('covers a folder-based book: the folder plus every ancestor to the filesystem root', () => {
    expect(scanStateInvalidationPaths('/books/Series/Book')).toEqual(['/books/Series/Book', '/books/Series', '/books', '/']);
  });

  it('covers a loose-file book: the file path, containing directory, and every ancestor', () => {
    expect(scanStateInvalidationPaths('/books/Book.epub')).toEqual(['/books/Book.epub', '/books', '/']);
  });

  it('includes the filesystem root exactly once', () => {
    expect(scanStateInvalidationPaths('/only')).toEqual(['/only', '/']);
    expect(scanStateInvalidationPaths('/book.epub')).toEqual(['/book.epub', '/']);
    expect(scanStateInvalidationPaths('/')).toEqual(['/']);
  });
});
