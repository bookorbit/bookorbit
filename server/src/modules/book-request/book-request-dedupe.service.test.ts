import { BookRequestDedupeService, dedupeKeyCandidates, lowerTitleKey, normalizeIsbn, primaryDedupeKey } from './book-request-dedupe.service';
import type { BookRequestRepository } from './book-request.repository';

function makeService(repoOverrides: Record<string, unknown> = {}) {
  const repo = {
    findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map(), byTitle: new Map() }),
    findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map()),
    findSubscribedRequestIds: vi.fn().mockResolvedValue(new Set()),
    ...repoOverrides,
  } as unknown as BookRequestRepository;

  return { service: new BookRequestDedupeService(repo), repo };
}

function owned(bookId: number, ...authorNames: string[]) {
  return { bookId, authorNames };
}

describe('normalizeIsbn', () => {
  it('strips separators and keeps a 13-digit ISBN', () => {
    expect(normalizeIsbn('978-0-441-01359-3')).toBe('9780441013593');
  });

  it('keeps a trailing X check digit', () => {
    expect(normalizeIsbn('043942089x')).toBe('043942089X');
  });

  it('rejects anything that is not a 10 or 13 character ISBN', () => {
    expect(normalizeIsbn('12345')).toBeNull();
    expect(normalizeIsbn(null)).toBeNull();
    expect(normalizeIsbn(undefined)).toBeNull();
  });
});

describe('dedupeKeyCandidates', () => {
  it('emits every key shape the work could have been filed under, most specific first', () => {
    const keys = dedupeKeyCandidates({
      title: 'Dune',
      authors: ['Frank Herbert'],
      isbn13: '978-0-441-01359-3',
      providerKey: 'google',
      providerId: 'abc',
      mediaKind: 'ebook',
    });

    expect(keys).toEqual(['isbn13:9780441013593:ebook', 'provider:google:abc:ebook', 'work:dune:frankherbert:ebook']);
  });

  it('still emits the work key when the candidate carries no identifiers', () => {
    expect(dedupeKeyCandidates({ title: 'Dune', mediaKind: 'ebook' })).toEqual(['work:dune::ebook']);
  });

  it('folds punctuation, case and accents so the same work reaches the same key', () => {
    const a = dedupeKeyCandidates({ title: 'Les Misérables', authors: ['Victor Hugo'], mediaKind: 'ebook' });
    const b = dedupeKeyCandidates({ title: 'les miserables!', authors: ['victor hugo'], mediaKind: 'ebook' });
    expect(a).toEqual(b);
  });

  it('separates media kinds, so wanting the audiobook too is a second request', () => {
    const ebook = dedupeKeyCandidates({ title: 'Dune', isbn13: '9780441013593', mediaKind: 'ebook' });
    const audio = dedupeKeyCandidates({ title: 'Dune', isbn13: '9780441013593', mediaKind: 'audiobook' });
    expect(ebook[0]).not.toBe(audio[0]);
  });

  it('ignores a 10-digit ISBN for the isbn13 key', () => {
    const keys = dedupeKeyCandidates({ title: 'Dune', isbn13: '0441013597', mediaKind: 'ebook' });
    expect(keys.some((key) => key.startsWith('isbn13:'))).toBe(false);
  });

  it('uses every provider identifier as an alias but files conflicting editions by work', () => {
    const work = {
      title: 'Dune',
      authors: ['Frank Herbert'],
      mediaKind: 'ebook' as const,
      metadataSources: [
        { providerKey: 'google', providerId: 'g1', providerLabel: 'Google Books', isbn10: '0441013597', isbn13: null },
        { providerKey: 'amazon', providerId: 'a1', providerLabel: 'Amazon', isbn10: null, isbn13: '9781250301697' },
      ],
    };

    expect(dedupeKeyCandidates(work)).toEqual([
      'isbn13:9780441013593:ebook',
      'isbn13:9781250301697:ebook',
      'provider:google:g1:ebook',
      'provider:amazon:a1:ebook',
      'work:dune:frankherbert:ebook',
    ]);
    expect(primaryDedupeKey(work)).toBe('work:dune:frankherbert:ebook');
  });
});

/**
 * The keys these produce are what a partial unique index enforces, so two different works sharing
 * one is not a near miss: the second submitter gets a unique violation the recovery cannot explain
 * and a 500 with nothing on it about the book they asked for.
 */
