import { Injectable, Logger, type MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import type {
  PodcastDownloadCompleteEvent,
  PodcastDownloadProgressEvent,
  PodcastImportProgressEvent,
  PodcastRefreshCompleteEvent,
  PodcastRetentionEvictedEvent,
  PodcastShowDiscoveredEvent,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { LibraryService } from '../library/library.service';

export type PodcastStreamEventName =
  | 'podcast:download:progress'
  | 'podcast:download:complete'
  | 'podcast:refresh:complete'
  | 'podcast:import:progress'
  | 'podcast:show:discovered'
  | 'podcast:retention:evicted';

/**
 * One broadcast on its way to every subscriber that can see `libraryId`.
 *
 * `coalesceKey` marks the event as droppable: a newer event with the same key replaces an older
 * one that has not been written yet, which is what keeps a slow reader from accumulating a
 * megabyte of superseded byte counts. Terminal events carry no key and are always delivered.
 */
export interface PodcastStreamEvent {
  name: PodcastStreamEventName;
  libraryId: number;
  coalesceKey?: string;
  payload:
    | PodcastDownloadProgressEvent
    | PodcastDownloadCompleteEvent
    | PodcastRefreshCompleteEvent
    | PodcastImportProgressEvent
    | PodcastShowDiscoveredEvent
    | PodcastRetentionEvictedEvent;
}

/** How often a subscriber's pending events are written to its stream. */
export const PODCAST_EVENT_FLUSH_INTERVAL_MS = 250;
/** Silence longer than this is indistinguishable from a dead connection, so say something. */
export const PODCAST_EVENT_HEARTBEAT_INTERVAL_MS = 25_000;
/** Per-subscriber ceiling before droppable events start being discarded oldest-first. */
export const PODCAST_EVENT_BUFFER_CAPACITY = 256;
/** How long a library access decision is reused before it is asked again. */
export const PODCAST_EVENT_ACCESS_TTL_MS = 60_000;

/**
 * One subscriber's pending events.
 *
 * Coalescing happens in place so ordering against terminal events survives: the last progress
 * value for an episode is always the one delivered, and a completion never overtakes it.
 */
export class PodcastEventBuffer {
  private queue: PodcastStreamEvent[] = [];
  private droppedCount = 0;

  constructor(private readonly capacity: number = PODCAST_EVENT_BUFFER_CAPACITY) {}

  get size(): number {
    return this.queue.length;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  push(event: PodcastStreamEvent): void {
    if (event.coalesceKey !== undefined) {
      const existing = this.queue.findIndex((queued) => queued.coalesceKey === event.coalesceKey);
      if (existing >= 0) {
        this.queue[existing] = event;
        return;
      }
    }
    this.queue.push(event);
    while (this.queue.length > this.capacity) {
      const droppable = this.queue.findIndex((queued) => queued.coalesceKey !== undefined);
      // Only progress is droppable. A buffer holding nothing but terminal events grows rather
      // than losing a completion that no later event would repeat.
      if (droppable < 0) return;
      this.queue.splice(droppable, 1);
      this.droppedCount += 1;
    }
  }

  drain(): PodcastStreamEvent[] {
    const drained = this.queue;
    this.queue = [];
    return drained;
  }
}

/**
 * The server-sent-events half of the podcast realtime channel.
 *
 * Every gateway broadcast is teed here by `PodcastGateway`, so the socket.io namespace and this
 * stream cannot drift: they are the same emit path with two transports. Clients that cannot speak
 * Engine.IO (the iOS app forbids third-party dependencies) read ordinary HTTP instead.
 */
@Injectable()
export class PodcastEventsService {
  private readonly logger = new Logger(PodcastEventsService.name);
  private readonly events = new Subject<PodcastStreamEvent>();

  constructor(
    private readonly auth: AuthService,
    private readonly libraries: LibraryService,
  ) {}

  publishDownloadProgress(event: PodcastDownloadProgressEvent): void {
    this.publish({
      name: 'podcast:download:progress',
      libraryId: event.libraryId,
      coalesceKey: `download:${event.episodeId}`,
      payload: event,
    });
  }

  publishDownloadComplete(event: PodcastDownloadCompleteEvent): void {
    this.publish({ name: 'podcast:download:complete', libraryId: event.libraryId, payload: event });
  }

  publishRefreshComplete(event: PodcastRefreshCompleteEvent): void {
    this.publish({ name: 'podcast:refresh:complete', libraryId: event.libraryId, payload: event });
  }

  publishRetentionEvicted(event: PodcastRetentionEvictedEvent): void {
    // Terminal for the episode: nothing later repeats it, so it must not be droppable.
    this.publish({ name: 'podcast:retention:evicted', libraryId: event.libraryId, payload: event });
  }

  publishShowDiscovered(event: PodcastShowDiscoveredEvent): void {
    // Coalesced per show: while a show's files are still arriving its episode count is republished,
    // and only the newest count is worth delivering.
    this.publish({
      name: 'podcast:show:discovered',
      libraryId: event.libraryId,
      coalesceKey: `show:${event.podcastId}`,
      payload: event,
    });
  }

  publishImportProgress(event: PodcastImportProgressEvent): void {
    // An import readout is a running total, so only its latest value matters; coalescing in place
    // means the final idle summary is still the last thing written.
    this.publish({
      name: 'podcast:import:progress',
      libraryId: event.libraryId,
      coalesceKey: `import:${event.libraryId}`,
      payload: event,
    });
  }

  /**
   * The events this user is allowed to see, plus a heartbeat.
   *
   * The stream ends when the user's token version moves, which is what logout and a password
   * change do: an open stream must not outlive the session that opened it.
   */
  stream(user: RequestUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const buffer = new PodcastEventBuffer();
      const access = new Map<number, { checkedAt: number; allowed: boolean }>();
      let closed = false;
      // Access checks are async, so pushes are chained rather than raced: a completion must never
      // be buffered ahead of the progress event that preceded it.
      let admission: Promise<void> = Promise.resolve();

      const source = this.events.subscribe((event) => {
        admission = admission
          .then(async () => {
            if (closed) return;
            if (!(await this.canAccess(user, event.libraryId, access))) return;
            buffer.push(event);
          })
          .catch(() => undefined);
      });

      const flush = setInterval(() => {
        if (closed) return;
        for (const event of buffer.drain()) {
          subscriber.next({ type: event.name, data: event.payload });
        }
      }, PODCAST_EVENT_FLUSH_INTERVAL_MS);

      const heartbeat = setInterval(() => {
        void (async () => {
          try {
            await this.auth.validateSessionUser(user.id, user.tokenVersion, user.authenticationMethod ?? 'legacy', user.sessionId);
          } catch {
            this.logger.debug(`[podcast.sse_stream] [end] userId=${user.id} - stream closed by token invalidation`);
            subscriber.complete();
            return;
          }
          if (closed) return;
          subscriber.next(heartbeatMessage());
        })();
      }, PODCAST_EVENT_HEARTBEAT_INTERVAL_MS);

      // Opening beat: proves the stream is live before anything happens on it, and starts the
      // client's own silence watchdog from a known point.
      subscriber.next(heartbeatMessage());
      this.logger.debug(`[podcast.sse_stream] [start] userId=${user.id} - stream opened`);

      return () => {
        closed = true;
        clearInterval(flush);
        clearInterval(heartbeat);
        source.unsubscribe();
        if (buffer.dropped > 0) {
          this.logger.warn(`[podcast.sse_stream] [end] userId=${user.id} droppedEvents=${buffer.dropped} - slow stream shed progress events`);
        }
      };
    });
  }

  private publish(event: PodcastStreamEvent): void {
    if (!Number.isInteger(event.libraryId) || event.libraryId <= 0) return;
    this.events.next(event);
  }

  /**
   * Whether this subscriber may see a library's events, remembered briefly so a burst of progress
   * events is not a burst of access queries. The short life of the answer is what makes a revoked
   * grant take effect without waiting for the client to reconnect.
   */
  private async canAccess(user: RequestUser, libraryId: number, cache: Map<number, { checkedAt: number; allowed: boolean }>): Promise<boolean> {
    if (user.isSuperuser) return true;
    const now = Date.now();
    const cached = cache.get(libraryId);
    if (cached && now - cached.checkedAt < PODCAST_EVENT_ACCESS_TTL_MS) return cached.allowed;
    const allowed = await this.libraries
      .verifyUserAccess(user.id, libraryId, user.isSuperuser)
      .then(() => true)
      .catch(() => false);
    cache.set(libraryId, { checkedAt: now, allowed });
    return allowed;
  }
}

function heartbeatMessage(): MessageEvent {
  return { type: 'heartbeat', data: { at: new Date().toISOString() } };
}
