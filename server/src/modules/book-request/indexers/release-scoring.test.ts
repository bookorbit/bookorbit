import type { ReleaseCandidate } from './indexer-adapter';
import { rejectRelease, scoreRelease, toReleaseItem, type ScoringRequest } from './release-scoring';

function request(overrides: Partial<ScoringRequest> = {}): ScoringRequest {
  return {
    title: 'Dune',
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    isbns: [],
    mediaKind: 'ebook',
    preferredFormats: [],
    language: null,
    tiers: [],
    ...overrides,
  };
}

function release(overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate {
  return {
    indexerId: 1,
    guid: 'g1',
    title: 'Frank Herbert - Dune (2005) [EPUB]',
    sizeBytes: 2 * 1024 * 1024,
    seeders: 20,
    leechers: 3,
    ...overrides,
  };
}

function pointsFor(scored: ReturnType<typeof scoreRelease>, code: string): number | undefined {
  return scored.reasons.find((reason) => reason.code === code)?.points;
}

describe('rejectRelease', () => {
  it('drops a release nobody is seeding', () => {
    expect(rejectRelease(release({ seeders: 0 }), request())).toBe('no seeders');
  });

  it('drops a release whose format belongs to a different medium', () => {
    expect(rejectRelease(release({ format: 'mp3' }), request({ mediaKind: 'ebook' }))).toContain('not a ebook format');
    expect(rejectRelease(release({ format: 'epub' }), request({ mediaKind: 'audiobook' }))).toContain('not a audiobook format');
  });

  it('accepts pdf for both ebooks and comics', () => {
    expect(rejectRelease(release({ format: 'pdf' }), request({ mediaKind: 'ebook' }))).toBeNull();
    expect(rejectRelease(release({ format: 'pdf' }), request({ mediaKind: 'comic' }))).toBeNull();
  });

  it('compares only the language subtag, so eng and en agree', () => {
    expect(rejectRelease(release({ language: 'ENG' }), request({ language: 'en' }))).toBeNull();
    expect(rejectRelease(release({ language: 'de' }), request({ language: 'en' }))).toContain('not en');
  });

  /**
   * A tracker states ISO 639-2 while a request states ISO 639-1, and most of the pairs that do not
   * share a prefix are major languages. Truncating "spa" to "sp" would drop every Spanish release.
   */
  it('maps a three-letter code that does not truncate to its two-letter form', () => {
    for (const [released, requested] of [
      ['spa', 'es'],
      ['ger', 'de'],
      ['deu', 'de'],
      ['swe', 'sv'],
      ['jpn', 'ja'],
      ['dut', 'nl'],
      ['zho', 'zh'],
    ]) {
      expect(rejectRelease(release({ language: released }), request({ language: requested }))).toBeNull();
    }

    expect(rejectRelease(release({ language: 'spa' }), request({ language: 'de' }))).toContain('not de');
  });

  /**
   * A torznab proxy publishes the language in the release title rather than as an attribute, so
   * without this fallback the filter above silently stops running for every torznab indexer.
   * Titles are real Prowlarr output.
   */
  it('reads the language from a title flag when the indexer stated no attribute', () => {
    const audiobook = (title: string) => release({ title, sizeBytes: 900 * 1024 * 1024, language: undefined });
    const asked = (language: string) => request({ title: 'Project Hail Mary', mediaKind: 'audiobook', language });

    const dutch = audiobook('Project Hail Mary by Andy Weir [DUT / M4B]');
    expect(rejectRelease(dutch, asked('en'))).toContain('not en');
    expect(rejectRelease(dutch, asked('nl'))).toBeNull();

    expect(rejectRelease(audiobook('Project Hail Mary by Andy Weir [ENG / MP3]'), asked('en'))).toBeNull();
    expect(rejectRelease(audiobook('Project Hail Mary by Andy Weir [DAN / MP3]'), asked('en'))).toContain('not en');
  });

  it('prefers a stated language attribute over the title flag', () => {
    const candidate = release({ title: 'Dune [DUT / EPUB]', language: 'eng' });
    expect(rejectRelease(candidate, request({ language: 'en' }))).toBeNull();
  });

  /**
   * The filter must stay skipped rather than reject on a language it invented. `normalizeLanguage`
   * truncates an unknown token to two letters, which would otherwise read "[VIP]" as Vietnamese.
   */
  it('leaves the language unstated when no bracketed flag is a known code', () => {
    for (const title of [
      'Frank Herbert - Dune (2005) [EPUB]',
      'Dune [VIP]',
      'Dune [HQ / EPUB]',
      'Dune Messiah',
      '[1818] Mary Shelley - Frankenstein',
    ]) {
      expect(rejectRelease(release({ title, format: undefined, language: undefined }), request({ language: 'en' }))).toBeNull();
    }
  });

  /** "lit" is Lithuanian and also the Microsoft Reader format; on a book tracker it is the format. */
  it('does not read a format token in brackets as a language', () => {
    const candidate = release({ title: 'Dune [EPUB / LIT]', format: undefined, language: undefined });
    expect(rejectRelease(candidate, request({ language: 'en' }))).toBeNull();
  });

  it('keeps a release whose indexer reported no seeder count at all', () => {
    expect(rejectRelease(release({ seeders: null }), request())).toBeNull();
  });

  it('keeps a release stating several formats when one of them fits the medium', () => {
    expect(rejectRelease(release({ format: 'm4a mp3' }), request({ mediaKind: 'audiobook' }))).toBeNull();
    expect(rejectRelease(release({ format: 'm4a mp3' }), request({ mediaKind: 'ebook' }))).toContain('not a ebook format');
  });

  /**
   * This used to be a hard filter, back when the dock was one row per file and a thirty-track
   * release imported track one and reported success. The dock holds units now, so hiding these
   * would hide the multi-format releases that are the best thing a tracker can offer.
   */
  it('keeps a release the indexer says holds more than one primary file', () => {
    expect(rejectRelease(release({ primaryFileCount: 30 }), request())).toBeNull();
    expect(rejectRelease(release({ primaryFileCount: 1 }), request())).toBeNull();
  });

  it('keeps a release whose only file signal is a bare count, which scoring penalises instead', () => {
    expect(rejectRelease(release({ fileCount: 30 }), request())).toBeNull();
  });
});

describe('scoreRelease', () => {
  it('scores a clean title and author match well above a title-only one', () => {
    const matched = scoreRelease(release(), request());
    const wrongAuthor = scoreRelease(release({ title: 'Dune - Someone Else [EPUB]' }), request());

    expect(matched.score).toBeGreaterThan(wrongAuthor.score);
  });

  it('treats an ISBN in the release name as decisive', () => {
    const scored = scoreRelease(release({ title: 'Dune 9780441013593 [EPUB]' }), request({ isbn13: '978-0-441-01359-3' }));

    expect(pointsFor(scored, 'isbnMatch')).toBe(61);
  });

  /**
   * Library Genesis prints every ISBN it holds against a row, and it holds some against the wrong
   * one. Such a row used to take a full match and lead the picker ahead of the right book.
   */
  it('refuses to let a matching ISBN carry a release about a different book', () => {
    const scored = scoreRelease(
      release({ title: 'Cooking for Beginners', bookTitle: 'Cooking for Beginners', author: 'Someone Else', isbn: '9780441013593' }),
      request({ isbn13: '978-0-441-01359-3' }),
    );

    expect(pointsFor(scored, 'isbnMatch')).toBeUndefined();
    expect(pointsFor(scored, 'titleMatch')).toBe(0);
  });

  it('still takes an ISBN stated beside a title that agrees at all', () => {
    const scored = scoreRelease(
      release({ title: 'Dune Messiah', bookTitle: 'Dune Messiah', author: 'Frank Herbert', isbn: '9780441013593' }),
      request({ isbn13: '978-0-441-01359-3' }),
    );

    expect(pointsFor(scored, 'isbnMatch')).toBe(61);
  });

  /**
   * A request holds the canonical ISBN-13, while catalogues that predate it print the 10 the book
   * was published under. Without converting the printed one, the two never compare equal and the
   * decisive sixty-one points were missed on exactly the sources most likely to state an ISBN.
   */
  it('matches an ISBN-10 a release prints against the canonical ISBN-13 requested', () => {
    const scored = scoreRelease(
      release({ title: 'Dune', bookTitle: 'Dune', author: 'Frank Herbert', isbn: '0441013597' }),
      request({ isbn13: '9780441013593' }),
    );

    expect(pointsFor(scored, 'isbnMatch')).toBe(61);
  });

  /**
   * Checksum-gated: an unvalidated ten-digit run is as likely to be an ASIN or a catalogue number,
   * and converting one would manufacture a 13 that matches a different book outright.
   */
  it('does not convert a ten-digit run that is not a valid ISBN-10', () => {
    const scored = scoreRelease(
      release({ title: 'Dune', bookTitle: 'Dune', author: 'Frank Herbert', isbn: '0441013590' }),
      request({ isbn13: '9780441013593' }),
    );

    expect(pointsFor(scored, 'isbnMatch')).toBeUndefined();
  });

  it('rewards a preferred format over a merely acceptable one', () => {
    const preferred = scoreRelease(release({ format: 'epub' }), request({ preferredFormats: ['epub'] }));
    const acceptable = scoreRelease(release({ format: 'epub' }), request({ preferredFormats: ['azw3'] }));

    expect(pointsFor(preferred, 'preferredFormat')).toBeGreaterThan(pointsFor(acceptable, 'knownFormat')!);
  });

  it('reads the format out of the scene name when the indexer states none', () => {
    const scored = scoreRelease(release({ title: 'Dune - Frank Herbert [AZW3]' }), request({ preferredFormats: ['azw3'] }));

    expect(scored.reasons.find((reason) => reason.code === 'preferredFormat')?.detail).toBe('azw3');
  });

  /** MyAnonaMouse states file types as "m4a mp3"; scoring that as unknown throws away the signal. */
  it('reads a preferred format out of a multi-format field', () => {
    const scored = scoreRelease(release({ title: 'Dune', format: 'm4a mp3' }), request({ mediaKind: 'audiobook', preferredFormats: ['mp3'] }));

    expect(scored.reasons.find((reason) => reason.code === 'preferredFormat')?.detail).toBe('mp3');
  });

  it('scores no seeder bonus when the indexer reported no count, rather than a zero-seeder one', () => {
    const scored = scoreRelease(release({ seeders: null }), request());

    expect(scored.reasons.some((reason) => reason.code === 'seeders')).toBe(false);
  });

  it('penalises a size that cannot be the requested medium', () => {
    const sample = scoreRelease(release({ sizeBytes: 4 * 1024 }), request());

    expect(pointsFor(sample, 'suspiciousSize')).toBeLessThan(0);
    expect(sample.score).toBeLessThan(scoreRelease(release(), request()).score);
  });

  it('saturates the seeder bonus, so 200 against 400 barely differs but 1 against 20 does', () => {
    const one = pointsFor(scoreRelease(release({ seeders: 1 }), request()), 'seeders')!;
    const twenty = pointsFor(scoreRelease(release({ seeders: 20 }), request()), 'seeders')!;
    const twoHundred = pointsFor(scoreRelease(release({ seeders: 200 }), request()), 'seeders')!;
    const fourHundred = pointsFor(scoreRelease(release({ seeders: 400 }), request()), 'seeders')!;

    expect(twenty - one).toBeGreaterThan(5);
    expect(fourHundred - twoHundred).toBe(0);
  });

  it('penalises a release carrying far more files than one book in several formats', () => {
    const scored = scoreRelease(release({ fileCount: 30 }), request());

    expect(pointsFor(scored, 'likelySeveralBooks')).toBeLessThan(0);
  });

  /**
   * Three formats plus a cover and an `.opf` is five files and one perfectly ordinary book. It
   * used to lose twenty points for that, which was enough to drop it under an 80 auto-grab floor.
   */
  it('does not penalise one book carried in several formats', () => {
    const scored = scoreRelease(release({ fileCount: 5 }), request());

    expect(pointsFor(scored, 'likelySeveralBooks')).toBeUndefined();
  });

  /** A release holding several book files is ordinary now, and must not be hidden from the list. */
  it('keeps a multi-file release in the results rather than filtering it out', () => {
    const scored = scoreRelease(release({ fileCount: 5, primaryFileCount: 3 }), request());

    expect(scored.score).toBeGreaterThan(0);
  });

  /**
   * The ceiling is the point of the weight table, not an incidental bound: every reason is rounded
   * on its own, so a fractional weight would land this on 99 or 101 and quietly stop the score
   * reading as a percentage. Asserting the exact number is what catches that.
   */
  it('reaches exactly 100 when everything goes right, and never drops below 0', () => {
    const best = scoreRelease(
      release({ title: 'Dune - Frank Herbert 9780441013593 [EPUB]', seeders: 900, freeleech: true, format: 'epub' }),
      request({ isbn13: '9780441013593', preferredFormats: ['epub'] }),
    );
    const worst = scoreRelease(release({ title: 'Unrelated', sizeBytes: 1, seeders: 1, fileCount: 40 }), request());

    expect(best.score).toBe(100);
    expect(worst.score).toBeGreaterThanOrEqual(0);
  });

  /** Freeleech is five of the hundred, so the same release without it tops out five short. */
  it('caps an otherwise perfect release at 95 when it is not freeleech', () => {
    const scored = scoreRelease(
      release({ title: 'Dune - Frank Herbert 9780441013593 [EPUB]', seeders: 900, freeleech: false, format: 'epub' }),
      request({ isbn13: '9780441013593', preferredFormats: ['epub'] }),
    );

    expect(scored.score).toBe(95);
  });
});

describe('toReleaseItem', () => {
  /**
   * MyAnonaMouse publishes `filetypes` alphabetically, so leading with the indexer's first token
   * labelled a release holding the requested epub as an AZW3, and faceting on that one value hid
   * it from a filter on EPUB entirely.
   */
  it('carries every format the release claims, the requested ones first', () => {
    const candidate = release({ title: 'Frank Herbert - Dune', format: 'azw3 epub mobi' });
    const scored = scoreRelease(candidate, request({ preferredFormats: ['epub'] }));

    const item = toReleaseItem(scored, 'myanonamouse', request({ preferredFormats: ['epub'] }));

    expect(item.formats).toEqual(['epub', 'azw3', 'mobi']);
    expect(item.format).toBe('epub');
  });

  /** With nothing preferred there is nothing to promote, so the indexer's order stands. */
  it('keeps the indexer order where the request prefers no format', () => {
    const candidate = release({ title: 'Frank Herbert - Dune', format: 'azw3 epub mobi' });
    const scored = scoreRelease(candidate, request());

    expect(toReleaseItem(scored, 'myanonamouse', request()).formats).toEqual(['azw3', 'epub', 'mobi']);
  });

  /** Several preferred formats rank against each other in the order the request asked for them. */
  it('orders the preferred formats by preference', () => {
    const candidate = release({ title: 'Frank Herbert - Dune', format: 'azw3 epub mobi' });
    const scoringRequest = request({ preferredFormats: ['mobi', 'epub'] });
    const scored = scoreRelease(candidate, scoringRequest);

    expect(toReleaseItem(scored, 'myanonamouse', scoringRequest).formats).toEqual(['mobi', 'epub', 'azw3']);
  });

  it('falls back to the formats named in the release title', () => {
    const scored = scoreRelease(release(), request({ preferredFormats: ['epub'] }));

    expect(toReleaseItem(scored, 'jackett', request({ preferredFormats: ['epub'] })).formats).toEqual(['epub']);
  });

  it('states no format where neither the field nor the title names one', () => {
    const scored = scoreRelease(release({ title: 'Frank Herbert - Dune' }), request());
    const item = toReleaseItem(scored, 'jackett', request());

    expect(item.formats).toEqual([]);
    expect(item.format).toBeNull();
  });
});
