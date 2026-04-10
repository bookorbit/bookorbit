import { EventEmitter } from 'events';

import { BOOK_BUCKET_FILE_INGESTED, BookBucketEventsService } from './book-bucket-events.service';

describe('BookBucketEventsService', () => {
  it('is an EventEmitter and exposes the ingestion event name', () => {
    const events = new BookBucketEventsService();

    expect(events).toBeInstanceOf(EventEmitter);
    expect(BOOK_BUCKET_FILE_INGESTED).toBe('book-bucket.file.ingested');
  });

  it('emits and receives book-bucket ingestion events', () => {
    const events = new BookBucketEventsService();
    const listener = vi.fn();
    events.on(BOOK_BUCKET_FILE_INGESTED, listener);

    events.emit(BOOK_BUCKET_FILE_INGESTED, 42);

    expect(listener).toHaveBeenCalledWith(42);
  });
});
