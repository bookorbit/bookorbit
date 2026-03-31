import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, type AuthorEnrichmentStatusEvent } from '@projectx/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';

export const AUTHOR_ENRICHMENT_STATUS_EVENT = 'author-enrichment:status';

@WebSocketGateway({ namespace: '/authors-enrichment', cors: { credentials: true } })
export class AuthorEnrichmentGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AuthorEnrichmentGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly enrichmentConfig: AuthorEnrichmentConfigService,
    private readonly session: AuthorEnrichmentSessionService,
    config: ConfigService,
  ) {
    this.clientOrigin = config.get<string>('app.appUrl') ?? 'http://localhost:5173';
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
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token);
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');

      this.assertCanViewStatus(user);
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);
      const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.enrichmentConfig.isPaused()]);
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
