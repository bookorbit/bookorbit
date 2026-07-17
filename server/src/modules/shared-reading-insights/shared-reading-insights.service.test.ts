import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { SharedReadingInsightsService } from './shared-reading-insights.service';

function makeUser() {
  return { id: 5, username: 'viewer', isSuperuser: false, permissions: [], settings: {} } as never;
}

function summaryData() {
  return {
    daily: [{ day: '2026-07-01', readingSeconds: 3600, sessionsCount: 2 }],
    status: { booksStarted: 3, booksCompleted: 1 },
    formats: [{ name: 'EPUB', readingSeconds: 1800 }],
    genres: [{ name: 'History', readingSeconds: 1800 }],
    sources: [{ source: 'web', readingSeconds: 3600, sessionsCount: 2 }],
  };
}

describe('SharedReadingInsightsService', () => {
  it('defaults missing consent data to private', async () => {
    const repository = { getSharingSettings: vi.fn().mockResolvedValue({ id: 1 }) };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getMySettings(1)).resolves.toEqual({ sharingLevel: 'private', consentedAt: null });
  });

  it('throws when current-user settings cannot find the account', async () => {
    const repository = { getSharingSettings: vi.fn().mockResolvedValue(undefined) };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getMySettings(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only the current user setting and records the consent change', async () => {
    const repository = {
      updateSharingSettings: vi.fn().mockResolvedValue({ sharingLevel: 'summary', consentedAt: new Date('2026-07-01T00:00:00Z') }),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new SharedReadingInsightsService(repository as never, audit as never);

    const result = await service.updateMySettings(makeUser(), 'summary');

    expect(result).toEqual({ sharingLevel: 'summary', consentedAt: '2026-07-01T00:00:00.000Z' });
    expect(repository.updateSharingSettings).toHaveBeenCalledWith(5, 'summary', expect.any(Date));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 5, meta: { sharingLevel: 'summary' } }));
  });

  it('withdraws consent with a null timestamp and rejects missing update targets', async () => {
    const repository = { updateSharingSettings: vi.fn().mockResolvedValueOnce({ sharingLevel: 'private', consentedAt: null }) };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new SharedReadingInsightsService(repository as never, audit as never);

    await expect(service.updateMySettings(makeUser(), 'private')).resolves.toEqual({ sharingLevel: 'private', consentedAt: null });
    expect(repository.updateSharingSettings).toHaveBeenCalledWith(5, 'private', null);
    await expect(service.updateMySettings(makeUser(), 'private')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not create a view session for a private profile, including for privileged viewers', async () => {
    const repository = { getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'private' }) };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.createViewSession(makeUser(), 9)).rejects.toMatchObject({ response: { errorCode: 'READING_INSIGHTS_PRIVATE' } });
  });

  it('does not create a view session for an account that no longer exists', async () => {
    const repository = { getSharingSettings: vi.fn().mockResolvedValue(undefined) };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.createViewSession(makeUser(), 404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates one audited view session without reading content in audit metadata', async () => {
    const repository = {
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'detailed' }),
      createViewSession: vi.fn().mockResolvedValue(undefined),
    };
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const service = new SharedReadingInsightsService(repository as never, audit as never);

    const result = await service.createViewSession(makeUser(), 9);

    expect(result).toMatchObject({ sharingLevel: 'detailed', viewSessionId: expect.any(String), expiresAt: expect.any(String) });
    const payload = audit.record.mock.calls[0][0];
    expect(payload.meta).toEqual({ subjectUserId: 9, sharingLevel: 'detailed', viewSessionId: result.viewSessionId });
    expect(JSON.stringify(payload.meta)).not.toContain('book');
  });

  it('returns summary-only data without title-level fields', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'summary' }),
      getSummary: vi.fn().mockResolvedValue(summaryData()),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    const result = await service.getSharedSummary(makeUser(), 9, 'session', 90);

    expect(result).toMatchObject({ sharingLevel: 'summary', readingSeconds: 3600, activeDays: 1 });
    expect(result).not.toHaveProperty('topBooks');
    expect(JSON.stringify(result)).not.toContain('bookTitle');
  });

  it('blocks detailed data after consent is downgraded', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'detailed' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'summary' }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getSharedDetail(makeUser(), 9, 'session', 90)).rejects.toMatchObject({
      response: { errorCode: 'READING_INSIGHTS_SUMMARY_ONLY' },
    });
  });

  it('requires a new audited session after consent is upgraded', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'summary' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'detailed' }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getSharedDetail(makeUser(), 9, 'session', 90)).rejects.toMatchObject({
      response: { errorCode: 'READING_INSIGHTS_SUMMARY_ONLY' },
    });
  });

  it('blocks every request immediately after consent is withdrawn', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'detailed' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'private' }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getSharedSummary(makeUser(), 9, 'session', 90)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('normalizes aggregate timestamps in detailed book results', async () => {
    const book = { bookId: 1, title: 'Book', readingSeconds: 60, lastReadAt: '2026-07-01T00:00:00.000Z', status: 'reading' };
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'detailed' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'detailed' }),
      getDetail: vi.fn().mockResolvedValue({
        topBooks: [book],
        recentBooks: [book],
        topAuthors: [],
        topGenres: [],
        topSeries: [],
        topNarrators: [],
      }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    const result = await service.getSharedDetail(makeUser(), 9, 'session', 90);

    expect(result.topBooks[0].lastReadAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('normalizes database Date values in detailed book results', async () => {
    const book = { bookId: 1, title: 'Book', readingSeconds: 60, lastReadAt: new Date('2026-07-01T00:00:00.000Z'), status: 'reading' };
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'detailed' }),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'detailed' }),
      getDetail: vi.fn().mockResolvedValue({
        topBooks: [book],
        recentBooks: [],
        topAuthors: [],
        topGenres: [],
        topSeries: [],
        topNarrators: [],
      }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    const result = await service.getSharedDetail(makeUser(), 9, 'session', 90);

    expect(result.topBooks[0].lastReadAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('returns only the current user profile access history', async () => {
    const audit = {
      getReadingInsightsAccess: vi.fn().mockResolvedValue({
        items: [{ id: 1, viewerUsername: 'admin', meta: { sharingLevel: 'detailed' }, viewedAt: new Date('2026-07-01T00:00:00Z') }],
        total: 1,
      }),
    };
    const service = new SharedReadingInsightsService({} as never, audit as never);

    const result = await service.getMyAccessHistory(9, 1, 20);

    expect(audit.getReadingInsightsAccess).toHaveBeenCalledWith(9, 1, 20);
    expect(result.items[0]).toEqual({ id: 1, viewerUsername: 'admin', sharingLevel: 'detailed', viewedAt: '2026-07-01T00:00:00.000Z' });
  });

  it('builds private, summary, and detailed self previews without creating audit sessions', async () => {
    const repository = {
      getSharingSettings: vi
        .fn()
        .mockResolvedValueOnce({ readingInsightsSharingLevel: 'private', readingInsightsConsentedAt: null })
        .mockResolvedValueOnce({ readingInsightsSharingLevel: 'summary', readingInsightsConsentedAt: new Date() })
        .mockResolvedValueOnce({ readingInsightsSharingLevel: 'detailed', readingInsightsConsentedAt: new Date() }),
      getSummary: vi.fn().mockResolvedValue(summaryData()),
      getDetail: vi.fn().mockResolvedValue({
        topBooks: [],
        recentBooks: [],
        topAuthors: [],
        topGenres: [],
        topSeries: [],
        topNarrators: [],
      }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getMyPreview(5, 90)).resolves.toEqual({ sharingLevel: 'private', consentedAt: null });
    await expect(service.getMyPreview(5, 90)).resolves.toMatchObject({ sharingLevel: 'summary', periodDays: 90 });
    await expect(service.getMyPreview(5, 90)).resolves.toMatchObject({
      summary: { sharingLevel: 'detailed' },
      detail: { sharingLevel: 'detailed' },
    });
  });

  it('rejects missing and invalid view sessions with stable error codes', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue(undefined),
      getSharingSettings: vi.fn().mockResolvedValue({ readingInsightsSharingLevel: 'summary' }),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getSharedSummary(makeUser(), 9, undefined, 90)).rejects.toMatchObject({
      response: { errorCode: 'READING_INSIGHTS_VIEW_SESSION_REQUIRED' },
    });
    await expect(service.getSharedSummary(makeUser(), 9, 'invalid', 90)).rejects.toMatchObject({
      response: { errorCode: 'READING_INSIGHTS_VIEW_SESSION_INVALID' },
    });
  });

  it('blocks a valid session when the subject account was deleted', async () => {
    const repository = {
      getViewSession: vi.fn().mockResolvedValue({ id: 'session', sharingLevel: 'summary' }),
      getSharingSettings: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SharedReadingInsightsService(repository as never, {} as never);

    await expect(service.getSharedSummary(makeUser(), 9, 'session', 90)).rejects.toMatchObject({
      response: { errorCode: 'READING_INSIGHTS_PRIVATE' },
    });
  });

  it('normalizes missing access-history metadata to summary access', async () => {
    const audit = {
      getReadingInsightsAccess: vi.fn().mockResolvedValue({
        items: [{ id: 1, viewerUsername: 'admin', meta: null, viewedAt: new Date('2026-07-01T00:00:00Z') }],
        total: 1,
      }),
    };
    const service = new SharedReadingInsightsService({} as never, audit as never);

    const result = await service.getMyAccessHistory(9, 1, 20);

    expect(result.items[0].sharingLevel).toBe('summary');
  });
});
