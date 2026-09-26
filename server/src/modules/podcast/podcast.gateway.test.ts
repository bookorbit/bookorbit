import { describe, expect, it, vi } from 'vitest';

import { PodcastGateway } from './podcast.gateway';

function makeGateway() {
  const jwtService = { verify: vi.fn() };
  const authService = { validateSessionUser: vi.fn() };
  const libraries = { verifyUserAccess: vi.fn() };
  const events = {
    publishDownloadProgress: vi.fn(),
    publishDownloadComplete: vi.fn(),
    publishRefreshComplete: vi.fn(),
    publishImportProgress: vi.fn(),
    publishRetentionEvicted: vi.fn(),
  };
  const config = { appUrl: 'http://localhost:6263' };
  const gateway = new PodcastGateway(jwtService as never, authService as never, libraries as never, events as never, config as never);
  return { gateway, jwtService, authService, libraries, events };
}

describe('PodcastGateway', () => {
  it('authenticates connections and stores the current user on the socket', async () => {
    const { gateway, jwtService, authService } = makeGateway();
    jwtService.verify.mockReturnValue({ sub: 42, ver: 3, amr: 'password' });
    authService.validateSessionUser.mockResolvedValue({ id: 42, username: 'listener', isSuperuser: false });
    const client = {
      id: 'podcast-1',
      handshake: { auth: { token: 'valid' } },
      data: {},
      emit: vi.fn(),
      disconnect: vi.fn(),
    };

    await gateway.handleConnection(client as never);

    expect(jwtService.verify).toHaveBeenCalledWith('valid', { algorithms: ['HS256'] });
    expect(authService.validateSessionUser).toHaveBeenCalledWith(42, 3, 'password', undefined);
    expect(client.data).toEqual({ user: { id: 42, username: 'listener', isSuperuser: false } });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('joins only libraries the authenticated user can access', async () => {
    const { gateway, libraries } = makeGateway();
    libraries.verifyUserAccess.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'));
    const client = {
      data: { user: { id: 42, isSuperuser: false } },
      join: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };

    await gateway.handleSubscribeLibrary(client as never, 7);
    await gateway.handleSubscribeLibrary(client as never, 8);

    expect(libraries.verifyUserAccess).toHaveBeenNthCalledWith(1, 42, 7, false);
    expect(libraries.verifyUserAccess).toHaveBeenNthCalledWith(2, 42, 8, false);
    expect(client.join).toHaveBeenCalledOnce();
    expect(client.join).toHaveBeenCalledWith('library:7');
    expect(client.emit).toHaveBeenCalledWith('podcast:subscription:error', { libraryId: 8 });
  });

  it('emits podcast events only to the owning library room', () => {
    const { gateway } = makeGateway();
    const emit = vi.fn();
    const to = vi.fn().mockReturnValue({ emit });
    gateway['server'] = { to } as never;
    const event = {
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading' as const,
      receivedBytes: 50,
      totalBytes: 100,
    };

    gateway.emitDownloadProgress(event);

    expect(to).toHaveBeenCalledWith('library:7');
    expect(emit).toHaveBeenCalledWith('podcast:download:progress', event);
  });

  it('tees every broadcast to the server-sent events stream so the two channels cannot drift', () => {
    const { gateway, events } = makeGateway();
    gateway['server'] = { to: vi.fn().mockReturnValue({ emit: vi.fn() }) } as never;
    const progress = { libraryId: 7, podcastId: 3, episodeId: 42, batchId: null, status: 'queued' as const, receivedBytes: 0, totalBytes: null };
    const complete = {
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local' as const,
      localSizeBytes: 1024,
    };
    const refresh = { libraryId: 7, podcastId: 3, newEpisodes: 2, consecutiveFailures: 0, lastError: null };
    const importProgress = { libraryId: 7, queued: 1, processing: 2, failed: 0 };
    const evicted = { libraryId: 7, podcastId: 3, episodeId: 42, reason: 'played' as const };

    gateway.emitDownloadProgress(progress);
    gateway.emitDownloadComplete(complete);
    gateway.emitRefreshComplete(refresh);
    gateway.emitImportProgress(importProgress);
    gateway.emitRetentionEvicted(evicted);

    expect(events.publishDownloadProgress).toHaveBeenCalledWith(progress);
    expect(events.publishDownloadComplete).toHaveBeenCalledWith(complete);
    expect(events.publishRefreshComplete).toHaveBeenCalledWith(refresh);
    expect(events.publishImportProgress).toHaveBeenCalledWith(importProgress);
    expect(events.publishRetentionEvicted).toHaveBeenCalledWith(evicted);
  });

  it('still reaches the events stream when no socket.io server is attached', () => {
    const { gateway, events } = makeGateway();
    const progress = { libraryId: 7, podcastId: 3, episodeId: 42, batchId: null, status: 'downloading' as const, receivedBytes: 10, totalBytes: 100 };

    gateway.emitDownloadProgress(progress);

    expect(events.publishDownloadProgress).toHaveBeenCalledWith(progress);
  });
});
