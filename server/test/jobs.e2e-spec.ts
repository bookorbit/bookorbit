import { randomUUID } from 'crypto';
import { Permission, type JobActionResponse, type JobList, type JobListItem, type JobView } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

/**
 * The Jobs area across types: who sees which rows, what `scope=everyone` needs, and how actions
 * answer for jobs a viewer cannot see or may not change. Rows are written straight into each
 * type's table in settled states, so no worker picks them up while the suite reads them.
 */
describe('Jobs area (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let bookA!: { bookId: number };
  let bookB!: { bookId: number };

  let editor!: TestUserSession;
  let otherEditor!: TestUserSession;
  let merger!: TestUserSession;
  let settingsAdmin!: TestUserSession;
  let fulfiller!: TestUserSession;
  let otherFulfiller!: TestUserSession;
  let requestManager!: TestUserSession;
  let libraryManager!: TestUserSession;
  let unassignedLibraryManager!: TestUserSession;
  let metadataManager!: TestUserSession;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;

  let editorChapterJob!: string;
  let otherChapterJob!: string;
  let failedMerge!: number;
  let doneMerge!: number;
  let failedScan!: number;
  let fulfillerDownload!: number;
  let otherDownload!: number;
  let editorBulkRun!: string;
  let otherBulkRun!: string;
  let ownerlessBulkRun!: string;
  let readAlongReview!: string;
  let reviewDownload!: number;
  let reviewExpiresAt!: Date;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder' });
    bookA = await writeBook();
    bookB = await writeBook();

    editor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    otherEditor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    merger = await createUserAndLogin(ctx, { permissions: [Permission.LibraryMergeBooks] });
    settingsAdmin = await createUserAndLogin(ctx, { permissions: [Permission.ManageAppSettings] });
    fulfiller = await createUserAndLogin(ctx, { permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });
    otherFulfiller = await createUserAndLogin(ctx, { permissions: [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill] });
    requestManager = await createUserAndLogin(ctx, { permissions: [Permission.BookRequestAccess, Permission.ManageBookRequests] });
    libraryManager = await createUserAndLogin(ctx, { permissions: [Permission.ManageLibraries] });
    unassignedLibraryManager = await createUserAndLogin(ctx, { permissions: [Permission.ManageLibraries] });
    metadataManager = await createUserAndLogin(ctx, { permissions: [Permission.ManageMetadataConfig] });
    reader = await createUserAndLogin(ctx, { permissions: [Permission.LibraryGenerateReadAloud] });
    outsider = await createUserAndLogin(ctx, { permissions: [Permission.LibraryUpload] });
    for (const user of [editor, otherEditor, merger, libraryManager, reader]) await grantLibraryAccess(ctx, user.userId, library.libraryId, 'editor');

    const now = new Date();
    const [first, second] = await ctx.db
      .insert(schema.bookChapterJobs)
      .values([
        {
          bookId: bookA.bookId,
          userId: editor.userId,
          kind: 'write',
          baseRevision: randomUUID(),
          status: 'failed',
          errorCode: 'CHAPTERS_WRITE_UNAVAILABLE',
          updatedAt: now,
        },
        {
          bookId: bookB.bookId,
          userId: otherEditor.userId,
          kind: 'read',
          baseRevision: randomUUID(),
          status: 'failed',
          errorCode: 'error',
          updatedAt: now,
        },
      ])
      .returning({ id: schema.bookChapterJobs.id });
    editorChapterJob = first!.id;
    otherChapterJob = second!.id;

    await ctx.db.insert(schema.chapterLookupQueue).values([
      { bookId: bookA.bookId, userId: editor.userId, status: 'failed', finishedAt: now, updatedAt: now },
      { bookId: bookB.bookId, userId: editor.userId, status: 'review', finishedAt: now, updatedAt: now },
    ]);

    // Waiting on its requester's approval, so the read-aloud worker leaves it alone.
    reviewExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [review] = await ctx.db
      .insert(schema.readAloudJobs)
      .values({
        bookId: bookA.bookId,
        requestedByUserId: reader.userId,
        status: 'awaiting_review',
        stage: 'awaiting_review',
        progress: 100,
        input: { sourceHashes: {} } as unknown as typeof schema.readAloudJobs.$inferInsert.input,
        expiresAt: reviewExpiresAt,
      })
      .returning({ id: schema.readAloudJobs.id });
    readAlongReview = review!.id;

    const merges = await ctx.db
      .insert(schema.bookMergeJobs)
      .values([
        {
          libraryId: library.libraryId,
          targetBookId: bookA.bookId,
          sourceBookIds: [bookB.bookId],
          requestedByUserId: merger.userId,
          status: 'failed',
          plan: {},
          errorCode: 'FILE_CHANGED',
          finishedAt: now,
        },
        {
          libraryId: library.libraryId,
          targetBookId: bookB.bookId,
          sourceBookIds: [bookA.bookId],
          requestedByUserId: merger.userId,
          status: 'done',
          plan: {},
          processed: 1,
          total: 1,
          finishedAt: now,
        },
      ])
      .returning({ id: schema.bookMergeJobs.id });
    failedMerge = merges[0]!.id;
    doneMerge = merges[1]!.id;

    const [scan] = await ctx.db
      .insert(schema.bookDuplicateScans)
      .values({
        userId: merger.userId,
        libraryIds: [library.libraryId],
        requestedLibraryId: library.libraryId,
        similarityPercent: 90,
        status: 'failed',
        errorCode: 'scan_failed',
        completedAt: now,
      })
      .returning({ id: schema.bookDuplicateScans.id });
    failedScan = scan!.id;

    await ctx.db.insert(schema.bookMetadataFetchQueue).values({ bookId: bookB.bookId, status: 'failed', updatedAt: now });
    const [author] = await ctx.db
      .insert(schema.authors)
      .values({ name: `Author ${randomUUID().slice(0, 6)}` })
      .returning({ id: schema.authors.id });
    await ctx.db.insert(schema.authorEnrichmentQueue).values({ authorId: author!.id, status: 'failed', updatedAt: now });

    fulfillerDownload = await download(fulfiller, 'failed');
    otherDownload = await download(otherFulfiller, 'failed');
    reviewDownload = await download(fulfiller, 'needs_review');

    const bulkBase = { kind: 'book-refresh-metadata', credentialKind: 'session', total: 2, processed: 1, startedAt: now, finishedAt: now } as const;
    const [failedRun, interruptedRun, ownerlessRun] = await ctx.db
      .insert(schema.bulkRuns)
      .values([
        { ...bulkBase, requestedBy: editor.userId, status: 'failed', errorCode: 'credential-revoked' },
        { ...bulkBase, requestedBy: otherEditor.userId, status: 'interrupted', subjectIds: [bookA.bookId, bookB.bookId] },
        { ...bulkBase, requestedBy: null, status: 'failed', errorCode: 'access-revoked' },
      ])
      .returning({ id: schema.bulkRuns.id });
    editorBulkRun = failedRun!.id;
    otherBulkRun = interruptedRun!.id;
    ownerlessBulkRun = ownerlessRun!.id;
  });

  afterAll(async () => {
    await closeReaderStateIsolationE2EContext(ctx);
  });

  async function writeBook(): Promise<{ bookId: number }> {
    const title = `Title ${randomUUID().slice(0, 6)}`;
    const path = await createEpubFixture(library.folderPath, `Author ${randomUUID().slice(0, 6)}/${title}/${title}.epub`, { title });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    return { bookId: (await locateBookByAbsolutePath(ctx, path)).bookId };
  }

  /** A self-served request its owner fulfils, whose only download ended in `status`: failed on its own, or waiting on a person. */
  async function download(owner: TestUserSession, status: 'failed' | 'needs_review'): Promise<number> {
    const [request] = await ctx.db
      .insert(schema.bookRequests)
      .values({
        userId: owner.userId,
        mediaKind: 'ebook',
        title: `Request ${randomUUID().slice(0, 6)}`,
        status,
        selfServe: true,
        dedupeKey: `jobs-e2e:${randomUUID()}`,
      })
      .returning({ id: schema.bookRequests.id });
    const [attempt] = await ctx.db
      .insert(schema.bookRequestDownloads)
      .values({ requestId: request!.id, source: 'magnet', releaseTitle: 'Release', status })
      .returning({ id: schema.bookRequestDownloads.id });
    return attempt!.id;
  }

  async function list(user: TestUserSession, view: JobView, query = ''): Promise<{ status: number; body: JobList }> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/jobs?view=${view}${query}`, headers: authHeader(user.accessToken) });
    return { status: response.statusCode, body: response.json<JobList>() };
  }

  async function act(user: TestUserSession, action: string, ids: string[]): Promise<JobActionResponse> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/jobs/actions',
      headers: authHeader(user.accessToken),
      payload: { action, ids },
    });
    expect(response.statusCode).toBe(200);
    return response.json<JobActionResponse>();
  }

  function byId(items: JobListItem[]): Map<string, JobListItem> {
    return new Map(items.map((item) => [item.id, item]));
  }

  it('refuses the area to an account that holds no job permission', async () => {
    expect((await list(outsider, 'queue')).status).toBe(403);
  });

  it('shows an editor their own chapter work and bulk actions only, and refuses them everyone else', async () => {
    const { status, body } = await list(editor, 'failed', '&counts=1');
    expect(status).toBe(200);
    const items = byId(body.items);
    expect(items.get(`chapter-edit:${editorChapterJob}`)).toMatchObject({
      type: 'chapter-edit',
      kind: 'write',
      status: 'failed',
      reason: 'CHAPTERS_WRITE_UNAVAILABLE',
      subject: expect.objectContaining({ url: `/book/${bookA.bookId}` }),
      actions: ['retry'],
    });
    expect(items.get(`chapter-lookup:user-${editor.userId}.failed`)).toMatchObject({
      shape: 'queue',
      status: 'failed',
      extra: { failed: 1 },
    });
    expect(items.has(`chapter-edit:${otherChapterJob}`)).toBe(false);
    // Their own failed bulk action sits beside their chapter work.
    expect([...items.keys()].sort()).toEqual(
      [`bulk-run:${editorBulkRun}`, `chapter-edit:${editorChapterJob}`, `chapter-lookup:user-${editor.userId}.failed`].sort(),
    );
    expect(body.counts?.failed).toBe(3);

    expect((await list(editor, 'failed', '&scope=everyone')).status).toBe(403);
  });

  it("shows a settings manager everyone's merges, scans and chapter work, but not other accounts' downloads", async () => {
    const { status, body } = await list(settingsAdmin, 'failed', '&scope=everyone');
    expect(status).toBe(200);
    const items = byId(body.items);
    expect(items.get(`book-merge:${failedMerge}`)).toMatchObject({ status: 'failed', reason: 'FILE_CHANGED', actions: [] });
    expect(items.get(`duplicate-scan:${failedScan}`)).toMatchObject({ status: 'failed', reason: 'scan_failed', kind: 'library' });
    expect(items.get(`chapter-edit:${otherChapterJob}`)).toMatchObject({ requester: { id: otherEditor.userId } });
    // Only the person who asked may retry a chapter change; a manager sees why not.
    expect(items.get(`chapter-edit:${editorChapterJob}`)).toMatchObject({ actions: [], actionNote: 'chapter-edit-requester' });
    expect([...items.keys()].some((id) => id.startsWith('request-download:'))).toBe(false);

    const history = byId((await list(settingsAdmin, 'history', '&scope=everyone&type=book-merge')).body.items);
    expect(history.get(`book-merge:${doneMerge}`)).toMatchObject({ status: 'completed', done: 1, total: 1 });
  });

  it('shows a merger their merges and duplicate scans', async () => {
    const items = byId((await list(merger, 'failed')).body.items);
    expect(items.has(`book-merge:${failedMerge}`)).toBe(true);
    expect(items.get(`duplicate-scan:${failedScan}`)).toMatchObject({ subject: { url: '/tools/duplicate-books' } });
    expect([...items.keys()].some((id) => id.startsWith('chapter-'))).toBe(false);
  });

  it("shows a fulfiller their own downloads, and a request manager everyone's", async () => {
    const mine = byId((await list(fulfiller, 'failed')).body.items);
    expect(mine.get(`request-download:${fulfillerDownload}`)).toMatchObject({ status: 'failed', kind: 'ebook', requester: { id: fulfiller.userId } });
    expect(mine.has(`request-download:${otherDownload}`)).toBe(false);

    const everyone = byId((await list(requestManager, 'failed', '&scope=everyone&type=request-download')).body.items);
    expect(everyone.has(`request-download:${fulfillerDownload}`)).toBe(true);
    expect(everyone.has(`request-download:${otherDownload}`)).toBe(true);
  });

  it('shows library scans to those who manage a library they can reach, and to no one else', async () => {
    const scans = (await list(libraryManager, 'history', '&type=library-scan')).body.items;
    // Both books were scanned in by hand, and a manual scan is always listed.
    expect(scans.length).toBeGreaterThanOrEqual(2);
    expect(scans[0]).toMatchObject({
      type: 'library-scan',
      kind: 'manual',
      status: 'completed',
      subject: { url: `/library/${library.libraryId}` },
      requester: null,
    });
    expect((await list(unassignedLibraryManager, 'history', '&type=library-scan')).body.items).toEqual([]);
    const editorTypes = new Set((await list(editor, 'history')).body.items.map((item) => item.type));
    expect(editorTypes.has('library-scan')).toBe(false);
  });

  it('shows the metadata queues as summary rows to those who manage metadata settings', async () => {
    const items = byId((await list(metadataManager, 'failed')).body.items);
    expect(items.get('metadata-fetch:failed')).toMatchObject({ shape: 'queue', status: 'failed', extra: { failed: 1 }, actions: ['retry'] });
    expect(items.get('author-enrichment:failed')).toMatchObject({ shape: 'queue', status: 'failed', extra: { failed: 1 }, actions: ['retry'] });

    // A settings manager sees the rows, but only a metadata manager may act on them.
    const admin = byId((await list(settingsAdmin, 'failed')).body.items);
    expect(admin.get('metadata-fetch:failed')).toMatchObject({ actions: [], actionNote: 'metadata-config' });
    expect((await act(settingsAdmin, 'retry', ['metadata-fetch:failed'])).results[0]?.outcome).toBe('refused');

    const editorIds = (await list(editor, 'failed')).body.items.map((item) => item.id);
    expect(editorIds).not.toContain('metadata-fetch:failed');
  });

  it("shows an editor their own bulk runs, and a settings manager everyone's without letting them continue another's", async () => {
    const mine = byId((await list(editor, 'failed', '&type=bulk-run')).body.items);
    expect(mine.get(`bulk-run:${editorBulkRun}`)).toMatchObject({
      status: 'failed',
      kind: 'book-refresh-metadata',
      reason: 'credential-revoked',
      done: 1,
      total: 2,
      actions: ['dismiss'],
    });
    expect(mine.has(`bulk-run:${otherBulkRun}`)).toBe(false);

    const everyone = byId((await list(settingsAdmin, 'failed', '&scope=everyone&type=bulk-run')).body.items);
    expect(everyone.get(`bulk-run:${otherBulkRun}`)).toMatchObject({
      status: 'failed',
      reason: 'interrupted',
      requester: { id: otherEditor.userId },
      actions: ['dismiss'],
    });
    expect((await act(settingsAdmin, 'continue', [`bulk-run:${otherBulkRun}`])).results[0]?.outcome).toBe('refused');
    expect((await act(editor, 'continue', [`bulk-run:${otherBulkRun}`])).results[0]?.outcome).toBe('not-found');

    // A run whose account is gone belongs to nobody, so managers find it in their own view.
    const managerOwn = byId((await list(settingsAdmin, 'failed', '&type=bulk-run')).body.items);
    expect(managerOwn.has(`bulk-run:${ownerlessBulkRun}`)).toBe(true);
    expect(managerOwn.has(`bulk-run:${otherBulkRun}`)).toBe(false);
    expect(mine.has(`bulk-run:${ownerlessBulkRun}`)).toBe(false);
  });

  it('lists the work waiting on each person in Needs you, with a count and a link to where they answer it', async () => {
    const mine = await list(reader, 'needs-you', '&counts=1');
    expect(mine.status).toBe(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      id: `read-along:${readAlongReview}`,
      status: 'needs-you',
      reason: 'review',
      subject: { url: `/book/${bookA.bookId}/files` },
      extra: { expiresAt: reviewExpiresAt.toISOString() },
    });
    expect(mine.body.counts?.needsYou).toBe(1);

    const lookups = await list(editor, 'needs-you', '&counts=1');
    expect(lookups.body.items).toEqual([
      expect.objectContaining({ id: `chapter-lookup:user-${editor.userId}.review`, shape: 'queue', status: 'needs-you', extra: { review: 1 } }),
    ]);
    expect(lookups.body.items[0]!.subject.url).toBe('/tools/chapter-health');
    expect(lookups.body.counts?.needsYou).toBe(1);

    const downloads = await list(fulfiller, 'needs-you', '&counts=1');
    expect(downloads.body.items.map((item) => item.id)).toEqual([`request-download:${reviewDownload}`]);
    expect(downloads.body.items[0]).toMatchObject({ reason: 'review', subject: { url: expect.stringMatching(/^\/requests\/\d+$/) as unknown } });
    expect(downloads.body.counts?.needsYou).toBe(1);
  });

  it("keeps another account's reviews out of Needs you, and shows them to those who manage the type under everyone", async () => {
    for (const viewer of [otherEditor, otherFulfiller, outsider]) {
      const { status, body } = await list(viewer, 'needs-you');
      if (status === 403) continue;
      expect(body.items).toEqual([]);
    }
    const managed = byId((await list(settingsAdmin, 'needs-you', '&scope=everyone')).body.items);
    expect(managed.has(`read-along:${readAlongReview}`)).toBe(true);
    // Chapter lookups only ever cover books the viewer can reach, and this manager reaches no library.
    expect(managed.has(`chapter-lookup:user-${editor.userId}.review`)).toBe(false);
    expect(managed.has(`request-download:${reviewDownload}`)).toBe(false);
    expect((await list(settingsAdmin, 'needs-you')).body.items).toEqual([]);

    const requests = byId((await list(requestManager, 'needs-you', '&scope=everyone')).body.items);
    expect([...requests.keys()]).toEqual([`request-download:${reviewDownload}`]);
  });

  it('names the types and scopes each viewer has beside the counts', async () => {
    const editorList = (await list(editor, 'queue', '&counts=1')).body;
    expect(editorList.types).toEqual(['chapter-edit', 'chapter-lookup', 'bulk-run']);
    expect(editorList.scopes).toEqual(['mine']);
    const requests = (await list(requestManager, 'queue', '&counts=1')).body;
    expect(requests.types).toEqual(['request-download']);
    expect(requests.scopes).toEqual(['mine', 'everyone']);
    expect((await list(editor, 'queue')).body.types).toBeUndefined();
  });

  it('answers not-found for a job the viewer cannot see, and refused for one they see but may not change', async () => {
    const unseen = await act(editor, 'retry', [`chapter-edit:${otherChapterJob}`, `request-download:${otherDownload}`, `book-merge:${failedMerge}`]);
    expect(unseen.results.map((result) => result.outcome)).toEqual(['not-found', 'not-found', 'not-found']);

    const refused = await act(settingsAdmin, 'retry', [`chapter-edit:${editorChapterJob}`]);
    expect(refused.results[0]).toMatchObject({ outcome: 'refused', status: 'failed' });
  });
});
