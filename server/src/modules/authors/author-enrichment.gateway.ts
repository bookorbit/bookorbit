import { ForbiddenException, Inject, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission, type AuthorEnrichmentStatusEvent } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { appConfig } from '../../config/config';
import { AuthenticatorService } from '../auth/authenticator.service';

export const AUTHOR_ENRICHMENT_STATUS_EVENT = 'author-enrichment:status';

@WebSocketGateway({ namespace: '/authors-enrichment', cors: { credentials: true } })
export class AuthorEnrichmentGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(AuthorEnrichmentGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly authenticator: AuthenticatorService,
    private readonly queueRepo: AuthorEnrichmentRepository,
    private readonly enrichmentConfig: AuthorEnrichmentConfigService,
    private readonly session: AuthorEnrichmentSessionService,
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
    const event = 'author.enrichment.socket';
    try {
      const user = await this.authenticator.authenticateSocket(client);

      this.assertCanViewStatus(user);
      this.logger.debug(`[${event}] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
      const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.enrichmentConfig.isPaused()]);
      client.emit(AUTHOR_ENRICHMENT_STATUS_EVENT, { ...summary, paused, ...this.session.getSnapshot() });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(`[${event}] [fail] socketId=${client.id} errorClass=${errorClass} error="${message}" - websocket rejected`);
      rejectSocketConnection(client, err);
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
    throw new ForbiddenException('Missing permission: manage_app_settings or manage_metadata_config');
  }
}