describe('dedupeKeyCandidates in alphabets other than Latin', () => {
  it.each([
    ['Cyrillic', 'Война и мир', 'Лев Толстой'],
    ['Greek', 'Οδύσσεια', 'Όμηρος'],
    ['Japanese', 'ノルウェイの森', '村上春樹'],
    ['Arabic', 'ألف ليلة وليلة', 'مجهول'],
  ])('keeps a %s title and author apart from another one', (_alphabet, title, author) => {
    const [key] = dedupeKeyCandidates({ title, authors: [author], mediaKind: 'ebook' });
    const [other] = dedupeKeyCandidates({ title: 'Dune', authors: ['Frank Herbert'], mediaKind: 'ebook' });

    expect(key).not.toBe(other);
    expect(key).not.toBe('work:::ebook');
    expect(key.startsWith('work:')).toBe(true);
  });

  it('gives two different non-Latin titles two different keys', () => {
    const [war] = dedupeKeyCandidates({ title: 'Война и мир', mediaKind: 'ebook' });
    const [anna] = dedupeKeyCandidates({ title: 'Анна Каренина', mediaKind: 'ebook' });

    expect(war).not.toBe(anna);
  });

  it('still folds punctuation and case within one alphabet', () => {
    const a = dedupeKeyCandidates({ title: 'Война и мир!', mediaKind: 'ebook' });
    const b = dedupeKeyCandidates({ title: '  война, и мир  ', mediaKind: 'ebook' });

    expect(a).toEqual(b);
  });

  /** Punctuation or symbols alone still tokenize to nothing, and must not become one shared key. */
  it('keeps two untokenizable titles apart rather than collapsing them onto one key', () => {
    const stars = dedupeKeyCandidates({ title: '★★★', mediaKind: 'ebook' });
    const marks = dedupeKeyCandidates({ title: '???', mediaKind: 'ebook' });

    expect(stars).toHaveLength(1);
    expect(stars).not.toEqual(marks);
  });
});

describe('primaryDedupeKey', () => {
  it('stores under the most specific key available', () => {
    expect(primaryDedupeKey({ title: 'Dune', isbn13: '9780441013593', providerKey: 'google', providerId: 'x', mediaKind: 'ebook' })).toBe(
      'isbn13:9780441013593:ebook',
    );
    expect(primaryDedupeKey({ title: 'Dune', providerKey: 'google', providerId: 'x', mediaKind: 'ebook' })).toBe('provider:google:x:ebook');
    expect(primaryDedupeKey({ title: 'Dune', mediaKind: 'ebook' })).toBe('work:dune::ebook');
  });

  /**
   * The probe and the insert have to agree about what a work is called. A constant here would file
   * every work the candidate list came back empty for under one key nothing ever looks a request
   * up by, so the second one of a medium collides on the index and 500s.
   */
  it('never falls back to a key two different works could share', () => {
    const stars = primaryDedupeKey({ title: '★★★', mediaKind: 'ebook' });
    const marks = primaryDedupeKey({ title: '???', mediaKind: 'ebook' });

    expect(stars).not.toBe(marks);
    expect(stars).toBe(dedupeKeyCandidates({ title: '★★★', mediaKind: 'ebook' })[0]);
  });
});

/**
 * `book_requests.dedupe_key` is `varchar(500)` and the submission DTO allows a 500-character title
 * beside a 255-character author. An unbounded key overflowed the column, and Postgres 22001 reached
 * the requester as an unexplained 500.
 */
describe('dedupe keys against the column they are stored in', () => {
  const DEDUPE_KEY_LENGTH = 500;
  const longTitle = 'a'.repeat(500);
  const longAuthor = 'b'.repeat(255);

  it('fits the longest title and author the DTO accepts', () => {
    for (const key of dedupeKeyCandidates({ title: longTitle, authors: [longAuthor], mediaKind: 'audiobook' })) {
      expect(key.length).toBeLessThanOrEqual(DEDUPE_KEY_LENGTH);
    }
    expect(primaryDedupeKey({ title: longTitle, authors: [longAuthor], mediaKind: 'audiobook' }).length).toBeLessThanOrEqual(DEDUPE_KEY_LENGTH);
  });

  it('fits the longest provider identifiers the DTO accepts', () => {
    const key = primaryDedupeKey({
      title: longTitle,
      providerKey: 'p'.repeat(50),
      providerId: 'i'.repeat(255),
      mediaKind: 'audiobook',
    });

    expect(key.length).toBeLessThanOrEqual(DEDUPE_KEY_LENGTH);
  });

  /**
   * Truncated with the full token's hash appended rather than simply cut. Two long titles sharing
   * a prefix - a series, a subtitle-heavy edition - would otherwise fold two books into one
   * request, which is worse than the overflow this bound exists to prevent.
   */
  it('keeps two long titles apart when only their tails differ', () => {
    const first = primaryDedupeKey({ title: longTitle, authors: [`${longAuthor}one`], mediaKind: 'ebook' });
    const second = primaryDedupeKey({ title: longTitle, authors: [`${longAuthor}two`], mediaKind: 'ebook' });

    expect(first).not.toBe(second);
  });

  /**
   * Shortening is for keys that would not fit, not for tokens over some width. A stored key is only
   * useful while the probe still computes it, so changing one that already fits would file every
   * existing request of a long-titled work under a key nothing looks it up by.
   */
  it('leaves a long title that still fits exactly as it was', () => {
    const title = 'a'.repeat(300);

    expect(primaryDedupeKey({ title, mediaKind: 'ebook' })).toBe(`work:${title}::ebook`);
  });

  /** A title inside the bound keeps the plain readable key it has always had. */
  it('leaves an ordinary title untouched', () => {
    expect(primaryDedupeKey({ title: 'Dune', authors: ['Frank Herbert'], mediaKind: 'ebook' })).toBe('work:dune:frankherbert:ebook');
  });
});

