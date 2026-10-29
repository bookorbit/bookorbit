import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  Permission,
  READ_ALOUD_JOB_UPDATED_EVENT,
  READ_ALOUD_SOCKET_NAMESPACE,
  type AuthenticationMethod,
  type ReadAloudJob,
} from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AuthService } from '../auth/auth.service';

function userRoom(userId: number): string {
  return `read-aloud:user:${userId}`;
}

/**
 * Live job updates go only to the job's requester: the payload is the requester's view of the job,
 * and other viewers of the book read the same job over HTTP, scoped by the same rules.
 */
@WebSocketGateway({ namespace: READ_ALOUD_SOCKET_NAMESPACE, cors: { origin: wsCorsOrigin() } })
export class ReadAloudGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ReadAloudGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException('No token provided');
      const payload = this.jwtService.verify<{ sub: number; ver: number; sid?: number; amr?: AuthenticationMethod }>(token, {
        algorithms: ['HS256'],
      });
      const user = await this.authService.validateSessionUser(payload.sub, payload.ver, payload.amr ?? 'legacy', payload.sid);
      if (!user) throw new UnauthorizedException('User not found or token revoked');
      // Forbidden, not Unauthorized: a fresh token would be refused the same way, so the client must not retry.
      if (!user.isSuperuser && !user.permissions.includes(Permission.LibraryGenerateReadAloud)) {
        throw new ForbiddenException('Missing read-aloud permission');
      }
      if (user.permissions.includes(Permission.DemoRestricted)) throw new ForbiddenException('Demo-restricted account');
      await client.join(userRoom(user.id));
    } catch (err) {
      this.logger.warn(
        `[read_aloud.ws_connect] [fail] socket=${client.id} errorClass=${(err as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue((err as Error).message)}" - handshake refused`,
      );
      rejectSocketConnection(client, err);
    }
  }

  handleDisconnect(): void {}

  emitJobUpdated(userId: number, job: ReadAloudJob): void {
    this.server?.to(userRoom(userId)).emit(READ_ALOUD_JOB_UPDATED_EVENT, job);
  }
}
