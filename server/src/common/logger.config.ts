import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const FRAMEWORK_CONTEXTS = new Set(['InstanceLoader', 'RouterExplorer', 'RoutesResolver']);

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
      return `[HTTP] ${req.method} ${req.url} ${res.statusCode} +${Math.round(responseTime)}ms`;
    },
    customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
      return `[HTTP] ${req.method} ${req.url} ${res.statusCode} - ${err?.message ?? 'error'}`;
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'debug';
    },
    serializers: {
      req: (req: IncomingMessage & { id?: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
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
