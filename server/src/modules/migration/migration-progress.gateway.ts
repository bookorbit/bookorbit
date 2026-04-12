import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { Permission, type MigrationProgressEvent, type MigrationRunState } from '@projectx/types';
import type { RequestUser } from '../../common/types/request-user';
import { AuthService } from '../auth/auth.service';
import { MigrationRepository } from './migration.repository';
import { sanitizeRunForApi } from './core/api-sanitizers';

@WebSocketGateway({ namespace: '/migration', cors: { credentials: true } })
export class MigrationProgressGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(MigrationProgressGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly repo: MigrationRepository,
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
      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token, { algorithms: ['HS256'] });
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');
      this.assertCanViewMigrationProgress(user);
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`[migration.ws_connection] [start] userId=${user.id} socketId=${client.id} - websocket connected`);
    } catch (err) {
      this.logger.warn(
        `[migration.ws_connection] [fail] socketId=${client.id} errorClass=${err instanceof Error ? err.name : 'Error'} error="${(err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"')}" - websocket rejected`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[migration.ws_connection] [end] socketId=${client.id} - websocket disconnected`);
  }

  @SubscribeMessage('subscribe:run')
  async handleSubscribeRun(client: Socket, runId: number): Promise<void> {
    const user = (client.data as { user?: RequestUser }).user;
    if (!user) return;
    void client.join(`run:${runId}`);

    const run = await this.repo.findRunById(runId);
    if (!run) return;

    const metrics = await this.repo.listRunMetrics(runId);
    const totals = metrics.reduce(
      (acc, row) => ({
        processed: acc.processed + row.processed,
        imported: acc.imported + row.imported,
        skipped: acc.skipped + row.skipped,
        unresolved: acc.unresolved + row.unresolved,
        failed: acc.failed + row.failed,
      }),
      { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
    );

    const sanitized = sanitizeRunForApi(run);
    const snapshot: MigrationProgressEvent = {
      runId,
      state: sanitized.state as MigrationRunState,
      currentStage: sanitized.currentStage,
      totals,
      metrics: metrics.map((m) => ({
        stage: m.stage,
        entityType: m.entityType,
        processed: m.processed,
        imported: m.imported,
        skipped: m.skipped,
        unresolved: m.unresolved,
        failed: m.failed,
        updatedAt: m.updatedAt.toISOString(),
      })),
    };
    client.emit('migration:progress', snapshot);
  }

  emitProgress(event: MigrationProgressEvent): void {
    this.server?.to(`run:${event.runId}`).emit('migration:progress', event);
  }

  private assertCanViewMigrationProgress(user: RequestUser): void {
    if (user.isSuperuser) return;
    if (user.permissions.includes(Permission.ManageAppSettings)) return;
    throw new Error('Missing permission: manage_app_settings');
  }
}
