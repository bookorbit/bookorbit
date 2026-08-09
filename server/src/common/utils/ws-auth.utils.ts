import { UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';

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
