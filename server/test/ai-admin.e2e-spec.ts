import { randomBytes } from 'node:crypto';

import {
  AI_API_TYPES,
  AuditAction,
  Permission,
  type AiConnection,
  type AiConnectionTestResult,
  type AiModelList,
  type AiOverview,
  type AiSettings,
  type AiSlotsUpdateResult,
  type AiTryResult,
  type AiUsageReport,
} from '@bookorbit/types';
import { and, eq, like, sql } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { AI_STUB_TRY_NAMES, startAiStubProvider, type AiStubProvider } from '../src/modules/ai/testing/ai-stub-provider';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createUserAndLogin,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 90_000;
const STUB_KEY = 'sk-stub-test-key-0001';
const SECOND_KEY = 'sk-stub-second-key-0002';
const HEADER_VALUE = 'team-header-secret-9876';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const ROUTES: Array<{ method: Method; url: string }> = [
  { method: 'GET', url: '/admin/ai' },
  { method: 'GET', url: '/admin/ai/connections' },
  { method: 'POST', url: '/admin/ai/connections' },
  { method: 'PATCH', url: '/admin/ai/connections/1' },
  { method: 'DELETE', url: '/admin/ai/connections/1' },
  { method: 'POST', url: '/admin/ai/connections/test' },
  { method: 'POST', url: '/admin/ai/connections/1/test' },
  { method: 'GET', url: '/admin/ai/connections/1/models' },
  { method: 'GET', url: '/admin/ai/settings' },
  { method: 'PUT', url: '/admin/ai/settings/slots' },
  { method: 'PUT', url: '/admin/ai/settings/features/story-guides' },
  { method: 'PUT', url: '/admin/ai/settings/budget' },
  { method: 'POST', url: '/admin/ai/try' },
  { method: 'GET', url: '/admin/ai/usage' },
  { method: 'GET', url: '/admin/ai/usage.csv' },
];

