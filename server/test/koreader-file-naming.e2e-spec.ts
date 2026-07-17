import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { Permission } from '@bookorbit/types';
import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createUserAndLogin,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

describe('KOReader file naming (e2e)', () => {
  let ctx: AuthorizationMatrixE2EContext;
  let owner: TestUserSession;
  let otherUser: TestUserSession;
  let unauthorizedUser: TestUserSession;

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    owner = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    otherUser = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    unauthorizedUser = await createUserAndLogin(ctx);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('persists account defaults independently for each authenticated user', async () => {
    await expectStatus(putAccountPattern(owner, 'Owner/{title}'), 200);
    await expectStatus(putAccountPattern(otherUser, 'Other/{title}'), 200);

    const ownerResponse = await getAccountPattern(owner);
    const otherResponse = await getAccountPattern(otherUser);

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json()).toEqual({ pattern: 'Owner/{title}' });
    expect(otherResponse.statusCode).toBe(200);
    expect(otherResponse.json()).toEqual({ pattern: 'Other/{title}' });
  });

  it('returns a saved override for a swept device without progress rows', async () => {
    await ctx.db.insert(schema.koreaderDeviceSweeps).values({
      userId: owner.userId,
      deviceId: 'sweep-only-device',
      deviceModel: 'Kobo Libra 2',
      pluginVersion: '1.3.0',
      lastSweepAt: new Date('2026-07-14T00:00:00.000Z'),
    });

    await expectStatus(
      ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/koreader/devices/sweep-only-device/file-naming-pattern',
        headers: authHeader(owner.accessToken),
        payload: {
          pattern: 'Device/{title}',
          seriesPattern: 'Series/{series}/{title}',
          standalonePattern: '',
        },
      }),
      200,
    );

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/koreader/sync-status',
      headers: authHeader(owner.accessToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().devices).toEqual([]);
    expect(response.json().sweeps).toEqual([
      expect.objectContaining({
        deviceId: 'sweep-only-device',
        fileNamingPattern: 'Device/{title}',
        seriesFileNamingPattern: 'Series/{series}/{title}',
        standaloneFileNamingPattern: '',
      }),
    ]);
  });

  it('rejects invalid patterns, oversized device ids, and users without permission', async () => {
    await expectStatus(putAccountPattern(owner, '{title}\u0000bad'), 400);
    await expectStatus(putAccountPattern(unauthorizedUser, '{title}'), 403);
    await expectStatus(
      ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/koreader/devices/${'x'.repeat(101)}/file-naming-pattern`,
        headers: authHeader(owner.accessToken),
        payload: { pattern: '{title}', seriesPattern: '', standalonePattern: '' },
      }),
      414,
    );
  });

  function putAccountPattern(user: TestUserSession, pattern: string): Promise<InjectResponse> {
    return ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/file-naming-pattern',
      headers: authHeader(user.accessToken),
      payload: { pattern },
    });
  }

  function getAccountPattern(user: TestUserSession): Promise<InjectResponse> {
    return ctx.app.inject({
      method: 'GET',
      url: '/api/v1/koreader/file-naming-pattern',
      headers: authHeader(user.accessToken),
    });
  }

  async function expectStatus(responsePromise: Promise<InjectResponse>, expectedStatus: number): Promise<void> {
    const response = await responsePromise;
    expect(response.statusCode, response.body).toBe(expectedStatus);
  }
});
