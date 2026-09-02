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

  /**
   * A code without its parameters is a sentence a client cannot finish. "You can have {limit} in
   * flight at once" translated with no `limit` renders the placeholder empty, which is how the
   * one refusal that carries a number told nobody what the number was.
   */
  it('carries the code’s translation parameters alongside it', () => {
    const filter = new GlobalExceptionFilter();
    const { host, send } = makeHost();

    filter.catch(
      new HttpException({ message: 'too many in flight', errorCode: 'SUBMIT_SELF_SERVE_LIMIT', errorMeta: { limit: 10 } }, HttpStatus.FORBIDDEN),
      host,
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'SUBMIT_SELF_SERVE_LIMIT', errorMeta: { limit: 10 } }));
  });

  it('keeps only the scalars a translation could use, so an error body cannot carry internals', () => {
    const filter = new GlobalExceptionFilter();
    const { host, send } = makeHost();

    filter.catch(
      new HttpException(
        { message: 'nope', errorCode: 'SOME_CODE', errorMeta: { limit: 10, source: 'tracker', internals: { stack: 'secret' }, ids: [1, 2] } },
        HttpStatus.BAD_REQUEST,
      ),
      host,
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ errorMeta: { limit: 10, source: 'tracker' } }));
  });

  it('omits meta entirely when nothing coded it, so an uncoded refusal keeps its old shape', () => {
    const filter = new GlobalExceptionFilter();
    const { host, send } = makeHost();

    filter.catch(new HttpException({ message: 'nope', errorMeta: { limit: 10 } }, HttpStatus.BAD_REQUEST), host);

    expect(send).toHaveBeenCalledWith(expect.not.objectContaining({ errorMeta: expect.anything() }));
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
