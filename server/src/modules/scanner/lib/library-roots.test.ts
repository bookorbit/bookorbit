import { describe, expect, it } from 'vitest';

import { directoriesOwnedElsewhere, foldersYieldingTo, owningRoot, type LibraryRoot } from './library-roots';

const books: LibraryRoot = { id: 1, libraryId: 10, path: '/media/books' };
const comics: LibraryRoot = { id: 2, libraryId: 20, path: '/media/books/comics' };
const manga: LibraryRoot = { id: 3, libraryId: 30, path: '/media/books/comics/manga' };
const sibling: LibraryRoot = { id: 4, libraryId: 40, path: '/media/books2' };

describe('owningRoot', () => {
  const roots = [books, comics, manga, sibling];

  it('gives a path to the deepest folder that contains it', () => {
    expect(owningRoot('/media/books/Dune/dune.epub', roots)).toBe(books);
    expect(owningRoot('/media/books/comics/Saga/saga.cbz', roots)).toBe(comics);
    expect(owningRoot('/media/books/comics/manga/Akira/akira.cbz', roots)).toBe(manga);
  });

  it('gives a folder path to that folder', () => {
    expect(owningRoot('/media/books/comics', roots)).toBe(comics);
  });

  it('does not confuse a folder with a sibling that shares its name as a prefix', () => {
    expect(owningRoot('/media/books2/Emma/emma.epub', roots)).toBe(sibling);
    expect(owningRoot('/media/bookshelf/x.epub', roots)).toBeNull();
  });

  it('gives a path two folders share to the older folder', () => {
    const newer: LibraryRoot = { id: 9, libraryId: 90, path: '/media/books' };
    expect(owningRoot('/media/books/Dune/dune.epub', [newer, books])).toBe(books);
  });
});

describe('directoriesOwnedElsewhere', () => {
  it('lists the folders nested inside a folder, at any depth', () => {
    expect([...directoriesOwnedElsewhere(books, [books, comics, manga, sibling])].sort()).toEqual([comics.path, manga.path]);
    expect([...directoriesOwnedElsewhere(comics, [books, comics, manga, sibling])]).toEqual([manga.path]);
    expect(directoriesOwnedElsewhere(manga, [books, comics, manga, sibling]).size).toBe(0);
  });

  it('holds the whole folder when an older folder shares its path', () => {
    const newer: LibraryRoot = { id: 9, libraryId: 90, path: '/media/books' };
    expect([...directoriesOwnedElsewhere(newer, [books, newer])]).toEqual(['/media/books']);
    expect(directoriesOwnedElsewhere(books, [books, newer]).size).toBe(0);
  });
});

describe('foldersYieldingTo', () => {
  it('lists the folders around a folder, and a newer folder on the same path', () => {
    const newer: LibraryRoot = { id: 9, libraryId: 90, path: '/media/books/comics' };
    expect(foldersYieldingTo(manga, [books, comics, manga, sibling])).toEqual([books, comics]);
    expect(foldersYieldingTo(comics, [books, comics, newer])).toEqual([books, newer]);
    expect(foldersYieldingTo(books, [books, comics, sibling])).toEqual([]);
  });
});
