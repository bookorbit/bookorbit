import {
  findSiblingOccupiedTarget,
  resolveBookFileTargets,
  resolvePrimaryFileTarget,
  type BookFileTargetsInput,
  type TargetBookFile,
} from './book-file-targets';

function audioPart(id: number, folder: string, stem: string, part: number, sortOrder: number | null = part - 1): TargetBookFile {
  return {
    id,
    absolutePath: `${folder}/${stem}-Part${String(part).padStart(2, '0')}.mp3`,
    format: 'mp3',
    role: 'content',
    sortOrder,
  };
}

function input(overrides: Partial<BookFileTargetsInput> = {}): BookFileTargetsInput {
  const files = overrides.files ?? [{ id: 1, absolutePath: '/library/old/book.epub', format: 'epub', role: 'content', sortOrder: null }];
  return {
    primaryFileId: 1,
    files,
    metadata: {
      title: 'Book',
      subtitle: null,
      publisher: null,
      language: null,
      isbn13: null,
      publishedYear: null,
      seriesName: null,
      seriesIndex: null,
    },
    authors: ['Author'],
    narrators: [],
    libraryName: 'Library',
    libraryFolderPath: '/library',
    bookFolderPath: '/library/old/book.epub',
    organizationMode: 'book_per_file',
    pattern: '{authors}/{title}',
    sanitizeForCrossPlatform: false,
    ...overrides,
  };
}

