import { Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { Permission, type MetadataCacheClearResponse, type MetadataCacheConfigResponse, type MetadataCacheStats } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ClearMetadataCacheQueryDto, UpdateMetadataCacheConfigDto } from './dto/metadata-cache.dto';
import { MetadataCacheAdminService } from './metadata-cache-admin.service';

@Controller('metadata-cache')
export class MetadataCacheController {
  constructor(private readonly admin: MetadataCacheAdminService) {}

  @Get('config')
  @RequirePermission(Permission.ManageMetadataConfig)
  getConfig(): Promise<MetadataCacheConfigResponse> {
    return this.admin.getConfig();
  }

  @Put('config')
  @RequirePermission(Permission.ManageMetadataConfig)
  updateConfig(@Body() dto: UpdateMetadataCacheConfigDto, @CurrentUser() user: RequestUser): Promise<MetadataCacheConfigResponse> {
    return this.admin.updateConfig(dto, user.id);
  }

  @Get('stats')
  @RequirePermission(Permission.ManageMetadataConfig)
  getStats(): Promise<MetadataCacheStats> {
    return this.admin.getStats();
  }

  @Delete()
  @RequirePermission(Permission.ManageMetadataConfig)
  clear(@Query() dto: ClearMetadataCacheQueryDto, @CurrentUser() user: RequestUser): Promise<MetadataCacheClearResponse> {
    return this.admin.clear(dto, user.id);
  }
}
