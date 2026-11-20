import 'reflect-metadata';

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { of } from 'rxjs';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BulkRunHandlerRegistry } from '../bulk-runs/bulk-run-handler.registry';
import { BulkRunsService } from '../bulk-runs/bulk-runs.service';
import { AuthorBulkRefreshHandler } from './author-bulk-refresh.handler';
import { AuthorsController } from './authors.controller';
import { BulkRefreshAuthorsMetadataDto } from './dto/bulk-refresh-authors-metadata.dto';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    createReadStream: vi.fn(() => ({ stream: true })),
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    stat: vi.fn(),
  };
});

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 11,
    username: 'author-admin',
    name: 'Author Admin',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeReply() {
  const headers: Record<string, unknown> = {};
  const raw = {
    destroyed: false,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(() => {
      raw.writableEnded = true;
    }),
  };

  const reply = {
    raw,
    status: vi.fn(),
    header: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };

  reply.status.mockImplementation(() => reply as never);
  reply.header.mockImplementation((key: string, value: unknown) => {
    headers[key] = value;
    return reply as never;
  });
  reply.type.mockImplementation(() => reply as never);
  reply.send.mockImplementation(() => reply as never);

  return { reply: reply as never, raw, headers };
}

function makeController(bulkRunsOverride?: BulkRunsService) {
  const authorsService = {
    findAll: vi.fn(),
    listMetadataProviders: vi.fn(),
    searchMetadata: vi.fn(),
    streamMetadata: vi.fn(),
    lookupMetadata: vi.fn(),
    authorizeBulkRefresh: vi.fn(),
    findOne: vi.fn(),
    findBooks: vi.fn(),
    getThumbnailPath: vi.fn(),
    getImagePath: vi.fn(),
    uploadImage: vi.fn(),
    deleteImage: vi.fn(),
    refreshEnrichment: vi.fn(),
    pinMetadataMatch: vi.fn(),
    unpinMetadataMatch: vi.fn(),
    update: vi.fn(),
    merge: vi.fn(),
    delete: vi.fn(),
  };
  const enrichmentOrchestrator = {
    backfillLinkedAuthors: vi.fn(),
    backfillAllLinkedAuthors: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancelPending: vi.fn(),
    requeueFailed: vi.fn(),
    getFailedItems: vi.fn(),
  };
  const enrichmentConfig = {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  };
  const queueRepo = {
    countEligibleLinkedAuthors: vi.fn(),
  };

  const metadataPreferences = {};
  const bulkRuns = { startAndStream: vi.fn().mockResolvedValue(undefined) };

  const controller = new AuthorsController(
    authorsService as never,
    enrichmentOrchestrator as never,
    enrichmentConfig as never,
    queueRepo as never,
    metadataPreferences as never,
    (bulkRunsOverride ?? bulkRuns) as never,
  );

  return { controller, authorsService, enrichmentOrchestrator, enrichmentConfig, queueRepo, bulkRuns };
}

