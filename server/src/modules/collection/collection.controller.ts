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
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { AuditAction, AuditResource } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CollectionBooksDto } from './dto/collection-books.dto';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { CollectionService } from './collection.service';

@Controller('collections')
export class CollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query('bookIds') bookIdsStr?: string) {
    if (!bookIdsStr) return this.collectionService.findAll(user);
    const bookIds = bookIdsStr.split(',').map(Number);
    if (bookIds.some(isNaN)) throw new BadRequestException('bookIds must be a comma-separated list of integers');
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
  ) {
    return this.collectionService.getBooks(id, user, page, size);
  }
}
