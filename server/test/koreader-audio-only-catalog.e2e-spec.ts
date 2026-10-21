import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';
import {
  Permission,
  type KoreaderCatalogBookDetail,
  type KoreaderCatalogDashboardResponse,
  type KoreaderCatalogDashboardSectionResponse,
  type KoreaderCatalogManifestPage,
  type KoreaderCatalogSectionResponse,
  type KoreaderCredentials,
} from '@bookorbit/types';

const TOKEN = `audiocat${randomUUID().slice(0, 8)}`;
const KOREADER_USERNAME = `audio-only-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'AudioOnlyDevicePass123';

type FileSpec = { format: string; role?: 'content' | 'cover'; primary?: boolean; mediaOverlay?: boolean };
type BooksPage = { items: { id: number }[]; total: number; seriesSummary?: { total: number } | null };

describe('KOReader catalog hiding audiobook-only books (e2e)', { timeout: 300_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let mixed!: CreatedLibrary;
  let audio!: CreatedLibrary;
  let empty!: CreatedLibrary;
  let reader!: TestUserSession;
  let inoCounter = 1_000_000n;
  let seriesS!: number;
  const books: Record<string, number> = {};

  async function authorId(name: string): Promise<number> {
    const [existing] = await ctx.db.select({ id: schema.authors.id }).from(schema.authors).where(eq(schema.authors.name, name));
    if (existing) return existing.id;
    const [created] = await ctx.db.insert(schema.authors).values({ name }).returning({ id: schema.authors.id });
    return created!.id;
  }

  async function seriesId(name: string): Promise<number> {
    const [created] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name, normalizedName: name.toLowerCase() })
      .returning({ id: schema.bookSeries.id });
    return created!.id;
  }

  async function seedBook(
    target: CreatedLibrary,
    key: string,
    files: FileSpec[],
    opts: { authors?: string[]; series?: { id: number; index: string }; status?: 'reading' | 'read' } = {},
  ): Promise<number> {
    const folder = `${target.folderPath}/${key}-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({ libraryId: target.libraryId, libraryFolderId: target.libraryFolderId, folderPath: folder, status: 'present' })
      .returning({ id: schema.books.id });
    const bookId = book!.id;
    await ctx.db.insert(schema.bookMetadata).values({
      bookId,
      title: `${TOKEN} ${key}`,
      ...(opts.series ? { seriesId: opts.series.id, seriesIndex: opts.series.index } : {}),
    });
    let primaryFileId: number | null = null;
    for (const [index, file] of files.entries()) {
      inoCounter += 1n;
      const [row] = await ctx.db
        .insert(schema.bookFiles)
        .values({
          bookId,
          libraryFolderId: target.libraryFolderId,
          absolutePath: `${folder}/file-${index}.${file.format}`,
          relPath: `${key}/file-${index}.${file.format}`,
          ino: inoCounter,
          format: file.format,
          role: file.role ?? 'content',
          sizeBytes: 2048 + index,
          mediaOverlayAvailable: file.mediaOverlay ?? false,
          sortOrder: index,
        })
        .returning({ id: schema.bookFiles.id });
      if (file.primary) primaryFileId = row!.id;
    }
    if (primaryFileId !== null) await ctx.db.update(schema.books).set({ primaryFileId }).where(eq(schema.books.id, bookId));
    for (const [displayOrder, name] of (opts.authors ?? []).entries()) {
      await ctx.db.insert(schema.bookAuthors).values({ bookId, authorId: await authorId(name), displayOrder });
    }
    if (opts.series) {
      await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId: opts.series.id, seriesIndex: opts.series.index });
    }
    if (opts.status) await ctx.db.insert(schema.userBookStatus).values({ userId: reader.userId, bookId, status: opts.status, source: 'manual' });
    books[key] = bookId;
    return bookId;
  }

  async function catalog<T>(path: string): Promise<T> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/plugin/catalog${path}`,
      headers: { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD },
    });
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json() as T;
  }

  async function setHiding(hideAudioOnlyBooks: unknown): Promise<number> {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(reader.accessToken),
      payload: { hideAudioOnlyBooks },
    });
    return response.statusCode;
  }

  async function credentials(): Promise<KoreaderCredentials> {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/credentials', headers: authHeader(reader.accessToken) });
    expect(response.statusCode).toBe(200);
    return response.json() as KoreaderCredentials;
  }

  async function allBookIds(): Promise<number[]> {
    const page = await catalog<BooksPage>(`/books?size=100&sort=title`);
    return page.items.map((item) => item.id).sort((a, b) => a - b);
  }

  async function manifestIds(): Promise<number[]> {
    const ids: number[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: KoreaderCatalogManifestPage = await catalog<KoreaderCatalogManifestPage>(
        `/manifest?size=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      ids.push(...page.items.map((item) => item.id));
      if (!page.hasNext) break;
      cursor = page.nextCursor;
    }
    return ids.sort((a, b) => a - b);
  }

  function ids(...keys: string[]): number[] {
    return keys.map((key) => books[key]!).sort((a, b) => a - b);
  }

  const READABLE = [
    'plain-epub',
    'audio-primary-mixed',
    'epub-primary-mixed',
    'read-along',
    'cover-only',
    'comic',
    'series-s1',
    'series-s3',
    'series-t2',
  ];
  const AUDIO_ONLY = ['audio-only', 'mp3-folder', 'series-s2', 'series-t1', 'audio-library-m4b', 'audio-library-mp3'];

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    mixed = await createLibraryWithFolder(ctx, { name: `${TOKEN} Mixed` });
    audio = await createLibraryWithFolder(ctx, { name: `${TOKEN} Audiobooks` });
    empty = await createLibraryWithFolder(ctx, { name: `${TOKEN} Empty` });
    reader = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    for (const library of [mixed, audio, empty]) await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(reader.accessToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(created.statusCode);

    seriesS = await seriesId(`${TOKEN} Series S`);
    const seriesT = await seriesId(`${TOKEN} Series T`);
    const audioSeries = await seriesId(`${TOKEN} Audio Series`);
    const shared = `${TOKEN} Shared Author`;
    const listenOnly = `${TOKEN} Listen Only Author`;

    await seedBook(mixed, 'plain-epub', [{ format: 'epub', primary: true }], { authors: [shared], status: 'reading' });
    await seedBook(mixed, 'audio-only', [{ format: 'm4b', primary: true }], { authors: [shared, listenOnly], status: 'reading' });
    await seedBook(mixed, 'mp3-folder', [{ format: 'mp3', primary: true }, { format: 'mp3' }, { format: 'mp3' }, { format: 'jpg', role: 'cover' }], {
      authors: [listenOnly],
    });
    await seedBook(mixed, 'audio-primary-mixed', [{ format: 'm4b', primary: true }, { format: 'epub' }], { authors: [shared] });
    await seedBook(mixed, 'epub-primary-mixed', [{ format: 'epub', primary: true }, { format: 'm4b' }]);
    await seedBook(mixed, 'read-along', [{ format: 'epub', primary: true, mediaOverlay: true }]);
    await seedBook(mixed, 'cover-only', [{ format: 'jpg', role: 'cover' }]);
    await seedBook(mixed, 'comic', [{ format: 'cbz', primary: true }]);
    // Series S: the next volume is audiobook-only, so the series waits on it rather than skipping ahead.
    await seedBook(mixed, 'series-s1', [{ format: 'epub', primary: true }], { series: { id: seriesS, index: '1' }, status: 'read' });
    await seedBook(mixed, 'series-s2', [{ format: 'm4b', primary: true }], { series: { id: seriesS, index: '2' } });
    await seedBook(mixed, 'series-s3', [{ format: 'epub', primary: true }], { series: { id: seriesS, index: '3' } });
    // Series T: a listened audiobook-only volume still counts as done, so the ebook after it is next.
    await seedBook(mixed, 'series-t1', [{ format: 'm4b', primary: true }], { series: { id: seriesT, index: '1' }, status: 'read' });
    await seedBook(mixed, 'series-t2', [{ format: 'epub', primary: true }], { series: { id: seriesT, index: '2' } });
    await seedBook(audio, 'audio-library-m4b', [{ format: 'm4b', primary: true }], { authors: [listenOnly] });
    await seedBook(audio, 'audio-library-mp3', [{ format: 'mp3', primary: true }, { format: 'mp3' }], {
      series: { id: audioSeries, index: '1' },
    });

    const [collection] = await ctx.db
      .insert(schema.collections)
      .values({ userId: reader.userId, name: `${TOKEN} Shelf` })
      .returning({ id: schema.collections.id });
    await ctx.db
      .insert(schema.collectionBooks)
      .values(['plain-epub', 'audio-only', 'audio-library-m4b'].map((key) => ({ collectionId: collection!.id, bookId: books[key]! })));
    await ctx.db.insert(schema.smartScopes).values({
      userId: reader.userId,
      name: `${TOKEN} Everything`,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: TOKEN }] },
    });
  }, 300_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('hides audiobook-only books by default for new credentials', async () => {
    expect((await credentials()).hideAudioOnlyBooks).toBe(true);
    const status = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/sync-status', headers: authHeader(reader.accessToken) });
    expect((status.json() as { credentials: KoreaderCredentials }).credentials.hideAudioOnlyBooks).toBe(true);
  });

  it('keeps every book with a non-audio file, whichever file is primary, and drops the rest', async () => {
    expect(await allBookIds()).toEqual(ids(...READABLE));
    expect(await manifestIds()).toEqual(ids(...READABLE));

    const search = await catalog<BooksPage>(`/books?q=${encodeURIComponent(`${TOKEN} audio-only`)}`);
    expect(search.total).toBe(0);
    const byIds = await catalog<BooksPage>(`/books?ids=${books['plain-epub']},${books['audio-only']}`);
    expect(byIds.items.map((item) => item.id)).toEqual([books['plain-epub']]);

    const mixedDetail = await catalog<KoreaderCatalogBookDetail>(`/books/${books['audio-primary-mixed']}`);
    expect(mixedDetail.files.map((file) => file.format).sort()).toEqual(['epub', 'm4b']);
    // A hidden book still opens by id, from history or a stale link.
    expect((await catalog<KoreaderCatalogBookDetail>(`/books/${books['audio-only']}`)).id).toBe(books['audio-only']);
  });

  it('drops a library of only audiobook-only books and narrows every shelf and badge', async () => {
    const libraries = await catalog<KoreaderCatalogSectionResponse>('/sections/libraries');
    expect(libraries.items.map((item) => [item.title, item.count])).toEqual([
      [`${TOKEN} Empty`, 0],
      [`${TOKEN} Mixed`, READABLE.length],
    ]);
    const collections = await catalog<KoreaderCatalogSectionResponse>('/sections/collections');
    expect(collections.items.map((item) => item.count)).toEqual([1]);
    const scopes = await catalog<KoreaderCatalogSectionResponse>('/sections/smart-scopes');
    expect(scopes.items.map((item) => item.count)).toEqual([READABLE.length]);

    const authors = await catalog<KoreaderCatalogSectionResponse>('/sections/authors?size=60');
    expect(authors.items.map((item) => [item.title, item.count])).toEqual([[`${TOKEN} Shared Author`, 2]]);
    const series = await catalog<KoreaderCatalogSectionResponse>('/sections/series?size=60');
    expect(series.items.map((item) => [item.title, item.count])).toEqual([
      [`${TOKEN} Series S`, 2],
      [`${TOKEN} Series T`, 1],
    ]);

    const dashboard = await catalog<KoreaderCatalogDashboardResponse>('/dashboard');
    expect(dashboard.totalBooks).toBe(READABLE.length);
    expect(dashboard.browseCounts).toEqual(expect.objectContaining({ libraries: 2, authors: authors.total, series: series.total, inProgress: 1 }));
    expect(dashboard.continueReading.map((item) => item.id)).toEqual([books['plain-epub']]);
    expect(dashboard.discover.every((item) => !ids(...AUDIO_ONLY).includes(item.id))).toBe(true);
  });

  it('narrows the series a page belongs to and the related rows of a detail page', async () => {
    const seriesPage = await catalog<BooksPage>(`/books?seriesId=${seriesS}&sort=series`);
    expect(seriesPage.items.map((item) => item.id)).toEqual([books['series-s1'], books['series-s3']]);
    expect(seriesPage.seriesSummary?.total).toBe(2);

    const s1 = await catalog<KoreaderCatalogBookDetail>(`/books/${books['series-s1']}`);
    expect(s1.seriesMembers?.map((member) => member.id)).toEqual([books['series-s1'], books['series-s3']]);
    const plain = await catalog<KoreaderCatalogBookDetail>(`/books/${books['plain-epub']}`);
    const related = plain.relatedSections.flatMap((section) => section.books.map((book) => book.id));
    expect(related).not.toContain(books['audio-only']);
  });

  it('fills dashboard sections from what remains, and an audiobook-only volume holds its series', async () => {
    const upNext = await catalog<KoreaderCatalogDashboardSectionResponse>('/dashboard/sections/up-next-in-series');
    expect(upNext.section.books.map((book) => book.id)).toEqual([books['series-t2']]);
    const recent = await catalog<KoreaderCatalogDashboardSectionResponse>('/dashboard/sections/recently-added');
    expect(recent.section.books.map((book) => book.id).sort((a, b) => a - b)).toEqual(ids(...READABLE));
    const [scope] = (await catalog<KoreaderCatalogSectionResponse>('/sections/smart-scopes')).items;
    const scoped = await catalog<KoreaderCatalogDashboardSectionResponse>(`/dashboard/sections/smart-scope?smartScopeId=${scope!.id}`);
    expect(scoped.section.books.map((book) => book.id).sort((a, b) => a - b)).toEqual(ids(...READABLE));
  });

  it('rejects a setting that is not a boolean and shows everything once turned off', async () => {
    expect(await setHiding('no')).toBe(400);
    expect(await setHiding(false)).toBe(200);
    expect((await credentials()).hideAudioOnlyBooks).toBe(false);

    const everything = ids(...READABLE, ...AUDIO_ONLY);
    expect(await allBookIds()).toEqual(everything);
    expect(await manifestIds()).toEqual(everything);
    const libraries = await catalog<KoreaderCatalogSectionResponse>('/sections/libraries');
    expect(libraries.items.map((item) => item.title)).toContain(`${TOKEN} Audiobooks`);
    const authors = await catalog<KoreaderCatalogSectionResponse>('/sections/authors?size=60');
    expect(authors.items.map((item) => item.title)).toContain(`${TOKEN} Listen Only Author`);
    const upNext = await catalog<KoreaderCatalogDashboardSectionResponse>('/dashboard/sections/up-next-in-series');
    expect(upNext.section.books.map((book) => book.id).sort((a, b) => a - b)).toEqual(ids('series-s2', 'series-t2'));
    const dashboard = await catalog<KoreaderCatalogDashboardResponse>('/dashboard');
    expect(dashboard.totalBooks).toBe(everything.length);
    expect(dashboard.browseCounts.libraries).toBe(3);
    const plain = await catalog<KoreaderCatalogBookDetail>(`/books/${books['plain-epub']}`);
    expect(plain.relatedSections.flatMap((section) => section.books.map((book) => book.id))).toContain(books['audio-only']);
    const s1 = await catalog<KoreaderCatalogBookDetail>(`/books/${books['series-s1']}`);
    expect(s1.seriesMembers?.map((member) => member.id)).toEqual([books['series-s1'], books['series-s2'], books['series-s3']]);

    expect(await setHiding(true)).toBe(200);
    expect(await allBookIds()).toEqual(ids(...READABLE));
  });
});
