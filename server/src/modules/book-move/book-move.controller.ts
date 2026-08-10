import { Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { BookMoveProgressEvent } from '@bookorbit/types';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookMoveService } from './book-move.service';
import { MoveBooksDto, MovePreviewDto } from './dto/move-books.dto';

/**
 * Editor access on every source library and on the target is enforced per book in
 * the service: the target is named in the body rather than a route param, so the
 * library-access guard cannot see it, and a selection can span several sources.
 */
@Controller('books/move')
export class BookMoveController {
  constructor(private readonly bookMoveService: BookMoveService) {}

  @Post('preview')
  @RequirePermission(Permission.LibraryEditMetadata)
  preview(@Body() dto: MovePreviewDto, @CurrentUser() user: RequestUser) {
    return this.bookMoveService.preview(dto, user);
  }

  /**
   * Streams per-book progress. Headers are written lazily so pre-flight failures
   * (missing target, no access, a scan already running) still return a normal JSON
   * error instead of a 200 with an empty event stream.
   */
  @Post()
  @RequirePermission(Permission.LibraryEditMetadata)
  @Auditable({
    action: AuditAction.BookBulkMoveLibrary,
    resource: AuditResource.Book,
    description: (req) => `Moved books to library #${(req.body as { targetLibraryId?: number })?.targetLibraryId}`,
  })
  async move(@Body() dto: MoveBooksDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    let disconnected = false;
    let streamStarted = false;
    const handleDisconnect = () => {
      disconnected = true;
    };

    const ensureStreamStarted = () => {
      if (streamStarted) return;
      streamStarted = true;
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.on('close', handleDisconnect);
      reply.raw.on('aborted', handleDisconnect);
    };

    const writeEvent = (event: BookMoveProgressEvent) => {
      if (disconnected || reply.raw.writableEnded || reply.raw.destroyed) return;
      ensureStreamStarted();
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const summary = await this.bookMoveService.execute(dto, user, {
        onProgress: writeEvent,
        isCancelled: () => disconnected || reply.raw.writableEnded || reply.raw.destroyed,
      });

      writeEvent({ done: true, ...summary });

      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
    } catch (error) {
      if (streamStarted && !reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
        return;
      }
      throw error;
    } finally {
      if (streamStarted) {
        reply.raw.off('close', handleDisconnect);
        reply.raw.off('aborted', handleDisconnect);
      }
    }
  }
}
