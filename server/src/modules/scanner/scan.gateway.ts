import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import type { ScanProgressEvent } from '@projectx/types';
import { AuthService } from '../auth/auth.service';
import { ScanJobStore } from './scan-job-store.service';

@WebSocketGateway({ namespace: '/scan', cors: { origin: '*', credentials: true } })
export class ScanGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ScanGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly scanJobStore: ScanJobStore,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');
      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token);
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');
      client.data.user = user;
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);
    } catch (err) {
      this.logger.warn(`WS rejected: ${(err as Error).message} socket=${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  @SubscribeMessage('subscribe:library')
  handleSubscribeLibrary(client: Socket, libraryId: number): void {
    client.join(`library:${libraryId}`);
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

  // Called by ScannerService — not a WS message handler.
  emitProgress(event: ScanProgressEvent): void {
    this.server.to(`library:${event.libraryId}`).emit('scan:progress', event);
  }
}
