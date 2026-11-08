import { createHash, randomUUID } from 'crypto';

import { hash } from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AuditAction, Permission, type ApiKeySummary, type CreatedApiKey } from '@bookorbit/types';
import { io } from 'socket.io-client';

import * as schema from '../src/db/schema';
import { generateApiKeyToken } from '../src/modules/api-key/api-key-token';
import { closeE2EContext, createE2EContext, waitForCondition, type E2EContext } from './e2e/app-harness';

type InjectOptions = Exclude<Parameters<NestFastifyApplication['inject']>[0], string | undefined>;

interface TestUser {
  id: number;
  username: string;
  token: string;
}

type KeyHeader = 'x-api-key' | 'bearer';

const PASSWORD = 'ApiKeyUser123';
let addressCounter = 0;

/** Each sign-in comes from its own address, so the login throttle never trips across the suite. */
function nextAddress(): string {
  addressCounter += 1;
  return `10.77.${Math.floor(addressCounter / 250)}.${(addressCounter % 250) + 1}`;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function keyHeaders(token: string, header: KeyHeader = 'x-api-key'): Record<string, string> {
  return header === 'bearer' ? bearer(token) : { 'x-api-key': token };
}

/** How the notification socket answered a handshake carrying this token. */
function socketOutcome(origin: string, token: string): Promise<'authenticated' | 'unauthorized' | 'connect_error' | 'timeout'> {
  return new Promise((resolve) => {
    const socket = io(`${origin}/notifications`, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    const finish = (outcome: 'authenticated' | 'unauthorized' | 'connect_error' | 'timeout') => {
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish('timeout'), 5_000);
    socket.on('notification:unread-count', () => finish('authenticated'));
    socket.on('unauthorized', () => finish('unauthorized'));
    socket.on('connect_error', () => finish('connect_error'));
  });
}

describe('API key authentication (e2e)', () => {
  let ctx: E2EContext;

  async function createUser(options: { permissions?: Permission[]; isSuperuser?: boolean; libraries?: number[] } = {}): Promise<TestUser> {
    const username = `key-user-${randomUUID().slice(0, 12)}`;
    const [user] = await ctx.db
      .insert(schema.users)
      .values({
        username,
        name: username,
        email: `${username}@example.com`,
        passwordHash: await hash(PASSWORD, 4),
        isDefaultPassword: false,
        isSuperuser: options.isSuperuser ?? false,
        provisioningMethod: 'local',
      })
      .returning({ id: schema.users.id });
    if (options.permissions?.length) {
      await ctx.db.insert(schema.userPermissions).values(options.permissions.map((permissionName) => ({ userId: user.id, permissionName })));
    }
    if (options.libraries?.length) {
      await ctx.db
        .insert(schema.userLibraryAccess)
        .values(options.libraries.map((libraryId) => ({ userId: user.id, libraryId, accessLevel: 'owner' as const })));
    }
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: PASSWORD },
      remoteAddress: nextAddress(),
    });
    expect(login.statusCode).toBe(200);
    return { id: user.id, username, token: (login.json() as { accessToken: string }).accessToken };
  }

  async function createLibrary(): Promise<number> {
    const [library] = await ctx.db
      .insert(schema.libraries)
      .values({ name: `key-library-${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.libraries.id });
    return library.id;
  }

  async function createKey(owner: TestUser, payload: Record<string, unknown>): Promise<CreatedApiKey> {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/api-keys', headers: bearer(owner.token), payload });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as CreatedApiKey;
  }

  function withKey(token: string, options: Omit<InjectOptions, 'headers'> & { header?: KeyHeader }) {
    const { header, ...rest } = options;
    return ctx.app.inject({ ...rest, headers: keyHeaders(token, header) } as InjectOptions);
  }

  async function setKeySettings(enabled: boolean, maxLifetimeDays: number | null) {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/app-settings/api-keys',
      headers: bearer(ctx.adminToken),
      payload: { enabled, maxLifetimeDays },
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  beforeAll(async () => {
    ctx = await createE2EContext();
  });

  afterAll(async () => {
    await closeE2EContext(ctx);
  });

  describe('lifecycle', () => {
    it('creates a key that is shown once, stored only as a hash, and accepted in either header', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const created = await createKey(owner, { name: 'Backup script' });

      expect(created.token).toMatch(/^bok_[0-9A-Za-z]{49}$/);
      expect(created.key).toMatchObject({ name: 'Backup script', access: 'read', admin: false, libraryIds: null, hint: created.token.slice(-4) });

      const [row] = await ctx.db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, created.key.id));
      expect(row.tokenHash).toBe(createHash('sha256').update(created.token).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(created.token);

      for (const header of ['x-api-key', 'bearer'] as const) {
        const me = await withKey(created.token, { method: 'GET', url: '/api/v1/auth/me', header });
        expect(me.statusCode).toBe(200);
        expect(me.json()).toMatchObject({ id: owner.id, authenticationMethod: 'api_key', isSuperuser: false });
      }

      const list = await ctx.app.inject({ method: 'GET', url: '/api/v1/api-keys', headers: bearer(owner.token) });
      expect((list.json() as ApiKeySummary[]).map((key) => key.id)).toEqual([created.key.id]);
      expect(list.body).not.toContain(created.token);
    });

    it('stops a revoked key at once, and a regenerated key replaces the old one with the same grant', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys, Permission.ViewAuditLog] });
      const first = await createKey(owner, { name: 'Rotating', access: 'write', permissions: [Permission.ViewAuditLog] });

      const regenerated = await ctx.app.inject({ method: 'POST', url: `/api/v1/api-keys/${first.key.id}/regenerate`, headers: bearer(owner.token) });
      expect(regenerated.statusCode).toBe(201);
      const second = regenerated.json() as CreatedApiKey;
      expect(second.key).toMatchObject({ name: 'Rotating', access: 'write', permissions: [Permission.ViewAuditLog] });
      expect((await withKey(first.token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
      expect((await withKey(second.token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(200);

      const revoked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/api-keys/${second.key.id}`, headers: bearer(owner.token) });
      expect(revoked.statusCode).toBe(204);
      expect((await withKey(second.token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    });

    it('caps how many keys can be active at once', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      for (let index = 0; index < 25; index++) await createKey(owner, { name: `Key ${index}` });

      const refused = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(owner.token),
        payload: { name: 'One too many' },
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ errorCode: 'API_KEY_LIMIT_REACHED' });

      const revokedAll = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/api-keys', headers: bearer(owner.token) });
      expect(revokedAll.json()).toEqual({ revoked: 25 });
      await createKey(owner, { name: 'Room again' });
    });
  });

  describe('how a key may be presented', () => {
    it('ignores a key in the query string and refuses credentials that disagree', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { token } = await createKey(owner, { name: 'Headers only' });

      const inQuery = await ctx.app.inject({ method: 'GET', url: `/api/v1/auth/me?api_key=${token}` });
      expect(inQuery.statusCode).toBe(401);

      const conflicting = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { 'x-api-key': token, authorization: `Bearer ${owner.token}` },
      });
      expect(conflicting.statusCode).toBe(401);
    });

    it('refuses a tampered or unknown key', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { token } = await createKey(owner, { name: 'Tamper target' });
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

      expect((await withKey(tampered, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
      expect((await withKey(generateApiKeyToken(), { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    });

    it('refuses a key once it has expired', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { key, token } = await createKey(owner, { name: 'Short lived', expiresInDays: 30 });
      expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(200);

      await ctx.db
        .update(schema.apiKeys)
        .set({ createdAt: new Date(Date.now() - 2 * 86_400_000), expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.apiKeys.id, key.id));
      expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    });

    it('slows down an address that keeps presenting bad keys', async () => {
      const remoteAddress = '10.99.0.1';
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 31; attempt++) {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { 'x-api-key': generateApiKeyToken() },
          remoteAddress,
        });
        statuses.push(response.statusCode);
      }
      expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
      expect(statuses[30]).toBe(429);
    });
  });

  describe('what a key may do', () => {
    it('lets a read key read, including read-only queries sent as POST, but never write', async () => {
      const libraryId = await createLibrary();
      const owner = await createUser({ permissions: [Permission.ApiKeys], libraries: [libraryId] });
      const { token } = await createKey(owner, { name: 'Reader', access: 'read' });

      expect((await withKey(token, { method: 'GET', url: '/api/v1/libraries' })).statusCode).toBe(200);
      const query = await withKey(token, {
        method: 'POST',
        url: `/api/v1/libraries/${libraryId}/books`,
        payload: { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 5 } },
      });
      expect(query.statusCode).toBe(201);

      const write = await withKey(token, { method: 'POST', url: '/api/v1/collections', payload: { name: 'Nope', icon: 'FolderOpen' } });
      expect(write.statusCode).toBe(403);
      expect(write.json()).toMatchObject({ errorCode: 'API_KEY_READ_ONLY' });
    });

    it('keeps account and key management out of reach of any key', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { token } = await createKey(owner, { name: 'Writer', access: 'write' });

      for (const request of [
        { method: 'POST', url: '/api/v1/api-keys', payload: { name: 'Child key' } },
        { method: 'GET', url: '/api/v1/api-keys' },
        { method: 'PATCH', url: '/api/v1/users/me', payload: { name: 'Renamed by a key' } },
        { method: 'GET', url: '/api/v1/auth/sessions' },
        { method: 'POST', url: '/api/v1/auth/change-password', payload: { currentPassword: PASSWORD, newPassword: 'Changed123456' } },
      ] as const) {
        const response = await withKey(token, request);
        expect(response.statusCode, `${request.method} ${request.url}`).toBe(403);
        expect(response.json()).toMatchObject({ errorCode: 'API_KEY_ROUTE_FORBIDDEN' });
      }
    });

    it('acts with only the permissions the key was granted, and never more than its owner holds', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys, Permission.ViewAuditLog] });
      const plain = await createKey(owner, { name: 'Plain' });
      const auditor = await createKey(owner, { name: 'Auditor', permissions: [Permission.ViewAuditLog] });

      expect((await withKey(plain.token, { method: 'GET', url: '/api/v1/audit-log' })).statusCode).toBe(403);
      expect((await withKey(auditor.token, { method: 'GET', url: '/api/v1/audit-log' })).statusCode).toBe(200);

      const beyondOwner = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(owner.token),
        payload: { name: 'Too much', permissions: [Permission.ManageUsers] },
      });
      expect(beyondOwner.statusCode).toBe(400);
      expect(beyondOwner.json()).toMatchObject({ errorCode: 'API_KEY_SCOPE_EXCEEDS_OWNER' });

      await ctx.db
        .delete(schema.userPermissions)
        .where(and(eq(schema.userPermissions.userId, owner.id), eq(schema.userPermissions.permissionName, Permission.ViewAuditLog)));
      expect((await withKey(auditor.token, { method: 'GET', url: '/api/v1/audit-log' })).statusCode).toBe(403);
    });

    it('limits a key to the libraries it was given', async () => {
      const [first, second] = [await createLibrary(), await createLibrary()];
      const owner = await createUser({ permissions: [Permission.ApiKeys], libraries: [first, second] });
      const { token } = await createKey(owner, { name: 'First only', libraryIds: [first] });

      const libraries = await withKey(token, { method: 'GET', url: '/api/v1/libraries' });
      expect((libraries.json() as Array<{ id: number }>).map((library) => library.id)).toEqual([first]);

      const outside = await withKey(token, {
        method: 'POST',
        url: `/api/v1/libraries/${second}/books`,
        payload: { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 5 } },
      });
      expect([403, 404]).toContain(outside.statusCode);

      const unreachable = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(owner.token),
        payload: { name: 'Not mine', libraryIds: [await createLibrary()] },
      });
      expect(unreachable.json()).toMatchObject({ errorCode: 'API_KEY_SCOPE_EXCEEDS_OWNER' });
    });

    it('gives administrator power only to a key that asks for it, and never with a library limit', async () => {
      const libraryId = await createLibrary();
      const admin = await createUser({ isSuperuser: true });
      const plain = await createKey(admin, { name: 'Admin, plain' });
      const powerful = await createKey(admin, { name: 'Admin, full', admin: true, access: 'write' });

      expect((await withKey(plain.token, { method: 'GET', url: '/api/v1/auth/me' })).json()).toMatchObject({ isSuperuser: false });
      expect((await withKey(plain.token, { method: 'GET', url: '/api/v1/audit-log' })).statusCode).toBe(403);
      for (const token of [plain.token, powerful.token]) {
        const libraries = (await withKey(token, { method: 'GET', url: '/api/v1/libraries' })).json() as Array<{ id: number }>;
        expect(libraries.map((library) => library.id)).toContain(libraryId);
      }
      expect((await withKey(powerful.token, { method: 'GET', url: '/api/v1/auth/me' })).json()).toMatchObject({ isSuperuser: true });
      expect((await withKey(powerful.token, { method: 'GET', url: '/api/v1/audit-log' })).statusCode).toBe(200);

      const limited = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/api-keys',
        headers: bearer(admin.token),
        payload: { name: 'Admin, limited', admin: true, libraryIds: [libraryId] },
      });
      expect(limited.statusCode).toBe(400);
      expect(limited.json()).toMatchObject({ errorCode: 'API_KEY_ADMIN_WITH_LIBRARIES' });
    });

    it("keeps the owner's restrictions whatever the key was granted", async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys, Permission.NotificationAccess, Permission.DemoRestricted] });
      const { token } = await createKey(owner, { name: 'Demo', permissions: [Permission.NotificationAccess] });

      const me = (await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).json() as { permissions: string[] };
      expect(me.permissions).toEqual(expect.arrayContaining([Permission.NotificationAccess, Permission.DemoRestricted]));
      expect((await withKey(token, { method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(403);
    });

    it('leaves a key limited to a deleted library seeing nothing, rather than every library', async () => {
      const [doomed, kept] = [await createLibrary(), await createLibrary()];
      const owner = await createUser({ permissions: [Permission.ApiKeys], libraries: [doomed, kept] });
      const { token } = await createKey(owner, { name: 'Doomed only', libraryIds: [doomed] });

      await ctx.db.delete(schema.libraries).where(eq(schema.libraries.id, doomed));

      const libraries = await withKey(token, { method: 'GET', url: '/api/v1/libraries' });
      expect(libraries.statusCode).toBe(200);
      expect(libraries.json()).toEqual([]);
      const outside = await withKey(token, {
        method: 'POST',
        url: `/api/v1/libraries/${kept}/books`,
        payload: { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 5 } },
      });
      expect([403, 404]).toContain(outside.statusCode);
    });

    it('records an action taken with a key against that key', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { key, token } = await createKey(owner, { name: 'Collector', access: 'write' });

      const created = await withKey(token, {
        method: 'POST',
        url: '/api/v1/collections',
        payload: { name: `Via key ${randomUUID()}`, icon: 'FolderOpen' },
      });
      expect(created.statusCode).toBe(201);
      const collectionId = (created.json() as { id: number }).id;

      const findEntry = async () => {
        const [entry] = await ctx.db
          .select()
          .from(schema.auditLog)
          .where(and(eq(schema.auditLog.action, AuditAction.CollectionCreate), eq(schema.auditLog.resourceId, collectionId)));
        return entry;
      };
      await waitForCondition(async () => {
        expect(await findEntry()).toBeDefined();
      }, 4_000);
      const entry = await findEntry();
      expect(entry).toMatchObject({ userId: owner.id, apiKeyId: key.id });
      expect(entry.meta).toMatchObject({ viaApiKey: 'Collector' });
    });
  });

  describe('sockets and usage tracking', () => {
    it('authenticates a socket handshake with a key and refuses it once the key is revoked', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys, Permission.NotificationAccess] });
      const { key, token } = await createKey(owner, { name: 'Socket', permissions: [Permission.NotificationAccess] });
      await ctx.app.listen(0, '127.0.0.1');
      const origin = await ctx.app.getUrl();

      expect(await socketOutcome(origin, token)).toBe('authenticated');

      await ctx.app.inject({ method: 'DELETE', url: `/api/v1/api-keys/${key.id}`, headers: bearer(owner.token) });
      expect(await socketOutcome(origin, token)).toBe('unauthorized');
    });

    it('records when and where a key was last used, at most once a minute', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { key, token } = await createKey(owner, { name: 'Tracked' });
      const lastUse = async () => {
        const [row] = await ctx.db
          .select({ at: schema.apiKeys.lastUsedAt, ip: schema.apiKeys.lastUsedIp })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, key.id));
        return row;
      };
      const use = (remoteAddress: string) =>
        ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { 'x-api-key': token }, remoteAddress });

      await use('10.88.0.1');
      await waitForCondition(async () => {
        expect(await lastUse()).toMatchObject({ ip: '10.88.0.1' });
      }, 4_000);
      const first = await lastUse();

      await use('10.88.0.2');
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(await lastUse()).toEqual(first);

      await ctx.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date(Date.now() - 2 * 60_000) })
        .where(eq(schema.apiKeys.id, key.id));
      await use('10.88.0.3');
      await waitForCondition(async () => {
        expect(await lastUse()).toMatchObject({ ip: '10.88.0.3' });
      }, 4_000);
    });
  });

  describe('when the owner changes', () => {
    it('stops working when the owner loses the permission or is suspended', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { token } = await createKey(owner, { name: 'Owner bound' });

      await ctx.db
        .delete(schema.userPermissions)
        .where(and(eq(schema.userPermissions.userId, owner.id), eq(schema.userPermissions.permissionName, Permission.ApiKeys)));
      expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);

      await ctx.db.insert(schema.userPermissions).values({ userId: owner.id, permissionName: Permission.ApiKeys });
      expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(200);

      await ctx.db.update(schema.users).set({ active: false }).where(eq(schema.users.id, owner.id));
      expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    });
  });

  describe('administration', () => {
    it('lets a user manager issue, list and revoke keys for someone who may hold them, suspended included', async () => {
      const manager = await createUser({ permissions: [Permission.ManageUsers] });
      const target = await createUser({ permissions: [Permission.ApiKeys] });
      const outsider = await createUser();

      const refused = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${outsider.id}/api-keys`,
        headers: bearer(manager.token),
        payload: { name: 'Not allowed' },
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ errorCode: 'API_KEY_OWNER_NOT_PERMITTED' });

      const issued = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/users/${target.id}/api-keys`,
        headers: bearer(manager.token),
        payload: { name: 'Issued' },
      });
      expect(issued.statusCode).toBe(201);
      const created = issued.json() as CreatedApiKey;
      expect(created.key.createdBy).toEqual({ id: manager.id, username: manager.username });
      expect((await withKey(created.token, { method: 'GET', url: '/api/v1/auth/me' })).json()).toMatchObject({ id: target.id });

      await ctx.db.update(schema.users).set({ active: false }).where(eq(schema.users.id, target.id));
      const listed = await ctx.app.inject({ method: 'GET', url: `/api/v1/users/${target.id}/api-keys`, headers: bearer(manager.token) });
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as ApiKeySummary[]).map((key) => key.id)).toEqual([created.key.id]);

      const revoked = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/users/${target.id}/api-keys`, headers: bearer(manager.token) });
      expect(revoked.json()).toEqual({ revoked: 1 });
    });

    it("keeps a manager who is not an administrator away from an administrator's keys", async () => {
      const manager = await createUser({ permissions: [Permission.ManageUsers] });
      const admin = await createUser({ isSuperuser: true });

      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/users/${admin.id}/api-keys`, headers: bearer(manager.token) });
      expect(response.statusCode).toBe(403);
    });

    it('turns every key off and back on, and holds new keys to the lifetime cap', async () => {
      const owner = await createUser({ permissions: [Permission.ApiKeys] });
      const { token } = await createKey(owner, { name: 'Server switch', expiresInDays: null });

      try {
        await setKeySettings(false, null);
        const off = await withKey(token, { method: 'GET', url: '/api/v1/auth/me' });
        expect(off.statusCode).toBe(401);
        expect(off.json()).toMatchObject({ errorCode: 'API_KEYS_DISABLED' });

        await setKeySettings(true, 30);
        expect((await withKey(token, { method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(200);

        for (const expiresInDays of [90, null]) {
          const refused = await ctx.app.inject({
            method: 'POST',
            url: '/api/v1/api-keys',
            headers: bearer(owner.token),
            payload: { name: 'Too long', expiresInDays },
          });
          expect(refused.statusCode).toBe(400);
          expect(refused.json()).toMatchObject({ errorCode: 'API_KEY_EXPIRY_EXCEEDS_CAP', errorMeta: { cap: 30 } });
        }

        const capped = await createKey(owner, { name: 'Default under cap' });
        const lifetimeDays = (Date.parse(capped.key.expiresAt!) - Date.parse(capped.key.createdAt)) / 86_400_000;
        expect(Math.round(lifetimeDays)).toBe(30);
      } finally {
        await setKeySettings(true, null);
      }
    });
  });
});
