import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';

describe('AuthorEnrichmentSessionService', () => {
  it('tracks successful and failed terminal outcomes separately', () => {
    const session = new AuthorEnrichmentSessionService();

    session.addToTotal(3);
    session.setCurrentItemName('Author Name');
    session.incrementDone();
    session.incrementDone(true);

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 3,
      sessionDone: 2,
      sessionFailed: 1,
      currentItemName: 'Author Name',
    });
  });

  it('ignores terminal outcomes without a visible session and caps completed work at the total', () => {
    const session = new AuthorEnrichmentSessionService();

    session.incrementDone(true);
    session.addToTotal(1);
    session.incrementDone();
    session.incrementDone(true);

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 1,
      sessionDone: 1,
      sessionFailed: 0,
      currentItemName: null,
    });
  });

  it('extends an incomplete session and starts fresh after a completed session', () => {
    const session = new AuthorEnrichmentSessionService();

    session.addToTotal(2);
    session.incrementDone(true);
    session.addToTotal(3);
    expect(session.getSnapshot()).toMatchObject({ sessionTotal: 5, sessionDone: 1, sessionFailed: 1 });

    for (let index = 0; index < 4; index += 1) session.incrementDone();
    session.addToTotal(2);

    expect(session.getSnapshot()).toEqual({
      sessionTotal: 2,
      sessionDone: 0,
      sessionFailed: 0,
      currentItemName: null,
    });
  });

  it('resets only when the expected revision is still current', () => {
    const session = new AuthorEnrichmentSessionService();
    session.addToTotal(1);
    const revision = session.getRevision();

    session.setCurrentItemName('New work');

    expect(session.resetIfRevision(revision)).toBe(false);
    expect(session.getSnapshot().sessionTotal).toBe(1);
    expect(session.resetIfRevision(session.getRevision())).toBe(true);
    expect(session.getSnapshot()).toEqual({
      sessionTotal: 0,
      sessionDone: 0,
      sessionFailed: 0,
      currentItemName: null,
    });
  });
});
