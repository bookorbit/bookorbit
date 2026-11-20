import { Body, Controller, Get, Injectable, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import type { BookQuery, JumpBucketsQuery, TaxonomyKind } from '@bookorbit/types';
import { KeyReadSafe } from '../../common/decorators/api-key-policy.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryPipe, JumpBucketsQueryPipe } from '../book/pipes/book-query.pipe';
import { ListTaxonomyDto } from './dto/list-taxonomy.dto';
import { TaxonomyLibraryDto } from './dto/taxonomy-library.dto';
import { TaxonomyService } from './taxonomy.service';

/**
 * Genres and tags answer the same five routes. Each kind gets its own controller so the paths stay
 * plain (`/genres`, `/tags`) instead of a `:kind` parameter that would sit beside every other
 * top-level route.
 *
 * `@Injectable()` is here only so TypeScript records the constructor's parameter types; without a
 * decorator on the class that declares the constructor, Nest has nothing to inject.
 */
@Injectable()
abstract class TaxonomyControllerBase {
  protected abstract readonly kind: TaxonomyKind;

  constructor(protected readonly taxonomyService: TaxonomyService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() dto: ListTaxonomyDto) {
    return this.taxonomyService.findPage(this.kind, user, dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.taxonomyService.findDetail(this.kind, id, user);
  }

  @Get(':id/similar')
  findSimilar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.taxonomyService.findSimilar(this.kind, id, user);
  }

  @Post(':id/books/query')
  @KeyReadSafe()
  queryBooks(
    @Param('id', ParseIntPipe) id: number,
    @Query() scope: TaxonomyLibraryDto,
    @Body(BookQueryPipe) query: BookQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.taxonomyService.queryBooks(this.kind, id, user, query, scope.libraryId);
  }

  @Post(':id/books/jump-buckets')
  @KeyReadSafe()
  queryJumpBuckets(
    @Param('id', ParseIntPipe) id: number,
    @Query() scope: TaxonomyLibraryDto,
    @Body(JumpBucketsQueryPipe) query: JumpBucketsQuery,
    @CurrentUser() user: RequestUser,
  ) {
    return this.taxonomyService.queryJumpBuckets(this.kind, id, user, query, scope.libraryId);
  }
}

@Controller('genres')
export class GenresController extends TaxonomyControllerBase {
  protected readonly kind = 'genre' as const;
}

@Controller('tags')
export class TagsController extends TaxonomyControllerBase {
  protected readonly kind = 'tag' as const;
}
