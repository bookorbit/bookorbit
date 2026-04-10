import 'reflect-metadata';

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { of } from 'rxjs';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AuthorsController } from './authors.controller';

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

function makeController() {
  const authorsService = {
    findAll: vi.fn(),
    getInsights: vi.fn(),
    listDuplicateSuggestions: vi.fn(),
    listMetadataProviders: vi.fn(),
    searchMetadata: vi.fn(),
    streamMetadata: vi.fn(),
    lookupMetadata: vi.fn(),
    bulkRefreshMetadata: vi.fn(),
    findOne: vi.fn(),
    findBooks: vi.fn(),
    getThumbnailPath: vi.fn(),
    getImagePath: vi.fn(),
    refreshEnrichment: vi.fn(),
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

  const controller = new AuthorsController(authorsService as never, enrichmentOrchestrator as never, enrichmentConfig as never, queueRepo as never);

  return { controller, authorsService, enrichmentOrchestrator, enrichmentConfig, queueRepo };
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

  it('streams SSE progress and completion for bulk refresh', async () => {
    const { controller, authorsService } = makeController();
    const { reply, raw } = makeReply();
    const user = makeUser();
    authorsService.bulkRefreshMetadata.mockImplementation((_authorIds: number[], _u: RequestUser, onProgress: (event: object) => void) => {
      onProgress({ authorId: 5, status: 'queued' });
      return Promise.resolve({ queued: 1, processed: 1, failed: 0 });
    });

    await controller.bulkRefreshMetadata({ authorIds: [5] }, user, reply);

    expect(raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(raw.write).toHaveBeenNthCalledWith(1, `data: ${JSON.stringify({ authorId: 5, status: 'queued' })}\n\n`);
    expect(raw.write).toHaveBeenNthCalledWith(2, `data: ${JSON.stringify({ done: true, queued: 1, processed: 1, failed: 0 })}\n\n`);
    expect(raw.end).toHaveBeenCalled();
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

  it('delegates write endpoints for refresh/update/merge/delete', async () => {
    const { controller, authorsService } = makeController();
    const user = makeUser();
    authorsService.refreshEnrichment.mockResolvedValue({ id: 9 });
    authorsService.update.mockResolvedValue({ id: 9, name: 'Updated' });
    authorsService.merge.mockResolvedValue({ mergedAuthorIds: [2], affectedBookCount: 3 });
    authorsService.delete.mockResolvedValue({ deletedAuthorIds: [2], affectedBookCount: 3 });

    await expect(controller.refreshEnrichment(user, 9)).resolves.toEqual({ id: 9 });
    await expect(controller.update(user, 9, { name: 'Updated' })).resolves.toEqual({ id: 9, name: 'Updated' });
    await expect(controller.merge(user, { targetAuthorId: 9, sourceAuthorIds: [2] })).resolves.toEqual({
      mergedAuthorIds: [2],
      affectedBookCount: 3,
    });
    await expect(controller.delete(user, { authorIds: [2] })).resolves.toEqual({ deletedAuthorIds: [2], affectedBookCount: 3 });
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
