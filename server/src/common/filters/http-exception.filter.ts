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

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof exc?.statusCode === 'number'
          ? Number(exc.statusCode)
          : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message =
      typeof raw === 'string' ? raw : (((raw as Record<string, unknown>).message as string) ?? (exc?.message as string) ?? 'An error occurred');

    if (status >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
      this.logger.error(exception);
    }

    reply.status(status).send({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }
}
