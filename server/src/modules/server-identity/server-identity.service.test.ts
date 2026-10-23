import { ServerIdentityRepository } from './server-identity.repository';
import { ServerIdentityService } from './server-identity.service';

describe('ServerIdentityService', () => {
  it('shares the durable identity across concurrent requests', async () => {
    const getOrCreate = vi.fn().mockResolvedValue('538a27ca-87ef-47bc-a195-13c8597c3529');
    const service = new ServerIdentityService({ getOrCreate } as unknown as ServerIdentityRepository);
    const [first, second] = await Promise.all([service.getIdentity(), service.getIdentity()]);
    expect(first).toEqual({ product: 'bookorbit', protocolVersion: 1, instanceId: '538a27ca-87ef-47bc-a195-13c8597c3529' });
    expect(second).toEqual(first);
    expect(getOrCreate).toHaveBeenCalledOnce();
  });

  it('retries after a failed database read', async () => {
    const getOrCreate = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue('restored');
    const service = new ServerIdentityService({ getOrCreate } as unknown as ServerIdentityRepository);
    await expect(service.getIdentity()).rejects.toThrow('unavailable');
    expect((await service.getIdentity()).instanceId).toBe('restored');
    expect(getOrCreate).toHaveBeenCalledTimes(2);
  });
});
