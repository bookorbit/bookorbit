import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, type AuthorEnrichmentStatusEvent } from '@projectx/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';

export const AUTHOR_ENRICHMENT_STATUS_EVENT = 'author-enrichment:status';

@WebSocketGateway({ namespace: '/authors-enrichment', cors: { origin: process.env.CLIENT_URL ?? 'http://localhost:5173' } })
export class AuthorEnrichmentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AuthorEnrichmentGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly appSettings: AppSettingsService,
    private readonly session: AuthorEnrichmentSessionService,
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
      const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.appSettings.isAuthorEnrichmentPaused()]);
      client.emit(AUTHOR_ENRICHMENT_STATUS_EVENT, { ...summary, paused, ...this.session.getSnapshot() });
    } catch (err) {
      this.logger.warn(`WS rejected: ${(err as Error).message} socket=${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  emitStatus(status: AuthorEnrichmentStatusEvent): void {
    this.server?.emit(AUTHOR_ENRICHMENT_STATUS_EVENT, status);
  }

  private assertCanViewStatus(user: RequestUser): void {
    if (user.isSuperuser) return;
    if (user.permissions.includes(Permission.ManageAppSettings)) return;
    if (user.permissions.includes(Permission.ManageMetadataConfig)) return;
    throw new Error('Missing permission: manage_app_settings or manage_metadata_config');
  }
}
