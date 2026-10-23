import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';
import type {
  BookRequestBulkResult,
  BookRequestItem,
  BookRequestPage,
  BookRequestPairSubmitResult,
  BookRequestSubmitResult,
  IndexerItem,
} from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { IndexerConfigService } from '../src/modules/book-request/indexers/indexer-config.service';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createBookDockRow,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

/**
 * What the authorization matrix cannot express.
 *
 * The matrix probes every route with a set of personas and asserts the guard's answer, which is
 * exactly the wrong shape for this feature: almost every rule here is per row rather than per
 * route. "A cannot read B's request" and "a self-fulfiller may drive their own request and nobody
 * else's" both pass the guard and are then decided by the service, and the three plugin routes are
 * gated by a hand-rolled superuser check the matrix has no dimension for.
 *
 * The state machine is exercised over the paths that need no download client. Grab, transfer and
 * import are covered by unit tests against mocked adapters; standing a real client up here would
 * test the client rather than BookOrbit.
 */

const SCENARIO_TIMEOUT_MS = 60_000;

const REQUESTER_PERMISSIONS = [Permission.BookRequestAccess];
const MODERATOR_PERMISSIONS = [Permission.BookRequestAccess, Permission.ManageBookRequests];
const SELF_FULFIL_PERMISSIONS = [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill];

interface SubmitOptions {
  title?: string;
  mediaKind?: 'ebook' | 'audiobook';
  targetLibraryId?: number | null;
  selfServe?: boolean;
  userId?: number;
  authors?: string[];
  preferredFormats?: string[];
  note?: string;
}

