import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { AuditAction, AuditResource } from '@projectx/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateLensDto } from './dto/create-lens.dto';
import { ReorderLensesDto } from './dto/reorder-lenses.dto';
import { UpdateLensDto } from './dto/update-lens.dto';
import { LensService } from './lens.service';

@Controller('lenses')
export class LensController {
  constructor(private readonly lensService: LensService) {}

  @Get()
  findAll(@CurrentUser() user: RequestUser) {
    return this.lensService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.lensService.findOne(id, user);
  }

  @Post()
  @Auditable({
    action: AuditAction.LensCreate,
    resource: AuditResource.Lens,
    getResourceId: (_, res: unknown) => (res as { id?: number })?.id,
    description: (_, res: unknown) => `Created lens '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateLensDto, @CurrentUser() user: RequestUser) {
    return this.lensService.create(dto, user);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(@Body() dto: ReorderLensesDto, @CurrentUser() user: RequestUser) {
    return this.lensService.reorder(dto, user);
  }

  @Patch(':id')
  @Auditable({
    action: AuditAction.LensUpdate,
    resource: AuditResource.Lens,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Updated lens #${req.params['id']}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLensDto, @CurrentUser() user: RequestUser) {
    return this.lensService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.LensDelete,
    resource: AuditResource.Lens,
    getResourceId: (req) => parseInt(req.params['id'] as string, 10),
    description: (req) => `Deleted lens #${req.params['id']}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.lensService.remove(id, user);
  }

  @Get(':id/books')
  executeLens(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Query('page', new DefaultValuePipe(0), ParseIntPipe) page: number,
    @Query('size', new DefaultValuePipe(50), ParseIntPipe) size: number,
    @Query('q') q?: string,
  ) {
    return this.lensService.executeLens(id, user, page, size, q);
  }
}
