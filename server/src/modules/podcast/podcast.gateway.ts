import { Inject, Logger, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import type {
  PodcastDownloadCompleteEvent,
  PodcastDownloadProgressEvent,
  PodcastImportProgressEvent,
  PodcastRefreshCompleteEvent,
  PodcastRetentionEvictedEvent,
  PodcastShowDiscoveredEvent,
  AuthenticationMethod,
} from '@bookorbit/types';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { LibraryService } from '../library/library.service';
import { PodcastEventsService } from './podcast-events.service';
import { rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { appConfig } from '../../config/config';

@WebSocketGateway({ namespace: '/podcasts', cors: { credentials: true } })
export class PodcastGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(PodcastGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly libraries: LibraryService,
    private readonly events: PodcastEventsService,
    @Inject(appConfig.KEY) app: ConfigType<typeof appConfig>,
  ) {
    this.clientOrigin = app.appUrl;
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
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException('No token provided');
      const payload = this.jwtService.verify<{ sub: number; ver: number; sid?: number; amr?: AuthenticationMethod }>(token, {
        algorithms: ['HS256'],
      });
      const user = await this.authService.validateSessionUser(payload.sub, payload.ver, payload.amr ?? 'legacy', payload.sid);
      if (!user) throw new UnauthorizedException('User not found or token revoked');
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`[podcast.ws_connection] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
    } catch (error) {
      this.logger.warn(
        `[podcast.ws_connection] [fail] socketId=${client.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - websocket rejected`,
      );
      rejectSocketConnection(client, error);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[podcast.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  @SubscribeMessage('subscribe:library')
  async handleSubscribeLibrary(client: Socket, libraryId: number): Promise<void> {
    const user = (client.data as { user?: RequestUser }).user;
    if (!user || !Number.isInteger(libraryId) || libraryId <= 0) return;
    try {
      await this.libraries.verifyUserAccess(user.id, libraryId, user.isSuperuser);
      await client.join(`library:${libraryId}`);
    } catch {
      client.emit('podcast:subscription:error', { libraryId });
    }
  }

  // Every emit below is teed to the SSE stream from this one place. Clients that cannot speak
  // Engine.IO read the same events over ordinary HTTP, and because both transports leave from the
  // same call site they cannot drift apart.

  emitDownloadProgress(event: PodcastDownloadProgressEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:download:progress', event);
    this.events.publishDownloadProgress(event);
  }

  emitDownloadComplete(event: PodcastDownloadCompleteEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:download:complete', event);
    this.events.publishDownloadComplete(event);
  }

  emitRefreshComplete(event: PodcastRefreshCompleteEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:refresh:complete', event);
    this.events.publishRefreshComplete(event);
  }

  emitImportProgress(event: PodcastImportProgressEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:import:progress', event);
    this.events.publishImportProgress(event);
  }

  emitShowDiscovered(event: PodcastShowDiscoveredEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:show:discovered', event);
    this.events.publishShowDiscovered(event);
  }

  emitRetentionEvicted(event: PodcastRetentionEvictedEvent): void {
    this.server?.to(`library:${event.libraryId}`).emit('podcast:retention:evicted', event);
    this.events.publishRetentionEvicted(event);
  }
}
