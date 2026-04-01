import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

describe('BookMetadataFetchSessionService', () => {
  it('tracks totals and current item safely', () => {
    const session = new BookMetadataFetchSessionService();

    session.addToTotal(3);
    session.setCurrentItemName('My Book');
    session.incrementDone();

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 3,
      sessionDone: 1,
      currentItemName: 'My Book',
    });
  });

  it('does not let done exceed total and ignores non-positive total increments', () => {
    const session = new BookMetadataFetchSessionService();

    session.addToTotal(0);
    session.addToTotal(-10);
    session.incrementDone();
    session.addToTotal(1);
    session.incrementDone();
    session.incrementDone();

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 1,
      sessionDone: 1,
      currentItemName: null,
    });
  });

  it('resets all state', () => {
    const session = new BookMetadataFetchSessionService();
    session.addToTotal(2);
    session.incrementDone();
    session.setCurrentItemName('Current');

    session.reset();

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 0,
      sessionDone: 0,
      currentItemName: null,
    });
  });
});
