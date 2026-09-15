import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateIndexerManagerDto, UpdateIndexerManagerDto, UpdateManagedIndexerSourceDto } from './dto/indexer-manager.dto';
import { IndexerManagerService } from './indexer-manager.service';

@Controller('admin/request-indexer-managers')
@RequirePermission(Permission.ManageAppSettings)
export class IndexerManagerController {
  constructor(private readonly service: IndexerManagerService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateIndexerManagerDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateIndexerManagerDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.test(id);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  sync(@Param('id', ParseIntPipe) id: number) {
    return this.service.sync(id);
  }

  @Put(':id/sources/:sourceId')
  updateSource(@Param('id', ParseIntPipe) id: number, @Param('sourceId', ParseIntPipe) sourceId: number, @Body() dto: UpdateManagedIndexerSourceDto) {
    return this.service.updateSource(id, sourceId, dto);
  }
}
