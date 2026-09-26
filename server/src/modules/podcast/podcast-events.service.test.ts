import { UnauthorizedException } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import {
  PODCAST_EVENT_ACCESS_TTL_MS,
  PODCAST_EVENT_BUFFER_CAPACITY,
  PODCAST_EVENT_FLUSH_INTERVAL_MS,
  PODCAST_EVENT_HEARTBEAT_INTERVAL_MS,
  PodcastEventBuffer,
  PodcastEventsService,
  type PodcastStreamEvent,
} from './podcast-events.service';

function progressEvent(episodeId: number, receivedBytes: number, libraryId = 7): PodcastStreamEvent {
  return {
    name: 'podcast:download:progress',
    libraryId,
    coalesceKey: `download:${episodeId}`,
    payload: { libraryId, podcastId: 3, episodeId, status: 'downloading', receivedBytes, totalBytes: 100 },
  };
}

function completeEvent(episodeId: number, libraryId = 7): PodcastStreamEvent {
  return {
    name: 'podcast:download:complete',
    libraryId,
    payload: { libraryId, podcastId: 3, episodeId, mediaStatus: 'local', localSizeBytes: 100 },
  };
}

describe('PodcastEventBuffer', () => {
  it('replaces a superseded progress event in place so ordering against completions survives', () => {
    const buffer = new PodcastEventBuffer(10);

    buffer.push(progressEvent(42, 10));
    buffer.push(completeEvent(7));
    buffer.push(progressEvent(42, 90));

    const drained = buffer.drain();
    expect(drained.map((event) => event.name)).toEqual(['podcast:download:progress', 'podcast:download:complete']);
    expect(drained[0].payload).toMatchObject({ episodeId: 42, receivedBytes: 90 });
    expect(buffer.dropped).toBe(0);
  });

  it('drops the oldest progress event when a slow reader fills the buffer', () => {
    const buffer = new PodcastEventBuffer(3);

    buffer.push(progressEvent(1, 1));
    buffer.push(progressEvent(2, 2));
    buffer.push(progressEvent(3, 3));
    buffer.push(progressEvent(4, 4));

    expect(buffer.drain().map((event) => (event.payload as { episodeId: number }).episodeId)).toEqual([2, 3, 4]);
    expect(buffer.dropped).toBe(1);
  });

  it('never discards a terminal event, even past capacity', () => {
    const buffer = new PodcastEventBuffer(2);

    buffer.push(completeEvent(1));
    buffer.push(completeEvent(2));
    buffer.push(completeEvent(3));

    expect(buffer.size).toBe(3);
    expect(buffer.dropped).toBe(0);
  });

  it('sheds progress before terminal events when both are queued', () => {
    const buffer = new PodcastEventBuffer(2);

    buffer.push(progressEvent(1, 1));
    buffer.push(completeEvent(2));
    buffer.push(completeEvent(3));

    expect(buffer.drain().map((event) => event.name)).toEqual(['podcast:download:complete', 'podcast:download:complete']);
    expect(buffer.dropped).toBe(1);
  });

  it('drains empty and leaves nothing behind', () => {
    const buffer = new PodcastEventBuffer();

    buffer.push(progressEvent(1, 1));
    expect(buffer.drain()).toHaveLength(1);
    expect(buffer.drain()).toHaveLength(0);
    expect(buffer.size).toBe(0);
    expect(PODCAST_EVENT_BUFFER_CAPACITY).toBeGreaterThan(0);
  });
});

