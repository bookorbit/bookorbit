import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import type { BookDockSummary } from '@bookorbit/types';
import { AuthService } from '../auth/auth.service';

@WebSocketGateway({ namespace: '/book-dock', cors: { origin: process.env.CLIENT_URL ?? 'http://localhost:5173' } })
export class BookDockGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BookDockGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');
      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token, { algorithms: ['HS256'] });
      const user = await this.authService.validateUser(payload.sub, payload.ver);
      if (!user) throw new Error('User not found or token revoked');
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);
    } catch (err) {
      this.logger.warn(`WS rejected: ${(err as Error).message} socket=${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  emitSummary(summary: BookDockSummary): void {
    this.server?.emit('book-dock:summary', summary);
  }
}
