import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Permission } from '@bookorbit/types';
import type { NotificationItem } from '@bookorbit/types';
import { Server, Socket } from 'socket.io';

import type { RequestUser } from '../../common/types/request-user';
import { UserService } from '../user/user.service';
import { NotificationRepository } from './notification.repository';

@WebSocketGateway({ namespace: '/notifications', cors: { credentials: true } })
export class NotificationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(NotificationGateway.name);
  private readonly clientOrigin: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly notificationRepo: NotificationRepository,
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
    const event = 'notification.socket';
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('No token provided');

      const payload = this.jwtService.verify<{ sub: number; ver: number }>(token, { algorithms: ['HS256'] });
      const user = await this.userService.findByIdWithPermissions(payload.sub);
      if (!user || !user.active) throw new Error('User not found or inactive');
      if (user.tokenVersion !== payload.ver) throw new Error('Token revoked');

      this.assertHasAccess(user);

      await client.join(`user:${user.id}`);
      this.logger.debug(`[${event}] [start] userId=${user.id} socketId=${client.id} - websocket connected`);

      const unreadCount = await this.notificationRepo.countUnread(user.id);
      client.emit('notification:unread-count', { count: unreadCount });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const message = (err instanceof Error ? err.message : String(err)).replace(/"/g, '\\"');
      this.logger.warn(`[${event}] [fail] socketId=${client.id} errorClass=${errorClass} error="${message}" - websocket rejected`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[notification.socket] [end] socketId=${client.id} - websocket disconnected`);
  }

  emitNew(userId: number, notification: NotificationItem): void {
    this.server?.to(`user:${userId}`).emit('notification:new', notification);
  }

  emitCountUpdate(userId: number, count: number): void {
    this.server?.to(`user:${userId}`).emit('notification:unread-count', { count });
  }

  emitRead(userId: number, notificationId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:read', { id: notificationId });
  }

  emitDismissed(userId: number, notificationId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:dismissed', { id: notificationId });
  }

  emitCleared(userId: number): void {
    this.server?.to(`user:${userId}`).emit('notification:cleared', {});
  }

  private assertHasAccess(user: RequestUser): void {
    if (user.permissions.includes(Permission.DemoRestricted)) {
      throw new Error('Demo-restricted account cannot access notifications');
    }
    if (user.isSuperuser) return;
    if (user.permissions.includes(Permission.NotificationAccess)) return;
    throw new Error('Missing permission: notification_access');
  }
}
