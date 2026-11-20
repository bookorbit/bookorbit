import { randomUUID } from 'crypto';

import * as schema from '../src/db/schema';
import { KOREADER_CATALOG_MAX_EXCLUDED_IDS } from '../src/modules/koreader/dto/koreader-catalog-query.dto';
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
import { Permission, type KoreaderCatalogBookListItem, type KoreaderCatalogPage, type KoreaderPluginVersionInfo } from '@bookorbit/types';

const TOKEN = `notondevice${randomUUID().slice(0, 8)}`;
const KOREADER_USERNAME = `books-query-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'BooksQueryDevicePass123';
const BOOK_COUNT = 1_200;
const DECOY_BOOK_COUNT = 50;
const PAGE_SIZE = 100;
// Ids no book has, to fill an exclusion up to its cap.
const UNUSED_ID_BASE = 1_000_000_000;

type BooksPage = KoreaderCatalogPage<KoreaderCatalogBookListItem>;

// The plugin's "Not on this device" list: the list query sent as a body, with every book the
// device holds excluded. Only the device knows which those are, so the set arrives whole.
describe('KOReader catalog list query with excluded books (e2e)', { timeout: 300_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let decoyLibrary!: CreatedLibrary;
  let reader!: TestUserSession;
  let bookIds: number[] = [];
  let decoyIds: number[] = [];
  let smartScopeId!: number;

  const koreaderHeaders = { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };

  async function seedBooks(target: CreatedLibrary, count: number, label: string): Promise<number[]> {
    const rows = await ctx.db
      .insert(schema.books)
      .values(
        Array.from({ length: count }, (_, index) => ({
          libraryId: target.libraryId,
          libraryFolderId: target.libraryFolderId,
          folderPath: `${target.folderPath}/${label}-${index}`,
          status: 'present' as const,
        })),
      )
      .returning({ id: schema.books.id });
    await ctx.db
      .insert(schema.bookMetadata)
      .values(rows.map((row, index) => ({ bookId: row.id, title: `${TOKEN} ${label} ${String(index).padStart(4, '0')}` })));
    await ctx.db.insert(schema.bookFiles).values(
      rows.map((row, index) => ({
        bookId: row.id,
        libraryFolderId: target.libraryFolderId,
        absolutePath: `${target.folderPath}/${label}-${index}/book.epub`,
        relPath: `${label}-${index}/book.epub`,
        ino: BigInt(row.id),
        format: 'epub',
        sizeBytes: 1024 + index,
        fileHash: `${label.slice(0, 4)}${String(row.id).padStart(28, '0')}`,
      })),
    );
    return rows.map((row) => row.id);
  }

  async function query(body: Record<string, unknown>) {
    return ctx.app.inject({ method: 'POST', url: '/api/v1/koreader/plugin/catalog/books/query', headers: koreaderHeaders, payload: body });
  }

  async function queryPage(body: Record<string, unknown>): Promise<BooksPage> {
    const response = await query(body);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as BooksPage;
  }

  // Walks every page the way the plugin does, with the same string values its URL would carry.
  async function walk(body: Record<string, string>): Promise<number[]> {
    const seen: number[] = [];
    for (let page = 1; ; page += 1) {
      const result = await queryPage({ ...body, page: String(page), size: String(PAGE_SIZE) });
      expect(result.nextUrl).toBeNull();
      expect(result.previousUrl).toBeNull();
      seen.push(...result.items.map((item) => item.id));
      if (!result.hasNext) break;
      expect(page).toBeLessThan(Math.ceil(BOOK_COUNT / PAGE_SIZE) + 1);
    }
    return seen;
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `books-query-${randomUUID()}` });
    decoyLibrary = await createLibraryWithFolder(ctx, { name: `books-query-decoy-${randomUUID()}` });
    bookIds = await seedBooks(library, BOOK_COUNT, 'Book');
    decoyIds = await seedBooks(decoyLibrary, DECOY_BOOK_COUNT, 'Decoy');

    reader = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);
    const [scope] = await ctx.db
      .insert(schema.smartScopes)
      .values({
        userId: reader.userId,
        name: `${TOKEN} Everything`,
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: TOKEN }] },
      })
      .returning({ id: schema.smartScopes.id });
    smartScopeId = scope!.id;

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(reader.accessToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);
  }, 300_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('is advertised, so a plugin only sends it to a server that has it', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/plugin/version', headers: koreaderHeaders });
    expect(response.statusCode).toBe(200);
    expect((response.json() as KoreaderPluginVersionInfo).capabilities).toContain('catalogBooksQuery');
  });

  it('pages through exactly the books not excluded, without gaps or duplicates', async () => {
    const kept = bookIds.filter((_, index) => index % 4 === 0);
    const excluded = bookIds.filter((_, index) => index % 4 !== 0);
    // Books the reader cannot see and ids no book has change nothing.
    const excludeIds = [...excluded, ...decoyIds, UNUSED_ID_BASE].join(',');

    const seen = await walk({ sort: 'title', order: 'asc', excludeIds });

    expect(seen).toHaveLength(kept.length);
    expect(new Set(seen)).toEqual(new Set(kept));
    expect((await queryPage({ sort: 'title', excludeIds, size: '1' })).total).toBe(kept.length);
  });

  it('keeps the exclusion inside a library and a SmartScope', async () => {
    const excludeIds = bookIds.slice(10).join(',');

    const inLibrary = await queryPage({ libraryId: String(library.libraryId), sort: 'title', excludeIds });
    const inScope = await queryPage({ smartScopeId: String(smartScopeId), sort: 'title', excludeIds });

    expect(inLibrary.items.map((item) => item.id).sort((a, b) => a - b)).toEqual(bookIds.slice(0, 10));
    expect(inScope.total).toBe(10);
    expect(inScope.items.map((item) => item.id).sort((a, b) => a - b)).toEqual(bookIds.slice(0, 10));
  });

  it('counts jump buckets over the same narrowed list', async () => {
    const page = await queryPage({ sort: 'title', buckets: '1', excludeIds: bookIds.slice(3).join(',') });

    expect(page.total).toBe(3);
    expect(page.buckets).toEqual([expect.objectContaining({ index: 0 })]);
  });

  it('takes a whole library worth of ids in one request and rejects more', async () => {
    const excluded = bookIds.slice(5);
    const filler = Array.from({ length: KOREADER_CATALOG_MAX_EXCLUDED_IDS - excluded.length }, (_, index) => UNUSED_ID_BASE + index);

    const atCap = await queryPage({ sort: 'title', excludeIds: [...excluded, ...filler] });
    const overCap = await query({ sort: 'title', excludeIds: [...excluded, ...filler, UNUSED_ID_BASE - 1] });

    expect(atCap.total).toBe(5);
    expect(overCap.statusCode).toBe(400);
  });

  it('leaves the GET list as it was: everything listed, and no exclusion accepted', async () => {
    const listed = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/plugin/catalog/books?size=1&sort=title', headers: koreaderHeaders });
    const withExclusion = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/plugin/catalog/books?size=1&sort=title&excludeIds=${bookIds[0]}`,
      headers: koreaderHeaders,
    });

    expect(listed.statusCode).toBe(200);
    expect((listed.json() as BooksPage).total).toBe(BOOK_COUNT);
    expect((listed.json() as BooksPage).nextUrl).toEqual(expect.any(String));
    expect(withExclusion.statusCode).toBe(400);
  });

  it('answers only a signed-in device', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/catalog/books/query',
      headers: { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': 'wrong' },
      payload: { excludeIds: '1' },
    });
    expect(response.statusCode).toBe(401);
  });
});
