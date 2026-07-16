import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';

import { GlobalExceptionFilter } from './http-exception.filter';

function makeHost(options: { sent?: boolean } = {}) {
  const send = vi.fn();
  const status = vi.fn().mockReturnValue({ send });
  const reply = { status, sent: options.sent ?? false };
  const request = { url: '/api/books/1', id: 'req-123' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, send };
}

describe('GlobalExceptionFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes HttpException payloads into standard error shape', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, send } = makeHost();

    filter.catch(new BadRequestException('invalid query'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'invalid query',
        path: '/api/books/1',
        requestId: 'req-123',
      }),
    );
  });

  it('preserves stable application error codes', () => {
    const filter = new GlobalExceptionFilter();
    const { host, send } = makeHost();

    filter.catch(new HttpException({ message: 'sharing disabled', errorCode: 'READING_INSIGHTS_PRIVATE' }, HttpStatus.FORBIDDEN), host);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'READING_INSIGHTS_PRIVATE' }));
  });

  it('falls back to statusCode/message fields on non-HttpException values', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status, send } = makeHost();

    filter.catch({ statusCode: 422, message: 'unprocessable input' }, host);

    expect(status).toHaveBeenCalledWith(422);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        message: 'Internal server error',
      }),
    );
  });

  it('logs server errors and returns 500 for unknown exceptions', () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host, status, send } = makeHost();
    const exception = new Error('db down');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(exception);
  });

  it('does not log client errors', () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host } = makeHost();

    filter.catch(new HttpException({ message: 'conflict' }, HttpStatus.CONFLICT), host);

    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('silently ignores ERR_STREAM_PREMATURE_CLOSE without sending a reply', () => {
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const filter = new GlobalExceptionFilter();
    const { host, status } = makeHost();

    filter.catch({ code: 'ERR_STREAM_PREMATURE_CLOSE', message: 'Premature close' }, host);

    expect(loggerSpy).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('skips sending a reply when reply is already sent', () => {
    const filter = new GlobalExceptionFilter();
    const { host, status } = makeHost({ sent: true });

    filter.catch(new BadRequestException('too late'), host);

    expect(status).not.toHaveBeenCalled();
  });
});
