import { UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

import type { RequestUser } from '../types/request-user';

export const WS_UNAUTHORIZED_EVENT = 'unauthorized';

/**
 * `JwtService.verify` rejects with jsonwebtoken's own error types rather than an HTTP exception, and
 * `TokenExpiredError` is the single most common way a handshake fails: the tab slept through the
 * token's lifetime. Matched by name so this stays independent of the jsonwebtoken package.
 */
const JWT_FAILURE_NAMES = new Set(['TokenExpiredError', 'JsonWebTokenError', 'NotBeforeError']);

function isAuthenticationFailure(cause: unknown): boolean {
  if (cause instanceof UnauthorizedException) return true;
  return cause instanceof Error && JWT_FAILURE_NAMES.has(cause.name);
}

/**
 * Closes a socket whose handshake was refused, telling the client first when a retry could work.
 *
 * socket.io reports a server-initiated close as `io server disconnect` and, by contract, never
 * reconnects from it. Without a signal the client cannot tell "your access token went stale while
 * the tab slept, get a fresh one and come back" apart from any other refusal, so it either gives up
 * on live updates until the page is reloaded or reconnects in a loop with the same dead token.
 *
 * Only an authentication failure is worth another handshake. A permission denial, or anything
 * unexpected, closes the socket silently: a fresh token would be refused in exactly the same way.
 * The payload stays vague because the client's only useful response is to re-authenticate.
 */
export function rejectSocketConnection(client: Socket, cause: unknown): void {
  if (isAuthenticationFailure(cause)) {
    client.emit(WS_UNAUTHORIZED_EVENT, { reason: 'invalid_token' });
  }
  client.disconnect();
}

const handshakes = new WeakMap<Socket, Promise<RequestUser | null>>();

/**
 * Records a gateway's handshake so its message handlers can wait for it.
 *
 * socket.io tells the client it is connected before Nest calls `handleConnection`, and Nest starts
 * delivering the socket's messages without waiting for that call to finish. A client that subscribes
 * the moment it connects therefore reaches a handler while its token is still being checked, and
 * reading `client.data.user` there sees an anonymous socket and drops the subscription. Call this
 * synchronously at the top of `handleConnection`, before anything is awaited.
 *
 * The handshake must resolve to null rather than reject when it refuses the socket.
 */
export function trackSocketHandshake(client: Socket, handshake: Promise<RequestUser | null>): Promise<RequestUser | null> {
  handshakes.set(client, handshake);
  return handshake;
}

/** The socket's authenticated user, once its handshake has finished; null when it was refused. */
export async function resolveSocketUser(client: Socket): Promise<RequestUser | null> {
  const handshake = handshakes.get(client);
  if (handshake) return handshake;
  return (client.data as { user?: RequestUser } | undefined)?.user ?? null;
}
