/**
 * Book links: separate records shown as one book, across libraries (07-phase-3-link.md 3.2, 3.3).
 * Covers the rules of edge-case group G that the API owns: G2, G10 to G13, G17, G19.
 */
import { randomUUID } from 'crypto';
import { join } from 'path';

import { eq, inArray } from 'drizzle-orm';

import type { BookDetail, BookLinkGroup } from '@bookorbit/types';
import { Permission } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { createEpubFixture, createPdfFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookFileByRelPath,
  triggerAndWaitForLibraryScan,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';

const SCENARIO_TIMEOUT_MS = 120_000;

describe('Book links (e2e)', () => {
  let ctx: MetadataWriteE2EContext;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
  }, SCENARIO_TIMEOUT_MS);

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  async function libraryWithBooks(entries: Array<{ folder: string; file: string; kind: 'epub' | 'pdf'; title: string }>) {
    const library = await createLibraryWithFolder(ctx, { name: `link-${randomUUID()}`, mode: 'book_per_folder' });
    for (const entry of entries) {
      const rel = join(entry.folder, entry.file);
      if (entry.kind === 'epub') await createEpubFixture(library.folderPath, rel, { title: entry.title });
      else await createPdfFixture(library.folderPath, rel, entry.title);
    }
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const ids: number[] = [];
    for (const entry of entries) ids.push((await locateBookFileByRelPath(ctx, library.libraryId, join(entry.folder, entry.file))).bookId);
    return { library, ids };
  }

  async function link(token: string, bookIds: number[]) {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/books/links', headers: authHeader(token), payload: { bookIds } });
    return { status: response.statusCode, body: response.json() as BookLinkGroup & { errorCode?: string; message?: string } };
  }

  async function detail(token: string, bookId: number) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${bookId}`, headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    return response.json() as BookDetail;
  }

  async function groupOf(bookId: number) {
    const [row] = await ctx.db.select().from(schema.bookLinks).where(eq(schema.bookLinks.bookId, bookId));
    return row?.groupId ?? null;
  }

  it(
    'links an ebook and an audiobook kept in two libraries, and each detail lists the other',
    async () => {
      const ebooks = await libraryWithBooks([{ folder: 'Kindred', file: 'Kindred.epub', kind: 'epub', title: 'Kindred' }]);
      const scans = await libraryWithBooks([{ folder: 'Kindred', file: 'Kindred.pdf', kind: 'pdf', title: 'Kindred' }]);
      const [ebookId] = ebooks.ids;
      const [scanId] = scans.ids;

      const created = await link(ctx.adminToken, [ebookId, scanId]);
      expect(created.status).toBe(201);
      expect(created.body.leadBookId).toBe(ebookId);
      expect(created.body.books.map((book) => book.bookId)).toEqual([ebookId, scanId]);

      const ebookDetail = await detail(ctx.adminToken, ebookId);
      expect(ebookDetail.linkGroupId).toBe(created.body.groupId);
      expect(ebookDetail.linkIsLead).toBe(true);
      expect(ebookDetail.linkedBooks).toEqual([
        expect.objectContaining({ bookId: scanId, libraryId: scans.library.libraryId, formats: ['pdf'], mediaKind: 'ebook', isLead: false }),
      ]);
      const scanDetail = await detail(ctx.adminToken, scanId);
      expect(scanDetail.linkedBooks?.map((book) => book.bookId)).toEqual([ebookId]);
      expect(scanDetail.linkIsLead).toBe(false);

      // G2: a reader of one library sees no trace of the other member.
      const reader = await createUserAndLogin(ctx, { permissions: [] });
      await grantLibraryAccess(ctx, reader.userId, ebooks.library.libraryId, 'viewer');
      const readerDetail = await detail(reader.accessToken, ebookId);
      expect(readerDetail.linkedBooks).toEqual([]);
      expect(readerDetail.linkGroupId).toBeNull();
      expect(readerDetail.linkIsLead).toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'joins a third book to a group, merges two groups, moves the lead and unlinks down to nothing',
    async () => {
      const { ids } = await libraryWithBooks([
        { folder: 'A', file: 'A.epub', kind: 'epub', title: 'Parable' },
        { folder: 'B', file: 'B.pdf', kind: 'pdf', title: 'Parable' },
        { folder: 'C', file: 'C.epub', kind: 'epub', title: 'Parable' },
        { folder: 'D', file: 'D.pdf', kind: 'pdf', title: 'Parable' },
      ]);
      const [a, b, c, d] = ids;

      const first = await link(ctx.adminToken, [a, b]);
      const second = await link(ctx.adminToken, [c, d]);
      expect(second.body.groupId).not.toBe(first.body.groupId);

      // G10: joining two grouped books folds the groups; the first grouped book's lead stays.
      const merged = await link(ctx.adminToken, [c, a]);
      expect(merged.status).toBe(201);
      expect(merged.body.groupId).toBe(second.body.groupId);
      expect(merged.body.leadBookId).toBe(c);
      expect(merged.body.books.map((book) => book.bookId).sort()).toEqual([a, b, c, d].sort());
      expect(await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, first.body.groupId))).toHaveLength(0);

      const lead = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/links/${merged.body.groupId}`,
        headers: authHeader(ctx.adminToken),
        payload: { leadBookId: b },
      });
      expect(lead.statusCode).toBe(200);
      expect((lead.json() as BookLinkGroup).leadBookId).toBe(b);

      // G11: the lead leaving clears the lead; G12: a group under two members goes away.
      const unlinkLead = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/books/${b}/link`, headers: authHeader(ctx.adminToken) });
      expect(unlinkLead.statusCode).toBe(204);
      const [group] = await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, merged.body.groupId));
      expect(group.leadBookId).toBeNull();
      for (const id of [a, c]) {
        const response = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/books/${id}/link`, headers: authHeader(ctx.adminToken) });
        expect(response.statusCode).toBe(204);
      }
      expect(await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, merged.body.groupId))).toHaveLength(0);
      expect(await groupOf(d)).toBeNull();
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'refuses to join a group holding a book the user cannot edit, without naming it, and hides unseen ids',
    async () => {
      const shared = await libraryWithBooks([{ folder: 'Dawn', file: 'Dawn.epub', kind: 'epub', title: 'Dawn' }]);
      const hidden = await libraryWithBooks([{ folder: 'Dawn', file: 'Dawn.pdf', kind: 'pdf', title: 'Dawn' }]);
      const extra = await libraryWithBooks([{ folder: 'Dawn Audio', file: 'Dawn.epub', kind: 'epub', title: 'Dawn' }]);
      expect((await link(ctx.adminToken, [shared.ids[0], hidden.ids[0]])).status).toBe(201);

      const editor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryMergeBooks] });
      await grantLibraryAccess(ctx, editor.userId, shared.library.libraryId, 'editor');
      await grantLibraryAccess(ctx, editor.userId, extra.library.libraryId, 'editor');

      // G19: the group holds a book in a library this user cannot see.
      const refused = await link(editor.accessToken, [extra.ids[0], shared.ids[0]]);
      expect(refused.status).toBe(409);
      expect(refused.body.errorCode).toBe('LINK_GROUP_NOT_EDITABLE');
      expect(refused.body.message).not.toContain(String(hidden.ids[0]));
      expect(refused.body).not.toHaveProperty('errorMeta');
      expect(await groupOf(extra.ids[0])).toBeNull();

      // G17: an id the user cannot see is a plain 404.
      expect((await link(editor.accessToken, [extra.ids[0], hidden.ids[0]])).status).toBe(404);

      // A viewer cannot link, and the permission is required.
      const viewer = await createUserAndLogin(ctx, { permissions: [Permission.LibraryMergeBooks] });
      await grantLibraryAccess(ctx, viewer.userId, shared.library.libraryId, 'viewer');
      await grantLibraryAccess(ctx, viewer.userId, extra.library.libraryId, 'viewer');
      expect((await link(viewer.accessToken, [extra.ids[0], shared.ids[0]])).status).toBe(403);
      const noPermission = await createUserAndLogin(ctx, { permissions: [] });
      expect((await link(noPermission.accessToken, [extra.ids[0], shared.ids[0]])).status).toBe(403);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'drops a group whose other member is deleted',
    async () => {
      const { ids } = await libraryWithBooks([
        { folder: 'Wild Seed', file: 'Wild Seed.epub', kind: 'epub', title: 'Wild Seed' },
        { folder: 'Wild Seed Scan', file: 'Wild Seed.pdf', kind: 'pdf', title: 'Wild Seed' },
      ]);
      const created = await link(ctx.adminToken, ids);
      expect(created.status).toBe(201);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/books',
        headers: authHeader(ctx.adminToken),
        payload: { bookIds: [ids[1]] },
      });
      expect([200, 204]).toContain(response.statusCode);
      expect(await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, created.body.groupId))).toHaveLength(0);
      expect(await ctx.db.select().from(schema.bookLinks).where(inArray(schema.bookLinks.bookId, ids))).toHaveLength(0);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    "drops a group left with one member when the other member's library is deleted, and keeps a group still two strong",
    async () => {
      const kept = await libraryWithBooks([
        { folder: 'Fledgling', file: 'Fledgling.epub', kind: 'epub', title: 'Fledgling' },
        { folder: 'Lilith', file: 'Lilith.epub', kind: 'epub', title: 'Lilith' },
        { folder: 'Lilith Scan', file: 'Lilith.pdf', kind: 'pdf', title: 'Lilith' },
      ]);
      const doomed = await libraryWithBooks([
        { folder: 'Fledgling', file: 'Fledgling.pdf', kind: 'pdf', title: 'Fledgling' },
        { folder: 'Lilith', file: 'Lilith.pdf', kind: 'pdf', title: 'Lilith' },
      ]);
      const pair = await link(ctx.adminToken, [kept.ids[0], doomed.ids[0]]);
      const trio = await link(ctx.adminToken, [kept.ids[1], kept.ids[2], doomed.ids[1]]);
      expect([pair.status, trio.status]).toEqual([201, 201]);

      const response = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/libraries/${doomed.library.libraryId}`,
        headers: authHeader(ctx.adminToken),
      });
      expect([200, 204]).toContain(response.statusCode);

      expect(await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, pair.body.groupId))).toHaveLength(0);
      expect(await groupOf(kept.ids[0])).toBeNull();
      expect((await detail(ctx.adminToken, kept.ids[0])).linkGroupId).toBeNull();
      expect(await groupOf(kept.ids[1])).toBe(trio.body.groupId);
      expect(await groupOf(kept.ids[2])).toBe(trio.body.groupId);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it('rejects a single book, a repeated id and more than ten books', async () => {
    expect((await link(ctx.adminToken, [1])).status).toBe(400);
    expect((await link(ctx.adminToken, [5, 5])).status).toBe(400);
    expect(
      (
        await link(
          ctx.adminToken,
          Array.from({ length: 11 }, (_, index) => index + 1),
        )
      ).status,
    ).toBe(400);
  });
});
