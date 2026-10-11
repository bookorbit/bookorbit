import { createHash, randomUUID } from 'crypto';
import { readFile, rename, stat, writeFile } from 'fs/promises';
import { and, asc, eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';
import * as unzipper from 'unzipper';
import { KepubConversionService } from '../src/modules/kobo/services/kepub-conversion.service';
import { SYNC_PAGE_SIZE } from '../src/modules/kobo/services/kobo-sync.service';
import * as schema from '../src/db/schema';
import { waitForCondition } from './e2e/app-harness';
import { createEpubFixture, createZipArchiveFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type ReaderStateIsolationE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

describe('Read-aloud delivery contracts (e2e)', { timeout: 180_000 }, () => {
  let ctx: ReaderStateIsolationE2EContext;
  let book: LocatedBookFile;
  let owner: TestUserSession;
  let outsider: TestUserSession;
  let sourcePath: string;
  let sourceBytes: Buffer;
  const koHeaders = () => ({ 'x-auth-user': owner.username, 'x-auth-key': owner.password });
  const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url,
      headers: authHeader(owner.accessToken),
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  async function detail(variant: string) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/plugin/catalog/books/${book.bookId}?variant=${variant}`,
      headers: koHeaders(),
    });
    expect(response.statusCode).toBe(200);
    return response.json().files.find((file: { id: number }) => file.id === book.bookFileId) as {
      id: number;
      downloadUrl: string;
      selection: string;
      sizeBytes: number | null;
      fileHash: string | null;
      devicePath: string;
    };
  }
  const acquire = (url: string, extraHeaders = {}) => ctx.app.inject({ method: 'GET', url, headers: { ...koHeaders(), ...extraHeaders } });
  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx);
    sourcePath = await createZipArchiveFixture(library.folderPath, 'narrated.epub', [
      { path: 'mimetype', content: 'application/epub+zip', store: true },
      {
        path: 'META-INF/container.xml',
        content:
          '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      },
      {
        path: 'OPS/book.opf',
        content: `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Narrated delivery fixture</dc:title><dc:identifier id="uid">urn:uuid:${randomUUID()}</dc:identifier><dc:language>en</dc:language><meta property="media:duration">0:00:10</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay"/><item id="overlay" href="overlay.smil" media-type="application/smil+xml"/><item id="audio" href="audio.mp3" media-type="audio/mpeg"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
      },
      {
        path: 'OPS/chapter.xhtml',
        content:
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><p><span id="sentence-1">Narration anchor survives delivery.</span></p></body></html>',
      },
      {
        path: 'OPS/overlay.smil',
        content:
          '<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="chapter.xhtml#sentence-1"/><audio src="audio.mp3" clipBegin="0s" clipEnd="10s"/></par></seq></body></smil>',
      },
      { path: 'OPS/audio.mp3', content: Buffer.alloc(2 * 1024 * 1024, 7), store: true },
    ]);
    sourceBytes = await readFile(sourcePath);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    book = await locateBookByAbsolutePath(ctx, sourcePath);
    owner = await createUserAndLogin(ctx, {
      permissions: [Permission.KoreaderSync, Permission.KoboSync, Permission.OpdsAccess, Permission.EmailSend],
    });
    outsider = await createUserAndLogin(ctx, {
      permissions: [Permission.KoreaderSync, Permission.KoboSync, Permission.OpdsAccess, Permission.EmailSend],
    });
    await grantLibraryAccess(ctx, owner.userId, library.libraryId);
    expect((await request('POST', '/api/v1/koreader/credentials', { username: owner.username, password: owner.password })).statusCode).toBe(201);
  });
  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('persists KOReader defaults without changing omitted fields and isolates users', async () => {
    expect((await request('PATCH', '/api/v1/koreader/credentials', { readAloudDelivery: 'original' })).statusCode).toBe(200);
    expect((await request('PATCH', '/api/v1/koreader/credentials', { syncEnabled: true })).statusCode).toBe(200);
    const url = '/api/v1/koreader/plugin/delivery-settings/delivery-device-a';
    const settings = await ctx.app.inject({ method: 'GET', url, headers: koHeaders() });
    expect(settings.json()).toMatchObject({ readAloudDelivery: 'original', credentialDefault: 'original', deviceConfigured: false });
    expect(
      (await ctx.app.inject({ method: 'GET', url, headers: { 'x-auth-user': outsider.username, 'x-auth-key': outsider.password } })).statusCode,
    ).toBe(401);
    expect((await request('PATCH', '/api/v1/koreader/credentials', { readAloudDelivery: 'invalid' })).statusCode).toBe(400);
  });

  it('imports legacy device choices once without overwriting configured defaults', async () => {
    expect((await request('PATCH', '/api/v1/koreader/credentials', { readAloudDelivery: 'original' })).statusCode).toBe(200);
    const url = '/api/v1/koreader/plugin/delivery-settings/delivery-device-a';
    const put = (readAloudDelivery: string | null, migrateOnly = false) =>
      ctx.app.inject({ method: 'PUT', url, headers: koHeaders(), payload: { readAloudDelivery, migrateOnly } });
    expect((await put('audioless_epub', true)).json()).toMatchObject({ readAloudDelivery: 'original', deviceOverride: null, deviceConfigured: true });
    expect((await put('audioless_epub')).json()).toMatchObject({ readAloudDelivery: 'audioless_epub', deviceOverride: 'audioless_epub' });
    expect((await put('original', true)).json()).toMatchObject({ readAloudDelivery: 'audioless_epub' });
    expect((await put(null)).json()).toMatchObject({ readAloudDelivery: 'original', deviceOverride: null });
    expect((await request('PATCH', '/api/v1/koreader/credentials', { readAloudDelivery: null })).statusCode).toBe(200);
    const legacy = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/plugin/delivery-settings/delivery-device-b',
      headers: koHeaders(),
      payload: { readAloudDelivery: 'original', migrateOnly: true },
    });
    expect(legacy.json()).toMatchObject({ readAloudDelivery: 'original', deviceOverride: 'original' });
    expect((await put(null, true)).json()).toMatchObject({ readAloudDelivery: 'audioless_epub' });
  });

  it('validates device settings and enforces web permissions', async () => {
    const url = '/api/v1/koreader/devices/delivery-device-b/delivery-settings';
    expect((await request('PATCH', url, { readAloudDelivery: 'audioless_epub' })).statusCode).toBe(200);
    expect(
      (await ctx.app.inject({ method: 'PATCH', url, headers: authHeader(outsider.accessToken), payload: { readAloudDelivery: 'original' } }))
        .statusCode,
    ).toBe(404);
    const restricted = await createUserAndLogin(ctx);
    expect(
      (await ctx.app.inject({ method: 'PATCH', url, headers: authHeader(restricted.accessToken), payload: { readAloudDelivery: 'original' } }))
        .statusCode,
    ).toBe(403);
    expect((await request('PATCH', url, {})).statusCode).toBe(400);
    expect((await request('PATCH', url, { readAloudDelivery: 'unknown' })).statusCode).toBe(400);
    expect((await request('PATCH', '/api/v1/koreader/devices/bad_device/delivery-settings', { readAloudDelivery: null })).statusCode).toBe(400);
    const read = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/plugin/delivery-settings/delivery-device-b', headers: koHeaders() });
    expect(read.json().readAloudDelivery).toBe('audioless_epub');
  });

  it('keeps the same device identifier separate between accounts and clears settings with credentials', async () => {
    const headers = authHeader(outsider.accessToken);
    const credentials = { username: outsider.username, password: outsider.password, readAloudDelivery: 'original' };
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/koreader/credentials', headers, payload: credentials })).statusCode).toBe(201);
    const url = '/api/v1/koreader/plugin/delivery-settings/delivery-device-b';
    const pluginHeaders = { 'x-auth-user': outsider.username, 'x-auth-key': outsider.password };
    expect((await ctx.app.inject({ method: 'GET', url, headers: pluginHeaders })).json()).toMatchObject({
      readAloudDelivery: 'original',
      deviceConfigured: false,
    });
    expect((await ctx.app.inject({ method: 'PUT', url, headers: pluginHeaders, payload: { readAloudDelivery: 'audioless_epub' } })).statusCode).toBe(
      200,
    );
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/v1/koreader/credentials', headers })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/koreader/credentials', headers, payload: credentials })).statusCode).toBe(201);
    expect((await ctx.app.inject({ method: 'GET', url, headers: pluginHeaders })).json()).toMatchObject({
      readAloudDelivery: 'original',
      deviceOverride: null,
      deviceConfigured: false,
    });
    expect((await ctx.app.inject({ method: 'GET', url, headers: koHeaders() })).json()).toMatchObject({
      readAloudDelivery: 'audioless_epub',
      deviceOverride: 'audioless_epub',
    });
  });

  it('continues past failed delivery pages, retries expired failures, and removes deferred books', async () => {
    const library = await createLibraryWithFolder(ctx);
    for (let index = 0; index <= SYNC_PAGE_SIZE; index++) {
      await createEpubFixture(library.folderPath, `retry-${index}.epub`, { title: `Delivery retry ${index}` });
    }
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const files = await ctx.db
      .select({ bookId: schema.books.id, path: schema.bookFiles.absolutePath })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.books.primaryFileId, schema.bookFiles.id))
      .where(eq(schema.books.libraryId, library.libraryId))
      .orderBy(asc(schema.books.id));
    expect(files).toHaveLength(SYNC_PAGE_SIZE + 1);
    await grantLibraryAccess(ctx, owner.userId, library.libraryId);
    const collection = (await request('POST', '/api/v1/collections', { name: 'Delivery retry pagination', icon: 'book', syncToKobo: true })).json();
    expect((await request('POST', `/api/v1/collections/${collection.id}/books`, { bookIds: files.map((file) => file.bookId) })).statusCode).toBe(201);
    await request('PATCH', '/api/v1/kobo/settings', { readAloudDelivery: 'original', convertToKepub: false });
    const device = (await request('POST', '/api/v1/kobo/devices', { name: 'Delivery retry pagination' })).json();
    const sync = () => ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${device.token}/v1/library/sync` });
    const deferred = files.slice(0, SYNC_PAGE_SIZE);
    for (const file of deferred) await rename(file.path, `${file.path}.unavailable`);
    try {
      const initial = await sync();
      expect(initial.statusCode).toBe(200);
      expect(initial.headers['x-kobo-sync']).toBe('continue');
      const snapshot = await ctx.db.query.koboLibrarySnapshots.findFirst({ where: eq(schema.koboLibrarySnapshots.deviceId, device.id) });
      expect(snapshot).toBeDefined();
      const healthy = files[SYNC_PAGE_SIZE]!;
      const next = await sync();
      expect(next.statusCode).toBe(200);
      const identity = await ctx.db.query.koboBookEntitlements.findFirst({
        where: and(eq(schema.koboBookEntitlements.userId, owner.userId), eq(schema.koboBookEntitlements.bookId, healthy.bookId)),
      });
      expect(next.json()).toContainEqual(
        expect.objectContaining({
          NewEntitlement: expect.objectContaining({ BookEntitlement: expect.objectContaining({ Id: identity!.entitlementId }) }),
        }),
      );
      expect(next.headers['x-kobo-sync']).not.toBe('continue');
      const first = deferred[0]!;
      await rename(`${first.path}.unavailable`, first.path);
      await ctx.db
        .update(schema.koboSnapshotBooks)
        .set({ deliveryRetryAt: new Date(0) })
        .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot!.id), eq(schema.koboSnapshotBooks.bookId, first.bookId)));
      const recovered = await sync();
      expect(recovered.statusCode).toBe(200);
      const recoveredRow = await ctx.db.query.koboSnapshotBooks.findFirst({
        where: and(eq(schema.koboSnapshotBooks.snapshotId, snapshot!.id), eq(schema.koboSnapshotBooks.bookId, first.bookId)),
      });
      expect(recoveredRow).toMatchObject({ synced: true, deliveryRetryAt: null, deliveryFailureCode: null });
      const removed = deferred[1]!;
      const remove = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/collections/${collection.id}/books`,
        headers: authHeader(owner.accessToken),
        payload: { bookIds: [removed.bookId] },
      });
      expect(remove.statusCode).toBe(200);
      await ctx.db
        .update(schema.koboSnapshotBooks)
        .set({ pendingDelete: true })
        .where(and(eq(schema.koboSnapshotBooks.snapshotId, snapshot!.id), eq(schema.koboSnapshotBooks.bookId, removed.bookId)));
      const removal = await sync();
      expect(removal.statusCode).toBe(200);
      expect(removal.json()).toContainEqual(expect.objectContaining({ ChangedEntitlement: expect.anything() }));
      expect(
        await ctx.db.query.koboSnapshotBooks.findFirst({
          where: and(eq(schema.koboSnapshotBooks.snapshotId, snapshot!.id), eq(schema.koboSnapshotBooks.bookId, removed.bookId)),
        }),
      ).toBeUndefined();
    } finally {
      for (const file of deferred) await rename(`${file.path}.unavailable`, file.path).catch(() => {});
      await ctx.db.delete(schema.collections).where(eq(schema.collections.id, collection.id));
      await ctx.db
        .delete(schema.userLibraryAccess)
        .where(and(eq(schema.userLibraryAccess.userId, owner.userId), eq(schema.userLibraryAccess.libraryId, library.libraryId)));
    }
  });

  it('offers separate pinned variants and preserves every original byte', async () => {
    const original = await detail('original');
    const text = await detail('audioless_epub');
    expect(original.sizeBytes).toBe(sourceBytes.length);
    expect(text.sizeBytes).toBeNull();
    expect(original.devicePath).not.toBe(text.devicePath);
    const response = await acquire(original.downloadUrl);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(sourceBytes);
    expect(response.headers.etag).toBe(`"${createHash('sha256').update(sourceBytes).digest('hex')}"`);
  });

  it('strips narration, preserves anchors, registers identity, and rebuilds deterministically', async () => {
    const file = await detail('audioless_epub');
    const first = await acquire(file.downloadUrl);
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-bookorbit-variant']).toBe('audioless_epub');
    const zip = await unzipper.Open.buffer(first.rawPayload);
    expect(zip.files.some((entry) => /\.(?:smil|mp3)$/i.test(entry.path))).toBe(false);
    expect((await zip.files.find((entry) => entry.path.endsWith('.xhtml'))!.buffer()).toString()).toContain('id="sentence-1"');
    const second = await acquire(file.downloadUrl);
    expect(second.rawPayload).toEqual(first.rawPayload);
    const measured = await detail('audioless_epub');
    expect(measured.sizeBytes).toBe(first.rawPayload.length);
    expect(measured.fileHash).toBe(first.headers['x-bookorbit-file-hash']);
    const fingerprint = first.headers['x-bookorbit-file-hash'];
    const match = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/match-check',
      headers: koHeaders(),
      payload: { hashes: [fingerprint], deviceId: 'delivery-contract', deviceModel: 'Simulator', pluginVersion: '1.5.5' },
    });
    expect(match.statusCode).toBe(201);
    expect(match.json().matches).toContainEqual(expect.objectContaining({ bookFileId: book.bookFileId }));
  });

  it('serves ranges with artifact validators and rejects invalid offsets', async () => {
    const file = await detail('original');
    const full = await acquire(file.downloadUrl);
    const range = await acquire(file.downloadUrl, { range: 'bytes=20-99', 'if-range': full.headers.etag });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload).toEqual(sourceBytes.subarray(20, 100));
    expect(range.headers['content-range']).toBe(`bytes 20-99/${sourceBytes.length}`);
    expect((await acquire(file.downloadUrl, { range: 'bytes=0-9', 'if-range': '"different"' })).statusCode).toBe(200);
    expect((await acquire(file.downloadUrl, { range: `bytes=${sourceBytes.length}-` })).statusCode).toBe(416);
  });

  it('rejects a variant mismatch and removed book access on a cached artifact', async () => {
    const file = await detail('original');
    expect((await acquire(file.downloadUrl.replace('variant=original', 'variant=audioless_epub'))).statusCode).toBe(403);
    await ctx.db.delete(schema.userLibraryAccess).where(eq(schema.userLibraryAccess.userId, owner.userId));
    try {
      expect([403, 404]).toContain((await acquire(file.downloadUrl)).statusCode);
    } finally {
      const [row] = await ctx.db.select({ libraryId: schema.books.libraryId }).from(schema.books).where(eq(schema.books.id, book.bookId));
      await grantLibraryAccess(ctx, owner.userId, row!.libraryId);
    }
  });

  it('keeps OPDS profile choices independent and preserves omitted/null update semantics', async () => {
    const profiles = [];
    for (const variant of ['original', 'audioless_epub']) {
      const username = `delivery-${variant}-${randomUUID().slice(0, 8)}`;
      const password = 'DeliveryProfile123';
      const created = await request('POST', '/api/v1/opds-users', { username, password, sortOrder: 'title_desc', readAloudDelivery: variant });
      expect(created.statusCode).toBe(201);
      profiles.push({ ...created.json(), username, password });
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/opds/${book.bookId}/download`,
        headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-bookorbit-variant']).toBe(variant);
    }
    const profile = profiles[0];
    const unrelated = await request('PATCH', `/api/v1/opds-users/${profile.id}`, { sortOrder: 'recent' });
    expect(unrelated.statusCode).toBe(200);
    expect(unrelated.json().readAloudDelivery).toBe('original');
    const reset = await request('PATCH', `/api/v1/opds-users/${profile.id}`, { readAloudDelivery: null });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ sortOrder: 'recent', readAloudDelivery: null });
    const crossUser = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/opds-users/${profile.id}`,
      headers: authHeader(outsider.accessToken),
      payload: { readAloudDelivery: 'original' },
    });
    expect([403, 404]).toContain(crossUser.statusCode);
  });

  it('keeps old email payloads valid and normalizes an old-client Kindle edit', async () => {
    const created = await request('POST', '/api/v1/email/recipients', { name: 'Reader', email: 'reader@example.com', readAloudDelivery: 'original' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const changed = await request('PUT', `/api/v1/email/recipients/${id}`, { deviceType: 'kindle' });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().readAloudDelivery).toBe('audioless_epub');
    expect((await request('PUT', `/api/v1/email/recipients/${id}`, { readAloudDelivery: 'original' })).statusCode).toBe(400);
  });

  it('prepares a small Kobo derivative below the source limit and keeps two devices pinned', async () => {
    const first = (await request('POST', '/api/v1/kobo/devices', { name: 'Original device' })).json();
    const current = await request('GET', `/api/v1/kobo/devices/${first.id}/books/${book.bookId}/delivery`);
    expect(current.statusCode).toBe(200);
    expect(current.json()).toBeNull();
    await request('PATCH', '/api/v1/kobo/settings', { readAloudDelivery: 'original', convertToKepub: true, kepubConversionLimitMb: 1 });
    const original = await ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${first.token}/v1/books/${book.bookId}/download` });
    expect(original.statusCode).toBe(200);
    expect(original.rawPayload).toEqual(sourceBytes);
    const conversion = vi.spyOn(ctx.app.get(KepubConversionService), 'acquireKepub');
    const second = (await request('POST', '/api/v1/kobo/devices', { name: 'Text device' })).json();
    await request('PATCH', '/api/v1/kobo/settings', { readAloudDelivery: 'audioless_epub' });
    const text = await ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${second.token}/v1/books/${book.bookId}/download` });
    expect(text.statusCode).toBe(200);
    expect(text.rawPayload.length).toBeLessThan(1024 * 1024);
    expect(text.headers['x-bookorbit-variant']).toBe('audioless_epub');
    const status = (await request('GET', `/api/v1/kobo/devices/${second.id}/books/${book.bookId}/delivery`)).json();
    await expect(conversion.mock.results[0]!.value).resolves.toHaveProperty('path');
    conversion.mockRestore();
    expect(status.metadata.format).toBe('kepub');
    const repeated = await ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${first.token}/v1/books/${book.bookId}/download` });
    expect(repeated.rawPayload).toEqual(sourceBytes);
    const base = `/api/v1/kobo/devices/${first.id}`;
    const prepared = await request('POST', `${base}/books/${book.bookId}/replacement`, { variant: 'audioless_epub' });
    expect(prepared.statusCode).toBe(201);
    const replacement = prepared.json();
    expect(replacement.state).toBe('prepared');
    expect((await request('POST', `${base}/replacements/${replacement.id}/confirm`)).statusCode).toBe(409);
    expect((await request('POST', `${base}/replacements/${replacement.id}/cancel`)).statusCode).toBe(201);
    expect((await request('GET', `${base}/books/${book.bookId}/delivery`)).json().metadata.actualVariant).toBe('original');
  });

  it('recovers a guided replacement and requires observed transfer before confirmation', async () => {
    const device = (await request('POST', '/api/v1/kobo/devices', { name: 'Replacement recovery' })).json();
    await request('PATCH', '/api/v1/kobo/settings', { readAloudDelivery: 'original' });
    const download = () => ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${device.token}/v1/books/${book.bookId}/download` });
    expect((await download()).rawPayload).toEqual(sourceBytes);
    const base = `/api/v1/kobo/devices/${device.id}`;
    const begin = () => request('POST', `${base}/books/${book.bookId}/replacement`, { variant: 'audioless_epub' });
    const prepared = (await begin()).json();
    expect((await begin()).json().id).toBe(prepared.id);
    const action = (name: string) => request('POST', `${base}/replacements/${prepared.id}/${name}`);
    expect((await action('confirm')).statusCode).toBe(409);
    expect((await action('offer')).json().state).toBe('offered');
    expect((await action('confirm')).statusCode).toBe(409);
    const transferred = await download();
    expect(transferred.statusCode).toBe(200);
    expect(transferred.headers['x-bookorbit-variant']).toBe('audioless_epub');
    await waitForCondition(async () => {
      const record = await ctx.db.query.koboDeviceDeliveries.findFirst({ where: eq(schema.koboDeviceDeliveries.id, prepared.id) });
      expect(record?.state).toBe('transfer_observed');
    });
    const recovered = await request('GET', `${base}/books/${book.bookId}/delivery`);
    expect(recovered.json()).toMatchObject({ id: prepared.id, state: 'transfer_observed' });
    expect((await action('confirm')).json().state).toBe('user_confirmed');
    expect((await action('confirm')).json().state).toBe('user_confirmed');
    expect((await action('cancel')).json().state).toBe('user_confirmed');
  });

  describe('Storyteller progress-reset regressions over live HTTP', () => {
    let origin: string;
    const cfi = 'epubcfi(/6/2!/4/2/2/1:3)';
    async function http(method: string, path: string, body?: unknown, authenticated = true) {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: { ...(authenticated ? authHeader(owner.accessToken) : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      expect(response.ok).toBe(true);
      return response;
    }
    async function progress() {
      return (await http('GET', `/api/v1/books/files/${book.bookFileId}/progress`)).json();
    }
    async function save(percentage: number, value: string | null = cfi) {
      await http('POST', `/api/v1/books/files/${book.bookFileId}/progress`, { percentage, cfi: value, source: 'text' });
    }
    const devicePath = (device: { token: string }, suffix: string) => `/api/v1/kobo/${device.token}/v1/${suffix}`;
    async function newDevice(name: string) {
      return (await http('POST', '/api/v1/kobo/devices', { name })).json() as Promise<{ id: number; token: string }>;
    }
    async function download(device: { token: string }) {
      return http('GET', devicePath(device, `books/${book.bookId}/download`), undefined, false);
    }
    async function push(device: { token: string }, percentage: number, modified: string) {
      const response = await http(
        'PUT',
        devicePath(device, `library/${book.bookId}/state`),
        {
          ReadingStates: [
            {
              CurrentBookmark: { ProgressPercent: percentage, LastModified: modified },
              StatusInfo: {
                Status: percentage === 0 ? 'ReadyToRead' : 'Reading',
                TimesStartedReading: percentage === 0 ? 0 : 1,
                LastModified: modified,
              },
            },
          ],
        },
        false,
      );
      expect(await response.json()).toMatchObject({ RequestResult: 'Success', UpdateResults: [{ CurrentBookmarkResult: { Result: 'Success' } }] });
    }
    beforeAll(async () => {
      await ctx.app.listen(0, '127.0.0.1');
      origin = await ctx.app.getUrl();
      const collection = await (
        await http('POST', '/api/v1/collections', { name: 'Storyteller live progress proof', icon: 'book', syncToKobo: true })
      ).json();
      await http('POST', `/api/v1/collections/${collection.id}/books`, { bookIds: [book.bookId] });
      await http('PATCH', '/api/v1/kobo/settings', { twoWayProgressSync: true, readAloudDelivery: 'original' });
    });
    it('delivers saved progress on the first Kobo sync before any Kobo bookmark exists', async () => {
      await save(61);
      const device = await newDevice('Initial progress proof');
      const response = await http('GET', devicePath(device, 'library/sync'), undefined, false);
      const entries = (await response.json()) as Array<{ NewEntitlement?: { ReadingState: { CurrentBookmark: Record<string, unknown> } } }>;
      const entitlement = entries.find((entry) => entry.NewEntitlement)?.NewEntitlement;
      expect(entitlement?.ReadingState.CurrentBookmark).toMatchObject({ ProgressPercent: 61 });
      expect(entitlement?.ReadingState.CurrentBookmark.Location).toBeUndefined();
      expect(await progress()).toMatchObject({ percentage: 61, cfi });
    });
    it('returns canonical percentage when the narrated original has no precise Kobo position conversion', async () => {
      await save(61);
      const device = await newDevice('Unavailable conversion proof');
      expect(Buffer.from(await (await download(device)).arrayBuffer())).toEqual(sourceBytes);
      await push(device, 0, '2020-01-01T00:00:00Z');
      const states = await (await http('GET', devicePath(device, `library/${book.bookId}/state`), undefined, false)).json();
      expect(states[0].CurrentBookmark.ProgressPercent).toBe(61);
      expect(states[0].CurrentBookmark.Location).toBeUndefined();
      expect(await progress()).toMatchObject({ percentage: 61, cfi });
    });
    it('preserves progress through replacement, transfer, confirmation and delayed backwards events', async () => {
      await save(61);
      const device = await newDevice('Replacement progress proof');
      await (await download(device)).arrayBuffer();
      const base = `/api/v1/kobo/devices/${device.id}`;
      const replacement = await (await http('POST', `${base}/books/${book.bookId}/replacement`, { variant: 'audioless_epub' })).json();
      await http('POST', `${base}/replacements/${replacement.id}/offer`);
      for (const stage of ['offered', 'transfer_observed', 'user_confirmed']) {
        if (stage === 'transfer_observed') {
          const transfer = await download(device);
          expect(transfer.headers.get('x-bookorbit-variant')).toBe('audioless_epub');
          expect((await transfer.arrayBuffer()).byteLength).toBeLessThan(1024 * 1024);
        }
        if (stage === 'user_confirmed') await http('POST', `${base}/replacements/${replacement.id}/confirm`);
        const modified = new Date(Date.now() + 60_000).toISOString();
        await push(device, 0, modified);
        expect(await progress()).toMatchObject({ percentage: 61, cfi });
        const raw = await ctx.db.query.koboDeviceReadingStates.findFirst({
          where: and(eq(schema.koboDeviceReadingStates.deviceId, device.id), eq(schema.koboDeviceReadingStates.bookId, book.bookId)),
        });
        expect(raw?.currentBookmark).toMatchObject({ ProgressPercent: 0 });
        expect(raw?.deliveryId).not.toBe(replacement.id);
        const pulled = await (await http('GET', devicePath(device, `library/${book.bookId}/state`), undefined, false)).json();
        expect(pulled[0].CurrentBookmark.ProgressPercent).toBe(61);
        expect(pulled[0].StatusInfo.Status).toBe('Reading');
        expect(new Date(pulled[0].CurrentBookmark.LastModified).getTime()).toBeGreaterThan(new Date(modified).getTime());
      }
      await push(device, 20, new Date(Date.now() + 120_000).toISOString());
      expect(await progress()).toMatchObject({ percentage: 61, cfi });
      const sync = (await (await http('GET', devicePath(device, 'library/sync'), undefined, false)).json()) as Array<{
        NewEntitlement?: { ReadingState: { CurrentBookmark: { ProgressPercent: number } } };
        ChangedReadingState?: { ReadingState: { CurrentBookmark: { ProgressPercent: number } } };
      }>;
      expect(sync.some((entry) => (entry.NewEntitlement ?? entry.ChangedReadingState)?.ReadingState.CurrentBookmark.ProgressPercent === 61)).toBe(
        true,
      );
      await save(0, null);
      await push(device, 0, new Date(Date.now() + 180_000).toISOString());
      expect(await progress()).toMatchObject({ percentage: 0, cfi: null });
    });
    it('allows deliberate backwards reading on an unchanged known device copy', async () => {
      await save(61);
      const device = await newDevice('Deliberate reread proof');
      await (await download(device)).arrayBuffer();
      await waitForCondition(async () => {
        const record = await ctx.db.query.koboDeviceDeliveries.findFirst({
          where: and(eq(schema.koboDeviceDeliveries.deviceId, device.id), eq(schema.koboDeviceDeliveries.bookId, book.bookId)),
        });
        expect(record?.state).toBe('transfer_observed');
      });
      await push(device, 20, new Date(Date.now() + 60_000).toISOString());
      expect(await progress()).toMatchObject({ percentage: 20 });
      await push(device, 0, new Date(Date.now() + 120_000).toISOString());
      expect(await progress()).toMatchObject({ percentage: 0 });
    });
    it('delivers saved progress before any bookmark exists with two-way sync disabled', async () => {
      await http('PATCH', '/api/v1/kobo/settings', { twoWayProgressSync: false });
      try {
        await save(61);
        await ctx.db
          .delete(schema.koboReadingStates)
          .where(and(eq(schema.koboReadingStates.userId, owner.userId), eq(schema.koboReadingStates.bookId, book.bookId)));
        const device = await newDevice('One-way initial progress proof');
        const entries = await (await http('GET', devicePath(device, 'library/sync'), undefined, false)).json();
        const entitlement = entries.find((entry: { NewEntitlement?: unknown }) => entry.NewEntitlement)?.NewEntitlement;
        expect(entitlement?.ReadingState.CurrentBookmark.ProgressPercent).toBe(61);
        expect(entitlement?.ReadingState.CurrentBookmark.Location).toBeUndefined();
        expect(entitlement?.ReadingState.StatusInfo.Status).toBe('Reading');
        expect(await progress()).toMatchObject({ percentage: 61, cfi });
      } finally {
        await http('PATCH', '/api/v1/kobo/settings', { twoWayProgressSync: true });
      }
    });
    it('returns retained replacement progress even when two-way sync is disabled', async () => {
      await http('PATCH', '/api/v1/kobo/settings', { twoWayProgressSync: false });
      try {
        await save(61);
        const device = await newDevice('One-way replacement progress proof');
        await (await download(device)).arrayBuffer();
        const base = `/api/v1/kobo/devices/${device.id}`;
        const replacement = await (await http('POST', `${base}/books/${book.bookId}/replacement`, { variant: 'audioless_epub' })).json();
        await http('POST', `${base}/replacements/${replacement.id}/offer`);
        await push(device, 0, new Date(Date.now() + 60_000).toISOString());
        expect(await progress()).toMatchObject({ percentage: 61, cfi });
        const states = await (await http('GET', devicePath(device, `library/${book.bookId}/state`), undefined, false)).json();
        expect(states[0].CurrentBookmark.ProgressPercent).toBe(61);
        expect(states[0].StatusInfo.Status).toBe('Reading');
        const raw = await ctx.db.query.koboDeviceReadingStates.findFirst({
          where: and(eq(schema.koboDeviceReadingStates.deviceId, device.id), eq(schema.koboDeviceReadingStates.bookId, book.bookId)),
        });
        expect(raw?.currentBookmark).toMatchObject({ ProgressPercent: 0 });
      } finally {
        await http('PATCH', '/api/v1/kobo/settings', { twoWayProgressSync: true });
      }
    });
  });

  it('rejects a changed source revision before sending transfer headers', async () => {
    const file = await detail('original');
    expect((await acquire(file.downloadUrl)).statusCode).toBe(200);
    await writeFile(sourcePath, Buffer.concat([sourceBytes, Buffer.from('changed')]));
    try {
      expect((await acquire(file.downloadUrl)).statusCode).toBe(409);
    } finally {
      await writeFile(sourcePath, sourceBytes);
      const info = await stat(sourcePath);
      await ctx.db
        .update(schema.bookFiles)
        .set({ mtime: info.mtime, sizeBytes: info.size, ino: BigInt(info.ino), updatedAt: new Date() })
        .where(eq(schema.bookFiles.id, book.bookFileId));
    }
  });
});
