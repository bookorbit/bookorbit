import { NotFoundException } from '@nestjs/common';

import { AccountActivityService } from './account-activity.service';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    username: 'reader',
    name: 'Reader',
    email: 'reader@example.com',
    active: true,
    isSuperuser: false,
    provisioningMethod: 'local',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: new Date('2026-06-01T00:00:00.000Z'),
    lastAuthenticatedAt: new Date(),
    readingInsightsSharingLevel: 'private',
    ...overrides,
  };
}

describe('AccountActivityService', () => {
  it('maps paginated rows and resolves activity states', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        items: [
          makeRow(),
          makeRow({ id: 2, active: false }),
          makeRow({ id: 3, lastAuthenticatedAt: null, lastLoginAt: null }),
          makeRow({ id: 4, lastAuthenticatedAt: new Date('2020-01-01T00:00:00.000Z') }),
        ],
        total: 4,
      }),
      summary: vi.fn(),
      findById: vi.fn(),
    };
    const service = new AccountActivityService(repository as never);

    const result = await service.list({ page: 1, pageSize: 50, sortBy: 'lastAuthenticatedAt', sortDir: 'desc' });

    expect(result).toMatchObject({ total: 4, page: 1, pageSize: 50 });
    expect(result.items.map((item) => item.state)).toEqual(['recent', 'disabled', 'never', 'dormant']);
    expect(result.items[2].lastLoginAt).toBeNull();
    expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(repository.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50, recentCutoff: expect.any(Date) }));
  });

  it('returns summary counts from the repository', async () => {
    const summary = { recent: 4, dormant: 3, never: 2, disabled: 1 };
    const repository = { list: vi.fn(), summary: vi.fn().mockResolvedValue(summary), findById: vi.fn() };
    const service = new AccountActivityService(repository as never);

    await expect(service.getSummary()).resolves.toEqual(summary);
    expect(repository.summary).toHaveBeenCalledWith(expect.any(Date));
  });

  it('returns authentication-only account details', async () => {
    const repository = { list: vi.fn(), summary: vi.fn(), findById: vi.fn().mockResolvedValue(makeRow()) };
    const service = new AccountActivityService(repository as never);

    const result = await service.getDetail(1);

    expect(result).toMatchObject({ id: 1, email: 'reader@example.com', state: 'recent' });
    expect(result).not.toHaveProperty('books');
    expect(result).not.toHaveProperty('readingSessions');
  });

  it('throws when the account does not exist', async () => {
    const repository = { list: vi.fn(), summary: vi.fn(), findById: vi.fn().mockResolvedValue(undefined) };
    const service = new AccountActivityService(repository as never);

    await expect(service.getDetail(404)).rejects.toThrow(NotFoundException);
  });
});
