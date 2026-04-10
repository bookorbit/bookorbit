import { METADATA_AUTHORS_REPLACED, MetadataEventsService } from './metadata-events.service';

describe('MetadataEventsService', () => {
  it('emits author replacement events to subscribers', () => {
    const events = new MetadataEventsService();
    const listener = vi.fn();
    events.on(METADATA_AUTHORS_REPLACED, listener);

    events.emit(METADATA_AUTHORS_REPLACED, { bookId: 10, authorIds: [2, 3] });

    expect(listener).toHaveBeenCalledWith({ bookId: 10, authorIds: [2, 3] });
  });
});
