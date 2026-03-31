import { HealthRepository } from './health.repository';

describe('HealthRepository', () => {
  it('runs a ping query against the database', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };
    const repository = new HealthRepository(db as never);

    await repository.pingDatabase();

    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates database query errors', async () => {
    const dbError = new Error('connection lost');
    const db = { execute: vi.fn().mockRejectedValue(dbError) };
    const repository = new HealthRepository(db as never);

    await expect(repository.pingDatabase()).rejects.toThrow(dbError);
  });
});
