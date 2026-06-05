import { KoboBookIdentityService } from './kobo-book-identity.service';

type QueueState = {
  select: unknown[];
  insert: unknown[];
  update: unknown[];
};

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    set: vi.fn(),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
    catch: (onRejected: (error: unknown) => unknown) => Promise.resolve(result).catch(onRejected),
  };

  for (const key of ['from', 'where', 'limit', 'values', 'onConflictDoNothing', 'set']) {
    (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }

  return chain;
}

function makeDb(state?: Partial<QueueState>) {
  const queue: QueueState = {
    select: [...(state?.select ?? [])],
    insert: [...(state?.insert ?? [])],
    update: [...(state?.update ?? [])],
  };

  return {
    select: vi.fn(() => makeChain(queue.select.shift() ?? [])),
    insert: vi.fn(() => makeChain(queue.insert.shift() ?? [])),
    update: vi.fn(() => makeChain(queue.update.shift() ?? [])),
  };
}

describe('KoboBookIdentityService', () => {
  const identity = {
    bookId: 12,
    entitlementId: '11111111-1111-4111-8111-111111111111',
    coverImageId: '22222222-2222-4222-8222-222222222222',
    needsLegacyNumericRemoval: true,
  };

  it('returns existing identities without inserting', async () => {
    const db = makeDb({ select: [[identity]] });
    const service = new KoboBookIdentityService(db as never);

    await expect(service.ensureForBooks(5, [12, 12], true)).resolves.toEqual(new Map([[12, identity]]));

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('creates missing identities with the requested legacy-removal flag', async () => {
    const db = makeDb({ select: [[], [identity]] });
    const service = new KoboBookIdentityService(db as never);

    const result = await service.ensureForBooks(5, [12], true);

    expect(result.get(12)).toEqual(identity);
    const insertChain = db.insert.mock.results[0].value as { values: ReturnType<typeof vi.fn> };
    expect(insertChain.values).toHaveBeenCalledWith([{ userId: 5, bookId: 12, needsLegacyNumericRemoval: true }]);
  });

  it('resolves entitlement ids from UUID mapping and legacy numeric ids', async () => {
    const db = makeDb({ select: [[{ bookId: 12 }]] });
    const service = new KoboBookIdentityService(db as never);

    await expect(service.resolveBookIdByEntitlementId(5, identity.entitlementId)).resolves.toBe(12);
    await expect(service.resolveBookIdByEntitlementId(5, '420')).resolves.toBe(420);
    await expect(service.resolveBookIdByEntitlementId(5, 'not-a-kobo-id')).resolves.toBeNull();
  });

  it('resolves cover image ids from UUID mapping, versioned UUIDs, and legacy compound ids', async () => {
    const db = makeDb({ select: [[{ bookId: 12 }], [{ bookId: 12 }]] });
    const service = new KoboBookIdentityService(db as never);

    await expect(service.resolveBookIdByCoverImageId(5, identity.coverImageId)).resolves.toBe(12);
    await expect(service.resolveBookIdByCoverImageId(5, `${identity.coverImageId}_1778450221186`)).resolves.toBe(12);
    await expect(service.resolveBookIdByCoverImageId(5, '420-1778450221186')).resolves.toBe(420);
    await expect(service.resolveBookIdByCoverImageId(5, 'not-a-cover-id')).resolves.toBeNull();
  });

  it('marks legacy numeric removal complete only when book ids are provided', async () => {
    const db = makeDb();
    const service = new KoboBookIdentityService(db as never);

    await service.markLegacyNumericRemovalComplete(5, []);
    expect(db.update).not.toHaveBeenCalled();

    await service.markLegacyNumericRemovalComplete(5, [12, 12, 13]);
    expect(db.update).toHaveBeenCalledTimes(1);
    const updateChain = db.update.mock.results[0].value as { set: ReturnType<typeof vi.fn> };
    expect(updateChain.set).toHaveBeenCalledWith({ needsLegacyNumericRemoval: false });
  });

  it('builds stable and versioned cover image ids', () => {
    const service = new KoboBookIdentityService(makeDb() as never);

    expect(service.buildVersionedCoverImageId(identity.coverImageId, null)).toBe(identity.coverImageId);
    expect(service.buildVersionedCoverImageId(identity.coverImageId, new Date('2026-01-01T00:00:00.000Z'))).toBe(
      `${identity.coverImageId}_1767225600000`,
    );
  });
});
