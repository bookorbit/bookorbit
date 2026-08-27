import { scanStateInvalidationPaths } from './scan-state-paths';

describe('scanStateInvalidationPaths', () => {
  it('covers a folder-based book: the folder plus every ancestor to the filesystem root', () => {
    const paths = scanStateInvalidationPaths('/books/Series/Book');
    expect(paths).toEqual(expect.arrayContaining(['/books/Series/Book', '/books/Series', '/books']));
    expect(paths).toHaveLength(3);
  });

  it('covers a loose-file book: the containing directory plus its ancestors', () => {
    const paths = scanStateInvalidationPaths('/books/Book.epub');
    expect(paths).toContain('/books');
    expect(paths).not.toContain('/');
  });

  it('stops at the filesystem root without including it', () => {
    expect(scanStateInvalidationPaths('/only')).toEqual(['/only']);
  });

  it('never includes an ancestor above the filesystem root', () => {
    const paths = scanStateInvalidationPaths('/a/b/c');
    for (const path of paths) {
      expect(path === '/' || path.startsWith('/')).toBe(true);
    }
    expect(paths).not.toContain('');
  });
});
