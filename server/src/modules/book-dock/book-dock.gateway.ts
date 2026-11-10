import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AuthenticatorService } from '../auth/authenticator.service';

@WebSocketGateway({ namespace: '/book-dock', cors: { origin: wsCorsOrigin() } })
export class BookDockGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BookDockGateway.name);

  constructor(private readonly authenticator: AuthenticatorService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      (client.data as Record<string, unknown>).user = user;
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);
    } catch (err) {
      this.logger.warn(`WS rejected: ${(err as Error).message} socket=${client.id}`);
      rejectSocketConnection(client, err);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  emitChanged(): void {
    this.server?.emit('book-dock:changed');
  }
}
