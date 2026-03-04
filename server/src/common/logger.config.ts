import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';
import { RequestMethod } from '@nestjs/common';

const isDev = process.env.NODE_ENV !== 'production';

const FRAMEWORK_CONTEXTS = new Set(['InstanceLoader', 'RouterExplorer', 'RoutesResolver']);

export const loggerConfig: Params = {
  exclude: [
    { method: RequestMethod.GET, path: 'books/:id/thumbnail' },
    { method: RequestMethod.GET, path: 'books/:id/cover' },
    { method: RequestMethod.GET, path: 'cbz/files/:id/pages/:page' },
  ],
  pinoHttp: {
    level: isDev ? 'debug' : 'info',
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
    customProps: () => ({ context: 'HTTP' }),
    customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) => {
      return `${req.method} ${req.url} ${res.statusCode} +${Math.round(responseTime)}ms`;
    },
    customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) => {
      return `${req.method} ${req.url} ${res.statusCode} - ${err?.message ?? 'error'}`;
    },
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: IncomingMessage & { id?: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
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
              messageFormat: '[{context}] {msg}',
            },
          },
        }
      : {}),
  },
};
