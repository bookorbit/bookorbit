import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { BookDetail, MetadataHttpProviderView, MetadataProviderDirectory, MetadataProviderInfo } from '@bookorbit/types';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  triggerAndWaitForLibraryScan,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';
import { createEpubFixture } from './e2e/metadata-write/metadata-write-fixture-builder';

const SCENARIO_TIMEOUT_MS = 90_000;
const KEY = 'fake-provider';
const COLOR = '#336699';
const ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const TITLE = 'Zero Coupling Novel';

/**
 * A provider BookOrbit has never heard of, served by the test itself. Nothing in BookOrbit names
 * it: if any step below needs a code change to pass, external providers are coupled again.
 */
class FakeProvider {
  private server!: Server;
  readonly calls: string[] = [];
  baseUrl = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.baseUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://fake');
    this.calls.push(url.pathname);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/icon.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(ICON);
      return;
    }
    if (url.pathname === '/provider/info') {
      return send(200, {
        name: 'Fake Provider',
        key: KEY,
        avatarUrl: `${this.baseUrl}icon.png`,
        color: COLOR,
        version: '1.0.0',
        lookup: true,
        mediaTypes: ['book'],
        searchParams: ['isbn', 'limit'],
        supportedFields: ['title', 'description', 'publisher', 'communityRating'],
        bookUrlTemplate: 'https://fake.example/books/{id}',
      });
    }
    if (url.pathname === '/search') return send(200, { matches: [this.record('fp-1')] });
    const lookup = /^\/book\/(.+)$/.exec(url.pathname);
    if (lookup) return lookup[1] === 'fp-1' ? send(200, this.record('fp-1')) : send(404, { error: 'Not found' });
    send(404, { error: 'Not found' });
  }

  private record(id: string) {
    return {
      providerId: id,
      title: TITLE,
      authors: ['Test Author'],
      description: 'A description only the fake provider knows.',
      publisher: 'Fake House',
      rating: 4.2,
      ratingCount: 321,
      url: `https://fake.example/books/${id}?from=search`,
    };
  }
}