describe('Book requests (e2e)', () => {
  let ctx: AuthorizationMatrixE2EContext;
  let library: CreatedLibrary;
  let otherLibrary: CreatedLibrary;
  let requester: TestUserSession;
  let secondRequester: TestUserSession;
  let moderator: TestUserSession;
  let selfFulfiller: TestUserSession;
  let otherSelfFulfiller: TestUserSession;
  let settingsAdmin: TestUserSession;
  let superuser: TestUserSession;

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    library = await createLibraryWithFolder(ctx, { name: `book-requests-lib-${randomUUID()}` });
    otherLibrary = await createLibraryWithFolder(ctx, { name: `book-requests-other-${randomUUID()}` });

    requester = await createUserAndLogin(ctx, { permissions: REQUESTER_PERMISSIONS });
    secondRequester = await createUserAndLogin(ctx, { permissions: REQUESTER_PERMISSIONS });
    moderator = await createUserAndLogin(ctx, { permissions: MODERATOR_PERMISSIONS });
    selfFulfiller = await createUserAndLogin(ctx, { permissions: SELF_FULFIL_PERMISSIONS });
    otherSelfFulfiller = await createUserAndLogin(ctx, { permissions: SELF_FULFIL_PERMISSIONS });
    settingsAdmin = await createUserAndLogin(ctx, { permissions: [Permission.ManageAppSettings] });
    superuser = await createUserAndLogin(ctx, { isSuperuser: true });

    await Promise.all(
      [requester, secondRequester, moderator, selfFulfiller, otherSelfFulfiller].map((user) =>
        grantLibraryAccess(ctx, user.userId, library.libraryId, 'viewer'),
      ),
    );
    // Deliberately reachable by the moderator only, so a reroute onto it is a real reroute.
    await grantLibraryAccess(ctx, moderator.userId, otherLibrary.libraryId, 'viewer');
  }, 240_000);

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  function inject(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, session: TestUserSession, payload?: unknown) {
    return ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeader(session.accessToken),
      ...(payload === undefined ? {} : { payload }),
    });
  }

  /** A unique title per call, so nothing in this file collides on the live-request dedupe key. */
  async function submit(session: TestUserSession, options: SubmitOptions = {}) {
    return inject('POST', '/book-requests', session, {
      title: options.title ?? `Book Requests E2E ${randomUUID()}`,
      mediaKind: options.mediaKind ?? 'ebook',
      authors: options.authors ?? ['Fixture Author'],
      ...(options.targetLibraryId === undefined ? { targetLibraryId: library.libraryId } : { targetLibraryId: options.targetLibraryId }),
      ...(options.selfServe === undefined ? {} : { selfServe: options.selfServe }),
      ...(options.userId === undefined ? {} : { userId: options.userId }),
      ...(options.preferredFormats === undefined ? {} : { preferredFormats: options.preferredFormats }),
      ...(options.note === undefined ? {} : { note: options.note }),
    });
  }

  async function submitOk(session: TestUserSession, options: SubmitOptions = {}): Promise<BookRequestSubmitResult> {
    const response = await submit(session, options);
    expect(response.statusCode).toBe(201);
    return response.json() as BookRequestSubmitResult;
  }

  function statusOf(requestId: number): Promise<string | undefined> {
    return ctx.db
      .select({ status: schema.bookRequests.status })
      .from(schema.bookRequests)
      .where(eq(schema.bookRequests.id, requestId))
      .limit(1)
      .then((rows) => rows[0]?.status);
  }

  describe('lifecycle', () => {
    it(
      'carries a request from pending through an approval that reroutes it to being filed by hand',
      async () => {
        const { request, subscribed } = await submitOk(requester);
        expect(subscribed).toBe(false);
        expect(request.status).toBe('pending');
        expect(request.targetLibraryId).toBe(library.libraryId);

        // The approver disagrees with where the requester wanted it, which is the whole reason
        // approval accepts a destination rather than only a note.
        const approved = await inject('POST', `/admin/book-requests/${request.id}/approve`, moderator, {
          targetLibraryId: otherLibrary.libraryId,
          decisionNote: 'Rerouted to the reference library',
        });
        expect(approved.statusCode).toBe(200);

        const afterApproval = approved.json() as BookRequestItem;
        expect(afterApproval.status).toBe('approved');
        expect(afterApproval.targetLibraryId).toBe(otherLibrary.libraryId);
        expect(afterApproval.decidedByUserId).toBe(moderator.userId);
        expect(afterApproval.decidedByUsername).toBe(moderator.username);
        expect(afterApproval.decidedAt).not.toBeNull();
        expect(afterApproval.decisionNote).toBe('Rerouted to the reference library');

        const dockRow = await createBookDockRow(ctx, { uploadedBy: moderator.userId });
        const filed = await inject('POST', `/admin/book-requests/${request.id}/fulfill`, moderator, {
          bookDockFileId: dockRow.id,
          note: 'Filed from the dock',
        });
        expect(filed.statusCode).toBe(200);

        const available = filed.json() as BookRequestItem;
        expect(available.status).toBe('available');
        expect(available.bookDockFileId).toBe(dockRow.id);
        expect(available.decisionNote).toBe('Filed from the dock');

        // Terminal: filing again is refused rather than silently re-stamping the decision.
        const again = await inject('POST', `/admin/book-requests/${request.id}/fulfill`, moderator, { bookDockFileId: dockRow.id });
        expect(again.statusCode).toBe(400);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses to approve anything that is no longer pending',
      async () => {
        const { request } = await submitOk(requester);
        expect((await inject('POST', `/admin/book-requests/${request.id}/reject`, moderator, {})).statusCode).toBe(200);

        const late = await inject('POST', `/admin/book-requests/${request.id}/approve`, moderator, { targetLibraryId: library.libraryId });

        expect(late.statusCode).toBe(400);
        expect(await statusOf(request.id)).toBe('rejected');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'lets the requester cancel their own request and nobody else cancel it for them',
      async () => {
        const { request } = await submitOk(requester);

        expect((await inject('POST', `/book-requests/${request.id}/cancel`, secondRequester)).statusCode).toBe(403);
        expect(await statusOf(request.id)).toBe('pending');

        expect((await inject('POST', `/book-requests/${request.id}/cancel`, requester)).statusCode).toBe(200);
        expect(await statusOf(request.id)).toBe('cancelled');
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('dedupe', () => {
    it(
      'folds a second request for the same work into the first rather than 500ing on the unique index',
      async () => {
        const title = `Dedupe E2E ${randomUUID()}`;
        const first = await submitOk(requester, { title });

        const second = await submitOk(secondRequester, { title });

        expect(second.subscribed).toBe(true);
        expect(second.request.id).toBe(first.request.id);
        expect(second.request.subscribers.map((subscriber) => subscriber.userId)).toContain(secondRequester.userId);

        // The requester is not a subscriber of their own request: they are its owner.
        expect(second.request.subscribers.map((subscriber) => subscriber.userId)).not.toContain(requester.userId);
      },
      SCENARIO_TIMEOUT_MS,
    );

    /**
     * A non-Latin title used to collapse to one constant key, so the second such request of a
     * medium hit the unique index and 500d. It has to attach exactly as an ASCII one does.
     */
    it(
      'dedupes a non-Latin title without falling back to a shared key',
      async () => {
        const cyrillic = `Война и мир ${randomUUID().slice(0, 8)}`;
        const japanese = `吾輩は猫である ${randomUUID().slice(0, 8)}`;

        const first = await submitOk(requester, { title: cyrillic, authors: ['Лев Толстой'] });
        const attached = await submitOk(secondRequester, { title: cyrillic, authors: ['Лев Толстой'] });
        expect(attached.request.id).toBe(first.request.id);

        // A different non-Latin work is a different request, not the same key again.
        const other = await submitOk(requester, { title: japanese, authors: ['夏目漱石'] });
        expect(other.request.id).not.toBe(first.request.id);
        expect(other.subscribed).toBe(false);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'lets a settled work be asked for again',
      async () => {
        const title = `Re-request E2E ${randomUUID()}`;
        const first = await submitOk(requester, { title });
        expect((await inject('POST', `/admin/book-requests/${first.request.id}/reject`, moderator, {})).statusCode).toBe(200);

        const second = await submitOk(requester, { title });

        expect(second.subscribed).toBe(false);
        expect(second.request.id).not.toBe(first.request.id);
        expect(second.request.status).toBe('pending');
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('visibility and ownership', () => {
    it(
      'keeps one requester out of another requester’s request while letting a subscriber in',
      async () => {
        const title = `Visibility E2E ${randomUUID()}`;
        const { request } = await submitOk(requester, { title });

        const stranger = await createUserAndLogin(ctx, { permissions: REQUESTER_PERMISSIONS });
        expect((await inject('GET', `/book-requests/${request.id}`, stranger)).statusCode).toBe(403);

        await submitOk(secondRequester, { title });
        expect((await inject('GET', `/book-requests/${request.id}`, secondRequester)).statusCode).toBe(200);

        // A moderator reaches every request without being on it.
        expect((await inject('GET', `/book-requests/${request.id}`, moderator)).statusCode).toBe(200);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses the admin list to somebody who can only file requests',
      async () => {
        expect((await inject('GET', '/admin/book-requests', requester)).statusCode).toBe(403);
        expect((await inject('GET', '/admin/book-requests', moderator)).statusCode).toBe(200);
      },
      SCENARIO_TIMEOUT_MS,
    );

    /**
     * The self-fulfilment routes pass the guard for anybody holding the permission. Which rows
     * they may drive is decided per request, and that is the rule worth an end-to-end probe.
     */
    it(
      'lets a self-fulfiller drive their own request and refuses them somebody else’s',
      async () => {
        const mine = await submitOk(selfFulfiller, { selfServe: true });
        expect(mine.request.selfServe).toBe(true);
        expect(mine.request.status).toBe('approved');

        expect((await inject('GET', `/book-request-fulfilment/${mine.request.id}/attempts`, selfFulfiller)).statusCode).toBe(200);
        expect((await inject('GET', `/book-request-fulfilment/${mine.request.id}/attempts`, otherSelfFulfiller)).statusCode).toBe(403);

        // And the ordinary requester is refused by the guard rather than by the row check.
        expect((await inject('GET', `/book-request-fulfilment/${mine.request.id}/attempts`, requester)).statusCode).toBe(403);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'answers 404 for a fulfilment attempt against a download that belongs to another request',
      async () => {
        const mine = await submitOk(selfFulfiller, { selfServe: true });
        const theirs = await submitOk(otherSelfFulfiller, { selfServe: true });

        const [foreign] = await ctx.db
          .insert(schema.bookRequestDownloads)
          .values({
            requestId: theirs.request.id,
            source: 'magnet',
            status: 'needs_review',
            releaseTitle: 'Foreign attempt',
          })
          .returning({ id: schema.bookRequestDownloads.id });

        const response = await inject('POST', `/book-request-fulfilment/${mine.request.id}/downloads/${foreign.id}/select-unit`, selfFulfiller, {
          unitIndex: 0,
        });

        expect(response.statusCode).toBe(404);
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('self-serve constraints', () => {
    it(
      'refuses self-serve to somebody without the permission, with a code the form can translate',
      async () => {
        const response = await submit(requester, { selfServe: true });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ errorCode: 'SUBMIT_SELF_FULFIL_FORBIDDEN' });
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'caps how many self-serve requests one person may have in flight, and says what the cap is',
      async () => {
        const capped = await createUserAndLogin(ctx, { permissions: SELF_FULFIL_PERMISSIONS });
        await grantLibraryAccess(ctx, capped.userId, library.libraryId, 'viewer');

        // Sequential rather than concurrent: the cap is claimed under an advisory lock, and the
        // point here is the refusal rather than the race, which has its own unit coverage.
        for (let index = 0; index < 10; index++) {
          const allowed = await submit(capped, { selfServe: true });
          expect(allowed.statusCode).toBe(201);
        }

        const refused = await submit(capped, { selfServe: true });

        // 403 rather than 400: the refusal is about what this person may do, not what they sent.
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toMatchObject({ errorCode: 'SUBMIT_SELF_SERVE_LIMIT', errorMeta: { limit: 10 } });
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('delegated attribution', () => {
    it(
      'files on somebody else’s behalf for a moderator and records who actually did it',
      async () => {
        const response = await submit(moderator, { userId: requester.userId });

        expect(response.statusCode).toBe(201);
        const { request } = response.json() as BookRequestSubmitResult;
        expect(request.userId).toBe(requester.userId);
        expect(request.requesterUsername).toBe(requester.username);

        const [row] = await ctx.db
          .select({ createdByUserId: schema.bookRequests.createdByUserId })
          .from(schema.bookRequests)
          .where(eq(schema.bookRequests.id, request.id))
          .limit(1);
        expect(row?.createdByUserId).toBe(moderator.userId);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses to file on somebody else’s behalf without the moderator permission',
      async () => {
        const response = await submit(requester, { userId: secondRequester.userId });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ errorCode: 'SUBMIT_ON_BEHALF_FORBIDDEN' });
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses an unknown requester rather than filing the request against nobody',
      async () => {
        const response = await submit(moderator, { userId: 9_999_999 });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ errorCode: 'SUBMIT_ON_BEHALF_UNKNOWN_USER' });
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('subscriptions', () => {
    it(
      'lets a subscriber leave a request they joined, and refuses the requester their own',
      async () => {
        const title = `Unsubscribe E2E ${randomUUID()}`;
        const { request } = await submitOk(requester, { title });
        await submitOk(secondRequester, { title });

        // Leaving is only for somebody who joined: the owner has nothing to leave.
        expect((await inject('DELETE', `/book-requests/${request.id}/subscription`, requester)).statusCode).toBe(400);

        expect((await inject('DELETE', `/book-requests/${request.id}/subscription`, secondRequester)).statusCode).toBe(204);
        // Leaving costs the caller their view of the request, which is the whole point of leaving.
        expect((await inject('GET', `/book-requests/${request.id}`, secondRequester)).statusCode).toBe(403);

        const remaining = await ctx.db
          .select({ userId: schema.bookRequestSubscribers.userId })
          .from(schema.bookRequestSubscribers)
          .where(and(eq(schema.bookRequestSubscribers.requestId, request.id), eq(schema.bookRequestSubscribers.userId, secondRequester.userId)));
        expect(remaining).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'answers 404 when there was no subscription to leave',
      async () => {
        const { request } = await submitOk(requester);

        expect((await inject('DELETE', `/book-requests/${request.id}/subscription`, moderator)).statusCode).toBe(404);
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('bulk actions', () => {
    it(
      'rejects a selection with one shared reason and reports the rows it could not reach',
      async () => {
        const first = await submitOk(requester);
        const second = await submitOk(requester);
        const settled = await submitOk(requester);
        expect((await inject('POST', `/book-requests/${settled.request.id}/cancel`, requester)).statusCode).toBe(200);

        const response = await inject('POST', '/admin/book-requests/reject', moderator, {
          ids: [first.request.id, second.request.id, settled.request.id],
          decisionNote: 'Not available anywhere right now',
        });

        expect(response.statusCode).toBe(200);
        const result = response.json() as BookRequestBulkResult;
        expect(result.updated.map((item) => item.id).sort()).toEqual([first.request.id, second.request.id].sort());
        expect(result.updated.every((item) => item.status === 'rejected')).toBe(true);
        expect(result.updated.every((item) => item.decisionNote === 'Not available anywhere right now')).toBe(true);
        // A cancelled request is not pending, so it falls out rather than failing the whole batch.
        expect(result.failed.map((failure) => failure.id)).toEqual([settled.request.id]);
        expect(result.failed[0]?.reason).toBeTruthy();
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses bulk rejection to anybody who cannot moderate',
      async () => {
        const { request } = await submitOk(requester);

        const response = await inject('POST', '/admin/book-requests/reject', requester, { ids: [request.id] });

        expect(response.statusCode).toBe(403);
        expect(await statusOf(request.id)).toBe('pending');
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('listing', () => {
    it(
      'narrows the queue to self-served rows server-side, and to the ones that went through approval',
      async () => {
        const queued = await submitOk(requester);
        const served = await submitOk(selfFulfiller, { selfServe: true });

        const selfServed = await inject('GET', '/admin/book-requests?selfServe=true&limit=100', moderator);
        expect(selfServed.statusCode).toBe(200);
        const selfServedIds = (selfServed.json() as BookRequestPage).items.map((item) => item.id);
        expect(selfServedIds).toContain(served.request.id);
        expect(selfServedIds).not.toContain(queued.request.id);

        const approvedPath = await inject('GET', '/admin/book-requests?selfServe=false&limit=100', moderator);
        const approvedPathIds = (approvedPath.json() as BookRequestPage).items.map((item) => item.id);
        expect(approvedPathIds).toContain(queued.request.id);
        expect(approvedPathIds).not.toContain(served.request.id);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses a filter value that is neither true nor false rather than silently ignoring it',
      async () => {
        const response = await inject('GET', '/admin/book-requests?selfServe=maybe', moderator);

        expect(response.statusCode).toBe(400);
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('ebook and audiobook pairs', () => {
    function submitPair(session: TestUserSession, title: string, overrides: Record<string, unknown> = {}) {
      return inject('POST', '/book-requests/pairs', session, {
        title,
        authors: ['Fixture Author'],
        ebook: { targetLibraryId: library.libraryId },
        audiobook: { targetLibraryId: library.libraryId },
        ...overrides,
      });
    }

    async function submitPairOk(
      session: TestUserSession,
      title: string,
      overrides: Record<string, unknown> = {},
    ): Promise<BookRequestPairSubmitResult> {
      const response = await submitPair(session, title, overrides);
      expect(response.statusCode).toBe(201);
      return response.json() as BookRequestPairSubmitResult;
    }

    /** One content file, in a library that keeps one book per folder. */
    async function seedEbookBook(target: CreatedLibrary, format = 'epub'): Promise<number> {
      const folderPath = `${target.folderPath}/${randomUUID()}`;
      const [book] = await ctx.db
        .insert(schema.books)
        .values({ libraryId: target.libraryId, libraryFolderId: target.libraryFolderId, folderPath })
        .returning({ id: schema.books.id });
      await ctx.db.insert(schema.bookFiles).values({
        bookId: book!.id,
        libraryFolderId: target.libraryFolderId,
        absolutePath: `${folderPath}/book.${format}`,
        ino: BigInt(Math.floor(Math.random() * 1_000_000_000)),
        format,
        role: 'content',
      });
      return book!.id;
    }

    it(
      'files both halves as requests of their own that name each other',
      async () => {
        const { ebook, audiobook } = await submitPairOk(requester, `Pair ${randomUUID()}`);

        expect(ebook.subscribed).toBe(false);
        expect(audiobook.subscribed).toBe(false);
        expect(ebook.request.mediaKind).toBe('ebook');
        expect(audiobook.request.mediaKind).toBe('audiobook');
        expect(ebook.request.status).toBe('pending');
        expect(audiobook.request.status).toBe('pending');
        expect(ebook.request.companionRequestId).toBe(audiobook.request.id);
        expect(audiobook.request.companionRequestId).toBe(ebook.request.id);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'lists a pair as one entry led by its ebook when asked to group, and as two entries otherwise',
      async () => {
        const { ebook, audiobook } = await submitPairOk(requester, `Pair ${randomUUID()}`);

        const grouped = (await inject('GET', '/book-requests?groupPairs=true&limit=100', requester)).json() as BookRequestPage;
        const lead = grouped.items.find((item) => item.id === ebook.request.id);
        expect(lead?.companion?.id).toBe(audiobook.request.id);
        expect(grouped.items.some((item) => item.id === audiobook.request.id)).toBe(false);

        const flat = (await inject('GET', '/book-requests?limit=100', requester)).json() as BookRequestPage;
        const ids = flat.items.map((item) => item.id);
        expect(ids).toEqual(expect.arrayContaining([ebook.request.id, audiobook.request.id]));
        // A client that never asked to group must not be handed the nested shape.
        expect(flat.items.find((item) => item.id === ebook.request.id)).not.toHaveProperty('companion');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'keeps a grouped pair on a filtered queue when only one half matches the filter',
      async () => {
        const { ebook, audiobook } = await submitPairOk(requester, `Pair ${randomUUID()}`);
        const approved = await inject('POST', `/admin/book-requests/${audiobook.request.id}/approve`, moderator, {});
        expect(approved.statusCode).toBe(200);

        const queue = (await inject('GET', '/admin/book-requests?groupPairs=true&status=approved&limit=100', moderator)).json() as BookRequestPage;
        const lead = queue.items.find((item) => item.id === ebook.request.id);
        expect(lead?.status).toBe('pending');
        expect(lead?.companion?.status).toBe('approved');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'joins a half somebody already asked for and links it to the half it created',
      async () => {
        const title = `Pair ${randomUUID()}`;
        const existing = await submitOk(secondRequester, { title });

        const { ebook, audiobook } = await submitPairOk(requester, title);

        expect(ebook.subscribed).toBe(true);
        expect(ebook.request.id).toBe(existing.request.id);
        expect(audiobook.subscribed).toBe(false);
        expect(ebook.request.companionRequestId).toBe(audiobook.request.id);
        expect(audiobook.request.companionRequestId).toBe(existing.request.id);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses the whole pair, writing neither half, when the rules refuse one of them',
      async () => {
        const title = `Pair ${randomUUID()}`;
        const response = await submitPair(requester, title, { audiobook: { targetLibraryId: otherLibrary.libraryId } });

        expect(response.statusCode).toBe(403);
        expect((response.json() as { errorCode?: string }).errorCode).toBe('SUBMIT_LIBRARY_FORBIDDEN');
        const rows = await ctx.db.select({ id: schema.bookRequests.id }).from(schema.bookRequests).where(eq(schema.bookRequests.title, title));
        expect(rows).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'files a missing format against the book it was asked from, and refuses a format the book already has',
      async () => {
        const folderLibrary = await createLibraryWithFolder(ctx, { mode: 'book_per_folder', name: `book-requests-folder-${randomUUID()}` });
        await grantLibraryAccess(ctx, requester.userId, folderLibrary.libraryId, 'viewer');
        const bookId = await seedEbookBook(folderLibrary);

        const added = await inject('POST', '/book-requests', requester, {
          title: `Joined ${randomUUID()}`,
          mediaKind: 'audiobook',
          authors: ['Fixture Author'],
          targetBookId: bookId,
          targetLibraryId: library.libraryId,
        });
        expect(added.statusCode).toBe(201);
        const { request } = added.json() as BookRequestSubmitResult;
        expect(request.targetBookId).toBe(bookId);
        // The book decides where the format lands, whatever library the form had selected.
        expect(request.targetLibraryId).toBe(folderLibrary.libraryId);

        const duplicate = await inject('POST', '/book-requests', requester, {
          title: `Joined ${randomUUID()}`,
          mediaKind: 'ebook',
          targetBookId: bookId,
        });
        expect(duplicate.statusCode).toBe(400);
        expect((duplicate.json() as { errorCode?: string }).errorCode).toBe('SUBMIT_TARGET_BOOK_HAS_MEDIUM');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it.each(['cbz', 'cbr', 'cb7', 'cbx'])(
      'recognizes an existing %s comic as the non-audio half and still allows its audiobook',
      async (format) => {
        const folderLibrary = await createLibraryWithFolder(ctx, { mode: 'book_per_folder', name: `book-requests-comic-${randomUUID()}` });
        await grantLibraryAccess(ctx, requester.userId, folderLibrary.libraryId, 'viewer');
        const bookId = await seedEbookBook(folderLibrary, format);
        const duplicate = await inject('POST', '/book-requests', requester, {
          title: `Comic ${randomUUID()}`,
          mediaKind: 'ebook',
          preferredFormats: [format],
          targetBookId: bookId,
        });
        expect(duplicate.statusCode).toBe(400);
        expect(duplicate.json()).toMatchObject({ errorCode: 'SUBMIT_TARGET_BOOK_HAS_MEDIUM' });

        const added = await inject('POST', '/book-requests', requester, {
          title: `Comic ${randomUUID()}`,
          mediaKind: 'audiobook',
          targetBookId: bookId,
        });
        expect(added.statusCode).toBe(201);
        expect(added.json()).toMatchObject({ request: { mediaKind: 'audiobook', targetBookId: bookId, targetLibraryId: folderLibrary.libraryId } });
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'accepts comic preferences on ebook requests and scopes comic availability to accessible libraries',
      async () => {
        const title = `Comic ${randomUUID()}`;
        const created = await submitOk(requester, { title, preferredFormats: ['cbz', 'epub'] });
        expect(created.request).toMatchObject({ mediaKind: 'ebook', preferredFormats: ['cbz', 'epub'] });

        const bookId = await seedEbookBook(library, 'cbz');
        const ownedTitle = `Owned comic ${randomUUID()}`;
        await ctx.db.insert(schema.bookMetadata).values({ bookId, title: ownedTitle });
        const queries = [
          { title: ownedTitle, mediaKind: 'ebook' },
          { title: ownedTitle, mediaKind: 'audiobook' },
        ];
        const visible = await inject('POST', '/book-requests/availability', requester, { items: queries });
        expect(visible.statusCode).toBe(200);
        expect(visible.json()).toMatchObject([{ ownedBookId: bookId }, { ownedBookId: null }]);

        const stranger = await createUserAndLogin(ctx, { permissions: REQUESTER_PERMISSIONS });
        const hidden = await inject('POST', '/book-requests/availability', stranger, { items: queries });
        expect(hidden.statusCode).toBe(200);
        expect(hidden.json()).toMatchObject([{ ownedBookId: null }, { ownedBookId: null }]);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'treats a book in a library the requester cannot reach as one that does not exist',
      async () => {
        const hidden = await createLibraryWithFolder(ctx, { mode: 'book_per_folder', name: `book-requests-hidden-${randomUUID()}` });
        const bookId = await seedEbookBook(hidden);

        const response = await inject('POST', '/book-requests', requester, {
          title: `Joined ${randomUUID()}`,
          mediaKind: 'audiobook',
          targetBookId: bookId,
        });

        expect(response.statusCode).toBe(400);
        expect((response.json() as { errorCode?: string }).errorCode).toBe('SUBMIT_TARGET_BOOK_NOT_FOUND');
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('the retired comic medium', () => {
    it(
      'refuses a new comic request, writing nothing',
      async () => {
        const title = `Retired ${randomUUID()}`;
        const response = await inject('POST', '/book-requests', requester, { title, mediaKind: 'comic', targetLibraryId: library.libraryId });

        expect(response.statusCode).toBe(400);
        const rows = await ctx.db.select({ id: schema.bookRequests.id }).from(schema.bookRequests).where(eq(schema.bookRequests.title, title));
        expect(rows).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );

    /** Released iOS builds decode `comic` here as required; leaving it out breaks their whole request screen. */
    it(
      'still answers comic, with no destination, among the default destinations',
      async () => {
        const response = await inject('GET', '/book-requests/default-destinations', requester);

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ comic: { libraryId: null, libraryName: null, folderId: null } });
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'keeps an existing comic request readable and closable, but will not approve it',
      async () => {
        const created = await submitOk(requester);
        await ctx.db.update(schema.bookRequests).set({ mediaKind: 'comic' }).where(eq(schema.bookRequests.id, created.request.id));

        const read = await inject('GET', `/book-requests/${created.request.id}`, requester);
        expect((read.json() as BookRequestItem).mediaKind).toBe('comic');

        const approve = await inject('POST', `/admin/book-requests/${created.request.id}/approve`, moderator, {});
        expect(approve.statusCode).toBe(400);
        expect(await statusOf(created.request.id)).toBe('pending');

        const cancel = await inject('POST', `/book-requests/${created.request.id}/cancel`, requester, {});
        expect(cancel.statusCode).toBe(200);
        expect(await statusOf(created.request.id)).toBe('cancelled');
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('held imports', () => {
    it(
      'discards a held import, removing the dock entry and failing the request',
      async () => {
        const { request } = await submitOk(selfFulfiller, { selfServe: true });
        const dockRow = await createBookDockRow(ctx, { uploadedBy: selfFulfiller.userId });

        await ctx.db
          .update(schema.bookRequests)
          .set({ status: 'needs_review', bookDockFileId: dockRow.id })
          .where(eq(schema.bookRequests.id, request.id));
        await ctx.db.insert(schema.bookRequestDownloads).values({
          requestId: request.id,
          source: 'magnet',
          status: 'needs_review',
          releaseTitle: 'Held attempt',
          bookDockFileId: dockRow.id,
        });

        const response = await inject('POST', `/book-request-fulfilment/${request.id}/discard-import`, selfFulfiller);

        expect(response.statusCode).toBe(200);
        expect((response.json() as BookRequestItem).status).toBe('failed');

        const dockRows = await ctx.db
          .select({ id: schema.bookDockFiles.id })
          .from(schema.bookDockFiles)
          .where(eq(schema.bookDockFiles.id, dockRow.id));
        expect(dockRows).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses to discard an import on a request that is not waiting for review',
      async () => {
        const { request } = await submitOk(selfFulfiller, { selfServe: true });

        const response = await inject('POST', `/book-request-fulfilment/${request.id}/discard-import`, selfFulfiller);

        expect(response.statusCode).toBe(400);
        expect(await statusOf(request.id)).toBe('approved');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'lets a moderator discard a pipeline import without separate Book Dock permission',
      async () => {
        const { request } = await submitOk(requester);
        const dockRow = await createBookDockRow(ctx, { uploadedBy: requester.userId });

        await ctx.db
          .update(schema.bookRequests)
          .set({ status: 'needs_review', bookDockFileId: dockRow.id })
          .where(eq(schema.bookRequests.id, request.id));
        await ctx.db.insert(schema.bookRequestDownloads).values({
          requestId: request.id,
          source: 'magnet',
          status: 'needs_review',
          releaseTitle: 'Held moderator attempt',
          bookDockFileId: dockRow.id,
        });

        const response = await inject('POST', `/admin/book-requests/${request.id}/discard-import`, moderator);

        expect(response.statusCode).toBe(200);
        expect((response.json() as BookRequestItem).status).toBe('failed');
        expect(
          await ctx.db.select({ id: schema.bookDockFiles.id }).from(schema.bookDockFiles).where(eq(schema.bookDockFiles.id, dockRow.id)),
        ).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('indexer plugin routes', () => {
    /**
     * The highest-privilege routes in the feature: an installed plugin runs in this process with
     * this process's reach. Their gate is a hand-rolled superuser check rather than the permission
     * guard, so the authorization matrix has no dimension that can see it.
     */
    it(
      'refuses all three plugin routes to an operator who holds ManageAppSettings but is not a superuser',
      async () => {
        expect((await inject('POST', '/admin/request-indexers/plugins/inspect', settingsAdmin, {})).statusCode).toBe(403);
        expect((await inject('POST', '/admin/request-indexers/plugins', settingsAdmin, {})).statusCode).toBe(403);
        expect((await inject('DELETE', '/admin/request-indexers/plugins/demo-tracker', settingsAdmin)).statusCode).toBe(403);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'still refuses somebody with no settings permission at all, at the guard rather than the gate',
      async () => {
        expect((await inject('POST', '/admin/request-indexers/plugins/inspect', requester, {})).statusCode).toBe(403);
        expect((await inject('DELETE', '/admin/request-indexers/plugins/demo-tracker', requester)).statusCode).toBe(403);
      },
      SCENARIO_TIMEOUT_MS,
    );

    /**
     * A superuser gets past the gate. The refusal that follows is the upload check, which is the
     * point: it proves the 403s above came from the superuser gate and not from a missing body.
     */
    it(
      'lets a superuser past the gate and then refuses the request for carrying no plugin file',
      async () => {
        const response = await inject('DELETE', '/admin/request-indexers/plugins/no-such-plugin', superuser);

        expect(response.statusCode).not.toBe(403);
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('indexer seed policy', () => {
    it(
      'round-trips independent updates and null clears for a settings administrator',
      async () => {
        const created = await inject('POST', '/admin/request-indexers', settingsAdmin, {
          name: `seed-policy-${randomUUID()}`,
          adapterType: 'torznab',
          baseUrl: 'http://203.0.113.10:9117',
          applyTrackerSeedGoals: false,
          seedRatioGoal: 1.25,
          seedTimeMinutes: 60,
        });
        expect(created.statusCode).toBe(201);
        const item = created.json() as IndexerItem;
        expect(item).toMatchObject({
          applyTrackerSeedGoals: false,
          seedRatioGoal: 1.25,
          seedTimeMinutes: 60,
        });
        expect(created.body).not.toContain('credentialsEnc');

        try {
          const updated = await inject('PUT', `/admin/request-indexers/${item.id}`, settingsAdmin, { seedTimeMinutes: 90 });
          expect(updated.statusCode).toBe(200);
          expect(updated.json()).toMatchObject({ seedRatioGoal: 1.25, seedTimeMinutes: 90 });

          const cleared = await inject('PUT', `/admin/request-indexers/${item.id}`, settingsAdmin, {
            seedRatioGoal: null,
            seedTimeMinutes: null,
          });
          expect(cleared.statusCode).toBe(200);
          expect(cleared.json()).toMatchObject({ seedRatioGoal: null, seedTimeMinutes: null });
        } finally {
          await inject('DELETE', `/admin/request-indexers/${item.id}`, settingsAdmin);
        }
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'enforces settings permission and rejects invalid policy before writing',
      async () => {
        const payload = {
          name: `seed-policy-denied-${randomUUID()}`,
          adapterType: 'torznab',
          baseUrl: 'http://203.0.113.10:9117',
          seedTimeMinutes: 60,
        };
        expect((await inject('POST', '/admin/request-indexers', moderator, payload)).statusCode).toBe(403);
        expect((await inject('POST', '/admin/request-indexers', requester, payload)).statusCode).toBe(403);

        const invalid = await inject('POST', '/admin/request-indexers', settingsAdmin, { ...payload, seedTimeMinutes: 2_147_483_648 });
        expect(invalid.statusCode).toBe(400);
        expect(
          await ctx.db.select({ id: schema.requestIndexers.id }).from(schema.requestIndexers).where(eq(schema.requestIndexers.name, payload.name)),
        ).toHaveLength(0);

        const nonTorrentName = `seed-policy-non-torrent-${randomUUID()}`;
        const nonTorrent = await inject('POST', '/admin/request-indexers', settingsAdmin, {
          name: nonTorrentName,
          adapterType: 'newznab',
          baseUrl: 'http://203.0.113.10:9117',
          credential: 'api-key',
          applyTrackerSeedGoals: false,
        });
        expect(nonTorrent.statusCode).toBe(400);
        expect(
          await ctx.db.select({ id: schema.requestIndexers.id }).from(schema.requestIndexers).where(eq(schema.requestIndexers.name, nonTorrentName)),
        ).toHaveLength(0);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'enforces seed-goal constraints in PostgreSQL',
      async () => {
        const validName = `seed-policy-db-${randomUUID()}`;
        const [valid] = await ctx.db
          .insert(schema.requestIndexers)
          .values({
            name: validName,
            adapterType: 'torznab',
            baseUrl: 'http://203.0.113.10:9117',
            seedRatioGoal: 1.25,
            seedTimeMinutes: 2_147_483_647,
          })
          .returning({ id: schema.requestIndexers.id, applyTrackerSeedGoals: schema.requestIndexers.applyTrackerSeedGoals });
        expect(valid?.applyTrackerSeedGoals).toBe(true);

        try {
          for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(
              ctx.db.insert(schema.requestIndexers).values({
                name: `seed-policy-bad-ratio-${randomUUID()}`,
                adapterType: 'torznab',
                baseUrl: 'http://203.0.113.10:9117',
                seedRatioGoal: ratio,
              }),
            ).rejects.toBeDefined();
          }
          for (const minutes of [0, -1, 2_147_483_648]) {
            await expect(
              ctx.db.insert(schema.requestIndexers).values({
                name: `seed-policy-bad-time-${randomUUID()}`,
                adapterType: 'torznab',
                baseUrl: 'http://203.0.113.10:9117',
                seedTimeMinutes: minutes,
              }),
            ).rejects.toBeDefined();
          }
        } finally {
          if (valid) await ctx.db.delete(schema.requestIndexers).where(eq(schema.requestIndexers.id, valid.id));
        }
      },
      SCENARIO_TIMEOUT_MS,
    );
  });

  describe('request contract', () => {
    /**
     * `forbidNonWhitelisted` is assumed by every DTO in this feature, and an unknown field
     * arriving as a silent no-op would make a client-side rename fail as wrong data rather than
     * as an error. One probe, because it is a global pipe setting rather than a per-route one.
     */
    it(
      'refuses a body carrying a field no DTO declares',
      async () => {
        const response = await ctx.app.inject({
          method: 'POST',
          url: '/api/v1/book-requests',
          headers: authHeader(requester.accessToken),
          payload: { title: `Whitelist E2E ${randomUUID()}`, mediaKind: 'ebook', notAField: 'nope' },
        });

        expect(response.statusCode).toBe(400);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses browser-supplied seed goals on a grab',
      async () => {
        const { request } = await submitOk(selfFulfiller, { selfServe: true });
        const response = await inject('POST', `/book-request-fulfilment/${request.id}/grab`, selfFulfiller, {
          magnet: 'magnet:?xt=urn:btih:c9e15763f722f23e98a29decdfae341b98d53056',
          seedRatioGoal: 1,
        });

        expect(response.statusCode).toBe(400);
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'stores the format preference and note the request form now sends',
      async () => {
        const { request } = await submitOk(requester, { preferredFormats: ['epub', 'azw3'], note: 'Unabridged if possible' });

        expect(request.preferredFormats).toEqual(['epub', 'azw3']);
        expect(request.note).toBe('Unabridged if possible');
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'refuses a destination library the requester cannot reach',
      async () => {
        const response = await submit(requester, { targetLibraryId: otherLibrary.libraryId });

        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ errorCode: 'SUBMIT_LIBRARY_FORBIDDEN' });
      },
      SCENARIO_TIMEOUT_MS,
    );
  });
  describe('managed source seed policy', () => {
    it(
      'honors the current manager toggle over unsynchronized legacy source rows',
      async () => {
        const [manager] = await ctx.db
          .insert(schema.requestIndexerManagers)
          .values({
            name: `seed-policy-manager-${randomUUID()}`,
            type: 'prowlarr',
            baseUrl: 'http://127.0.0.1:9696',
            credentialsEnc: 'unused-fixture-credential',
            inheritSeedLimits: true,
          })
          .returning();
        try {
          const [source] = await ctx.db
            .insert(schema.requestIndexers)
            .values({
              name: `seed-policy-source-${randomUUID()}`,
              adapterType: 'torznab',
              baseUrl: 'http://127.0.0.1:9696/1',
              managerId: manager.id,
              managerExternalId: '1',
              managerMetadata: { displayName: 'Seed policy fixture', implementation: 'Torznab', protocol: 'torrent', priority: 25 },
              applyTrackerSeedGoals: true,
              seedRatioGoal: 1,
              seedTimeMinutes: 4320,
            })
            .returning();
          const service = ctx.app.get(IndexerConfigService);
          await expect(service.resolveSeedPolicy(source.id)).resolves.toMatchObject({
            applyTrackerSeedGoals: true,
            seedRatioGoal: 1,
            seedTimeMinutes: 4320,
          });

          await ctx.db
            .update(schema.requestIndexerManagers)
            .set({ inheritSeedLimits: false })
            .where(eq(schema.requestIndexerManagers.id, manager.id));
          await expect(service.resolveSeedPolicy(source.id)).resolves.toEqual({
            id: source.id,
            adapterType: 'torznab',
            seedsBack: true,
            applyTrackerSeedGoals: false,
            seedRatioGoal: null,
            seedTimeMinutes: null,
          });
          const [unchanged] = await ctx.db.select().from(schema.requestIndexers).where(eq(schema.requestIndexers.id, source.id));
          expect(unchanged).toMatchObject({ applyTrackerSeedGoals: true, seedRatioGoal: 1, seedTimeMinutes: 4320 });

          await ctx.db.update(schema.requestIndexers).set({ applyTrackerSeedGoals: false }).where(eq(schema.requestIndexers.id, source.id));
          await ctx.db.update(schema.requestIndexerManagers).set({ inheritSeedLimits: true }).where(eq(schema.requestIndexerManagers.id, manager.id));
          await expect(service.resolveSeedPolicy(source.id)).resolves.toMatchObject({
            applyTrackerSeedGoals: true,
            seedRatioGoal: 1,
            seedTimeMinutes: 4320,
          });
        } finally {
          await ctx.db.delete(schema.requestIndexerManagers).where(eq(schema.requestIndexerManagers.id, manager.id));
        }
      },
      SCENARIO_TIMEOUT_MS,
    );

    it(
      'preserves standalone manual goals when the manager join has no row',
      async () => {
        const [source] = await ctx.db
          .insert(schema.requestIndexers)
          .values({
            name: `standalone-seed-policy-${randomUUID()}`,
            adapterType: 'torznab',
            baseUrl: 'http://127.0.0.1:9117',
            applyTrackerSeedGoals: false,
            seedRatioGoal: 2,
            seedTimeMinutes: 90,
          })
          .returning();
        try {
          await expect(ctx.app.get(IndexerConfigService).resolveSeedPolicy(source.id)).resolves.toEqual({
            id: source.id,
            adapterType: 'torznab',
            seedsBack: true,
            applyTrackerSeedGoals: false,
            seedRatioGoal: 2,
            seedTimeMinutes: 90,
          });
        } finally {
          await ctx.db.delete(schema.requestIndexers).where(eq(schema.requestIndexers.id, source.id));
        }
      },
      SCENARIO_TIMEOUT_MS,
    );
  });
});