describe('lowerTitleKey', () => {
  it('matches the lower(title) expression index rather than normalizing harder', () => {
    expect(lowerTitleKey('  The Hobbit  ')).toBe('the hobbit');
  });
});

describe('BookRequestDedupeService.checkAvailability', () => {
  it('returns nothing for an empty batch without touching the database', async () => {
    const { service, repo } = makeService();
    await expect(service.checkAvailability([], 1, null)).resolves.toEqual([]);
    expect(repo.findActiveByDedupeKeys).not.toHaveBeenCalled();
  });

  it('probes every key shape, not just the candidate preferred one', async () => {
    const { service, repo } = makeService();
    await service.checkAvailability([{ title: 'Dune', author: 'Frank Herbert', isbn13: '9780441013593', mediaKind: 'ebook' }], 1, null);

    expect(repo.findActiveByDedupeKeys).toHaveBeenCalledWith(['isbn13:9780441013593:ebook', 'work:dune:frankherbert:ebook']);
  });

  it('finds an existing request filed under a weaker key than the candidate carries', async () => {
    // Someone requested Dune from a provider with no ISBN; this candidate has one. Preferred
    // keys differ, so only probing the preferred key would miss it and create a second request.
    const existing = { id: 7, userId: 2, status: 'pending', dedupeKey: 'work:dune:frankherbert:ebook' };
    const { service } = makeService({
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map([['work:dune:frankherbert:ebook', existing]])),
    });

    const [result] = await service.checkAvailability(
      [{ title: 'Dune', author: 'Frank Herbert', isbn13: '9780441013593', mediaKind: 'ebook' }],
      1,
      null,
    );

    expect(result.existingRequestId).toBe(7);
    expect(result.existingRequestStatus).toBe('pending');
  });

  it('reports ownership by ISBN13 ahead of title', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map([['9780441013593', 42]]), byTitle: new Map([['dune', [owned(99)]]]) }),
    });

    const [result] = await service.checkAvailability([{ title: 'Dune', isbn13: '9780441013593', mediaKind: 'ebook' }], 1, null);
    expect(result.ownedBookId).toBe(42);
  });

  it('falls back to a title match when the candidate has no ISBN', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map(), byTitle: new Map([['dune', [owned(99)]]]) }),
    });

    const [result] = await service.checkAvailability([{ title: 'Dune', mediaKind: 'ebook' }], 1, null);
    expect(result.ownedBookId).toBe(99);
  });

  it('requires the author to agree before a shared title counts as owned', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map(), byTitle: new Map([['it', [owned(99, 'Alexa Chipman')]]]) }),
    });

    const [result] = await service.checkAvailability([{ title: 'It', author: 'Stephen King', mediaKind: 'ebook' }], 1, null);
    expect(result.ownedBookId).toBeNull();
  });

  it('picks the book whose author matches out of several sharing a title', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({
        byIsbn13: new Map(),
        byTitle: new Map([['it', [owned(99, 'Alexa Chipman'), owned(101, 'Stephen King')]]]),
      }),
    });

    const [result] = await service.checkAvailability([{ title: 'It', author: 'Stephen King', mediaKind: 'ebook' }], 1, null);
    expect(result.ownedBookId).toBe(101);
  });

  it('ignores punctuation, case and combining accents when comparing authors', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map(), byTitle: new Map([['germinal', [owned(7, 'Émile Zola')]]]) }),
    });

    const [result] = await service.checkAvailability([{ title: 'Germinal', author: 'emile  zola', mediaKind: 'ebook' }], 1, null);
    expect(result.ownedBookId).toBe(7);
  });

  it('marks the requester as already subscribed to their own request', async () => {
    const existing = { id: 7, userId: 1, status: 'pending', dedupeKey: 'work:dune::ebook' };
    const { service } = makeService({
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map([['work:dune::ebook', existing]])),
    });

    const [result] = await service.checkAvailability([{ title: 'Dune', mediaKind: 'ebook' }], 1, null);
    expect(result.alreadySubscribed).toBe(true);
  });

  it('marks a subscriber on someone else request as already subscribed', async () => {
    const existing = { id: 7, userId: 2, status: 'pending', dedupeKey: 'work:dune::ebook' };
    const { service } = makeService({
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map([['work:dune::ebook', existing]])),
      findSubscribedRequestIds: vi.fn().mockResolvedValue(new Set([7])),
    });

    const [result] = await service.checkAvailability([{ title: 'Dune', mediaKind: 'ebook' }], 1, null);
    expect(result.alreadySubscribed).toBe(true);
  });

  it('leaves a stranger request unsubscribed', async () => {
    const existing = { id: 7, userId: 2, status: 'pending', dedupeKey: 'work:dune::ebook' };
    const { service } = makeService({
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map([['work:dune::ebook', existing]])),
    });

    const [result] = await service.checkAvailability([{ title: 'Dune', mediaKind: 'ebook' }], 1, null);
    expect(result.alreadySubscribed).toBe(false);
  });

  it('scopes ownership to the libraries the caller can reach', async () => {
    const { service, repo } = makeService();
    await service.checkAvailability([{ title: 'Dune', mediaKind: 'ebook' }], 1, [3, 4]);
    expect(repo.findOwnedMatches).toHaveBeenCalledWith([], ['dune'], [3, 4]);
  });

  it('keeps results aligned with the input order', async () => {
    const { service } = makeService({
      findOwnedMatches: vi.fn().mockResolvedValue({ byIsbn13: new Map(), byTitle: new Map([['b', [owned(2)]]]) }),
    });

    const results = await service.checkAvailability(
      [
        { title: 'a', mediaKind: 'ebook' },
        { title: 'b', mediaKind: 'ebook' },
        { title: 'c', mediaKind: 'ebook' },
      ],
      1,
      null,
    );

    expect(results.map((r) => r.ownedBookId)).toEqual([null, 2, null]);
  });
});