describe('resolveBookFileTargets', () => {
  describe('single file books', () => {
    it('sends the primary file where the pattern points', () => {
      expect(resolvePrimaryFileTarget(input())).toBe('/library/Author/Book.epub');
    });

    it('returns nothing when the pattern resolves to empty', () => {
      expect(resolveBookFileTargets(input({ pattern: '<{series}>' })).size).toBe(0);
    });

    it('returns nothing when the primary file is not among the files', () => {
      expect(resolveBookFileTargets(input({ primaryFileId: 999 })).size).toBe(0);
    });

    it('leaves a book that already sits at its target where it is', () => {
      const files: TargetBookFile[] = [{ id: 1, absolutePath: '/library/Author/Book.epub', format: 'epub', role: 'content', sortOrder: null }];
      expect(resolvePrimaryFileTarget(input({ files, bookFolderPath: '/library/Author/Book.epub' }))).toBe('/library/Author/Book.epub');
    });
  });

  /**
   * The bug this module exists for. Every part of an audiobook shares its metadata, so the pattern
   * resolves all of them onto one filename and the track suffix has to come back. A preview that
   * looked at the primary file alone could not see that and promised a rename that never happened.
   */
  describe('multi-track audiobooks', () => {
    const folder = '/library/Book';
    const files = [audioPart(1, folder, 'Book', 1), audioPart(2, folder, 'Book', 2), audioPart(3, folder, 'Book', 3)];
    const audiobook = () =>
      input({
        files,
        primaryFileId: 1,
        bookFolderPath: folder,
        organizationMode: 'book_per_folder',
        pattern: '{title}/{title}',
      });

    it('restores a track suffix on every colliding part', () => {
      const targets = resolveBookFileTargets(audiobook());
      expect(targets.get(1)).toBe('/library/Book/Book-Part01.mp3');
      expect(targets.get(2)).toBe('/library/Book/Book-Part02.mp3');
      expect(targets.get(3)).toBe('/library/Book/Book-Part03.mp3');
    });

    it('reports the primary part as already in place when the book is correctly named', () => {
      // This is the case that used to be offered as a rename and then skipped as "path unchanged".
      expect(resolvePrimaryFileTarget(audiobook())).toBe(files[0]!.absolutePath);
    });

    it('still moves the whole book when the folder is wrong', () => {
      const wrong = '/library/Wrong Folder';
      const misplaced = [audioPart(1, wrong, 'Book', 1), audioPart(2, wrong, 'Book', 2)];
      const targets = resolveBookFileTargets(
        input({ files: misplaced, bookFolderPath: wrong, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(1)).toBe('/library/Book/Book-Part01.mp3');
      expect(targets.get(2)).toBe('/library/Book/Book-Part02.mp3');
    });

    it('numbers parts by sort order rather than by file id', () => {
      const shuffled = [audioPart(1, folder, 'Book', 3, 2), audioPart(2, folder, 'Book', 1, 0), audioPart(3, folder, 'Book', 2, 1)];
      const targets = resolveBookFileTargets(
        input({ files: shuffled, primaryFileId: 2, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(2)).toBe('/library/Book/Book-Part01.mp3');
      expect(targets.get(3)).toBe('/library/Book/Book-Part02.mp3');
      expect(targets.get(1)).toBe('/library/Book/Book-Part03.mp3');
    });

    it('falls back to file id when sort order is missing', () => {
      const unordered = [audioPart(7, folder, 'Book', 1, null), audioPart(3, folder, 'Book', 2, null)];
      const targets = resolveBookFileTargets(
        input({ files: unordered, primaryFileId: 3, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(3)).toBe('/library/Book/Book-Part01.mp3');
      expect(targets.get(7)).toBe('/library/Book/Book-Part02.mp3');
    });

    it('does not add a suffix to a single audio file', () => {
      const single = [audioPart(1, folder, 'Book', 1)];
      const targets = resolveBookFileTargets(
        input({ files: single, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(1)).toBe('/library/Book/Book.mp3');
    });

    it('does not add a suffix when the parts already resolve to distinct names', () => {
      const distinct: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/a.mp3`, format: 'mp3', role: 'content', sortOrder: 0 },
        { id: 2, absolutePath: `${folder}/b.mp3`, format: 'mp3', role: 'content', sortOrder: 1 },
      ];
      const targets = resolveBookFileTargets(
        input({
          files: distinct,
          bookFolderPath: folder,
          organizationMode: 'book_per_folder',
          pattern: '{title}/{originalFilename}',
        }),
      );

      expect(targets.get(1)).toBe('/library/Book/a.mp3');
      expect(targets.get(2)).toBe('/library/Book/b.mp3');
    });
  });

  /**
   * The rename used to send only the primary file to the book folder and leave its siblings in
   * whatever sub-folder they sat in. A book stored one level down was torn in half: one unsuffixed
   * track ended up above the rest, and because the numbering still counted that file the remaining
   * parts started at `-Part02` with no `-Part01`. This reproduces that layout.
   */
  describe('books stored in a sub-folder below the book folder', () => {
    const bookFolder = '/library/Book';
    const nested = `${bookFolder}/Book`;

    function nestedParts(count: number): TargetBookFile[] {
      return Array.from({ length: count }, (_, index) => ({
        id: 100 + index,
        absolutePath: `${nested}/track${String(index + 1).padStart(2, '0')}.mp3`,
        format: 'mp3',
        role: 'content',
        sortOrder: index,
      }));
    }

    function targetsFor(files: TargetBookFile[], primaryFileId = 100) {
      return resolveBookFileTargets(
        input({ files, primaryFileId, bookFolderPath: bookFolder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );
    }

    it('brings every part up with the primary instead of splitting the book', () => {
      const files = nestedParts(4);
      const targets = targetsFor(files);

      for (const target of targets.values()) {
        expect(target.startsWith(`${nested}/`)).toBe(false);
      }
    });

    it('numbers the parts from one with no gap', () => {
      const files = nestedParts(4);
      const targets = targetsFor(files);

      expect([...targets.values()].sort()).toEqual([
        `${bookFolder}/Book-Part01.mp3`,
        `${bookFolder}/Book-Part02.mp3`,
        `${bookFolder}/Book-Part03.mp3`,
        `${bookFolder}/Book-Part04.mp3`,
      ]);
    });

    it('gives the primary file a suffix like every other part', () => {
      const files = nestedParts(3);
      const targets = targetsFor(files);

      expect(targets.get(100)).toBe(`${bookFolder}/Book-Part01.mp3`);
    });

    it('repairs a book that a previous rename already split', () => {
      // What the old behaviour left behind: parts numbered from 02 in a nested folder, plus one
      // unsuffixed track stranded a level up.
      const files: TargetBookFile[] = [
        ...Array.from({ length: 4 }, (_, index) => ({
          id: 200 + index,
          absolutePath: `${nested}/Book-Part${String(index + 2).padStart(2, '0')}.mp3`,
          format: 'mp3',
          role: 'content',
          sortOrder: index,
        })),
        { id: 299, absolutePath: `${bookFolder}/Book.mp3`, format: 'mp3', role: 'content', sortOrder: 37 },
      ];
      const targets = targetsFor(files, 200);

      expect(targets.get(200)).toBe(`${bookFolder}/Book-Part01.mp3`);
      expect(targets.get(203)).toBe(`${bookFolder}/Book-Part04.mp3`);
      // The stranded track sorts last, so it takes the final number and rejoins the set.
      expect(targets.get(299)).toBe(`${bookFolder}/Book-Part05.mp3`);
      expect(new Set(targets.values()).size).toBe(5);
      expect(findSiblingOccupiedTarget(files, targets)).toBeNull();
    });

    it('flattens discs into the book folder rather than leaving half of them behind', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${bookFolder}/disc1/a.mp3`, format: 'mp3', role: 'content', sortOrder: 0 },
        { id: 2, absolutePath: `${bookFolder}/disc1/b.mp3`, format: 'mp3', role: 'content', sortOrder: 1 },
        { id: 3, absolutePath: `${bookFolder}/disc2/a.mp3`, format: 'mp3', role: 'content', sortOrder: 2 },
      ];
      const targets = targetsFor(files, 1);

      // Structure is lost, but no file is dropped and no two files share a path.
      expect(new Set(targets.values()).size).toBe(3);
      expect([...targets.values()].every((target) => target.startsWith(`${bookFolder}/Book-Part`))).toBe(true);
    });

    it('numbers each colliding format independently without leaving gaps', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${nested}/one.mp3`, format: 'mp3', role: 'content', sortOrder: 0 },
        { id: 2, absolutePath: `${nested}/two.m4b`, format: 'm4b', role: 'content', sortOrder: 1 },
        { id: 3, absolutePath: `${nested}/three.mp3`, format: 'mp3', role: 'content', sortOrder: 2 },
        { id: 4, absolutePath: `${nested}/four.m4b`, format: 'm4b', role: 'content', sortOrder: 3 },
      ];
      const targets = targetsFor(files, 1);

      expect(targets.get(1)).toBe(`${bookFolder}/Book-Part01.mp3`);
      expect(targets.get(3)).toBe(`${bookFolder}/Book-Part02.mp3`);
      expect(targets.get(2)).toBe(`${bookFolder}/Book-Part01.m4b`);
      expect(targets.get(4)).toBe(`${bookFolder}/Book-Part02.m4b`);
    });
  });

  describe('non-audio companions', () => {
    const folder = '/library/old';

    it('carries a non-content file along with the book instead of renaming it', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/book.epub`, format: 'epub', role: 'content', sortOrder: null },
        { id: 2, absolutePath: `${folder}/cover.jpg`, format: 'jpg', role: 'cover', sortOrder: null },
      ];
      const targets = resolveBookFileTargets(
        input({ files, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(1)).toBe('/library/Book/Book.epub');
      expect(targets.get(2)).toBe('/library/Book/cover.jpg');
    });

    it('keeps a companion in its sub-folder under the new book folder', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/book.epub`, format: 'epub', role: 'content', sortOrder: null },
        { id: 2, absolutePath: `${folder}/extras/notes.txt`, format: 'txt', role: 'extra', sortOrder: null },
      ];
      const targets = resolveBookFileTargets(
        input({ files, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(2)).toBe('/library/Book/extras/notes.txt');
    });

    it('does not give a part suffix to two non-audio files that collide', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/one.epub`, format: 'epub', role: 'content', sortOrder: null },
        { id: 2, absolutePath: `${folder}/two.epub`, format: 'epub', role: 'content', sortOrder: null },
      ];
      const targets = resolveBookFileTargets(
        input({ files, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      // They cannot be told apart, so the collision fallback moves only the primary file.
      expect(targets.get(1)).toBe('/library/Book/Book.epub');
      expect(targets.get(2)).toBe('/library/Book/two.epub');
    });
  });

  describe('collision fallback', () => {
    it('moves only the primary file when the pattern cannot separate the rest', () => {
      const folder = '/library/old';
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/a.epub`, format: 'epub', role: 'content', sortOrder: null },
        { id: 2, absolutePath: `${folder}/b.epub`, format: 'epub', role: 'content', sortOrder: null },
        { id: 3, absolutePath: `${folder}/c.epub`, format: 'epub', role: 'content', sortOrder: null },
      ];
      const targets = resolveBookFileTargets(
        input({ files, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(targets.get(1)).toBe('/library/Book/Book.epub');
      expect(targets.get(2)).toBe('/library/Book/b.epub');
      expect(targets.get(3)).toBe('/library/Book/c.epub');
      expect(new Set(targets.values()).size).toBe(3);
    });

    it('never returns two files pointing at the same path', () => {
      const folder = '/library/Book';
      const files = [audioPart(1, folder, 'Book', 1), audioPart(2, folder, 'Book', 2), audioPart(3, folder, 'Book', 3)];
      const targets = resolveBookFileTargets(
        input({ files, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(new Set([...targets.values()].map((path) => path.toLowerCase())).size).toBe(targets.size);
    });
  });

  describe('book per file libraries', () => {
    it('resolves each content file independently', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: '/library/old/one.epub', format: 'epub', role: 'content', sortOrder: null },
        { id: 2, absolutePath: '/library/old/two.pdf', format: 'pdf', role: 'content', sortOrder: null },
      ];
      const targets = resolveBookFileTargets(input({ files, organizationMode: 'book_per_file', pattern: '{authors}/{title}' }));

      expect(targets.get(1)).toBe('/library/Author/Book.epub');
      expect(targets.get(2)).toBe('/library/Author/Book.pdf');
    });
  });

  /**
   * Parts numbered from 02 upward renumber to 01 upward, so every file wants the slot its
   * neighbour is still sitting in. Doing that in place would overwrite audio, which is why the
   * rename refuses it and the preview must refuse it too.
   */
  describe('renumbering that would overwrite a sibling', () => {
    const folder = '/library/Book';

    function shiftedParts(): TargetBookFile[] {
      // On disk as Part02..Part05, so the pattern renumbers them to Part01..Part04.
      return [2, 3, 4, 5].map((part, index) => audioPart(index + 1, folder, 'Book', part, index));
    }

    it('detects that a target is occupied by another file of the same book', () => {
      const files = shiftedParts();
      const targets = resolveBookFileTargets(
        input({ files, primaryFileId: 1, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(findSiblingOccupiedTarget(files, targets)).not.toBeNull();
    });

    it('reports no occupied target when the parts are already numbered from one', () => {
      const files = [1, 2, 3].map((part, index) => audioPart(index + 1, folder, 'Book', part, index));
      const targets = resolveBookFileTargets(
        input({ files, primaryFileId: 1, bookFolderPath: folder, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      // Every file maps onto its own current path, which is not a conflict.
      expect(findSiblingOccupiedTarget(files, targets)).toBeNull();
    });

    it('reports no occupied target when the whole book moves to a free folder', () => {
      const wrong = '/library/Wrong Folder';
      const files = [2, 3, 4].map((part, index) => audioPart(index + 1, wrong, 'Book', part, index));
      const targets = resolveBookFileTargets(
        input({ files, primaryFileId: 1, bookFolderPath: wrong, organizationMode: 'book_per_folder', pattern: '{title}/{title}' }),
      );

      expect(findSiblingOccupiedTarget(files, targets)).toBeNull();
    });

    it('ignores a file that maps onto its own path', () => {
      const files: TargetBookFile[] = [{ id: 1, absolutePath: '/library/Author/Book.epub', format: 'epub', role: 'content', sortOrder: null }];
      const targets = resolveBookFileTargets(input({ files, bookFolderPath: '/library/Author/Book.epub' }));

      expect(findSiblingOccupiedTarget(files, targets)).toBeNull();
    });

    it('is case insensitive about which file occupies a path', () => {
      const files: TargetBookFile[] = [
        { id: 1, absolutePath: `${folder}/BOOK-Part02.mp3`, format: 'mp3', role: 'content', sortOrder: 0 },
        { id: 2, absolutePath: `${folder}/BOOK-Part03.mp3`, format: 'mp3', role: 'content', sortOrder: 1 },
      ];
      const targets = new Map<number, string>([
        [1, `${folder}/BOOK-Part01.mp3`],
        [2, `${folder}/book-part02.mp3`],
      ]);

      expect(findSiblingOccupiedTarget(files, targets)).toBe(`${folder}/book-part02.mp3`);
    });
  });
});