describe('External metadata providers (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let admin!: TestUserSession;
  let reader!: TestUserSession;
  const fake = new FakeProvider();
  let providerId = 0;
  let bookId = 0;
  let apiBase = '';

  const call = (session: TestUserSession, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: authHeader(session.accessToken),
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  const detail = async (): Promise<BookDetail> => (await call(admin, 'GET', `/books/${bookId}`)).json() as BookDetail;

  const previousDirectoryUrl = process.env.METADATA_PROVIDER_DIRECTORY_URL;

  beforeAll(async () => {
    await fake.start();
    // A test run must never reach GitHub; the bundled directory is what is checked here.
    process.env.METADATA_PROVIDER_DIRECTORY_URL = 'off';
    ctx = await createAuthorizationMatrixE2EContext();
    admin = await createUserAndLogin(ctx, { isSuperuser: true });
    reader = await createUserAndLogin(ctx, { permissions: [] });

    const library = await createLibraryWithFolder(ctx);
    await createEpubFixture(library.folderPath, 'zero/coupling.epub', { title: TITLE });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const [row] = await ctx.db.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.libraryId, library.libraryId)).limit(1);
    bookId = row.id;
    // The harness stubs file extraction, so the scanned book starts with no title to search by.
    const titled = await call(admin, 'PATCH', `/books/${bookId}/metadata`, { title: TITLE });
    if (titled.statusCode !== 200) throw new Error(`Could not title the fixture book: ${titled.statusCode} ${titled.body}`);
    // Server-sent events need a real socket; fastify's injected one cannot keep a stream open.
    await ctx.app.listen(0, '127.0.0.1');
    apiBase = await ctx.app.getUrl();
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
    await fake.stop();
    if (previousDirectoryUrl === undefined) delete process.env.METADATA_PROVIDER_DIRECTORY_URL;
    else process.env.METADATA_PROVIDER_DIRECTORY_URL = previousDirectoryUrl;
  });

  it('keeps provider registration behind ManageMetadataConfig', async () => {
    expect((await call(reader, 'GET', '/metadata-http-providers')).statusCode).toBe(403);
    expect((await call(reader, 'POST', '/metadata-http-providers', { baseUrl: fake.baseUrl })).statusCode).toBe(403);
    expect((await call(reader, 'GET', '/metadata-http-providers/directory')).statusCode).toBe(403);
  });

  it('lists the ready-made providers from the bundled directory when the online one is off', async () => {
    const response = await call(admin, 'GET', '/metadata-http-providers/directory');

    expect(response.statusCode).toBe(200);
    const directory = response.json() as MetadataProviderDirectory;
    expect(directory).toMatchObject({ source: 'bundled', fetchedAt: null });
    expect(directory.providers.map((entry) => entry.key)).toContain('mangabaka');
    expect(directory.providers.every((entry) => entry.image.startsWith('ghcr.io/bookorbit/'))).toBe(true);
  });

  it('refuses a private address until the admin allows one', async () => {
    const refused = await call(admin, 'POST', '/metadata-http-providers', { baseUrl: fake.baseUrl });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ errorCode: 'METADATA_PROVIDER_PRIVATE_ADDRESS' });
  });

  it('registers the provider disabled, under the key it reports, and refuses a duplicate', async () => {
    const created = await call(admin, 'POST', '/metadata-http-providers', { baseUrl: fake.baseUrl, allowPrivateAddress: true });
    expect(created.statusCode).toBe(201);
    const view = created.json() as MetadataHttpProviderView;
    expect(view).toMatchObject({ key: KEY, enabled: false, status: 'ok', hasAuthorization: false, info: { name: 'Fake Provider', lookup: true } });
    providerId = view.id;

    const duplicate = await call(admin, 'POST', '/metadata-http-providers', { baseUrl: fake.baseUrl, allowPrivateAddress: true });
    expect(duplicate.statusCode).toBe(409);

    const providers = (await call(reader, 'GET', '/metadata-fetch/providers')).json() as MetadataProviderInfo[];
    expect(providers.map((p) => p.key)).not.toContain(KEY);
  });

  it('lists an enabled provider to every user, once, as external', async () => {
    expect((await call(admin, 'PATCH', `/metadata-http-providers/${providerId}`, { enabled: true })).statusCode).toBe(200);

    const providers = (await call(reader, 'GET', '/metadata-fetch/providers')).json() as MetadataProviderInfo[];
    const listed = providers.filter((p) => p.key === KEY);
    expect(listed).toEqual([
      {
        key: KEY,
        label: 'Fake Provider',
        identifiable: true,
        source: 'external',
        iconUrl: expect.stringMatching(new RegExp(`^/api/v1/metadata-providers/${KEY}/icon\\?v=[0-9a-f]{16}$`)),
        color: COLOR,
      },
    ]);
    expect(new Set(providers.map((p) => p.key)).size).toBe(providers.length);
  });

  it("serves the provider's icon from BookOrbit to every signed-in user", async () => {
    const [listed] = ((await call(reader, 'GET', '/metadata-fetch/providers')).json() as MetadataProviderInfo[]).filter((p) => p.key === KEY);
    const icon = await ctx.app.inject({ method: 'GET', url: listed.iconUrl!, headers: authHeader(reader.accessToken) });
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['content-type']).toBe('image/png');
    expect(icon.headers['x-content-type-options']).toBe('nosniff');
    expect(icon.headers['cache-control']).toContain('immutable');
    expect(icon.rawPayload.equals(ICON)).toBe(true);

    expect((await ctx.app.inject({ method: 'GET', url: listed.iconUrl! })).statusCode).toBe(401);
    expect((await call(reader, 'GET', '/metadata-providers/not-registered/icon')).statusCode).toBe(404);
  });

  it('answers manual search and lookup through the ordinary endpoints', async () => {
    const stream = await fetch(`${apiBase}/api/v1/metadata-fetch/stream?title=${encodeURIComponent(TITLE)}&providers=${KEY}`, {
      headers: authHeader(reader.accessToken),
    });
    expect(stream.status).toBe(200);
    const events = await stream.text();
    expect(events).toContain(`"provider":"${KEY}"`);
    expect(events).toContain('"providerId":"fp-1"');

    const lookup = await call(reader, 'GET', `/metadata-fetch/lookup?provider=${KEY}&id=fp-1`);
    expect(lookup.json()).toMatchObject({ provider: KEY, providerId: 'fp-1', title: TITLE, communityRating: 4.2 });
  });

  it('accepts the provider in field rules, and a refresh then stores its id, rating and link', async () => {
    const global = (await call(admin, 'GET', '/metadata-preferences/global')).json() as {
      fields: Record<string, { enabled: boolean; providers: string[]; mergeStrategy: string }>;
    };
    for (const field of ['description', 'publisher', 'communityRating']) {
      global.fields[field] = { ...global.fields[field], enabled: true, providers: [KEY] };
    }
    for (const [field, rule] of Object.entries(global.fields)) {
      if (!['description', 'publisher', 'communityRating'].includes(field)) global.fields[field] = { ...rule, providers: [] };
    }
    const saved = await call(admin, 'PUT', '/metadata-preferences/global', global);
    expect(saved.statusCode).toBe(200);

    const refresh = await call(admin, 'POST', `/books/${bookId}/refresh-metadata`);
    expect(refresh.statusCode).toBe(201);

    const book = await detail();
    expect(book.providerIds[KEY]).toBe('fp-1');
    expect(book.providerLinks?.[KEY]).toBe('https://fake.example/books/fp-1');
    expect(book.description).toBe('A description only the fake provider knows.');
    expect(book.communityRatings).toEqual(expect.arrayContaining([expect.objectContaining({ provider: KEY, rating: 4.2, ratingCount: 321 })]));
  });

  it('refreshes by stored id with a lookup, not a search', async () => {
    fake.calls.length = 0;
    expect((await call(admin, 'POST', `/books/${bookId}/refresh-metadata`)).statusCode).toBe(201);
    expect(fake.calls).toContain('/book/fp-1');
    expect(fake.calls).not.toContain('/search');
  });

  it('keeps the rating through other edits and through a client re-sending it, as released iOS builds do', async () => {
    expect((await call(admin, 'PATCH', `/books/${bookId}/metadata`, { publisher: 'Edited House' })).statusCode).toBe(200);
    const resent = await call(admin, 'PATCH', `/books/${bookId}/metadata`, {
      communityRatings: [{ provider: KEY, rating: 4.2, ratingCount: 321 }],
    });
    expect(resent.statusCode).toBe(200);
    expect((await detail()).communityRatings).toEqual(expect.arrayContaining([expect.objectContaining({ provider: KEY })]));
  });

  it('edits external ids through the metadata PATCH, for registered providers only', async () => {
    const edited = await call(admin, 'PATCH', `/books/${bookId}/metadata`, { externalProviderIds: { [KEY]: 'fp-2' } });
    expect(edited.statusCode).toBe(200);
    expect((await detail()).providerIds[KEY]).toBe('fp-2');

    const unknown = await call(admin, 'PATCH', `/books/${bookId}/metadata`, { externalProviderIds: { 'not-registered': 'x' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ errorCode: 'METADATA_PROVIDER_UNKNOWN' });

    const builtIn = await call(admin, 'PATCH', `/books/${bookId}/metadata`, { externalProviderIds: { goodreads: '1' } });
    expect(builtIn.statusCode).toBe(400);

    expect((await call(admin, 'PATCH', `/books/${bookId}/metadata`, { externalProviderIds: { 'not-registered': null } })).statusCode).toBe(200);
  });

  it('drops a disabled provider from searches but keeps what it stored', async () => {
    expect((await call(admin, 'PATCH', `/metadata-http-providers/${providerId}`, { enabled: false })).statusCode).toBe(200);
    const providers = (await call(reader, 'GET', '/metadata-fetch/providers')).json() as MetadataProviderInfo[];
    expect(providers.map((p) => p.key)).not.toContain(KEY);
    expect((await call(reader, 'GET', `/metadata-fetch/lookup?provider=${KEY}&id=fp-1`)).json()).toBeNull();
    expect((await detail()).providerIds[KEY]).toBe('fp-2');
  });

  it('purges its ids and ratings only when asked', async () => {
    expect((await call(admin, 'DELETE', `/metadata-http-providers/${providerId}?purge=true`)).statusCode).toBe(200);
    const ids = await ctx.db.select().from(schema.bookProviderIds).where(eq(schema.bookProviderIds.provider, KEY));
    const ratings = await ctx.db
      .select()
      .from(schema.bookCommunityRatings)
      .where(and(eq(schema.bookCommunityRatings.bookId, bookId), eq(schema.bookCommunityRatings.provider, KEY)));
    expect(ids).toEqual([]);
    expect(ratings).toEqual([]);
    expect((await call(admin, 'GET', '/metadata-http-providers')).json()).toEqual([]);
    expect((await call(reader, 'GET', `/metadata-providers/${KEY}/icon`)).statusCode).toBe(404);
  });
});
