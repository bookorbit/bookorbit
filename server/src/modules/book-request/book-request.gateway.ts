import { Logger, UnauthorizedException } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Permission } from '@bookorbit/types';
import type { BookRequestProgressEvent } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { rejectSocketConnection } from '../../common/utils/ws-auth.utils';
import { wsCorsOrigin } from '../../common/utils/ws-cors.utils';
import { AuthenticatorService } from '../auth/authenticator.service';

/** Everybody who reaches every request over HTTP, and therefore every request's progress. */
const MANAGERS_ROOM = 'book-requests:managers';

/** One room per connected user, so a progress tick can name who is entitled to it. */
function userRoom(userId: number): string {
  return `book-requests:user:${userId}`;
}

/**
 * Mirrors `book-dock.gateway.ts`, with one difference that matters: progress is routed rather than
 * broadcast. The payload carries request ids, download ids and byte totals, and `GET
 * /book-requests/:id` hands those to the requester, the subscribers and the moderators only. A
 * socket holding `book_request_access` is not automatically one of those, so a broadcast would
 * put operational detail about somebody else's request on a page that cannot open it.
 *
 * `changed` stays a broadcast. It carries nothing, and every page answers it with a fetch that is
 * scoped by the same rules the HTTP surface applies.
 */
@WebSocketGateway({ namespace: '/book-requests', cors: { origin: wsCorsOrigin() } })
export class BookRequestGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(BookRequestGateway.name);
  private changes = 0;

  constructor(private readonly authenticator: AuthenticatorService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.authenticator.authenticateSocket(client);
      if (!user.isSuperuser && !user.permissions.includes(Permission.BookRequestAccess)) {
        throw new UnauthorizedException('Missing book request access');
      }
      (client.data as Record<string, unknown>).user = user;
      await client.join(userRoom(user.id));
      // Read once at connect, like the permission check above it: a permission taken away mid
      // session is caught by the token version, which drops the socket rather than re-roles it.
      if (user.isSuperuser || user.permissions.includes(Permission.ManageBookRequests)) await client.join(MANAGERS_ROOM);
      this.logger.debug(`WS connected: user=${user.id} socket=${client.id}`);
    } catch (err) {
      this.logger.warn(
        `[book_request.ws_connect] [fail] socket=${client.id} errorClass=${(err as Error)?.constructor?.name ?? 'Error'} error="${sanitizeLogValue((err as Error).message)}" - handshake refused`,
      );
      rejectSocketConnection(client, err);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: socket=${client.id}`);
  }

  /**
   * How many change broadcasts have gone out. Every page answers a broadcast with a refetch, so
   * anything caching a derived view of the request set keys on this: a value computed before the
   * last change can then never be served after it, without every mutation having to know what
   * caches exist.
   */
  get changeVersion(): number {
    return this.changes;
  }

  emitChanged(): void {
    this.changes++;
    this.server?.emit('book-requests:changed');
  }

  /**
   * `viewerUserIds` is the requester plus the subscribers; the managers room is added here so no
   * caller has to resolve who those are. Socket.IO delivers once per socket however many of the
   * named rooms it is in.
   */
  emitProgress(event: BookRequestProgressEvent, viewerUserIds: readonly number[]): void {
    this.server?.to([MANAGERS_ROOM, ...viewerUserIds.map(userRoom)]).emit('book-requests:progress', event);
  }
}
