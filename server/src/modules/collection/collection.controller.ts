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

import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
  create(@Body() dto: CreateCollectionDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.create(dto, user);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderCollectionsDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.reorder(dto, user);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCollectionDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.collectionService.remove(id, user);
  }

  @Post(':id/books')
  addBooks(@Param('id', ParseIntPipe) id: number, @Body() dto: CollectionBooksDto, @CurrentUser() user: RequestUser) {
    return this.collectionService.addBooks(id, dto, user);
  }

  @Delete(':id/books')
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
