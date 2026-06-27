import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AnnotationHubService } from './annotation-hub.service';
import {
  AnnotationBulkDto,
  AnnotationExportQueryDto,
  AnnotationHubBooksQueryDto,
  AnnotationHubQueryDto,
  AnnotationPositionRetryDto,
} from './dto/annotation-hub.dto';

@Controller('annotations')
export class AnnotationHubController {
  constructor(private readonly hubService: AnnotationHubService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Query() query: AnnotationHubQueryDto) {
    return this.hubService.list(user.id, query);
  }

  @Get('books')
  listBooks(@CurrentUser() user: RequestUser, @Query() query: AnnotationHubBooksQueryDto) {
    return this.hubService.listBooks(user.id, {
      status: query.status ?? 'active',
      q: query.q,
      limit: query.limit,
      selectedId: query.selectedId,
    });
  }

  @Post('bulk')
  @HttpCode(200)
  bulk(@CurrentUser() user: RequestUser, @Body() dto: AnnotationBulkDto) {
    return this.hubService.bulk(user.id, dto);
  }

  @Post(':annotationId/restore')
  @HttpCode(200)
  restore(@CurrentUser() user: RequestUser, @Param('annotationId', ParseIntPipe) annotationId: number) {
    return this.hubService.restore(user.id, annotationId);
  }

  @Get(':annotationId/sync-detail')
  syncDetail(@CurrentUser() user: RequestUser, @Param('annotationId', ParseIntPipe) annotationId: number) {
    return this.hubService.syncDetail(user.id, annotationId);
  }

  @Post(':annotationId/positions/retry')
  @HttpCode(200)
  retryPosition(
    @CurrentUser() user: RequestUser,
    @Param('annotationId', ParseIntPipe) annotationId: number,
    @Body() dto: AnnotationPositionRetryDto,
  ) {
    return this.hubService.retryPosition(user.id, annotationId, dto.format);
  }

  @Delete(':annotationId')
  @HttpCode(204)
  async purge(@CurrentUser() user: RequestUser, @Param('annotationId', ParseIntPipe) annotationId: number) {
    await this.hubService.purge(user.id, annotationId);
  }

  @Get('export')
  async export(@CurrentUser() user: RequestUser, @Query() query: AnnotationExportQueryDto, @Res() reply: FastifyReply) {
    const result = await this.hubService.export(user.id, query, query.bookId ? `book-${query.bookId}` : 'library');
    return reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.filename}"`)
      .send(result.content);
  }
}
