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