describe('AI admin routes (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let admin!: TestUserSession;
  let reader!: TestUserSession;
  let stub!: AiStubProvider;
  let connectionId = 0;
  const bodies: string[] = [];
  const previousKey = process.env.AI_ENCRYPTION_KEY;

  const call = async (session: TestUserSession | null, method: Method, url: string, payload?: unknown) => {
    const response = await ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      ...(session ? { headers: authHeader(session.accessToken) } : {}),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    bodies.push(response.body);
    return response;
  };

  /** Audit entries are written from an event, so they land a moment after the response. */
  const auditActions = async (expected: string[]): Promise<Array<typeof schema.auditLog.$inferSelect>> => {
    for (let attempt = 0; ; attempt += 1) {
      const rows = await ctx.db
        .select()
        .from(schema.auditLog)
        .where(and(eq(schema.auditLog.userId, admin.userId), like(schema.auditLog.action, 'ai.%')))
        .orderBy(schema.auditLog.id);
      const actions = new Set(rows.map((row) => row.action));
      if (expected.every((action) => actions.has(action)) || attempt >= 50) return rows;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  beforeAll(async () => {
    process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    stub = await startAiStubProvider({ key: STUB_KEY });
    ctx = await createAuthorizationMatrixE2EContext();
    await ctx.db.delete(schema.aiBudgetReservations);
    await ctx.db.delete(schema.aiUsage);
    await ctx.db.delete(schema.aiUsageMonthly);
    await ctx.db.delete(schema.aiConnections);
    await ctx.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} like 'ai.%'`);
    admin = await createUserAndLogin(ctx, { permissions: [Permission.ManageAppSettings] });
    reader = await createUserAndLogin(ctx, { permissions: [] });
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    await stub.close();
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });

  it('refuses every route without a session, and without ManageAppSettings', async () => {
    for (const route of ROUTES) {
      const anonymous = await call(null, route.method, route.url, route.method === 'GET' ? undefined : {});
      expect({ route, status: anonymous.statusCode }).toEqual({ route, status: 401 });
      const denied = await call(reader, route.method, route.url, route.method === 'GET' ? undefined : {});
      expect({ route, status: denied.statusCode }).toEqual({ route, status: 403 });
      expect(denied.json().message).toContain('Missing permission:');
    }
  });

  it.each(AI_API_TYPES)('tests an unsaved %s connection without saving it', async (apiType) => {
    const response = await call(admin, 'POST', '/admin/ai/connections/test', {
      name: `Draft ${apiType}`,
      apiType,
      baseUrl: stub.baseUrl(apiType),
      key: STUB_KEY,
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as AiConnectionTestResult;
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => [step.id, step.ok])).toEqual([
      ['reach', true],
      ['key', true],
      ['models', true],
      ['json', true],
      ['usage', true],
      ['image', true],
    ]);
    expect(result.models?.models.map((model) => model.id)).toContain('stub-model-a');
    expect(await ctx.db.select().from(schema.aiConnections)).toEqual([]);
  });

  it('refuses unknown body fields and an invalid URL', async () => {
    const unknown = await call(admin, 'POST', '/admin/ai/connections', {
      name: 'Strict',
      apiType: 'openai-chat',
      baseUrl: stub.baseUrl('openai-chat'),
      organization: 'nope',
    });
    expect(unknown.statusCode).toBe(400);
    const badUrl = await call(admin, 'POST', '/admin/ai/connections', { name: 'Bad', apiType: 'openai-chat', baseUrl: 'ftp://example.test' });
    expect(badUrl.statusCode).toBe(400);
    expect(badUrl.json().errorCode).toBe('AI_INVALID_URL');
  });

  it('adds, lists, edits and tests a connection, and sends the stored key and header to the provider', async () => {
    const created = await call(admin, 'POST', '/admin/ai/connections', {
      name: 'Stub chat',
      apiType: 'openai-chat',
      baseUrl: stub.baseUrl('openai-chat'),
      key: STUB_KEY,
      headers: [{ name: 'X-Team', value: HEADER_VALUE }],
    });
    expect(created.statusCode).toBe(201);
    const connection = created.json() as AiConnection;
    connectionId = connection.id;
    expect(connection).toMatchObject({ name: 'Stub chat', hasKey: true, keyHint: '0001', usable: true, status: 'untested' });
    expect(connection.headers).toEqual([{ name: 'X-Team', hasValue: true, valueHint: '9876' }]);

    const listed = await call(admin, 'GET', '/admin/ai/connections');
    expect((listed.json() as AiConnection[]).map((entry) => entry.id)).toEqual([connectionId]);

    const renamed = await call(admin, 'PATCH', `/admin/ai/connections/${connectionId}`, { name: 'Stub chat renamed', timeoutMs: 30_000 });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Stub chat renamed', timeoutMs: 30_000, hasKey: true });

    stub.requests.length = 0;
    const tested = await call(admin, 'POST', `/admin/ai/connections/${connectionId}/test`, {});
    expect(tested.statusCode).toBe(200);
    expect((tested.json() as AiConnectionTestResult).ok).toBe(true);
    expect(stub.requests.length).toBeGreaterThan(0);
    for (const request of stub.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${STUB_KEY}`);
      expect(request.headers['x-team']).toBe(HEADER_VALUE);
    }

    const models = await call(admin, 'GET', `/admin/ai/connections/${connectionId}/models`);
    expect(models.statusCode).toBe(200);
    expect((models.json() as AiModelList).models.map((model) => model.id)).toEqual(expect.arrayContaining(['stub-model-a', 'stub-model-b']));

    const replaced = await call(admin, 'PATCH', `/admin/ai/connections/${connectionId}`, { key: SECOND_KEY });
    expect(replaced.json()).toMatchObject({ keyHint: '0002' });
    const failing = await call(admin, 'POST', `/admin/ai/connections/${connectionId}/test`, {});
    expect((failing.json() as AiConnectionTestResult).ok).toBe(false);
    const restored = await call(admin, 'PATCH', `/admin/ai/connections/${connectionId}`, { key: STUB_KEY });
    expect(restored.json()).toMatchObject({ keyHint: '0001' });

    const missing = await call(admin, 'GET', '/admin/ai/connections/999999/models');
    expect(missing.statusCode).toBe(404);
  });

  it('fills a slot, runs Try it, and reports what each feature still needs', async () => {
    const emptyTry = await call(admin, 'POST', '/admin/ai/try', { slot: 'careful' });
    expect(emptyTry.statusCode).toBe(400);
    expect(emptyTry.json().errorCode).toBe('AI_SLOT_EMPTY');

    const slots = await call(admin, 'PUT', '/admin/ai/settings/slots', {
      fast: { connectionId, model: 'stub-model-a', prices: { input: 1, output: 2 } },
    });
    expect(slots.statusCode).toBe(200);
    const updated = slots.json() as AiSlotsUpdateResult;
    expect(updated.changed).toEqual(['fast']);
    expect(updated.slots.fast).toMatchObject({ connectionId, model: 'stub-model-a', prices: { input: 1, output: 2 } });

    const tried = await call(admin, 'POST', '/admin/ai/try', { slot: 'fast' });
    expect(tried.statusCode).toBe(200);
    const result = tried.json() as AiTryResult;
    expect(result).toMatchObject({ slot: 'fast', model: 'stub-model-a', names: AI_STUB_TRY_NAMES });
    expect(result.costMicros).toBeGreaterThan(0);

    const settings = (await call(admin, 'GET', '/admin/ai/settings')).json() as AiSettings;
    expect(settings.features).toEqual([
      expect.objectContaining({ id: 'story-guides', missingSlots: ['careful'], privacy: null }),
      expect.objectContaining({ id: 'vision-scan', missingSlots: ['vision'], privacy: null }),
      expect.objectContaining({ id: 'reading-help', missingSlots: [], privacy: null }),
    ]);

    const unchanged = await call(admin, 'PUT', '/admin/ai/settings/slots', { fast: { connectionId, model: 'stub-model-a' } });
    expect((unchanged.json() as AiSlotsUpdateResult).changed).toEqual([]);
  });

  it('asks for the privacy confirmation the first time a feature turns on', async () => {
    const refused = await call(admin, 'PUT', '/admin/ai/settings/features/story-guides', { enabled: true });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errorCode).toBe('AI_PRIVACY_CONFIRMATION_REQUIRED');

    const enabled = await call(admin, 'PUT', '/admin/ai/settings/features/story-guides', {
      enabled: true,
      confirmPrivacy: true,
      limits: { concurrentBuilds: 2 },
    });
    expect(enabled.statusCode).toBe(200);
    const feature = (enabled.json() as AiSettings).features[0];
    expect(feature.settings).toMatchObject({ enabled: true, limits: { concurrentBuilds: 2 } });
    expect(feature.privacy).toMatchObject({ userId: admin.userId, username: admin.username });

    const outOfRange = await call(admin, 'PUT', '/admin/ai/settings/features/story-guides', { limits: { concurrentBuilds: 50 } });
    expect(outOfRange.statusCode).toBe(400);
    const unknown = await call(admin, 'PUT', '/admin/ai/settings/features/future-feature', { enabled: true });
    expect(unknown.statusCode).toBe(404);
  });

  it('saves the budget', async () => {
    const response = await call(admin, 'PUT', '/admin/ai/settings/budget', { monthlyBudget: 5, buildsPerMonth: 20 });
    expect(response.statusCode).toBe(200);
    expect((response.json() as AiSettings).budget).toEqual({ monthlyBudget: 5, buildsPerMonth: 20 });
    const overview = (await call(admin, 'GET', '/admin/ai')).json() as AiOverview;
    expect(overview.encryptionConfigured).toBe(true);
    expect(overview.month.requests).toBeGreaterThan(0);
    expect(overview.budget).toMatchObject({ monthlyBudget: 5 });
  });

  it('reports usage, and exports it as CSV', async () => {
    const usage = await call(admin, 'GET', '/admin/ai/usage');
    expect(usage.statusCode).toBe(200);
    const report = usage.json() as AiUsageReport;
    expect(report.months).toHaveLength(12);
    expect(report.byFeature.map((entry) => entry.feature)).toEqual(expect.arrayContaining(['connection-test', 'try-it']));
    expect(report.byModel.find((entry) => entry.connectionId === connectionId)).toMatchObject({
      model: 'stub-model-a',
      connectionName: 'Stub chat renamed',
    });

    const badRange = await call(admin, 'GET', '/admin/ai/usage?from=2026-13');
    expect(badRange.statusCode).toBe(400);

    const csv = await call(admin, 'GET', '/admin/ai/usage.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('attachment');
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.body.split('\n')[0]).toBe(
      'month,feature,slot,connection,model,requests,errors,input_tokens,output_tokens,reasoning_tokens,cached_tokens,cost_usd,unknown_cost_requests',
    );
    expect(csv.body).toContain('try-it,fast,Stub chat renamed,stub-model-a');
  });

  it('refuses to delete a connection a slot uses, and deletes it once free', async () => {
    const refused = await call(admin, 'DELETE', `/admin/ai/connections/${connectionId}`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ errorCode: 'AI_CONNECTION_IN_USE', errorMeta: { slots: 'fast', unfinishedJobs: 0 } });

    await call(admin, 'PUT', '/admin/ai/settings/slots', { fast: { connectionId: null, model: null } });
    const deleted = await call(admin, 'DELETE', `/admin/ai/connections/${connectionId}`);
    expect(deleted.statusCode).toBe(204);
    expect(await ctx.db.select().from(schema.aiConnections)).toEqual([]);

    // Usage outlives the connection; its rows lose the link rather than disappear.
    const usage = (await call(admin, 'GET', '/admin/ai/usage')).json() as AiUsageReport;
    expect(usage.byModel.some((entry) => entry.connectionId === connectionId)).toBe(false);
    expect(usage.byFeature.find((entry) => entry.feature === 'try-it')?.requests).toBeGreaterThan(0);
  });

  it('records each change in the audit log by field, never by value', async () => {
    const expected = [
      AuditAction.AiConnectionCreate,
      AuditAction.AiConnectionUpdate,
      AuditAction.AiConnectionKeyReplace,
      AuditAction.AiSlotsUpdate,
      AuditAction.AiPrivacyConfirm,
      AuditAction.AiFeatureUpdate,
      AuditAction.AiBudgetUpdate,
      AuditAction.AiConnectionDelete,
    ];
    const rows = await auditActions(expected);
    expect(new Set(rows.map((row) => row.action))).toEqual(new Set(expected));
    const rowsFor = (action: AuditAction) => rows.filter((row) => row.action === (action as string));

    const update = rowsFor(AuditAction.AiConnectionUpdate)[0];
    expect(update.meta).toEqual({ fields: expect.arrayContaining(['name', 'timeoutMs']) });
    expect(rowsFor(AuditAction.AiConnectionKeyReplace)).toHaveLength(2);
    expect(rowsFor(AuditAction.AiSlotsUpdate)[0].meta).toEqual({ slots: ['fast'] });
    expect(rowsFor(AuditAction.AiFeatureUpdate)[0].meta).toEqual({
      feature: 'story-guides',
      fields: ['enabled', 'limits'],
    });
    expect(rowsFor(AuditAction.AiBudgetUpdate)[0].meta).toEqual({ fields: ['monthlyBudget', 'buildsPerMonth'] });
    expect(rowsFor(AuditAction.AiConnectionCreate)[0]).toMatchObject({
      resourceId: connectionId,
      resourceLabel: expect.stringContaining('Stub chat'),
      meta: { apiType: 'openai-chat', hasKey: true },
    });

    const logged = JSON.stringify(rows);
    for (const secret of [STUB_KEY, SECOND_KEY, HEADER_VALUE]) expect(logged).not.toContain(secret);
  });

  it('never returns a stored key or header value', () => {
    expect(bodies.length).toBeGreaterThan(40);
    for (const body of bodies) {
      for (const secret of [STUB_KEY, SECOND_KEY, HEADER_VALUE]) expect(body).not.toContain(secret);
    }
  });
});
