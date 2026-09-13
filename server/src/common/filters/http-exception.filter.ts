import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const exc = exception as Record<string, unknown> | undefined;

    if (exc?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof exc?.statusCode === 'number'
          ? Number(exc.statusCode)
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const rawObject = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined;
    const message = typeof raw === 'string' ? raw : ((rawObject?.message as string) ?? (exc?.message as string) ?? 'An error occurred');
    const errorCode = typeof rawObject?.errorCode === 'string' ? rawObject.errorCode : undefined;
    // The code's parameters, and useless without them: a client translating "you can have {limit}
    // in flight at once" has the sentence but not the number, and renders the placeholder empty.
    // Scalars only, so a thrower cannot smuggle a nested object of internals into an error body.
    const errorMeta = errorCode ? scalarMeta(rawObject?.errorMeta) : undefined;
    const retryAfterSeconds = typeof rawObject?.retryAfterSeconds === 'number' ? rawObject.retryAfterSeconds : undefined;

    if (status >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      this.logger.error(exception);
    }

    if (reply.sent) {
      return;
    }

    reply.status(status).send({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
      ...(errorCode ? { errorCode } : {}),
      ...(errorMeta ? { errorMeta } : {}),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }
}

/**
 * Translation parameters are strings and numbers. Anything else in there is either a mistake or
 * somebody putting an object into an error body, and neither belongs on the wire.
 */
function scalarMeta(value: unknown): Record<string, string | number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, item]) => typeof item === 'string' || typeof item === 'number') as Array<
    [string, string | number]
  >;
  return entries.length ? Object.fromEntries(entries) : undefined;
}
