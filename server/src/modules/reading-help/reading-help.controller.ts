import { Body, Controller, Post, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { READING_HELP_BODY_LIMIT_BYTES, ReadingHelpDto } from './dto/reading-help.dto';
import { ReadingHelpService } from './reading-help.service';

/** A reader opening several definitions in a row stays well under this; cached answers count too. */
const ANSWER_THROTTLE = { default: { limit: 60, ttl: 60_000 } };
/** A comment line now and then keeps proxies from closing a stream while a careful model thinks. */
export const READING_HELP_KEEP_ALIVE_MS = 15_000;

@Controller('mobile/reading-help')
@RequireAppAttest({ unsignedOutsideProduction: true })
export class ReadingHelpController {
  constructor(private readonly readingHelp: ReadingHelpService) {}

  /**
   * Answers as server-sent events: `delta` pieces of text, then one `done` or `error`. Failures
   * found before the answer starts are ordinary JSON errors with an `errorCode`. An app that hangs
   * up cancels the model call. Not `request.signal`: Fastify aborts that once the body is read.
   */
  @Post()
  @RouteConfig({ bodyLimit: READING_HELP_BODY_LIMIT_BYTES })
  @Throttle(ANSWER_THROTTLE)
  async answer(@Body() dto: ReadingHelpDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply): Promise<void> {
    const hangUp = new AbortController();
    const handleClose = () => {
      if (!reply.raw.writableEnded) hangUp.abort();
    };
    reply.raw.on('close', handleClose);
    let keepAlive: NodeJS.Timeout | undefined;
    try {
      const events = await this.readingHelp.answer(user, dto, hangUp.signal);
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      keepAlive = setInterval(() => {
        if (!hangUp.signal.aborted) reply.raw.write(': keep-alive\n\n');
      }, READING_HELP_KEEP_ALIVE_MS);
      for await (const event of events) {
        if (hangUp.signal.aborted) break;
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (!reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
    } finally {
      if (keepAlive) clearInterval(keepAlive);
      reply.raw.off('close', handleClose);
    }
  }
}
