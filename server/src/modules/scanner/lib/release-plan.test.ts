import { describe, expect, it } from 'vitest';

import {
  interpretRelease,
  MAX_RELEASE_FILES,
  normalizeReleaseStem,
  selectReleaseUnit,
  unitRelativePath,
  type ReleaseFileInput,
} from './release-plan';

function files(...paths: string[]): ReleaseFileInput[] {
  return paths.map((path, index) => ({ path, sizeBytes: (index + 1) * 1000 }));
}

function titles(paths: string[]): string[] {
  return interpretRelease(files(...paths))
    .units.map((unit) => unit.title ?? '')
    .sort();
}

describe('interpretRelease: the scenario matrix', () => {
  it('reads a loose book file at the root as one unit', () => {
    const plan = interpretRelease(files('Book.epub'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]).toMatchObject({ mediaKind: 'ebook', contentFileCount: 1, primaryPath: 'Book.epub' });
  });

  it('keeps a folder of one book plus its artwork and sidecars as one unit', () => {
    const plan = interpretRelease(files('The Hobbit/The Hobbit.epub', 'The Hobbit/cover.jpg', 'The Hobbit/release.nfo', 'The Hobbit/metadata.opf'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.contentFileCount).toBe(1);
    expect(plan.units[0]!.files).toHaveLength(4);
    expect(plan.units[0]!.title).toBe('The Hobbit');
  });

  it('folds several formats of one title into a single unit', () => {
    const plan = interpretRelease(files('Dune/Dune.epub', 'Dune/Dune.mobi', 'Dune/Dune.azw3'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.contentFileCount).toBe(3);
    expect(plan.units[0]!.primaryPath).toBe('Dune/Dune.epub');
  });

  it('treats a release-group suffix as the same title rather than a second book', () => {
    const plan = interpretRelease(files('Dune/Dune (retail).epub', 'Dune/Dune.mobi'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.contentFileCount).toBe(2);
  });

  it('ignores a sample directory instead of counting it as a second book', () => {
    const plan = interpretRelease(files('Book.epub', 'Sample/preview.pdf'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.primaryPath).toBe('Book.epub');
    expect(plan.ignored).toEqual([{ path: 'Sample/preview.pdf', reason: 'junk_dir' }]);
  });

  it('ignores a sample file sitting beside the book', () => {
    const plan = interpretRelease(files('Book.epub', 'Book - sample.epub', 'preview.pdf'));

    expect(plan.units).toHaveLength(1);
    expect(plan.ignored.map((entry) => entry.reason)).toEqual(['sample', 'sample']);
  });

  it('reads a multipart audiobook as one ordered unit', () => {
    const tracks = Array.from({ length: 31 }, (_, index) => `Neuromancer/Chapter ${index + 1}.mp3`);
    const plan = interpretRelease(files(...tracks, 'Neuromancer/cover.jpg'));

    expect(plan.units).toHaveLength(1);
    const unit = plan.units[0]!;
    expect(unit.mediaKind).toBe('audiobook');
    expect(unit.contentFileCount).toBe(31);
    expect(unit.files).toHaveLength(32);
    expect(unit.primaryPath).toBe('Neuromancer/Chapter 1.mp3');
  });

  it('orders tracks naturally so chapter 10 follows chapter 9', () => {
    const plan = interpretRelease(files('Book/Chapter 10.mp3', 'Book/Chapter 9.mp3', 'Book/Chapter 1.mp3'));

    const ordered = plan.units[0]!.files.filter((file) => file.sortOrder !== null).map((file) => file.path);
    expect(ordered).toEqual(['Book/Chapter 1.mp3', 'Book/Chapter 9.mp3', 'Book/Chapter 10.mp3']);
  });

  it('folds disc subdirectories into the audiobook above them', () => {
    const plan = interpretRelease(files('Book/CD 1/track01.mp3', 'Book/CD 1/track02.mp3', 'Book/CD 2/track01.mp3', 'Book/cover.jpg'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.contentFileCount).toBe(3);
    expect(plan.units[0]!.title).toBe('Book');
    expect(plan.units[0]!.directory).toBe('Book');
  });

  /**
   * Ordering by file name interleaved the discs, so a two-disc set played track 1 of disc 1, then
   * track 1 of disc 2. The whole path is what carries the disc.
   */
  it('orders a two-disc audiobook disc by disc rather than interleaving the tracks', () => {
    const plan = interpretRelease(files('Book/CD 2/track01.mp3', 'Book/CD 1/track02.mp3', 'Book/CD 2/track02.mp3', 'Book/CD 1/track01.mp3'));

    expect(plan.units).toHaveLength(1);
    const ordered = [...plan.units[0]!.files].filter((file) => file.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!);
    expect(ordered.map((file) => file.path)).toEqual([
      'Book/CD 1/track01.mp3',
      'Book/CD 1/track02.mp3',
      'Book/CD 2/track01.mp3',
      'Book/CD 2/track02.mp3',
    ]);
    expect(plan.units[0]!.primaryPath).toBe('Book/CD 1/track01.mp3');
  });

  it('reports the path each file has inside its own unit', () => {
    const plan = interpretRelease(files('Book/CD 1/track01.mp3', 'Book/CD 2/track01.mp3'));
    const unit = plan.units[0]!;

    expect(unit.files.map((file) => unitRelativePath(unit, file.path)).sort()).toEqual(['CD 1/track01.mp3', 'CD 2/track01.mp3']);
  });

  it('leaves a unit at the release root with its path unchanged', () => {
    const plan = interpretRelease(files('Book.epub'));
    const unit = plan.units[0]!;

    expect(unit.directory).toBe('');
    expect(unitRelativePath(unit, 'Book.epub')).toBe('Book.epub');
  });

  it('reads a single m4b as one unit', () => {
    const plan = interpretRelease(files('Book.m4b'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.mediaKind).toBe('audiobook');
  });

  it('splits an m4b edition from an mp3 edition of the same title', () => {
    const plan = interpretRelease(files('Book/Book.m4b', 'Book/Chapter 1.mp3', 'Book/Chapter 2.mp3'));

    expect(plan.units).toHaveLength(2);
    expect(plan.units.map((unit) => unit.contentFileCount).sort()).toEqual([1, 2]);
  });

  it('reads a series pack as one unit per title', () => {
    const plan = interpretRelease(files('Discworld/Guards Guards.epub', 'Discworld/Mort.epub', 'Discworld/Small Gods.epub'));

    expect(plan.units).toHaveLength(3);
    expect(plan.units.map((unit) => unit.title).sort()).toEqual(['Guards Guards', 'Mort', 'Small Gods']);
  });

  it('reads a comic run as one unit per issue', () => {
    const issues = Array.from({ length: 60 }, (_, index) => `Saga/Saga ${String(index + 1).padStart(3, '0')}.cbz`);
    const plan = interpretRelease(files(...issues));

    expect(plan.units).toHaveLength(60);
    expect(plan.units.every((unit) => unit.mediaKind === 'comic' && unit.contentFileCount === 1)).toBe(true);
  });

  it('never extracts a comic archive, even though cbz is a zip and cbr is a rar', () => {
    const plan = interpretRelease(files('Saga 001.cbz', 'Saga 002.cbr', 'Saga 003.cb7'));

    expect(plan.containers).toEqual([]);
    expect(plan.units).toHaveLength(3);
  });

  it('keeps an ebook and an audiobook of one work as separate units for placement to merge', () => {
    const plan = interpretRelease(files('Dune/Dune.epub', 'Dune/Dune.m4b'));

    expect(plan.units).toHaveLength(2);
    expect(plan.units.map((unit) => unit.mediaKind).sort()).toEqual(['audiobook', 'ebook']);
  });

  it('reports an archived release as a container with no units', () => {
    const plan = interpretRelease(files('Book.rar', 'Book.r00', 'Book.r01'));

    expect(plan.units).toEqual([]);
    expect(plan.containers.map((container) => container.kind)).toEqual(['rar', 'rar', 'rar']);
  });

  it('reports a zipped ebook as a container', () => {
    const plan = interpretRelease(files('Book.epub.zip'));

    expect(plan.units).toEqual([]);
    expect(plan.containers).toEqual([{ path: 'Book.epub.zip', kind: 'zip' }]);
  });

  it('finds no unit in a release of artwork alone', () => {
    const plan = interpretRelease(files('Screens/shot.png', 'release.nfo'));

    expect(plan.units).toEqual([]);
    expect(plan.containers).toEqual([]);
  });
});

describe('interpretRelease: junk and padding', () => {
  it('drops BitTorrent v1 padding files', () => {
    const plan = interpretRelease(files('Book.epub', '____padding_file_0_abc', '.pad/32768'));

    expect(plan.units).toHaveLength(1);
    expect(plan.ignored.map((entry) => entry.reason).sort()).toEqual(['padding', 'padding']);
  });

  it('drops proof and screenshot directories', () => {
    const plan = interpretRelease(files('Book.epub', 'Proof/proof1.jpg', 'Screenshots/1.png', '_UNPACK_/old.epub'));

    expect(plan.units).toHaveLength(1);
    expect(plan.ignored).toHaveLength(3);
  });

  it('drops dotfiles', () => {
    const plan = interpretRelease(files('Book.epub', '.DS_Store'));

    expect(plan.units).toHaveLength(1);
    expect(plan.ignored).toEqual([{ path: '.DS_Store', reason: 'unsupported' }]);
  });

  it('does not mistake a title beginning with a sample word for a sample', () => {
    expect(titles(['Preview of Death.epub'])).toEqual(['Preview of Death']);
  });
});

describe('interpretRelease: bounds and shape', () => {
  it('flags a release longer than the cap as truncated', () => {
    const many = Array.from({ length: MAX_RELEASE_FILES + 5 }, (_, index) => `Pack/Book ${index}.epub`);
    const plan = interpretRelease(files(...many));

    expect(plan.truncated).toBe(true);
    expect(plan.units).toHaveLength(MAX_RELEASE_FILES);
  });

  it('sums a unit size across its files and tolerates unknown sizes', () => {
    const plan = interpretRelease([
      { path: 'Book/Book.epub', sizeBytes: 100 },
      { path: 'Book/cover.jpg', sizeBytes: null },
    ]);

    expect(plan.units[0]!.sizeBytes).toBe(100);
  });

  it('reports a null size when nothing in the unit states one', () => {
    const plan = interpretRelease([{ path: 'Book.epub', sizeBytes: null }]);

    expect(plan.units[0]!.sizeBytes).toBeNull();
  });

  it('gives artwork no sort order and content files a contiguous one', () => {
    const plan = interpretRelease(files('Book/a.mp3', 'Book/b.mp3', 'Book/cover.jpg'));

    expect(plan.units[0]!.files.map((file) => file.sortOrder)).toEqual([0, 1, null]);
  });

  it('attaches artwork only by stem when a directory holds several books', () => {
    const plan = interpretRelease(files('Pack/Mort.epub', 'Pack/Mort.jpg', 'Pack/Small Gods.epub', 'Pack/random.jpg'));

    const mort = plan.units.find((unit) => unit.title === 'Mort')!;
    expect(mort.files.map((file) => file.path)).toEqual(['Pack/Mort.epub', 'Pack/Mort.jpg']);
    expect(plan.ignored).toEqual([{ path: 'Pack/random.jpg', reason: 'unsupported' }]);
  });

  it('folds a stem-named subdirectory into the book it belongs to', () => {
    const plan = interpretRelease(files('Book.epub', 'Book/cover.jpg'));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.files).toHaveLength(2);
  });

  it('ignores an empty file list', () => {
    expect(interpretRelease([])).toEqual({ units: [], ignored: [], containers: [], truncated: false });
  });
});

describe('normalizeReleaseStem', () => {
  it.each([
    ['Dune', 'dune'],
    ['Dune (retail)', 'dune'],
    ['Dune [v2]', 'dune'],
    ['Dune - fixed', 'dune'],
    ['Dune.retail', 'dune'],
    ['Dune_Messiah', 'dune messiah'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeReleaseStem(input)).toBe(expected);
  });
});

describe('selectReleaseUnit', () => {
  function plan(...paths: string[]) {
    return interpretRelease(files(...paths));
  }

  it('takes the only unit a release resolves to', () => {
    const selection = selectReleaseUnit(plan('Dune/Dune.epub'));

    expect(selection.kind).toBe('unit');
    expect(selection.kind === 'unit' && selection.ignored).toEqual([]);
  });

  it('finds nothing in a release with no unit', () => {
    expect(selectReleaseUnit(plan('release.nfo')).kind).toBe('none');
  });

  /** The request already said which kind of book it wanted, so nobody needs to be asked again. */
  it('narrows a mixed release by the media kind the request asked for', () => {
    const selection = selectReleaseUnit(plan('Dune/Dune.epub', 'Dune/Dune.m4b'), { mediaKind: 'audiobook' });

    expect(selection.kind).toBe('unit');
    expect(selection.kind === 'unit' && selection.unit.mediaKind).toBe('audiobook');
    expect(selection.kind === 'unit' && selection.ignored).toHaveLength(1);
  });

  it('stays ambiguous when the media kind matches more than one unit', () => {
    const selection = selectReleaseUnit(plan('Pack/Mort.epub', 'Pack/Small Gods.epub'), { mediaKind: 'ebook' });

    expect(selection.kind).toBe('ambiguous');
    expect(selection.kind === 'ambiguous' && selection.units).toHaveLength(2);
  });

  it('stays ambiguous when nothing narrows the release', () => {
    expect(selectReleaseUnit(plan('Pack/Mort.epub', 'Pack/Small Gods.epub')).kind).toBe('ambiguous');
  });

  /** A choice already made outranks a media kind that disagrees: a human made it looking at both. */
  it('honours a choice already made over the requested media kind', () => {
    const selection = selectReleaseUnit(plan('Dune/Dune.epub', 'Dune/Dune.m4b'), {
      mediaKind: 'audiobook',
      primaryPath: 'Dune/Dune.epub',
    });

    expect(selection.kind === 'unit' && selection.unit.mediaKind).toBe('ebook');
  });

  it('finds nothing when the chosen unit is no longer in the release', () => {
    expect(selectReleaseUnit(plan('Pack/Mort.epub'), { primaryPath: 'Pack/Gone.epub' }).kind).toBe('none');
  });
});
