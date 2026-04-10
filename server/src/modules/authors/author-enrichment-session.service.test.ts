import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';

describe('AuthorEnrichmentSessionService', () => {
  it('returns live snapshot values', () => {
    const session = new AuthorEnrichmentSessionService();

    session.sessionTotal = 5;
    session.sessionDone = 2;
    session.currentItemName = 'Author Name';

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 5,
      sessionDone: 2,
      currentItemName: 'Author Name',
    });
  });

  it('resets all session counters and current item', () => {
    const session = new AuthorEnrichmentSessionService();
    session.sessionTotal = 3;
    session.sessionDone = 1;
    session.currentItemName = 'Working';

    session.reset();

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 0,
      sessionDone: 0,
      currentItemName: null,
    });
  });
});
