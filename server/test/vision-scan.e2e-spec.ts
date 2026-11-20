import { randomBytes, randomUUID } from 'node:crypto';

import { Permission, type AiConnectionTestResult, type AiTryResult, type AppInfoResponse, type VisionScanResponse } from '@bookorbit/types';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';

import * as schema from '../src/db/schema';
import { AI_STUB_VISION_BOOKS, startAiStubProvider, type AiStubProvider } from '../src/modules/ai/testing/ai-stub-provider';
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

/** Photo scans through the real HTTP stack, a local provider stub and PostgreSQL. */
describe('Vision scan (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let stub!: AiStubProvider;
  let admin!: TestUserSession;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;
  let book!: LocatedBookFile;
  let photo = '';
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

  const scan = (session: TestUserSession | null, payload: object = { kind: 'shelf', image: photo }) =>
    call(session, 'POST', '/mobile/vision-scan', payload);

  const appInfo = async (): Promise<AppInfoResponse> => (await call(reader, 'GET', '/app-info')).json<AppInfoResponse>();

  const setFeature = async (body: object) => {
    const response = await call(admin, 'PUT', '/admin/ai/settings/features/vision-scan', body);
    expect(response.statusCode).toBe(200);
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

    const library = await createLibraryWithFolder(ctx, { name: `vision-scan-${randomUUID()}` });
    const path = await createEpubFixture(library.folderPath, 'dracula.epub', { title: 'Dracula' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, path);
    // The matcher reads titles from the metadata row, which the scan may not have filled.
    await ctx.db
      .insert(schema.bookMetadata)
      .values({ bookId: book.bookId, title: 'Dracula' })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { title: 'Dracula' } });

    admin = await createUserAndLogin(ctx, { isSuperuser: true });
    reader = await createUserAndLogin(ctx, { permissions: [] });
    outsider = await createUserAndLogin(ctx, { permissions: [] });
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    const created = await call(admin, 'POST', '/admin/ai/connections', {
      name: 'Stub vision',
      apiType: 'openai-chat',
      baseUrl: stub.baseUrl('openai-chat'),
      key: STUB_KEY,
    });
    expect(created.statusCode).toBe(201);
    const connectionId = (created.json() as { id: number }).id;
    const slots = await call(admin, 'PUT', '/admin/ai/settings/slots', {
      vision: { connectionId, model: 'stub-model-a', prices: { input: 1, output: 4 } },
    });
    expect(slots.statusCode).toBe(200);

    photo = (
      await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#6b5b4b' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    await stub.close();
    if (previousKey === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previousKey;
  });

  beforeEach(() => {
    stub.options.rejectImages = false;
  });

  it('refuses a request without a session, and an unknown kind or field', async () => {
    expect((await scan(null)).statusCode).toBe(401);
    expect((await scan(reader, { kind: 'spine', image: photo })).statusCode).toBe(400);
    expect((await scan(reader, { kind: 'shelf', image: photo, detail: 'high' })).statusCode).toBe(400);
    expect((await scan(reader, { kind: 'shelf', image: 'not base64!' })).statusCode).toBe(400);
  });

  it('advertises the route and says photo scans are off until the admin turns them on', async () => {
    const info = await appInfo();
    expect(info.features).toContain('vision-scan');
    expect(info.visionScan).toEqual({ enabled: false });

    const off = await scan(reader);
    expect(off.statusCode).toBe(403);
    expect(off.json().errorCode).toBe('VISION_SCAN_OFF');
  });

  it('asks for the privacy confirmation, then reads the photo and matches the library per reader', async () => {
    const refused = await call(admin, 'PUT', '/admin/ai/settings/features/vision-scan', { enabled: true });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().errorCode).toBe('AI_PRIVACY_CONFIRMATION_REQUIRED');
    await setFeature({ enabled: true, confirmPrivacy: true });
    expect((await appInfo()).visionScan).toEqual({ enabled: true });

    const response = await scan(reader);
    expect(response.statusCode).toBe(200);
    const result = response.json<VisionScanResponse>();
    expect(result.kind).toBe('shelf');
    expect(result.books.map((entry) => [entry.id, entry.title, entry.author])).toEqual(
      AI_STUB_VISION_BOOKS.map((entry, index) => [String(index), entry.title, entry.author]),
    );
    expect(result.books[0].box).toEqual({ x: 0.037, y: 0.074, width: 0.296, height: 0.852 });
    const dracula = result.books.find((entry) => entry.title === 'Dracula');
    expect(dracula?.matches.map((match) => match.book.id)).toEqual([book.bookId]);
    expect(result.books.filter((entry) => entry !== dracula).every((entry) => entry.matches.length === 0)).toBe(true);

    const sent = JSON.stringify(stub.requests.at(-1)?.body);
    expect(sent).toContain('data:image/jpeg;base64,');
    expect(sent).not.toContain(photo.slice(0, 200));

    const outside = (await scan(outsider)).json<VisionScanResponse>();
    expect(outside.books).toHaveLength(AI_STUB_VISION_BOOKS.length);
    expect(outside.books.every((entry) => entry.matches.length === 0)).toBe(true);

    const ledger = await ctx.db
      .select()
      .from(schema.aiUsage)
      .where(and(eq(schema.aiUsage.feature, 'vision-scan'), eq(schema.aiUsage.slot, 'vision')));
    expect(ledger.length).toBeGreaterThanOrEqual(2);
    expect(ledger.every((row) => row.outcome === 'ok')).toBe(true);
  });

  it('says when the photo is not an image the server can read', async () => {
    const before = stub.requests.length;
    const response = await scan(reader, { kind: 'cover', image: Buffer.from('plain text, not a photo').toString('base64') });
    expect(response.statusCode).toBe(400);
    expect(response.json().errorCode).toBe('VISION_SCAN_IMAGE_INVALID');
    expect(stub.requests.length).toBe(before);
  });

  it('says when the provider cannot read pictures', async () => {
    stub.options.rejectImages = true;
    const response = await scan(reader);
    expect(response.statusCode).toBe(502);
    expect(response.json().errorCode).toBe('VISION_SCAN_PROVIDER');
  });

  it('refuses a scan once the feature budget is used up', async () => {
    await setFeature({ monthlyBudget: 0 });
    try {
      const response = await scan(reader);
      expect(response.statusCode).toBe(403);
      expect(response.json().errorCode).toBe('VISION_SCAN_BUDGET');
    } finally {
      await setFeature({ monthlyBudget: null });
    }
  });

  it('refuses an API key, as every App Attest route does', async () => {
    const owner = await createUserAndLogin(ctx, { permissions: [Permission.ApiKeys] });
    const created = await call(owner, 'POST', '/api-keys', { name: 'Scanner', access: 'write' });
    expect(created.statusCode, created.body).toBe(201);
    const { token } = created.json() as { token: string };
    const response = await call(null, 'POST', '/mobile/vision-scan', { kind: 'shelf', image: photo }, { 'x-api-key': token });
    expect(response.statusCode).toBe(403);
    expect(response.json().errorCode).toBe('API_KEY_ROUTE_FORBIDDEN');
  });

  it('tests the Vision model reading a picture, and runs Try it on the Vision slot', async () => {
    const tested = await call(admin, 'POST', '/admin/ai/connections/test', {
      name: 'Draft vision',
      apiType: 'anthropic-messages',
      baseUrl: stub.baseUrl('anthropic-messages'),
      key: STUB_KEY,
    });
    expect(tested.statusCode).toBe(200);
    expect((tested.json() as AiConnectionTestResult).steps.find((step) => step.id === 'image')).toMatchObject({ ok: true });

    const tried = await call(admin, 'POST', '/admin/ai/try', { slot: 'vision' });
    expect(tried.statusCode).toBe(200);
    expect(tried.json() as AiTryResult).toMatchObject({
      slot: 'vision',
      names: [],
      books: AI_STUB_VISION_BOOKS.map(({ title, author }) => ({ title, author })),
    });

    const off = await call(admin, 'PUT', '/admin/ai/settings/features/vision-scan', { enabled: false });
    expect(off.statusCode).toBe(200);
    expect((await appInfo()).visionScan).toEqual({ enabled: false });
  });
});
