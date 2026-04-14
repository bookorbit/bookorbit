import { OidcStateService } from './oidc-state.service';

const mockConfig = { get: vi.fn().mockReturnValue(undefined) };

function makeDb(overrides: Partial<ReturnType<typeof makeDb>> = {}) {
  const deleteMock = vi.fn().mockReturnThis();
  const db = {
    delete: vi.fn().mockReturnValue({ where: deleteMock }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
  return { db, deleteMock };
}

describe('OidcStateService', () => {
  describe('generate', () => {
    it('returns a non-empty base64url string', async () => {
      const { db } = makeDb();
      db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      const service = new OidcStateService(db as never, mockConfig as never);

      const state = await service.generate(1);
      expect(typeof state).toBe('string');
      expect(state.length).toBeGreaterThan(0);
      expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('returns unique values on each call', async () => {
      const { db } = makeDb();
      db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      const service = new OidcStateService(db as never, mockConfig as never);

      const a = await service.generate(1);
      const b = await service.generate(1);
      expect(a).not.toBe(b);
    });

    it('inserts state with meta=null when no meta passed', async () => {
      const valuesMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = {
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: insertMock,
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      const state = await service.generate(1);

      expect(insertMock).toHaveBeenCalledOnce();
      const [[{ state: insertedState, providerId, meta }]] = valuesMock.mock.calls;
      expect(insertedState).toBe(state);
      expect(providerId).toBe(1);
      expect(meta).toBeNull();
    });

    it('inserts state with serialized meta when meta passed', async () => {
      const valuesMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = {
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: insertMock,
      };
      const service = new OidcStateService(db as never, mockConfig as never);
      const metaPayload = { mode: 'link', userId: 42 };

      await service.generate(1, metaPayload);

      const [[{ meta }]] = valuesMock.mock.calls;
      expect(JSON.parse(meta as string)).toEqual(metaPayload);
    });

    it('inserts state into the database with an expiry', async () => {
      const valuesMock = vi.fn().mockResolvedValue(undefined);
      const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
      const db = {
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        insert: insertMock,
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      const before = Date.now();
      const state = await service.generate(1);
      const after = Date.now();

      const [[{ state: insertedState, expiresAt }]] = valuesMock.mock.calls;
      expect(insertedState).toBe(state);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 20 * 60 * 1000);
    });

    it('prunes expired states on each generate call', async () => {
      const whereMock = vi.fn().mockResolvedValue(undefined);
      const db = {
        delete: vi.fn().mockReturnValue({ where: whereMock }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      await service.generate(1);

      expect(db.delete).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
    });
  });

  describe('validateAndConsume', () => {
    it('returns { valid: true } when delete removes a row (valid state, no meta)', async () => {
      const db = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ state: 'valid-state', providerId: 1, meta: null }]),
          }),
        }),
        insert: vi.fn(),
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      const result = await service.validateAndConsume('valid-state');
      expect(result.valid).toBe(true);
      expect(result.providerId).toBe(1);
      expect(result.meta).toBeUndefined();
    });

    it('returns { valid: true, meta } when row has serialized meta', async () => {
      const metaPayload = { mode: 'link', userId: 99 };
      const db = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ state: 'valid-state', providerId: 1, meta: JSON.stringify(metaPayload) }]),
          }),
        }),
        insert: vi.fn(),
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      const result = await service.validateAndConsume('valid-state');
      expect(result.valid).toBe(true);
      expect(result.meta).toEqual(metaPayload);
    });

    it('returns { valid: false } when delete removes nothing (expired or unknown state)', async () => {
      const db = {
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
        insert: vi.fn(),
      };
      const service = new OidcStateService(db as never, mockConfig as never);

      const result = await service.validateAndConsume('unknown-state');
      expect(result.valid).toBe(false);
    });

    it('uses DELETE...RETURNING for atomic one-time consumption', async () => {
      const returningMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const deleteMock = vi.fn().mockReturnValue({ where: whereMock });
      const db = { delete: deleteMock, insert: vi.fn() };
      const service = new OidcStateService(db as never, mockConfig as never);

      await service.validateAndConsume('some-state');

      expect(deleteMock).toHaveBeenCalledOnce();
      expect(whereMock).toHaveBeenCalledOnce();
      expect(returningMock).toHaveBeenCalledOnce();
    });
  });
});
