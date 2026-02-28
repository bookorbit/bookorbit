import type { Params } from 'nestjs-pino';
import type { IncomingMessage, ServerResponse } from 'http';

const isDev = process.env.NODE_ENV !== 'production';

export const loggerConfig: Params = {
  pinoHttp: {
    level: isDev ? 'debug' : 'info',
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      req: (req: any) => ({ id: req.id as string, method: req.method as string, url: req.url as string }),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      res: (res: any) => ({ statusCode: res.statusCode as number }),
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
