import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { AuditAction, AuditResource } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateSmartScopeDto } from './dto/create-smart-scope.dto';
import { ReorderSmartScopesDto } from './dto/reorder-smart-scopes.dto';
import { UpdateSmartScopeDto } from './dto/update-smart-scope.dto';
import { SmartScopeService } from './smart-scope.service';

@Controller('smart-scopes')
export class SmartScopeController {
  constructor(private readonly smartScopeService: SmartScopeService) {}

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
    return this.smartScopeService.executeSmartScope(id, user, page, size, q);
  }
}
