import { randomUUID } from 'crypto';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';

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
import { Permission, type KoreaderCatalogManifestPage } from '@bookorbit/types';

const KOREADER_USERNAME = `manifest-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'ManifestDevicePass123';
// Above the retired MAX_PAGES ceiling of 20,000 so enumeration is proven past it.
const BOOK_COUNT = 25_000;
const DECOY_BOOK_COUNT = 5_000;
const INSERT_CHUNK = 1_000;
const PAGE_SIZE = 200;

type PlanNode = { 'Node Type'?: string; 'Relation Name'?: string; Plans?: PlanNode[] };

/** Flattens an EXPLAIN (FORMAT JSON) tree down to the nodes that touch a relation. */
function collectScanNodes(queryPlan: unknown): PlanNode[] {
  const roots = Array.isArray(queryPlan) ? queryPlan : [queryPlan];
  const found: PlanNode[] = [];
  const pending = roots.map((entry) => (entry as { Plan?: PlanNode })?.Plan).filter((node): node is PlanNode => !!node);
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (node['Relation Name']) found.push(node);
    if (node.Plans) pending.push(...node.Plans);
  }
  return found;
}

describe('KOReader bulk manifest at scale (e2e)', { timeout: 600_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let decoyLibrary!: CreatedLibrary;
  let reader!: TestUserSession;

  async function seedBooks(target: CreatedLibrary, count: number, label: string): Promise<void> {
    for (let offset = 0; offset < count; offset += INSERT_CHUNK) {
      const size = Math.min(INSERT_CHUNK, count - offset);
      const bookRows = await ctx.db
        .insert(schema.books)
        .values(
          Array.from({ length: size }, (_, index) => ({
            libraryId: target.libraryId,
            libraryFolderId: target.libraryFolderId,
            folderPath: `${target.folderPath}/${label}-${offset + index}`,
            status: 'present' as const,
          })),
        )
        .returning({ id: schema.books.id });

      await ctx.db.insert(schema.bookMetadata).values(
        bookRows.map((row, index) => ({
          bookId: row.id,
          title: `${label} Book ${offset + index}`,
        })),
      );

      await ctx.db.insert(schema.bookFiles).values(
        bookRows.map((row, index) => ({
          bookId: row.id,
          libraryFolderId: target.libraryFolderId,
          absolutePath: `${target.folderPath}/${label}-${offset + index}/book.epub`,
          relPath: `${label}-${offset + index}/book.epub`,
          ino: BigInt(row.id),
          format: 'epub',
          sizeBytes: 1024 + index,
          fileHash: `${label.slice(0, 4)}${String(offset + index).padStart(28, '0')}`,
        })),
      );
    }
  }

  async function fetchManifestPage(cursor: string | null): Promise<KoreaderCatalogManifestPage> {
    const params = new URLSearchParams({ size: String(PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/plugin/catalog/manifest?${params.toString()}`,
      headers: { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as KoreaderCatalogManifestPage;
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    // Lower ids belong to a library the reader cannot see, so the keyset has to skip
    // 5,000 inaccessible rows before its first accessible one.
    decoyLibrary = await createLibraryWithFolder(ctx, { name: `manifest-decoy-${randomUUID()}` });
    library = await createLibraryWithFolder(ctx, { name: `manifest-scale-${randomUUID()}` });
    await seedBooks(decoyLibrary, DECOY_BOOK_COUNT, 'decoy');
    await seedBooks(library, BOOK_COUNT, 'scale');

    reader = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(reader.accessToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);

    await ctx.db.execute(sql`analyze books`);
    await ctx.db.execute(sql`analyze book_metadata`);
    await ctx.db.execute(sql`analyze book_files`);
  }, 600_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('enumerates every accessible book past the retired 20,000 ceiling without gaps or duplicates', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;

    for (;;) {
      const page: KoreaderCatalogManifestPage = await fetchManifestPage(cursor);
      expect(page.restartRequired).toBe(false);
      pages += 1;
      for (const item of page.items) seen.push(item.id);
      if (!page.hasNext) break;
      expect(page.nextCursor).toEqual(expect.any(String));
      cursor = page.nextCursor;
      expect(pages).toBeLessThanOrEqual(Math.ceil(BOOK_COUNT / PAGE_SIZE) + 1);
    }

    expect(seen).toHaveLength(BOOK_COUNT);
    expect(new Set(seen).size).toBe(BOOK_COUNT);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThan(seen[index - 1]!);
    }

    const [row] = await ctx.db
      .select({ inaccessible: sql<number>`count(*)::int` })
      .from(schema.books)
      .where(and(eq(schema.books.libraryId, decoyLibrary.libraryId), inArray(schema.books.id, seen.slice(0, 1))));
    expect(row?.inaccessible).toBe(0);
  });

  it('serves a late keyset page from an index rather than a sequential scan', async () => {
    const [midpoint] = await ctx.db
      .select({ id: schema.books.id })
      .from(schema.books)
      .where(eq(schema.books.libraryId, library.libraryId))
      .orderBy(schema.books.id)
      .limit(1)
      .offset(BOOK_COUNT / 2);
    expect(midpoint?.id).toBeDefined();

    const explained = await ctx.db.execute<{ 'QUERY PLAN': unknown }>(sql`
      explain (format json, analyze, buffers)
      select ${schema.books.id} from ${schema.books}
      left join ${schema.bookMetadata} on ${schema.bookMetadata.bookId} = ${schema.books.id}
      where ${inArray(schema.books.libraryId, [library.libraryId])}
        and ${eq(schema.books.status, 'present')}
        and ${gt(schema.books.id, midpoint!.id)}
      order by ${schema.books.id}
      limit ${PAGE_SIZE + 1}
    `);

    const scans = collectScanNodes(explained.rows[0]?.['QUERY PLAN']);
    const booksScan = scans.find((node) => node['Relation Name'] === 'books');
    expect(booksScan, `no scan node for books in plan ${JSON.stringify(scans)}`).toBeDefined();
    // A sequential scan over books here would mean the scope filters and the id keyset
    // have no usable index, which is the regression this fixture exists to catch.
    expect(booksScan!['Node Type']).toMatch(/^Index (Only )?Scan$/);
  });
});