describe('PodcastEventsService', () => {
  const listener: RequestUser = { id: 42, isSuperuser: false, tokenVersion: 3, authenticationMethod: 'password' } as RequestUser;
  let auth: { validateSessionUser: ReturnType<typeof vi.fn> };
  let libraries: { verifyUserAccess: ReturnType<typeof vi.fn> };
  let service: PodcastEventsService;
  let subscriptions: Subscription[];

  beforeEach(() => {
    vi.useFakeTimers();
    auth = { validateSessionUser: vi.fn().mockResolvedValue({ id: 42 }) };
    libraries = { verifyUserAccess: vi.fn().mockResolvedValue(undefined) };
    service = new PodcastEventsService(auth as never, libraries as never);
    subscriptions = [];
  });

  afterEach(() => {
    for (const subscription of subscriptions) subscription.unsubscribe();
    vi.useRealTimers();
  });

  function collect(user: RequestUser = listener) {
    const received: MessageEvent[] = [];
    let completed = false;
    const subscription = service.stream(user).subscribe({
      next: (event) => received.push(event),
      complete: () => {
        completed = true;
      },
    });
    subscriptions.push(subscription);
    return { received, isComplete: () => completed };
  }

  /** Lets the queued access checks settle, then writes whatever they admitted. */
  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(PODCAST_EVENT_FLUSH_INTERVAL_MS);
  }

  it('opens with a heartbeat so a client knows the stream is live before anything happens', () => {
    const { received } = collect();

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe('heartbeat');
  });

  it('delivers events for libraries the user can access', async () => {
    const { received } = collect();

    service.publishDownloadProgress({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 10,
      totalBytes: 100,
    });
    await flush();

    expect(received.slice(1)).toEqual([
      {
        type: 'podcast:download:progress',
        data: { libraryId: 7, podcastId: 3, episodeId: 42, batchId: null, status: 'downloading', receivedBytes: 10, totalBytes: 100 },
      },
    ]);
  });

  it('filters out events from libraries the user cannot access', async () => {
    // Access is asked in the order the events arrive: library 9 is refused, library 7 is allowed.
    libraries.verifyUserAccess.mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
    const { received } = collect();

    service.publishRefreshComplete({ libraryId: 9, podcastId: 1, newEpisodes: 4, consecutiveFailures: 0, lastError: null });
    service.publishRefreshComplete({ libraryId: 7, podcastId: 2, newEpisodes: 1, consecutiveFailures: 0, lastError: null });
    await flush();

    expect(libraries.verifyUserAccess).toHaveBeenNthCalledWith(1, 42, 9, false);
    expect(libraries.verifyUserAccess).toHaveBeenNthCalledWith(2, 42, 7, false);
    expect(received.slice(1).map((event) => (event.data as { podcastId: number }).podcastId)).toEqual([2]);
  });

  it('asks about a library once per subscriber until the answer expires', async () => {
    const { received } = collect();

    for (let index = 0; index < 5; index += 1) {
      service.publishDownloadProgress({
        libraryId: 7,
        podcastId: 3,
        episodeId: index,
        batchId: null,
        status: 'downloading',
        receivedBytes: 1,
        totalBytes: 2,
      });
    }
    await flush();
    expect(libraries.verifyUserAccess).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PODCAST_EVENT_ACCESS_TTL_MS);
    service.publishDownloadComplete({
      libraryId: 7,
      podcastId: 3,
      episodeId: 99,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 10,
    });
    await flush();

    expect(libraries.verifyUserAccess).toHaveBeenCalledTimes(2);
    expect(received.length).toBeGreaterThan(1);
  });

  it('never asks about access for a superuser', async () => {
    const { received } = collect({ id: 1, isSuperuser: true, tokenVersion: 1 } as RequestUser);

    service.publishDownloadComplete({
      libraryId: 11,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 10,
    });
    await flush();

    expect(libraries.verifyUserAccess).not.toHaveBeenCalled();
    expect(received.slice(1)).toHaveLength(1);
  });

  it('keeps a completion behind the latest progress value for the same episode', async () => {
    const { received } = collect();

    service.publishDownloadProgress({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 10,
      totalBytes: 100,
    });
    service.publishDownloadProgress({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 60,
      totalBytes: 100,
    });
    service.publishDownloadComplete({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 100,
    });
    await flush();

    expect(received.slice(1).map((event) => event.type)).toEqual(['podcast:download:progress', 'podcast:download:complete']);
    expect(received[1].data).toMatchObject({ receivedBytes: 60 });
  });

  it('ignores broadcasts with an unusable library id', async () => {
    const { received } = collect();

    service.publishRefreshComplete({ libraryId: 0, podcastId: 1, newEpisodes: 1, consecutiveFailures: 0, lastError: null });
    await flush();

    expect(received.slice(1)).toHaveLength(0);
  });

  it('beats every 25 seconds while the session is still valid', async () => {
    const { received } = collect();

    await vi.advanceTimersByTimeAsync(PODCAST_EVENT_HEARTBEAT_INTERVAL_MS * 2);

    expect(received.filter((event) => event.type === 'heartbeat')).toHaveLength(3);
    expect(auth.validateSessionUser).toHaveBeenCalledWith(42, 3, 'password', undefined);
  });

  it('ends the stream when the token version is invalidated', async () => {
    const { received, isComplete } = collect();
    auth.validateSessionUser.mockRejectedValue(new UnauthorizedException());

    await vi.advanceTimersByTimeAsync(PODCAST_EVENT_HEARTBEAT_INTERVAL_MS);

    expect(isComplete()).toBe(true);
    expect(received.filter((event) => event.type === 'heartbeat')).toHaveLength(1);
  });

  it('stops delivering to a subscriber that has gone away', async () => {
    const { received } = collect();
    subscriptions.pop()?.unsubscribe();

    service.publishDownloadComplete({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 10,
    });
    await flush();

    expect(received).toHaveLength(1);
  });

  it('fans one broadcast out to every entitled subscriber', async () => {
    const first = collect();
    const second = collect();

    service.publishRefreshComplete({ libraryId: 7, podcastId: 3, newEpisodes: 2, consecutiveFailures: 0, lastError: null });
    await flush();

    expect(first.received.slice(1)).toHaveLength(1);
    expect(second.received.slice(1)).toHaveLength(1);
  });
});
