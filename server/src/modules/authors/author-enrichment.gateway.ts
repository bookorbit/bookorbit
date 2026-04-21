import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, type AuthorEnrichmentStatusEvent } from '@bookorbit/types';
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
    const event = 'author.enrichment.socket';
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token, { algorithms: ['HS256'] });
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');

      this.assertCanViewStatus(user);
      this.logger.debug(`[${event}] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
      const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.enrichmentConfig.isPaused()]);
      client.emit(AUTHOR_ENRICHMENT_STATUS_EVENT, { ...summary, paused, ...this.session.getSnapshot() });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(`[${event}] [fail] socketId=${client.id} errorClass=${errorClass} error="${message}" - websocket rejected`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[author.enrichment.socket] [end] socketId=${client.id} - websocket disconnected`);
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
