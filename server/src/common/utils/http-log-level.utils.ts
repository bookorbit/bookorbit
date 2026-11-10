import type { IncomingMessage } from 'node:http';

const DEBUG_HTTP_LOG = Symbol.for('bookorbit.debug-http-log');

type MarkedIncomingMessage = IncomingMessage & { [DEBUG_HTTP_LOG]?: true };

export function markHttpLogAsDebug(request: IncomingMessage): void {
  (request as MarkedIncomingMessage)[DEBUG_HTTP_LOG] = true;
}

export function isHttpLogMarkedAsDebug(request: IncomingMessage): boolean {
  return (request as MarkedIncomingMessage)[DEBUG_HTTP_LOG] === true;
}
