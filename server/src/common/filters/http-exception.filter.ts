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
    });
  }
}
