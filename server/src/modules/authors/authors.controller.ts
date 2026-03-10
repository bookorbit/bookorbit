import { Body, Controller, Delete, Get, MessageEvent, Param, ParseIntPipe, Patch, Post, Query, Res, Sse } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';
import { extname } from 'path';
import { map, Observable } from 'rxjs';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import type { AuthorMetadataCandidate } from '@projectx/types';
import { BulkAuthorIdsDto } from './dto/bulk-author-ids.dto';
import { DeleteAuthorsDto } from './dto/delete-authors.dto';
import { ListAuthorBooksDto } from './dto/list-author-books.dto';
import { ListAuthorInsightsDto } from './dto/list-author-insights.dto';
import { ListAuthorMetadataDto } from './dto/list-author-metadata.dto';
import { ListAuthorsDto } from './dto/list-authors.dto';
import { ListDuplicateSuggestionsDto } from './dto/list-duplicate-suggestions.dto';
import { LookupAuthorMetadataDto } from './dto/lookup-author-metadata.dto';
import { MergeAuthorsDto } from './dto/merge-authors.dto';
import { UpdateAuthorDto } from './dto/update-author.dto';
import { AuthorsService } from './authors.service';

@Controller('authors')
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() dto: ListAuthorsDto) {
    return this.authorsService.findAll(user, dto);
  }

  @Get('insights')
  findInsights(@CurrentUser() user: RequestUser, @Query() dto: ListAuthorInsightsDto) {
    return this.authorsService.getInsights(user, dto);
  }

  @Get('suggestions/duplicates')
  findDuplicateSuggestions(@CurrentUser() user: RequestUser, @Query() dto: ListDuplicateSuggestionsDto) {
    return this.authorsService.listDuplicateSuggestions(user, dto);
  }

  @Get('metadata/providers')
  listMetadataProviders() {
    return this.authorsService.listMetadataProviders();
  }

  @Get('metadata/search')
  searchMetadata(@Query() dto: ListAuthorMetadataDto) {
    return this.authorsService.searchMetadata(dto);
  }

  @Sse('metadata/stream')
  streamMetadata(@Query() dto: ListAuthorMetadataDto): Observable<MessageEvent> {
    return this.authorsService.streamMetadata(dto).pipe(map((candidate: AuthorMetadataCandidate) => ({ data: candidate })));
  }

  @Get('metadata/lookup')
  lookupMetadata(@Query() dto: LookupAuthorMetadataDto) {
    return this.authorsService.lookupMetadata(dto);
  }

  @Post('bulk-refresh-metadata')
  @RequirePermission('library_edit_metadata')
  async bulkRefreshMetadata(@Body() dto: BulkAuthorIdsDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const result = await this.authorsService.bulkRefreshMetadata(dto.authorIds, user, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    reply.raw.write(`data: ${JSON.stringify({ done: true, ...result })}\n\n`);
    reply.raw.end();
  }

  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.authorsService.findOne(user, id);
  }

  @Get(':id/books')
  findBooks(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Query() dto: ListAuthorBooksDto) {
    return this.authorsService.findBooks(user, id, dto);
  }

  @Get(':id/thumbnail')
  async getThumbnail(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const thumbnailPath = await this.authorsService.getThumbnailPath(user, id);
    if (!thumbnailPath) {
      reply.status(404).send({ message: `No thumbnail for author ${id}` });
      return;
    }

    const { mtimeMs } = await stat(thumbnailPath);
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', `"${Math.floor(mtimeMs)}"`);
    reply.type('image/jpeg');
    reply.send(createReadStream(thumbnailPath));
  }

  @Get(':id/image')
  async getImage(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Res() reply: FastifyReply) {
    const imagePath = await this.authorsService.getImagePath(user, id);
    if (!imagePath) {
      reply.status(404).send({ message: `No image for author ${id}` });
      return;
    }

    const { mtimeMs } = await stat(imagePath);
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', `"${Math.floor(mtimeMs)}"`);

    const ext = extname(imagePath).toLowerCase();
    reply.type(ext === '.png' ? 'image/png' : 'image/jpeg');
    reply.send(createReadStream(imagePath));
  }

  @Post(':id/enrichment/refresh')
  @RequirePermission('library_edit_metadata')
  refreshEnrichment(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.authorsService.refreshEnrichment(user, id);
  }

  @Patch(':id')
  @RequirePermission('library_edit_metadata')
  update(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAuthorDto) {
    return this.authorsService.update(user, id, dto);
  }

  @Post('merge')
  @RequirePermission('library_edit_metadata')
  merge(@CurrentUser() user: RequestUser, @Body() dto: MergeAuthorsDto) {
    return this.authorsService.merge(user, dto);
  }

  @Delete()
  @RequirePermission('library_edit_metadata')
  delete(@CurrentUser() user: RequestUser, @Body() dto: DeleteAuthorsDto) {
    return this.authorsService.delete(user, dto);
  }
}
