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

import { AuditAction, AuditResource } from '@bookorbit/types';
import type { BookQuery } from '@bookorbit/types';
import { MAX_OFFSET_ROWS, isOffsetWithinLimit } from '../../common/constants/pagination.constants';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookQueryPipe } from '../book/pipes/book-query.pipe';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';
import { SmartScopeService } from './smart-scope.service';

const PAGE_QUERY_INVALID_MESSAGE = 'page must be greater than or equal to 0';
const PAGE_WINDOW_INVALID_MESSAGE = `pagination window is too deep; page * size must be <= ${MAX_OFFSET_ROWS}`;
const SIZE_QUERY_INVALID_MESSAGE = 'size must be between 1 and 100';
const MAX_PAGE_SIZE = 100;

@Controller('smart-scopes')
export class SmartScopeController {
  constructor(private readonly smartScopeService: SmartScopeService) {}

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
  findAll(@CurrentUser() user: RequestUser) {
    return this.smartScopeService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.findOne(id, user);
  }

  @Post()
  @Auditable({
    action: AuditAction.SmartScopeCreate,
    resource: AuditResource.SmartScope,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created smartScope '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateSmartScopeDto, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.create(dto, user);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderSmartScopesDto, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.reorder(dto, user);
  }

  @Patch(':id')
  @Auditable({
    action: AuditAction.SmartScopeUpdate,
    resource: AuditResource.SmartScope,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated smartScope #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSmartScopeDto, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.SmartScopeDelete,
    resource: AuditResource.SmartScope,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Deleted smartScope #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.remove(id, user);
  }

  @Get(':id/books')
  executeSmartScope(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('q') q?: string,
  ) {
    this.validateSizeQuery(size);
    this.validatePageQuery(page, size);
    return this.smartScopeService.executeSmartScope(id, user, page, size, q);
  }

  @Post(':id/books/query')
  queryBooks(@Param('id', ParseIntPipe) id: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.queryBooks(id, user, query);
  }

  @Post(':id/books/jump-buckets')
  queryJumpBuckets(@Param('id', ParseIntPipe) id: number, @Body(BookQueryPipe) query: BookQuery, @CurrentUser() user: RequestUser) {
    return this.smartScopeService.queryJumpBuckets(id, user, query);
  }
}
