import { HttpException, HttpStatus } from '@nestjs/common';
import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PodcastController, PodcastDownloadBatchController, PodcastEpisodeController } from './podcast.controller';

/**
 * Records what the stream route sets on the reply. Every method Fastify chains on returns the
 * same object, so the controller's chained calls work unchanged.
 */
function createReply() {
  const headers = new Map<string, unknown>();
  const reply = {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    header(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return reply;
    },
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    type(value: string) {
      headers.set('content-type', value);
      return reply;
    },
    send(payload?: unknown) {
      reply.body = payload;
      return reply;
    },
  };
  return reply;
}

describe('PodcastEpisodeController stream digest', () => {
  const digest = 'd'.repeat(64);
  const service = { requireEpisodeAccess: vi.fn() };
  const storage = { findAvailableLocalMedia: vi.fn(), openRemoteMedia: vi.fn() };
  const tickets = { issue: vi.fn() };
  const controller = new PodcastEpisodeController({} as never, {} as never, service as never, storage as never, tickets as never);
  const user = { id: 1 } as never;

  const localMedia = (checksum: string | null) => ({
    handle: { createReadStream: vi.fn(() => 'stream'), close: vi.fn() },
    size: 2_048,
    mimeType: 'audio/mpeg',
    fileName: 'episode.mp3',
    checksum,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service.requireEpisodeAccess.mockResolvedValue(undefined);
  });

  it('publishes the digest on a whole-file response so a device download can verify it', async () => {
    storage.findAvailableLocalMedia.mockResolvedValue(localMedia(digest));
    const reply = createReply();

    await controller.stream(11, undefined, user, reply as never);

    expect(reply.headers.get('x-content-sha256')).toBe(digest);
    expect(reply.headers.get('content-length')).toBe(2_048);
  });

  it('omits the digest from a partial response, which it does not describe', async () => {
    storage.findAvailableLocalMedia.mockResolvedValue(localMedia(digest));
    const reply = createReply();

    await controller.stream(11, 'bytes=0-99', user, reply as never);

    expect(reply.statusCode).toBe(206);
    expect(reply.headers.has('x-content-sha256')).toBe(false);
  });

  it('omits the digest when the cached file has none recorded', async () => {
    storage.findAvailableLocalMedia.mockResolvedValue(localMedia(null));
    const reply = createReply();

    await controller.stream(11, undefined, user, reply as never);

    expect(reply.headers.has('x-content-sha256')).toBe(false);
  });

  it('never claims a digest for an episode proxied from its origin', async () => {
    storage.findAvailableLocalMedia.mockResolvedValue(null);
    storage.openRemoteMedia.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'audio/mpeg', 'content-length': '2048' }),
      body: null,
    });
    const reply = createReply();

    await controller.stream(11, undefined, user, reply as never);

    expect(reply.headers.has('x-content-sha256')).toBe(false);
    expect(reply.headers.get('cache-control')).toBe('private, no-store');
  });

  it('marks the response uncacheable before it can fail, so a browser cannot pin a 410', async () => {
    // 410 is cacheable by default. A stored one would keep failing playback of an episode the
    // server has since been able to serve again, with no request reaching it to prove otherwise.
    storage.findAvailableLocalMedia.mockResolvedValue(null);
    storage.openRemoteMedia.mockRejectedValue(new HttpException('gone', HttpStatus.GONE));
    const reply = createReply();

    await expect(controller.stream(11, undefined, user, reply as never)).rejects.toBeInstanceOf(HttpException);

    expect(reply.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps a locally served episode uncacheable too', async () => {
    storage.findAvailableLocalMedia.mockResolvedValue({
      handle: { close: vi.fn(), createReadStream: () => Readable.from([]) },
      size: 10,
      mimeType: 'audio/mpeg',
      fileName: 'episode.mp3',
      checksum: null,
    });
    const reply = createReply();

    await controller.stream(11, undefined, user, reply as never);

    expect(reply.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('PodcastDownloadBatchController', () => {
  it('passes the current user through both user-scoped status routes', async () => {
    const service = {
      listActiveDownloadBatches: vi.fn().mockResolvedValue([]),
      findDownloadBatch: vi.fn().mockResolvedValue({ id: '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115' }),
    };
    const controller = new PodcastDownloadBatchController(service as never);
    const user = { id: 42 } as never;

    await controller.listActive(user);
    await controller.findOne('0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115', user);

    expect(service.listActiveDownloadBatches).toHaveBeenCalledWith(user);
    expect(service.findDownloadBatch).toHaveBeenCalledWith('0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115', user);
  });
});

describe('PodcastController artwork upload', () => {
  const service = {
    requirePodcastAccess: vi.fn(),
    uploadPodcastArtwork: vi.fn(),
    uploadPodcastArtworkFromUrl: vi.fn(),
    deletePodcastArtwork: vi.fn(),
  };
  const storage = { fetchArtwork: vi.fn() };
  const controller = new PodcastController(service as never, {} as never, {} as never, service as never, storage as never);
  const user = { id: 1 } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    service.uploadPodcastArtwork.mockResolvedValue({ id: 3, imageUrl: '/api/v1/podcasts/3/artwork?v=1', artworkUpdatedAt: null });
  });

  it('hands the uploaded bytes to the service', async () => {
    const request = { file: vi.fn().mockResolvedValue({ toBuffer: () => Promise.resolve(Buffer.from('png')) }) };

    await controller.uploadArtwork(3, user, request as never);

    expect(service.uploadPodcastArtwork).toHaveBeenCalledWith(3, Buffer.from('png'), user);
  });

  it('rejects an upload that carries no file part', async () => {
    const request = { file: vi.fn().mockResolvedValue(undefined) };

    await expect(controller.uploadArtwork(3, user, request as never)).rejects.toThrow('No artwork file provided');
    expect(service.uploadPodcastArtwork).not.toHaveBeenCalled();
  });
});
