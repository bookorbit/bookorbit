import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, type BookMetadataFetchStatusEvent } from '@projectx/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';

export const BOOK_METADATA_FETCH_STATUS_EVENT = 'book-metadata-fetch:status';

@WebSocketGateway({ namespace: '/book-metadata-fetch', cors: { origin: process.env.CLIENT_URL ?? 'http://localhost:5173' } })
export class BookMetadataFetchGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BookMetadataFetchGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly configService: BookMetadataFetchConfigService,
    private readonly session: BookMetadataFetchSessionService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token);
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');

      this.assertCanViewStatus(user);
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);

      const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.configService.isPaused()]);
      client.emit(BOOK_METADATA_FETCH_STATUS_EVENT, { ...summary, paused, ...this.session.getSnapshot() } satisfies BookMetadataFetchStatusEvent);
    } catch (err) {
      this.logger.warn(`WS rejected: ${(err as Error).message} socket=${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  emitStatus(status: BookMetadataFetchStatusEvent): void {
    this.server?.emit(BOOK_METADATA_FETCH_STATUS_EVENT, status);
  }

  private assertCanViewStatus(user: RequestUser): void {
    if (user.isSuperuser) return;
    if (user.permissions.includes(Permission.ManageMetadataConfig)) return;
    throw new Error('Missing permission: manage_metadata_config');
  }
}
