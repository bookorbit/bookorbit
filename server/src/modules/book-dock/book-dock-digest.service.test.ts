import { Logger } from '@nestjs/common';
import { NotificationType, Permission } from '@bookorbit/types';

import { BookDockDigestService, DIGEST_MAX_WAIT_MS, DIGEST_QUIET_MS } from './book-dock-digest.service';

const MINUTE = 60_000;

function makeService() {
  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
  const docks = [{ id: 11, libraryId: 4, libraryName: 'Fiction' }];
  const dockRegistry = { findById: vi.fn((id: number) => Promise.resolve(docks.find((dock) => dock.id === id))) };
  const service = new BookDockDigestService(notificationService as never, dockRegistry as never);
  return { service, notificationService };
}

let nextId = 1;
const file = (dockId: number | null, uploadedBy: number | null = null) => ({ id: nextId, fileName: `book-${nextId++}.epub`, dockId, uploadedBy });

describe('BookDockDigestService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('waits until the dock has been quiet for five minutes, then says what was filed and what waits', async () => {
    const { service, notificationService } = makeService();
    for (let index = 0; index < 3; index++) service.recordFiled(file(11), 100 + index);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    service.recordHeld(file(11));
    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS - 1);
    expect(notificationService.notify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(notificationService.notify).toHaveBeenCalledExactlyOnceWith({
      type: NotificationType.BookDockDigestNeedsReview,
      title: 'Library Dock: Fiction',
      message: '3 books filed, 1 needs review.',
      actionUrl: '/book-dock',
      scope: { kind: 'permission', permission: Permission.ManageBookDock },
      meta: { dockId: 11, libraryId: 4, libraryName: 'Fiction', filed: 3, held: 1 },
    });
  });

  it('tells about a single filed book by name, as before', async () => {
    const { service, notificationService } = makeService();
    const row = file(11, 5);
    service.recordFiled(row, 77);

    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);

    expect(notificationService.notify).toHaveBeenCalledExactlyOnceWith({
      type: NotificationType.BookDockFinalized,
      title: 'Book auto-finalized',
      message: `"${row.fileName}" was added to your library`,
      scope: { kind: 'user', userId: 5 },
      meta: { fileId: row.id, bookId: 77 },
    });
  });

  it('reports a dock where everything filed as a success, and one where nothing did as needing review', async () => {
    const { service, notificationService } = makeService();
    service.recordFiled(file(null), 1);
    service.recordFiled(file(null), 2);
    service.recordHeld(file(11));

    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BookDockDigest,
        title: 'Library Dock: Unsorted',
        message: '2 books filed.',
        meta: { dockId: null, libraryId: null, libraryName: null, filed: 2, held: 0 },
      }),
    );
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.BookDockDigestNeedsReview, message: '1 book needs review.' }),
    );
  });

  it('sends each uploader their own digest and the managers one for files dropped on disk', async () => {
    const { service, notificationService } = makeService();
    for (let index = 0; index < 480; index++) service.recordFiled(file(11), index);
    for (let index = 0; index < 20; index++) service.recordHeld(file(11));
    service.recordFiled(file(11, 5), 900);
    service.recordFiled(file(11, 5), 901);
    service.recordHeld(file(11, 6));

    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);

    const sent = notificationService.notify.mock.calls.map(([payload]) => [payload.scope, payload.meta]);
    expect(sent).toHaveLength(3);
    expect(sent).toContainEqual([{ kind: 'permission', permission: Permission.ManageBookDock }, expect.objectContaining({ filed: 480, held: 20 })]);
    expect(sent).toContainEqual([{ kind: 'user', userId: 5 }, expect.objectContaining({ filed: 2, held: 0 })]);
    expect(sent).toContainEqual([{ kind: 'user', userId: 6 }, expect.objectContaining({ filed: 0, held: 1 })]);
  });

  it('does not let a dock that never goes quiet hold its digest for more than an hour', async () => {
    const { service, notificationService } = makeService();
    for (let elapsed = 0; elapsed < DIGEST_MAX_WAIT_MS + 10 * MINUTE; elapsed += 4 * MINUTE) {
      service.recordFiled(file(11), elapsed);
      await vi.advanceTimersByTimeAsync(4 * MINUTE);
    }

    expect(notificationService.notify).toHaveBeenCalledTimes(1);
    expect(notificationService.notify.mock.calls[0][0].meta).toMatchObject({ filed: DIGEST_MAX_WAIT_MS / (4 * MINUTE) });
  });

  it('starts counting again after a digest is sent', async () => {
    const { service, notificationService } = makeService();
    service.recordHeld(file(11));
    service.recordHeld(file(11));
    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);
    service.recordHeld(file(11));
    service.recordHeld(file(11));
    service.recordHeld(file(11));
    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);

    expect(notificationService.notify.mock.calls.map(([payload]) => payload.meta.held)).toEqual([2, 3]);
  });

  it('logs a digest it could not send and keeps going', async () => {
    const { service, notificationService } = makeService();
    notificationService.notify.mockRejectedValueOnce(new Error('database down'));
    service.recordHeld(file(11));
    service.recordHeld(file(11));

    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);
    service.recordHeld(file(11));
    service.recordHeld(file(11));
    await vi.advanceTimersByTimeAsync(DIGEST_QUIET_MS);

    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('[book_dock.digest] [fail]'));
    expect(notificationService.notify).toHaveBeenCalledTimes(2);
  });

  it('drops what it counted on shutdown, sending nothing', async () => {
    const { service, notificationService } = makeService();
    service.recordHeld(file(11));
    service.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(DIGEST_MAX_WAIT_MS);

    expect(notificationService.notify).not.toHaveBeenCalled();
  });
});