describe('AuthorsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates list and detail endpoints to AuthorsService', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    authorsService.findAll.mockResolvedValue({ items: [], total: 0 });
    authorsService.findOne.mockResolvedValue({ id: 2, name: 'A' });
    authorsService.findBooks.mockResolvedValue({ items: [], total: 0 });

    await expect(controller.findAll(user, { page: 0 })).resolves.toEqual({ items: [], total: 0 });
    await expect(controller.findOne(user, 2)).resolves.toEqual({ id: 2, name: 'A' });
    await expect(controller.findBooks(user, 2, { page: 0 })).resolves.toEqual({ items: [], total: 0 });

    expect(authorsService.findAll).toHaveBeenCalledWith(user, { page: 0 });
    expect(authorsService.findOne).toHaveBeenCalledWith(user, 2);
    expect(authorsService.findBooks).toHaveBeenCalledWith(user, 2, { page: 0 });
  });

  it('returns metadata provider lists/searches and maps metadata stream events', async () => {
    const { controller, authorsService } = makeController();
    const candidate = { provider: 'audnexus', providerId: 'x1', name: 'Jane Doe' };
    authorsService.listMetadataProviders.mockResolvedValue([{ key: 'audnexus' }]);
    authorsService.searchMetadata.mockResolvedValue([candidate]);
    authorsService.lookupMetadata.mockResolvedValue(candidate);
    authorsService.streamMetadata.mockReturnValue(of(candidate));

    await expect(controller.listMetadataProviders()).resolves.toEqual([{ key: 'audnexus' }]);
    await expect(controller.searchMetadata({ q: 'Jane' })).resolves.toEqual([candidate]);
    await expect(controller.lookupMetadata({ provider: 'audnexus', id: 'x1' })).resolves.toEqual(candidate);

    const events = await new Promise<unknown[]>((resolve, reject) => {
      const rows: unknown[] = [];
      controller.streamMetadata({ q: 'Jane' }).subscribe({
        next: (row) => rows.push(row),
        error: reject,
        complete: () => resolve(rows),
      });
    });

    expect(events).toEqual([{ data: candidate }]);
  });

  it('authorizes the selection, then starts a bulk run that streams it', async () => {
    const { controller, authorsService, bulkRuns } = makeController();
    const { reply } = makeReply();
    const user = makeUser();
    authorsService.authorizeBulkRefresh.mockResolvedValue([5, 6]);

    await controller.bulkRefreshMetadata({ authorIds: [5, 6, 5], ignoreCache: true }, user, reply);

    expect(authorsService.authorizeBulkRefresh).toHaveBeenCalledWith(user, [5, 6, 5]);
    expect(bulkRuns.startAndStream).toHaveBeenCalledWith(reply, {
      kind: 'author-refresh-metadata',
      subjectIds: [5, 6],
      options: { ignoreCache: true },
      actor: user,
      audit: expect.objectContaining({ action: AuditAction.AuthorBulkMetadataRefresh, resource: AuditResource.Author }),
    });
    const audit = bulkRuns.startAndStream.mock.calls[0]![1].audit as { description: (count: number) => string };
    expect(audit.description(1)).toBe('Bulk refreshed metadata for 1 author');
    expect(audit.description(2)).toBe('Bulk refreshed metadata for 2 authors');
  });

  it('defaults ignoreCache to false', async () => {
    const { controller, authorsService, bulkRuns } = makeController();
    const { reply } = makeReply();
    authorsService.authorizeBulkRefresh.mockResolvedValue([5]);

    await controller.bulkRefreshMetadata({ authorIds: [5] }, makeUser(), reply);

    expect(bulkRuns.startAndStream).toHaveBeenCalledWith(reply, expect.objectContaining({ options: { ignoreCache: false } }));
  });

  it('refuses an unauthorized selection before the stream starts', async () => {
    const { controller, authorsService, bulkRuns } = makeController();
    const { reply, raw } = makeReply();
    authorsService.authorizeBulkRefresh.mockRejectedValue(
      new ForbiddenException('Insufficient library access to mutate one or more selected authors'),
    );

    await expect(controller.bulkRefreshMetadata({ authorIds: [5] }, makeUser(), reply)).rejects.toBeInstanceOf(ForbiddenException);

    expect(bulkRuns.startAndStream).not.toHaveBeenCalled();
    expect(raw.writeHead).not.toHaveBeenCalled();
  });

  it('answers an empty selection at once with an empty done and creates no run', async () => {
    const registry = new BulkRunHandlerRegistry();
    registry.register(new AuthorBulkRefreshHandler(registry, {} as never));
    const repo = { insertWithinLimit: vi.fn() };
    const bulkRuns = new BulkRunsService(repo as never, registry, {} as never, {} as never, {} as never, {} as never);
    const { controller, authorsService } = makeController(bulkRuns);
    const { reply, raw } = makeReply();
    authorsService.authorizeBulkRefresh.mockResolvedValue([]);

    await controller.bulkRefreshMetadata({ authorIds: [] }, makeUser(), reply);

    expect(raw.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'text/event-stream' }));
    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ done: true, processed: 0, failed: 0, updated: 0 })}\n\n`);
    expect(raw.end).toHaveBeenCalled();
    expect(repo.insertWithinLimit).not.toHaveBeenCalled();
  });

  it('records the bulk refresh in the audit log itself instead of through @Auditable', () => {
    expect(Reflect.getMetadata(AUDITABLE_KEY, AuthorsController.prototype.bulkRefreshMetadata)).toBeUndefined();
  });

  it('accepts the bulk refresh body with an optional ignoreCache only on that endpoint', () => {
    const [bulkRefreshBody] = Reflect.getMetadata('design:paramtypes', AuthorsController.prototype, 'bulkRefreshMetadata') as unknown[];
    const [deleteBody] = Reflect.getMetadata('design:paramtypes', AuthorsController.prototype, 'delete') as unknown[];

    expect(bulkRefreshBody).toBe(BulkRefreshAuthorsMetadataDto);
    expect(deleteBody).not.toBe(BulkRefreshAuthorsMetadataDto);
  });

  it('streams cache provenance alongside each candidate', async () => {
    const { controller, authorsService } = makeController();
    const cached = { provider: 'audnexus', providerId: 'x1', name: 'Jane Doe', cache: { fetchedAt: '2026-09-01T00:00:00.000Z', stale: false } };
    authorsService.streamMetadata.mockReturnValue(of(cached));

    const events = await new Promise<unknown[]>((resolve, reject) => {
      const rows: unknown[] = [];
      controller.streamMetadata({ q: 'Jane', cache: 'refresh' }).subscribe({
        next: (row) => rows.push(row),
        error: reject,
        complete: () => resolve(rows),
      });
    });

    expect(events).toEqual([{ data: cached }]);
    expect(authorsService.streamMetadata).toHaveBeenCalledWith({ q: 'Jane', cache: 'refresh' });
  });

  it('passes the backfill ignoreCache flag and tolerates an absent body', async () => {
    const { controller, enrichmentOrchestrator } = makeController();
    enrichmentOrchestrator.backfillLinkedAuthors.mockResolvedValue(2);
    enrichmentOrchestrator.backfillAllLinkedAuthors.mockResolvedValue(4);

    await expect(controller.enqueueBackfill({ ignoreCache: true })).resolves.toEqual({ queued: 2 });
    await expect(controller.enqueueBackfillAll({ ignoreCache: true })).resolves.toEqual({ queued: 4 });
    await expect(controller.enqueueBackfill(undefined)).resolves.toEqual({ queued: 2 });
    await expect(controller.enqueueBackfillAll({})).resolves.toEqual({ queued: 4 });

    expect(enrichmentOrchestrator.backfillLinkedAuthors.mock.calls).toEqual([[{ ignoreCache: true }], [{ ignoreCache: false }]]);
    expect(enrichmentOrchestrator.backfillAllLinkedAuthors.mock.calls).toEqual([[{ ignoreCache: true }], [{ ignoreCache: false }]]);
  });

  it('marks bulk metadata refresh endpoint as demo-restricted', () => {
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AuthorsController.prototype.bulkRefreshMetadata)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot perform bulk edits',
    });
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, AuthorsController.prototype.refreshEnrichment)).toBeUndefined();
  });

  it('returns enrichment config values and updates them', async () => {
    const { controller, enrichmentConfig } = makeController();
    const config = {
      enabled: true,
      triggerOnImport: false,
      writeMode: 'missing_only',
      conditions: { neverEnriched: true, missingBio: true, missingPhoto: false },
    };
    enrichmentConfig.getConfig.mockResolvedValue(config);
    enrichmentConfig.setConfig.mockResolvedValue(undefined);

    await expect(controller.getEnrichmentConfig()).resolves.toEqual(config);
    await expect(controller.setEnrichmentConfig(config)).resolves.toEqual(config);

    expect(enrichmentConfig.setConfig).toHaveBeenCalledWith(config);
    expect(enrichmentConfig.getConfig).toHaveBeenCalledTimes(2);
  });

  it('delegates orchestration and queue endpoints', async () => {
    const { controller, enrichmentOrchestrator, queueRepo } = makeController();
    queueRepo.countEligibleLinkedAuthors.mockResolvedValue(12);
    enrichmentOrchestrator.backfillLinkedAuthors.mockResolvedValue(8);
    enrichmentOrchestrator.backfillAllLinkedAuthors.mockResolvedValue(15);
    enrichmentOrchestrator.pause.mockResolvedValue(undefined);
    enrichmentOrchestrator.resume.mockResolvedValue(undefined);
    enrichmentOrchestrator.cancelPending.mockResolvedValue(undefined);
    enrichmentOrchestrator.requeueFailed.mockResolvedValue(3);
    enrichmentOrchestrator.getFailedItems.mockResolvedValue({ items: [], total: 0, page: 2, limit: 100 });

    await expect(controller.previewCount({ conditions: { neverEnriched: true, missingBio: false, missingPhoto: true } })).resolves.toEqual({
      count: 12,
    });
    await expect(controller.enqueueBackfill()).resolves.toEqual({ queued: 8 });
    await expect(controller.enqueueBackfillAll()).resolves.toEqual({ queued: 15 });
    await expect(controller.pauseEnrichment()).resolves.toEqual({ paused: true });
    await expect(controller.resumeEnrichment()).resolves.toEqual({ paused: false });
    await expect(controller.cancelEnrichment()).resolves.toEqual({ cancelled: true });
    await expect(controller.retryFailedEnrichment()).resolves.toEqual({ requeued: 3 });
    await expect(controller.getFailedEnrichment(2, 500)).resolves.toEqual({ items: [], total: 0, page: 2, limit: 100 });

    expect(enrichmentOrchestrator.getFailedItems).toHaveBeenCalledWith(2, 100);
  });

  it('serves thumbnail/image streams with cache and content headers', async () => {
    const { controller, authorsService } = makeController();
    const { reply: thumbnailReply, headers: thumbnailHeaders } = makeReply();
    const { reply: imageReply, headers: imageHeaders } = makeReply();
    const user = makeUser();
    vi.mocked(stat).mockResolvedValue({ mtimeMs: 1234 } as never);
    vi.mocked(createReadStream).mockReturnValue({ stream: true } as never);

    authorsService.getThumbnailPath.mockResolvedValue('/tmp/author-2-thumb.jpg');
    authorsService.getImagePath.mockResolvedValue('/tmp/author-2-image.png');

    await controller.getThumbnail(user, 2, thumbnailReply);
    await controller.getImage(user, 2, imageReply);

    expect(thumbnailHeaders['Cache-Control']).toBe('no-cache');
    expect(thumbnailHeaders['ETag']).toBe('"1234"');
    expect(thumbnailReply.type).toHaveBeenCalledWith('image/jpeg');

    expect(imageHeaders['Cache-Control']).toBe('no-cache');
    expect(imageHeaders['ETag']).toBe('"1234"');
    expect(imageReply.type).toHaveBeenCalledWith('image/png');
    expect(createReadStream).toHaveBeenCalledWith('/tmp/author-2-image.png');
  });

  it('returns 404 payloads when thumbnail/image files are missing', async () => {
    const { controller, authorsService } = makeController();
    const { reply: thumbnailReply } = makeReply();
    const { reply: imageReply } = makeReply();
    const user = makeUser();

    authorsService.getThumbnailPath.mockResolvedValue(null);
    authorsService.getImagePath.mockResolvedValue(null);

    await controller.getThumbnail(user, 44, thumbnailReply);
    await controller.getImage(user, 55, imageReply);

    expect(thumbnailReply.status).toHaveBeenCalledWith(404);
    expect(thumbnailReply.send).toHaveBeenCalledWith({ message: 'No thumbnail for author 44' });
    expect(imageReply.status).toHaveBeenCalledWith(404);
    expect(imageReply.send).toHaveBeenCalledWith({ message: 'No image for author 55' });
  });

  it('uploads author image bytes and delegates to AuthorsService', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    const bytes = Buffer.from('image-bytes');
    const req = {
      file: vi.fn().mockResolvedValue({
        mimetype: 'image/png',
        toBuffer: vi.fn().mockResolvedValue(bytes),
      }),
    };
    authorsService.uploadImage.mockResolvedValue({ id: 9, imageUrl: '/api/v1/authors/9/image' });

    await expect(controller.uploadImage(user, 9, req as never)).resolves.toEqual({ id: 9, imageUrl: '/api/v1/authors/9/image' });
    expect(authorsService.uploadImage).toHaveBeenCalledWith(user, 9, bytes, 'image/png');
  });

  it('returns bad request when upload image request has no multipart file', async () => {
    const { controller } = makeController();
    const user = makeUser();
    const req = {
      file: vi.fn().mockResolvedValue(undefined),
    };

    await expect(controller.uploadImage(user, 9, req as never)).rejects.toMatchObject({
      name: BadRequestException.name,
      message: 'No file provided',
    });
  });

  it('delegates write endpoints for refresh/update/merge/delete', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    authorsService.refreshEnrichment.mockResolvedValue({ id: 9, metadataCache: { fallbackProviders: [] } });
    authorsService.update.mockResolvedValue({ id: 9, name: 'Updated' });
    authorsService.merge.mockResolvedValue({ mergedAuthorIds: [2], affectedBookCount: 3 });
    authorsService.delete.mockResolvedValue({ deletedAuthorIds: [2], affectedBookCount: 3 });

    await expect(controller.refreshEnrichment(user, 9)).resolves.toEqual({ id: 9, metadataCache: { fallbackProviders: [] } });
    await expect(controller.update(user, 9, { name: 'Updated' })).resolves.toEqual({ id: 9, name: 'Updated' });
    await expect(controller.merge(user, { targetAuthorId: 9, sourceAuthorIds: [2] })).resolves.toEqual({
      mergedAuthorIds: [2],
      affectedBookCount: 3,
    });
    await expect(controller.delete(user, { authorIds: [2] })).resolves.toEqual({ deletedAuthorIds: [2], affectedBookCount: 3 });
  });

  it('delegates metadata match pin and unpin, gated and audited like an author edit', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    const dto = { provider: 'goodreads', providerId: '4567' } as never;
    authorsService.pinMetadataMatch.mockResolvedValue({ id: 9, metadataProviderPinned: true });
    authorsService.unpinMetadataMatch.mockResolvedValue({ id: 9, metadataProviderPinned: false });

    await expect(controller.pinMetadataMatch(user, 9, dto)).resolves.toEqual({ id: 9, metadataProviderPinned: true });
    expect(authorsService.pinMetadataMatch).toHaveBeenCalledWith(user, 9, dto);
    await expect(controller.unpinMetadataMatch(user, 9)).resolves.toEqual({ id: 9, metadataProviderPinned: false });
    expect(authorsService.unpinMetadataMatch).toHaveBeenCalledWith(user, 9);

    for (const handler of [AuthorsController.prototype.pinMetadataMatch, AuthorsController.prototype.unpinMetadataMatch]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.LibraryEditMetadata);
      const audit = Reflect.getMetadata(AUDITABLE_KEY, handler) as { action: string; getResourceId: (req: unknown) => number };
      expect(audit.action).toBe(AuditAction.AuthorUpdate);
      expect(audit.getResourceId({ params: { id: '9' } })).toBe(9);
    }
  });

  it('delegates delete image endpoint to AuthorsService', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    authorsService.deleteImage.mockResolvedValue({ id: 9, imageUrl: null });

    await expect(controller.deleteImage(user, 9)).resolves.toEqual({ id: 9, imageUrl: null });
    expect(authorsService.deleteImage).toHaveBeenCalledWith(user, 9);
  });

  it('uses correct merge audit description keys from DTO payload', () => {
    const options = Reflect.getMetadata(AUDITABLE_KEY, AuthorsController.prototype.merge) as {
      description: (req: { body: Record<string, unknown> }) => string;
    };

    const description = options.description({
      body: {
        sourceAuthorIds: [3, 4],
        targetAuthorId: 7,
      },
    });

    expect(description).toBe('Merged 2 author(s) into author #7');
  });
});
