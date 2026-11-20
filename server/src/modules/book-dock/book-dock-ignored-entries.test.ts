import { describe, expect, it } from 'vitest';

import { isIgnoredDockEntryName, isIgnoredDockPath } from './book-dock-ignored-entries';

describe('isIgnoredDockEntryName', () => {
  it.each([
    '._Dune.epub',
    '.DS_Store',
    '.stfolder',
    '.stversions',
    '.Trash-1000',
    '@eaDir',
    '@Recycle',
    '#recycle',
    '#snapshot',
    '$RECYCLE.BIN',
    'Thumbs.db',
    'desktop.ini',
    'lost+found',
  ])('ignores %s', (name) => {
    expect(isIgnoredDockEntryName(name)).toBe(true);
  });

  it.each(['Dune.epub', 'Dune', 'recycle.epub', 'eaDir', 'A #recycle story.epub'])('keeps %s', (name) => {
    expect(isIgnoredDockEntryName(name)).toBe(false);
  });
});

describe('isIgnoredDockPath', () => {
  const root = '/data/book-dock';

  it('never ignores the root or a path outside it', () => {
    expect(isIgnoredDockPath(root, root)).toBe(false);
    expect(isIgnoredDockPath(root, '/data/.hidden/book.epub')).toBe(false);
  });

  it('ignores anything below an ignored folder at any depth', () => {
    expect(isIgnoredDockPath(root, `${root}/#recycle/Dune.epub`)).toBe(true);
    expect(isIgnoredDockPath(root, `${root}/Dune/@eaDir/cover.jpg`)).toBe(true);
    expect(isIgnoredDockPath(root, `${root}/Dune/._01.mp3`)).toBe(true);
  });

  it('keeps ordinary books and book folders', () => {
    expect(isIgnoredDockPath(root, `${root}/Dune.epub`)).toBe(false);
    expect(isIgnoredDockPath(root, `${root}/Dune/01.mp3`)).toBe(false);
  });
});
