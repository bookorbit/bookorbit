import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { classifyDockPath, isReservedRootName, unitDirectoryOf } from './library-dock-paths';

const root = '/data/book-dock';

describe('classifyDockPath', () => {
  it('puts a loose file and a unit folder at the root in Unsorted', () => {
    expect(classifyDockPath(root, join(root, 'Dune.epub'))).toEqual({ area: 'unsorted', dockRoot: root, relParts: ['Dune.epub'] });
    expect(classifyDockPath(root, join(root, 'Dune', 'Dune.epub'))).toEqual({ area: 'unsorted', dockRoot: root, relParts: ['Dune', 'Dune.epub'] });
  });

  it('places everything under _libraries/<folder> in that dock, ignoring the case of _libraries', () => {
    expect(classifyDockPath(root, join(root, '_libraries', 'Fiction', 'Dune.epub'))).toEqual({
      area: 'dock',
      folderName: 'Fiction',
      dockRoot: join(root, '_libraries', 'Fiction'),
      relParts: ['Dune.epub'],
    });
    expect(classifyDockPath(root, join(root, '_Libraries', 'Fiction', 'Dune', 'a.mp3'))).toEqual({
      area: 'dock',
      folderName: 'Fiction',
      dockRoot: join(root, '_Libraries', 'Fiction'),
      relParts: ['Dune', 'a.mp3'],
    });
  });

  it('treats the dock folder itself as a dock path with nothing below it', () => {
    expect(classifyDockPath(root, join(root, '_libraries', 'Fiction'))).toEqual({
      area: 'dock',
      folderName: 'Fiction',
      dockRoot: join(root, '_libraries', 'Fiction'),
      relParts: [],
    });
  });

  it('recognises the _libraries folder itself', () => {
    expect(classifyDockPath(root, join(root, '_libraries'))).toEqual({ area: 'libraries', path: join(root, '_libraries') });
  });

  it('keeps the legacy covers folder reserved', () => {
    expect(classifyDockPath(root, join(root, 'covers'))).toEqual({ area: 'reserved' });
    expect(classifyDockPath(root, join(root, 'covers', '12.jpg'))).toEqual({ area: 'reserved' });
  });

  it('treats a covers folder inside a dock or a book as ordinary content', () => {
    expect(classifyDockPath(root, join(root, '_libraries', 'Fiction', 'covers', 'a.epub')).area).toBe('dock');
    expect(classifyDockPath(root, join(root, 'Dune', 'covers')).area).toBe('unsorted');
  });

  it('ignores the root itself and anything outside it', () => {
    expect(classifyDockPath(root, root)).toEqual({ area: 'outside' });
    expect(classifyDockPath(root, '/data/book-dock-covers/1.jpg')).toEqual({ area: 'outside' });
    expect(classifyDockPath(root, '/elsewhere/Dune.epub')).toEqual({ area: 'outside' });
  });
});

describe('unitDirectoryOf', () => {
  it('is the first folder under the dock root for anything nested deeper', () => {
    expect(unitDirectoryOf(classifyDockPath(root, join(root, '_libraries', 'Fiction', 'Dune', 'CD1', 'a.mp3')))).toBe(
      join(root, '_libraries', 'Fiction', 'Dune'),
    );
    expect(unitDirectoryOf(classifyDockPath(root, join(root, 'Dune', 'a.mp3')))).toBe(join(root, 'Dune'));
  });

  it('is null for a loose file, a unit folder itself, a dock folder and _libraries', () => {
    expect(unitDirectoryOf(classifyDockPath(root, join(root, '_libraries', 'Fiction', 'Dune.epub')))).toBeNull();
    expect(unitDirectoryOf(classifyDockPath(root, join(root, '_libraries', 'Fiction')))).toBeNull();
    expect(unitDirectoryOf(classifyDockPath(root, join(root, '_libraries')))).toBeNull();
    expect(unitDirectoryOf(classifyDockPath(root, join(root, 'Dune')))).toBeNull();
  });
});

describe('isReservedRootName', () => {
  it('reserves covers and _libraries in any case', () => {
    expect(isReservedRootName('covers')).toBe(true);
    expect(isReservedRootName('_libraries')).toBe(true);
    expect(isReservedRootName('_LIBRARIES')).toBe(true);
    expect(isReservedRootName('libraries')).toBe(false);
    expect(isReservedRootName('Covers')).toBe(false);
  });
});
