import { OidcCleanupService } from './oidc-cleanup.service';

function makeDb() {
  const chain = {
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
  return {
    delete: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

describe('OidcCleanupService', () => {
  let service: OidcCleanupService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    db = makeDb();
    service = new OidcCleanupService(db as never);
  });

  it('deletes expired/revoked sessions, expired states, and expired JTIs in parallel', async () => {
    db._chain.returning
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // sessions
      .mockResolvedValueOnce([{ state: 'abc' }]) // states
      .mockResolvedValueOnce([]); // jtis

    await service.runCleanup();

    expect(db.delete).toHaveBeenCalledTimes(3);
  });

  it('logs deletion counts on success', async () => {
    db._chain.returning
      .mockResolvedValueOnce([{ id: 1 }])
      .mockResolvedValueOnce([{ state: 'xyz' }])
      .mockResolvedValueOnce([{ jti: 'jti-1' }, { jti: 'jti-2' }]);

    const logSpy = vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined);

    await service.runCleanup();

    const endLog = logSpy.mock.calls.find((args) => String(args[0]).includes('[end]'));
    expect(endLog).toBeTruthy();
    expect(String(endLog![0])).toMatch('deletedSessions=1');
    expect(String(endLog![0])).toMatch('deletedStates=1');
    expect(String(endLog![0])).toMatch('deletedJtis=2');
  });

  it('logs error and does not throw when cleanup fails', async () => {
    db._chain.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const errorSpy = vi.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    await expect(service.runCleanup()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching('[fail]'));
  });
});