describe('BookRequestDedupeService.findActiveRequestFor', () => {
  it('returns the match for the most specific key when several hit', async () => {
    const byIsbn = { id: 1, dedupeKey: 'isbn13:9780441013593:ebook' };
    const byWork = { id: 2, dedupeKey: 'work:dune:frankherbert:ebook' };
    const { service } = makeService({
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(
        new Map([
          ['isbn13:9780441013593:ebook', byIsbn],
          ['work:dune:frankherbert:ebook', byWork],
        ]),
      ),
    });

    const found = await service.findActiveRequestFor({
      title: 'Dune',
      authors: ['Frank Herbert'],
      isbn13: '9780441013593',
      mediaKind: 'ebook',
    });

    expect(found).toBe(byIsbn);
  });

  it('returns undefined when nothing is live', async () => {
    const { service } = makeService();
    await expect(service.findActiveRequestFor({ title: 'Dune', mediaKind: 'ebook' })).resolves.toBeUndefined();
  });
});

/**
 * The hole aliases exist to narrow, stated as a test so the shape is not re-derived: a request
 * filed under its ISBN and a free-text one that only ever produces a work key never collide on the
 * stored key alone, and the unique index permits both.
 */
describe('BookRequestDedupeService free-text collision', () => {
  const isbnWork = { title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593', mediaKind: 'ebook' as const };
  const typedWork = { title: 'Dune', authors: ['Frank Herbert'], mediaKind: 'ebook' as const };

  it('files an ISBN-bearing request under a key free text can never produce', () => {
    expect(primaryDedupeKey(isbnWork)).toMatch(/^isbn13:/);
    expect(primaryDedupeKey(typedWork)).not.toMatch(/^isbn13:/);
  });

  /** Which is why the work key is stored as an alias alongside it, and probed on the way in. */
  it("still emits the shared work key as one of the ISBN request's candidates", () => {
    const shared = primaryDedupeKey(typedWork);
    expect(dedupeKeyCandidates(isbnWork)).toContain(shared);
  });

  it('finds the live request through an alias the repository matched', async () => {
    const existing = { id: 7, dedupeKey: `isbn13:9780441013593:ebook` };
    const { service } = makeService({
      // What the repository returns once it has probed the alias table: keyed by the key that was
      // asked about, not by the one the row was filed under.
      findActiveByDedupeKeys: vi.fn().mockResolvedValue(new Map([[primaryDedupeKey(typedWork), existing]])),
    });

    await expect(service.findActiveRequestFor(typedWork)).resolves.toBe(existing);
  });
});
