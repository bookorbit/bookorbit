import fastifyCompress from '@fastify/compress';
import { CanActivate, ExecutionContext, Injectable, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { PodcastEventsController } from './podcast.controller';
import { PodcastEventsService } from './podcast-events.service';
import { PodcastGateway } from './podcast.gateway';

const listener = { id: 42, username: 'listener', isSuperuser: false, tokenVersion: 3 } as RequestUser;

/** Stands in for the global JWT guard so the route sees an authenticated user. */
@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest<{ user: RequestUser }>().user = listener;
    return true;
  }
}

@Module({
  controllers: [PodcastEventsController],
  providers: [PodcastEventsService, { provide: APP_GUARD, useClass: StubAuthGuard }, { provide: 'AuthService', useValue: {} }],
})
class PodcastEventsTestModule {}

/**
 * The SSE stream over a real socket, in the exact bytes a client parses.
 *
 * This is the drift guard between the two realtime channels: one download emit has to arrive on
 * the socket.io room and on the event stream, because both leave from the same gateway call.
 */
describe('podcast event stream over HTTP', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let events: PodcastEventsService;
  let gateway: PodcastGateway;
  let socketEmit: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const auth = { validateUser: vi.fn().mockResolvedValue({ id: 42 }) };
    const libraries = { verifyUserAccess: vi.fn().mockResolvedValue(undefined) };
    const moduleFixture = await Test.createTestingModule({ imports: [PodcastEventsTestModule] })
      .overrideProvider(PodcastEventsService)
      .useValue(new PodcastEventsService(auth as never, libraries as never))
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Production registers global compression; an SSE route that got wrapped in a gzip transform
    // would stall until its buffer filled, which is exactly the failure this asserts against.
    await app.register(fastifyCompress as never, { encodings: ['gzip', 'br'] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();

    events = app.get(PodcastEventsService);
    socketEmit = vi.fn();
    gateway = new PodcastGateway({} as never, {} as never, {} as never, events, { appUrl: 'http://localhost:6263' } as never);
    gateway['server'] = { to: vi.fn().mockReturnValue({ emit: socketEmit }) } as never;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('delivers a download on both channels, framed as text/event-stream', async () => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/podcast-events/stream`, { signal: abort.signal });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    const readUntil = async (predicate: (text: string) => boolean): Promise<void> => {
      const deadline = Date.now() + 5_000;
      while (!predicate(received)) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for stream content, got:\n${received}`);
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended early');
        received += decoder.decode(value, { stream: true });
      }
    };

    await readUntil((text) => text.includes('event: heartbeat'));

    gateway.emitDownloadProgress({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 512,
      totalBytes: 2048,
    });
    await readUntil((text) => text.includes('event: podcast:download:progress'));

    gateway.emitDownloadComplete({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 2048,
    });
    await readUntil((text) => text.includes('event: podcast:download:complete'));

    abort.abort();

    // The same two emits went to the socket.io room, from the same call site.
    expect(socketEmit).toHaveBeenNthCalledWith(1, 'podcast:download:progress', expect.objectContaining({ episodeId: 42, receivedBytes: 512 }));
    expect(socketEmit).toHaveBeenNthCalledWith(2, 'podcast:download:complete', expect.objectContaining({ episodeId: 42, mediaStatus: 'local' }));

    // Every dispatch is a name line, a data line, and a blank line: the framing the client parses.
    const progressFrame = received.split('\n\n').find((frame) => frame.includes('podcast:download:progress'));
    expect(progressFrame).toBeDefined();
    const dataLine = progressFrame!
      .split('\n')
      .find((line) => line.startsWith('data:'))!
      .slice('data:'.length)
      .trim();
    expect(JSON.parse(dataLine)).toEqual({
      libraryId: 7,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 512,
      totalBytes: 2048,
    });
  }, 20_000);

  it('does not compress or buffer the stream behind a content-length', async () => {
    const abort = new AbortController();
    const response = await fetch(`${baseUrl}/podcast-events/stream`, {
      signal: abort.signal,
      headers: { 'accept-encoding': 'gzip, br' },
    });

    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    abort.abort();
  }, 20_000);
});
