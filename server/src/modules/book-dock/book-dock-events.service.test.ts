import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

import { BOOK_DOCK_FILE_INGESTED, BookDockEventsService } from './book-dock-events.service';

describe('BookDockEventsService', () => {
  it('is an EventEmitter and exposes the ingestion event name', () => {
    const events = new BookDockEventsService();

    expect(events).toBeInstanceOf(EventEmitter);
    expect(BOOK_DOCK_FILE_INGESTED).toBe('book-dock.file.ingested');
  });

  it('emits and receives book-dock ingestion events', () => {
    const events = new BookDockEventsService();
    const listener = vi.fn();
    events.on(BOOK_DOCK_FILE_INGESTED, listener);

    events.emit(BOOK_DOCK_FILE_INGESTED, 42);

    expect(listener).toHaveBeenCalledWith(42);
  });
});

describe('BookDockEventsService owned file exits', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const owned = (id: number) => ({ id, autoFinalizeSuppressed: true });
  const unowned = (id: number) => ({ id, autoFinalizeSuppressed: false });

  it('asks the owning module about its own files only, and passes each exit on', async () => {
    const events = new BookDockEventsService();
    const report = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn().mockResolvedValue(report);
    events.onOwnedFileExit(handler);

    const reportExit = await events.beforeOwnedFilesExit([unowned(1), owned(2), owned(3)]);
    await reportExit(2, { kind: 'filed', bookId: 40 });
    await reportExit(3, { kind: 'discarded' });

    expect(handler).toHaveBeenCalledExactlyOnceWith([2, 3]);
    expect(report.mock.calls).toEqual([
      [2, { kind: 'filed', bookId: 40 }],
      [3, { kind: 'discarded' }],
    ]);
  });

  it('never reaches a handler when no file in the batch is owned', async () => {
    const events = new BookDockEventsService();
    const handler = vi.fn();
    events.onOwnedFileExit(handler);

    const reportExit = await events.beforeOwnedFilesExit([unowned(1), unowned(2)]);
    await reportExit(1, { kind: 'discarded' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when no module listens', async () => {
    const events = new BookDockEventsService();

    const reportExit = await events.beforeOwnedFilesExit([owned(1)]);

    await expect(reportExit(1, { kind: 'discarded' })).resolves.toBeUndefined();
  });

  /** The person's file or discard goes ahead either way; the owner keeps what it had. */
  it('logs a handler that fails to prepare instead of failing the dock action', async () => {
    const events = new BookDockEventsService();
    const working = vi.fn().mockResolvedValue(undefined);
    events.onOwnedFileExit(() => Promise.reject(new Error('database unavailable')));
    events.onOwnedFileExit(() => Promise.resolve(working));

    const reportExit = await events.beforeOwnedFilesExit([owned(5)]);
    await reportExit(5, { kind: 'discarded' });

    expect(working).toHaveBeenCalledExactlyOnceWith(5, { kind: 'discarded' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[book_dock.owned_exit] [fail] stage=prepare files=1'));
  });

  it('logs a report that fails instead of throwing it into the dock action', async () => {
    const events = new BookDockEventsService();
    events.onOwnedFileExit(() => Promise.resolve(() => Promise.reject(new Error('notification failed'))));

    const reportExit = await events.beforeOwnedFilesExit([owned(5)]);

    await expect(reportExit(5, { kind: 'filed', bookId: 9 })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[book_dock.owned_exit] [fail] stage=report fileId=5 exit=filed'));
  });
});
