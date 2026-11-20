import { ForbiddenException, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, STORY_GUIDE_FEATURE, type StoryGuideChangedEvent } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { rejectSocketConnection, resolveSocketUser, trackSocketHandshake } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AI_JOB_CHANGED, AiJobChanges, type AiJobChange } from '../ai-jobs/ai-job-changes.service';
import { AuthenticatorService } from '../auth/authenticator.service';
import { BookService } from '../book/book.service';
import { StoryTextService } from './story-text.service';

/** Changes heard within this window go out together, so a build's many writes reach a page as a few events. */
export const STORY_GUIDE_PUSH_MS = 500;

/** Books one socket may watch at once: a page watches one, so this only bounds a misbehaving client. */
export const STORY_GUIDE_WATCH_LIMIT = 20;

function bookRoom(bookId: number): string {
  return `story-guide:book:${bookId}`;
}

function isBookId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Tells book pages that their story guide status moved, so they ask again instead of polling.
 *
 * A socket watches a book only after the same access check as the status route, and the events say
 * which book changed and nothing else: what the viewer may see of the job comes from the status
 * route. `story-guide:queue-changed` is a broadcast with no payload, sent when any job changes
 * status, because that can move the place of every queued job.
 */
@WebSocketGateway({ namespace: '/story-guides', cors: { origin: wsCorsOrigin() } })
export class StoryGuidesGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server?: Server;
  private readonly logger = new Logger(StoryGuidesGateway.name);
  private readonly changedBooks = new Set<number>();
  private queueChanged = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handleChange = (change: AiJobChange): void => this.note(change);
  private stopHearingTexts: (() => void) | null = null;

  constructor(
    private readonly authenticator: AuthenticatorService,
    private readonly books: BookService,
    private readonly changes: AiJobChanges,
    private readonly texts: StoryTextService,
  ) {}

  onModuleInit(): void {
    this.changes.on(AI_JOB_CHANGED, this.handleChange);
    // A page showing "Checking this book" is waiting for exactly this.
    this.stopHearingTexts = this.texts.onComputed((bookId) => this.noteBook(bookId));
  }

  onModuleDestroy(): void {
    this.changes.off(AI_JOB_CHANGED, this.handleChange);
    this.stopHearingTexts?.();
    this.stopHearingTexts = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  async handleConnection(client: Socket): Promise<void> {
    await trackSocketHandshake(client, this.authenticate(client));
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[story_guide.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  /** Answers whether the socket now watches the book; a page that hears `false` keeps polling. */
  @SubscribeMessage('story-guide:watch')
  async watch(client: Socket, bookId: unknown): Promise<boolean> {
    const user = await resolveSocketUser(client);
    if (!user || !isBookId(bookId)) return false;
    const room = bookRoom(bookId);
    if (client.rooms.has(room)) return true;
    const watched = [...client.rooms].filter((name) => name.startsWith('story-guide:book:')).length;
    if (watched >= STORY_GUIDE_WATCH_LIMIT) return false;
    try {
      await this.books.verifyBookAccess(bookId, user);
    } catch {
      return false;
    }
    await client.join(room);
    return true;
  }

  @SubscribeMessage('story-guide:unwatch')
  async unwatch(client: Socket, bookId: unknown): Promise<boolean> {
    if (!isBookId(bookId)) return false;
    await client.leave(bookRoom(bookId));
    return true;
  }

  /** Sends what the last window heard. Public for tests; the timer calls it otherwise. */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const books = [...this.changedBooks];
    const queueChanged = this.queueChanged;
    this.changedBooks.clear();
    this.queueChanged = false;
    if (!this.server) return;
    for (const bookId of books) {
      const event: StoryGuideChangedEvent = { bookId };
      this.server.to(bookRoom(bookId)).emit('story-guide:changed', event);
    }
    if (queueChanged) this.server.emit('story-guide:queue-changed');
  }

  private note(change: AiJobChange): void {
    if (change.feature !== STORY_GUIDE_FEATURE) return;
    const bookId = change.subjectRef.bookId;
    if (isBookId(bookId)) this.changedBooks.add(bookId);
    if (change.kind === 'state') this.queueChanged = true;
    this.scheduleFlush();
  }

  private noteBook(bookId: number): void {
    if (!isBookId(bookId)) return;
    this.changedBooks.add(bookId);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), STORY_GUIDE_PUSH_MS);
    this.flushTimer.unref?.();
  }

  private async authenticate(client: Socket): Promise<RequestUser | null> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      // Read once at connect: a permission taken away mid session is caught by the token version.
      if (!user.isSuperuser && !user.permissions.includes(Permission.LibraryGenerateStoryGuide)) {
        throw new ForbiddenException('Missing permission: library_generate_story_guide');
      }
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`[story_guide.ws_connection] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
      return user;
    } catch (err) {
      this.logger.warn(
        `[story_guide.ws_connection] [fail] socketId=${client.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - websocket rejected`,
      );
      rejectSocketConnection(client, err);
      return null;
    }
  }
}
