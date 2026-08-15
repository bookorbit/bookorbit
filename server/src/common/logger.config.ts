import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const FRAMEWORK_CONTEXTS = new Set(['InstanceLoader', 'RouterExplorer', 'RoutesResolver']);

const NO_RESPONSE_STATUS = 'aborted';

/**
 * `ServerResponse.statusCode` is 200 from the moment the object is created, so a request whose
 * connection died before a single header was written still reports 200 here. That made failed
 * requests indistinguishable from successful ones in the access log, while pino's own response
 * serializer recorded them honestly as `"statusCode": null` (it emits `headersSent ? statusCode :
 * null`). Trust `headersSent` for the same reason pino does.
 */
function outcomeOf(res: ServerResponse): number | typeof NO_RESPONSE_STATUS {
  return res.headersSent ? res.statusCode : NO_RESPONSE_STATUS;
}

function isFailure(res: ServerResponse): boolean {
  return !res.headersSent || res.statusCode >= 400;
}

export const loggerConfig: Params = {
  exclude: [],
  pinoHttp: {
    level: logLevel,
    hooks: {
      logMethod: function (inputArgs, method) {
        const first = inputArgs[0];
        if (
          first !== null &&
          typeof first === 'object' &&
          'context' in first &&
          FRAMEWORK_CONTEXTS.has((first as Record<string, unknown>).context as string)
        ) {
          return;
        }
        method.apply(this, inputArgs);
      },
    },
    customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) => {
      return `[HTTP] ${req.method} ${req.url} ${outcomeOf(res)} +${Math.round(responseTime)}ms`;
    },
    customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
      return `[HTTP] ${req.method} ${req.url} ${outcomeOf(res)} - ${err?.message ?? 'error'}`;
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      // A response that never reached the client is a failed request, not a quiet success.
      if (isFailure(res)) return 'warn';
      return 'debug';
    },
    serializers: {
      req: (req: IncomingMessage & { id?: string }) => ({ id: req.id, method: req.method, url: req.url }),
      // pino-http wraps this with `wrapResponseSerializer`, so the argument is pino's already
      // serialized response rather than the raw one: `statusCode` is null when nothing was sent.
      res: (res: { statusCode: number | null }) => ({ statusCode: res.statusCode }),
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.token',
        'req.body.clientSecret',
        'req.body.codeVerifier',
      ],
      censor: '[REDACTED]',
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,req,res,responseTime',
              messageFormat: '{msg}',
            },
          },
        }
      : {}),
  },
};
