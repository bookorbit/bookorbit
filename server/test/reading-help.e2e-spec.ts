import { randomBytes, randomUUID } from 'node:crypto';

import { Permission, type AppInfoResponse, type ReadingHelpEvent } from '@bookorbit/types';
import { and, eq, sql } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { AI_STUB_READING_HELP_ANSWER, startAiStubProvider, type AiStubProvider } from '../src/modules/ai/testing/ai-stub-provider';
import { createEpubFixture } from './e2e/authorization-matrix/authorization-matrix-fixture-builder';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type AuthorizationMatrixE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 90_000;
const STUB_KEY = 'sk-stub-test-key-0001';
/** The stub's answer cut at the two sentences a term answer keeps. */
const CAPPED =
  'Mr. Darcy is a proud gentleman who has come to Netherfield with Mr. Bingley. He has just refused to dance with Elizabeth at the assembly.';

/** Reading help through the real HTTP stack, a local streaming provider stub and PostgreSQL. */
describe('Reading help (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let stub!: AiStubProvider;
  let admin!: TestUserSession;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;
  let book!: LocatedBookFile;
  let connectionId = 0;
  const previousKey = process.env.AI_ENCRYPTION_KEY;

  const call = (
    session: TestUserSession | null,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { ...(session ? authHeader(session.accessToken) : {}), ...headers },
      ...(payload !== undefined ? { payload } : {}),
    });

  const question = (overrides: object = {}) => ({
    kind: 'term',
    fileId: book.bookFileId,
    language: 'en',
    term: 'Darcy',
    passages: ['Mr. Darcy came into the room with Mr. Bingley.', 'He would not dance with Elizabeth.'],
    ...overrides,
  });

  const ask = (session: TestUserSession | null, payload: object = question()) => call(session, 'POST', '/mobile/reading-help', payload);

  const eventsOf = (body: string): ReadingHelpEvent[] =>
    body
      .split('\n\n')
      .map((block) => block.split('\n').filter((line) => line.startsWith('data: ')))
      .filter((lines) => lines.length > 0)
      .map((lines) => JSON.parse(lines.map((line) => line.slice(6)).join('\n')) as ReadingHelpEvent);

  const appInfo = async (): Promise<AppInfoResponse> => (await call(reader, 'GET', '/app-info')).json<AppInfoResponse>();

  const setFeature = async (body: object) => {
    const response = await call(admin, 'PUT', '/admin/ai/settings/features/reading-help', body);
    expect(response.statusCode, response.body).toBe(200);
  };

  const setSlots = async (body: object) => {
    const response = await call(admin, 'PUT', '/admin/ai/settings/slots', body);
    expect(response.statusCode, response.body).toBe(200);
  };

  beforeAll(async () => {
    process.env.AI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    stub = await startAiStubProvider({ key: STUB_KEY });
    ctx = await createAuthorizationMatrixE2EContext();
    await ctx.db.delete(schema.aiAnswerCache);
    await ctx.db.delete(schema.aiBudgetReservations);
    await ctx.db.delete(schema.aiUsage);
    await ctx.db.delete(schema.aiUsageMonthly);
    await ctx.db.delete(schema.aiConnections);
    await ctx.db.delete(schema.appSettings).where(sql`${schema.appSettings.key} like 'ai.%'`);

    const library = await createLibraryWithFolder(ctx, { name: `reading-help-${randomUUID()}` });
    const path = await createEpubFixture(library.folderPath, 'pride.epub', { title: 'Pride and Prejudice' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, path);

    admin = await createUserAndLogin(ctx, { isSuperuser: true });
    reader = await createUserAndLogin(ctx, { permissions: [] });
    outsider = await createUserAndLogin(ctx, { permissions: [] });
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    const created = await call(admin, 'POST', '/admin/ai/connections', {
      name: 'Stub text',
      apiType: 'openai-chat',
      baseUrl: stub.baseUrl('openai-chat'),
      key: STUB_KEY,
    });
    expect(created.statusCode).toBe(201);
    connectionId = (created.json() as { id: number }).id;
    await setSlots({ fast: { connectionId, model: 'stub-model-a', prices: { input: 1, output: 4 } } });
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    await stub.close();
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });

  it('refuses a request without a session, and an unknown kind, field or empty passage list', async () => {
    expect((await ask(null)).statusCode).toBe(401);
    expect((await ask(reader, question({ kind: 'chat' }))).statusCode).toBe(400);
    expect((await ask(reader, question({ book: 'Pride and Prejudice' }))).statusCode).toBe(400);
    expect((await ask(reader, question({ passages: [] }))).statusCode).toBe(400);
    expect((await ask(reader, question({ language: 'en_US!' }))).statusCode).toBe(400);
  });

  it('advertises the route and says reading help is off until the admin turns it on', async () => {
    const info = await appInfo();
    expect(info.features).toContain('reading-help');
    expect(info.readingHelp).toEqual({ enabled: false, careful: false, passageTokens: 8_000 });

    const off = await ask(reader);
    expect(off.statusCode).toBe(403);
    expect(off.json().errorCode).toBe('READING_HELP_OFF');
  });

  it('asks for the privacy confirmation, then streams an answer capped at its sentences and records it for the reader', async () => {
    const refused = await call(admin, 'PUT', '/admin/ai/settings/features/reading-help', { enabled: true });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errorCode).toBe('AI_PRIVACY_CONFIRMATION_REQUIRED');
    await setFeature({ enabled: true, confirmPrivacy: true });
    expect((await appInfo()).readingHelp).toEqual({ enabled: true, careful: false, passageTokens: 8_000 });

    const response = await ask(reader);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    const events = eventsOf(response.body);
    const deltas = events.filter((event) => event.type === 'delta').map((event) => event.text);
    expect(deltas.length).toBeGreaterThan(1);
    // Pieces go out as they come; the last may end in the space before a sentence the cap then cut.
    expect(deltas.join('').trim()).toBe(CAPPED);
    expect(events.at(-1)).toEqual({ type: 'done', text: CAPPED, cached: false, careful: false });
    expect(AI_STUB_READING_HELP_ANSWER.startsWith(CAPPED)).toBe(true);

    const sent = stub.requests.at(-1)?.body ?? {};
    expect(sent).toMatchObject({ model: 'stub-model-a', stream: true });
    expect(JSON.stringify(sent)).toContain('He would not dance with Elizabeth.');
    expect(JSON.stringify(sent)).not.toContain('Pride and Prejudice');

    const ledger = await ctx.db
      .select()
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.feature, 'reading-help'), eq(schema.aiUsage.userId, reader.userId)));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ slot: 'fast', outcome: 'ok' });
  });

  it('answers the same question again from the cache, without calling the provider', async () => {
    const before = stub.requests.length;
    const response = await ask(reader);
    expect(response.statusCode).toBe(200);
    expect(eventsOf(response.body)).toEqual([{ type: 'done', text: CAPPED, cached: true, careful: false }]);
    expect(stub.requests.length).toBe(before);
  });

  it('refuses a file the reader cannot open, before calling the provider', async () => {
    const before = stub.requests.length;
    expect((await ask(outsider)).statusCode).toBe(403);
    expect((await ask(reader, question({ fileId: 2_147_000_000 }))).statusCode).toBe(404);
    expect(stub.requests.length).toBe(before);
  });

  it('asks the Careful model only once it has one', async () => {
    const missing = await ask(reader, question({ careful: true }));
    expect(missing.statusCode).toBe(409);
    expect(missing.json().errorCode).toBe('READING_HELP_CAREFUL_OFF');

    await setSlots({ careful: { connectionId, model: 'stub-model-b', prices: { input: 2, output: 8 } } });
    expect((await appInfo()).readingHelp).toMatchObject({ careful: true });
    const response = await ask(reader, question({ careful: true }));
    expect(response.statusCode).toBe(200);
    expect(eventsOf(response.body).at(-1)).toEqual({ type: 'done', text: CAPPED, cached: false, careful: true });
    expect(stub.requests.at(-1)?.body).toMatchObject({ model: 'stub-model-b' });
  });

  it('stops a reader who used their monthly share, but not a cached answer', async () => {
    await setFeature({ readerMonthlyBudget: 0 });
    try {
      const capped = await ask(reader, question({ term: 'Bingley' }));
      expect(capped.statusCode).toBe(429);
      expect(capped.json().errorCode).toBe('READING_HELP_READER_CAP');
      expect((await ask(reader)).statusCode).toBe(200);
    } finally {
      await setFeature({ readerMonthlyBudget: 1 });
    }
  });

  it('refuses once the feature budget is used up', async () => {
    await setFeature({ monthlyBudget: 0 });
    try {
      const response = await ask(reader, question({ term: 'Elizabeth' }));
      expect(response.statusCode).toBe(403);
      expect(response.json().errorCode).toBe('READING_HELP_BUDGET');
    } finally {
      await setFeature({ monthlyBudget: null });
    }
  });

  it('keeps reader caps to the features that have them', async () => {
    const saved = await call(admin, 'PUT', '/admin/ai/settings/features/reading-help', { readerRequestsPerMonth: 50 });
    expect(saved.statusCode).toBe(200);
    const feature = (saved.json() as { features: { id: string; settings: { readerRequestsPerMonth?: number | null } }[] }).features.find(
      (entry) => entry.id === 'reading-help',
    );
    expect(feature?.settings.readerRequestsPerMonth).toBe(50);
    expect((await call(admin, 'PUT', '/admin/ai/settings/features/story-guides', { readerMonthlyBudget: 1 })).statusCode).toBe(400);
  });

  it('refuses an API key, as every App Attest route does', async () => {
    const owner = await createUserAndLogin(ctx, { permissions: [Permission.ApiKeys] });
    const created = await call(owner, 'POST', '/api-keys', { name: 'Helper', access: 'write' });
    expect(created.statusCode, created.body).toBe(201);
    const { token } = created.json() as { token: string };
    const response = await call(null, 'POST', '/mobile/reading-help', question(), { 'x-api-key': token });
    expect(response.statusCode).toBe(403);
    expect(response.json().errorCode).toBe('API_KEY_ROUTE_FORBIDDEN');
  });

  it('says reading help is off again once the admin turns it off', async () => {
    await setFeature({ enabled: false });
    expect((await appInfo()).readingHelp).toMatchObject({ enabled: false });
    expect((await ask(reader)).json().errorCode).toBe('READING_HELP_OFF');
  });
});
