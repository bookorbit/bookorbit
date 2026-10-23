import { eq } from 'drizzle-orm';

import { serverIdentity } from '../src/db/schema';
import { ServerIdentityRepository } from '../src/modules/server-identity/server-identity.repository';
import { ServerIdentityService } from '../src/modules/server-identity/server-identity.service';
import { closeE2EContext, createE2EContext, type E2EContext } from './e2e/app-harness';

describe('Server connection identity', () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await createE2EContext({ isolateAppData: true });
  }, 60_000);

  afterAll(async () => {
    if (ctx) await closeE2EContext(ctx);
  });

  it('exposes a small public no-store response and the same identity through app-info', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/server-identity' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const identity = response.json();
    expect(identity).toEqual({ product: 'bookorbit', protocolVersion: 1, instanceId: expect.any(String) });
    expect(identity.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const info = await ctx.app.inject({ method: 'GET', url: '/api/v1/app-info', headers: { authorization: `Bearer ${ctx.adminToken}` } });
    expect(info.statusCode).toBe(200);
    expect(info.json().instanceId).toBe(identity.instanceId);
    expect(info.json().features).toContain('server-connection-identity');
  });

  it('concurrent replicas converge on the persisted singleton and restart keeps it', async () => {
    const repositories = Array.from({ length: 12 }, () => new ServerIdentityRepository(ctx.db));
    const identities = await Promise.all(repositories.map((repository) => repository.getOrCreate()));
    expect(new Set(identities).size).toBe(1);
    expect(identities[0]).toBeTruthy();
    const rows = await ctx.db.select().from(serverIdentity).where(eq(serverIdentity.id, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0].instanceId).toBe(identities[0]);
    const restarted = new ServerIdentityService(new ServerIdentityRepository(ctx.db));
    expect((await restarted.getIdentity()).instanceId).toBe(identities[0]);
  });
});
