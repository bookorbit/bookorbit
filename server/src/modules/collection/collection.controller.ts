import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AuditAction, AuditResource } from '@bookorbit/types';
import type { BookQuery } from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryPipe } from '../book/pipes/book-query.pipe';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionService } from './collection.service';

const BOOK_IDS_QUERY_INVALID_MESSAGE = 'bookIds must be a comma-separated list of positive integers';
const PAGE_QUERY_INVALID_MESSAGE = 'page must be greater than or equal to 0';
const PAGE_WINDOW_INVALID_MESSAGE = `pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`;
const SIZE_QUERY_INVALID_MESSAGE = 'size must be between 1 and 100';
const MAX_PAGE_SIZE = 100;

@Controller('collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  private parseBookIdsQuery(bookIdsStr: string): number[] {
    const parts = bookIdsStr.split(',').map((part) => part.trim());
    if (parts.length === 0 || parts.some((part) => part.length === 0)) {
      throw new BadRequestException(BOOK_IDS_QUERY_INVALID_MESSAGE);
    }

    const parsed = parts.map((part) => Number(part));
    if (parsed.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new BadRequestException(BOOK_IDS_QUERY_INVALID_MESSAGE);
    }

    return [...new Set(parsed)];
  }

  private validatePageQuery(page: number, size: number): void {
    if (page < 0) {
      throw new BadRequestException(PAGE_QUERY_INVALID_MESSAGE);
    }

    if (!isOffsetWithinLimit(page * size)) {
      throw new BadRequestException(PAGE_WINDOW_INVALID_MESSAGE);
    }
  }

  private validateSizeQuery(size: number): void {
    if (size < 1 || size > MAX_PAGE_SIZE) {
      throw new BadRequestException(SIZE_QUERY_INVALID_MESSAGE);
    }
  }

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query('bookIds') bookIdsStr?: string) {
    if (!bookIdsStr) return this.collectionService.findAll(user);
    const bookIds = this.parseBookIdsQuery(bookIdsStr);
    return this.collectionService.findAll(user, bookIds);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.collectionService.findOne(id, user);
  }

  @Post()
  @Auditable({
    action: AuditAction.CollectionCreate,
    resource: AuditResource.Collection,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created collection '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateCollectionDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.create(dto, user);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderCollectionsDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.reorder(dto, user);
  }

  @Patch(':id')
  @Auditable({
    action: AuditAction.CollectionUpdate,
    resource: AuditResource.Collection,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated collection #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCollectionDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.CollectionDelete,
    resource: AuditResource.Collection,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Deleted collection #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.collectionService.remove(id, user);
  }

  @Post(':id/books')
  @Auditable({
    action: AuditAction.CollectionBooksAdd,
    resource: AuditResource.Collection,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Added ${count} book${count !== 1 ? 's' : ''} to collection #${req.params['id']}`;
    },
  })
  addBooks(@Param('id', ParseIntPipe) id: number, @Body() dto: CollectionBooksDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.addBooks(id, dto, user);
  }

  @Delete(':id/books')
  @Auditable({
    action: AuditAction.CollectionBooksRemove,
    resource: AuditResource.Collection,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => {
      const count = (req.body as { bookIds?: number[] })?.bookIds?.length ?? 0;
      return `Removed ${count} book${count !== 1 ? 's' : ''} from collection #${req.params['id']}`;
    },
  })
  removeBooks(@Param('id', ParseIntPipe) id: number, @Body() dto: CollectionBooksDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.removeBooks(id, dto, user);
  }

  @Get(':id/books')
  getBooks(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('collapseSeries', new ParseBoolPipe({ optional: true })) collapseSeries?: boolean,
    @Query('q') q?: string,
  ) {
    this.validateSizeQuery(size);
    this.validatePageQuery(page, size);
    return this.collectionService.getBooks(id, user, page, size, collapseSeries, q);
  }

  @Post(':id/books/query')
  queryBooks(@Param('id', ParseIntPipe) id: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.collectionService.queryBooks(id, user, query);
  }

  @Post(':id/books/jump-buckets')
  queryJumpBuckets(@Param('id', ParseIntPipe) id: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.collectionService.queryJumpBuckets(id, user, query);
  }
}
