import { LibraryScopeService } from '../../common/library-scope/library-scope.service';
import { Inject, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';

import type {
  BookMergedEvent,
  BookLinksChangedEvent,
  BookDuplicateResolutionEvent,
  BookMergeJobEvent,
  BookMissingEvent,
  BookMovedEvent,
  BookProgressChangedEvent,
  BookRestoredEvent,
  BookTransferredEvent,
  CoverRefreshedEvent,
  CoverRefreshProgressEvent,
  ScanBooksAddedEvent,
  ScanProgressEvent,
} from '@bookorbit/types';
import {
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  AchievementEventsService,
  type BookProgressChangedPayload,
} from '../achievement/achievement-events.service';
import { ScanJobStore } from './scan-job-store.service';
import { ScannerRepository } from './scanner.repository';
import type { RequestUser } from '../../common/types/request-user';
import { rejectSocketConnection, resolveSocketUser, trackSocketHandshake } from '../../common/utils/ws-auth.utils';
import { appConfig } from '../../config/config';
import { BOOK_COVER_CHANGED, BookCoverEventsService } from '../book-cover-store/book-cover-events.service';
import { AuthenticatorService } from '../auth/authenticator.service';

@WebSocketGateway({ namespace: '/scan', cors: { credentials: true } })
export class ScanGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ScanGateway.name);
  private readonly clientOrigin: string;
  private readonly handleBookProgressChanged = (payload: BookProgressChangedPayload): void => {
    this.emitBookProgressChanged(payload);
  };
  private readonly handleCoverChanged = (event: CoverRefreshedEvent): void => {
    this.emitCoverRefreshed(event);
  };

  constructor(
    private readonly authenticator: AuthenticatorService,
    private readonly scanJobStore: ScanJobStore,
    private readonly scannerRepository: ScannerRepository,
    private readonly achievementEvents: AchievementEventsService,
    private readonly libraryScope: LibraryScopeService,
    @Inject(appConfig.KEY) app: ConfigType<typeof appConfig>,
    @Optional() private readonly coverEvents?: BookCoverEventsService,
  ) {
    this.clientOrigin = app.appUrl;
  }

  onModuleInit(): void {
    this.achievementEvents.on(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, this.handleBookProgressChanged);
    this.coverEvents?.on(BOOK_COVER_CHANGED, this.handleCoverChanged);
  }

  onModuleDestroy(): void {
    this.achievementEvents.removeListener(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, this.handleBookProgressChanged);
    this.coverEvents?.removeListener(BOOK_COVER_CHANGED, this.handleCoverChanged);
  }

  afterInit(server: Server): void {
    if (!server.engine?.opts) return;
    server.engine.opts.cors = {
      ...(server.engine.opts.cors ?? {}),
      origin: this.clientOrigin,
      credentials: true,
    };
  }

  async handleConnection(client: Socket): Promise<void> {
    await trackSocketHandshake(client, this.authenticate(client));
  }

  private async authenticate(client: Socket): Promise<RequestUser | null> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      (client.data as Record<string, unknown>).user = user;
      await client.join(`user:${user.id}`);
      this.logger.debug(`[scanner.ws_connection] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
      return user;
    } catch (err) {
      this.logger.warn(
        `[scanner.ws_connection] [fail] socketId=${client.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - websocket rejected`,
      );
      rejectSocketConnection(client, err);
      return null;
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[scanner.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  /**
   * A library room carries the library's book cards and scan counts, so joining one needs the same
   * access as reading the library over HTTP.
   */
  @SubscribeMessage('subscribe:library')
  async handleSubscribeLibrary(client: Socket, libraryId: number): Promise<void> {
    const user = await resolveSocketUser(client);
    if (!user || !Number.isSafeInteger(libraryId) || libraryId <= 0) return;
    if (!(await this.libraryScope.canSee(user, libraryId))) {
      this.logger.debug(`[scanner.ws_subscribe] [fail] userId=${user.id} libraryId=${libraryId} socketId=${client.id} - no library access`);
      return;
    }
    await client.join(`library:${libraryId}`);
    // Send current snapshot immediately so reconnecting clients catch up.
    const entry = this.scanJobStore.get(libraryId);
    if (entry) {
      const event: ScanProgressEvent = {
        jobId: entry.jobId,
        libraryId,
        status: 'running',
        processed: entry.processed,
        total: entry.total,
        added: entry.added,
        updated: entry.updated,
        missing: entry.missing,
      };
      client.emit('scan:progress', event);
    }
  }

  // Called by services — not WS message handlers. Guards against script/test
  // contexts where no HTTP adapter starts and this.server is never populated.
  emitProgress(event: ScanProgressEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('scan:progress', event);
  }

  emitCoverRefreshProgress(event: CoverRefreshProgressEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('cover:refresh:progress', event);
  }

  emitCoverRefreshed(event: CoverRefreshedEvent): void {
    if (event.libraryId === undefined) return;
    this.server?.to(`library:${event.libraryId}`).emit('cover:refreshed', event);
  }

  emitBookMissing(event: BookMissingEvent): void {
    this.logger.debug(`[scanner.ws_emit] [book:missing] libraryId=${event.libraryId} bookCount=${event.bookIds.length}`);
    this.server?.to(`library:${event.libraryId}`).emit('book:missing', event);
  }

  emitBookRestored(event: BookRestoredEvent): void {
    this.logger.debug(`[scanner.ws_emit] [book:restored] libraryId=${event.libraryId} bookCount=${event.bookIds.length}`);
    this.server?.to(`library:${event.libraryId}`).emit('book:restored', event);
  }

  emitBookMoved(event: BookMovedEvent): void {
    this.logger.debug(`[scanner.ws_emit] [book:moved] libraryId=${event.libraryId} bookCount=${event.bookIds.length}`);
    this.server?.to(`library:${event.libraryId}`).emit('book:moved', event);
  }

  emitBookTransferred(event: BookTransferredEvent): void {
    this.logger.debug(
      `[scanner.ws_emit] [book:transferred] fromLibraryId=${event.fromLibraryId} toLibraryId=${event.toLibraryId} bookCount=${event.bookIds.length}`,
    );
    this.server?.to([`library:${event.fromLibraryId}`, `library:${event.toLibraryId}`]).emit('book:transferred', event);
  }

  /** To the room of every library the merge touched: viewers of a library the books left must drop them too. */
  emitBookMerged(event: BookMergedEvent): void {
    const libraryIds = [...new Set([event.libraryId, ...(event.sourceLibraryIds ?? [])])];
    this.logger.debug(
      `[scanner.ws_emit] [book:merged] libraryId=${event.libraryId} libraryIds=${libraryIds.join(',')} targetBookId=${event.targetBookId} sourceCount=${event.sourceBookIds.length}`,
    );
    this.server?.to(libraryIds.map((id) => `library:${id}`)).emit('book:merged', event);
  }

  emitBookMergeJob(userId: number, phase: 'progress' | 'finished', event: BookMergeJobEvent): void {
    this.server?.to(`user:${userId}`).emit(`book-merge:${phase}`, event);
  }

  emitDuplicateResolution(userId: number, phase: 'progress' | 'finished', event: BookDuplicateResolutionEvent): void {
    this.server?.to(`user:${userId}`).emit(`book-duplicates:resolution-${phase}`, event);
  }

  emitBookLinksChanged(event: BookLinksChangedEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('book:links-changed', event);
  }

  emitBookProgressChanged(payload: BookProgressChangedPayload): void {
    const event: BookProgressChangedEvent = {
      bookId: payload.bookId,
      progress: payload.progress,
      source: payload.source,
    };
    this.server?.to(`user:${payload.userId}`).emit('book:progress-changed', event);
  }

  emitBooksAdded(event: ScanBooksAddedEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('scan:books:added', event);
  }
}
