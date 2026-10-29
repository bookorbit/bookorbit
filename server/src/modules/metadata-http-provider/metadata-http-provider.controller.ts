import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import type { MetadataHttpProviderView } from '@bookorbit/types';

import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import {
  CreateMetadataHttpProviderDto,
  DeleteMetadataHttpProviderQueryDto,
  TestMetadataHttpProviderDto,
  UpdateMetadataHttpProviderDto,
} from './dto/metadata-http-provider.dto';
import { MetadataHttpProviderService } from './metadata-http-provider.service';
import { MetadataProviderDirectoryService } from './metadata-provider-directory.service';

function providerName(res: unknown): string {
  const view = res as Partial<MetadataHttpProviderView> | undefined;
  return view?.info?.name ?? view?.key ?? 'unknown';
}

/** External metadata providers: admins register them by URL, everyone else only sees them in searches. */
@Controller('metadata-http-providers')
@RequirePermission(Permission.ManageMetadataConfig)
export class MetadataHttpProviderController {
  constructor(
    private readonly service: MetadataHttpProviderService,
    private readonly directory: MetadataProviderDirectoryService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  /** Ready-made providers an admin can run, for the External tab. */
  @Get('directory')
  directoryList() {
    return this.directory.get();
  }

  @Post()
  @Auditable({
    action: AuditAction.MetadataHttpProviderCreate,
    resource: AuditResource.MetadataHttpProvider,
    getResourceId: (_req, res: unknown) => (res as { id?: number })?.id,
    description: (_req, res: unknown) => `Added metadata provider '${providerName(res)}'`,
  })
  create(@Body() dto: CreateMetadataHttpProviderDto, @CurrentUser() user: RequestUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @Auditable({
    action: AuditAction.MetadataHttpProviderUpdate,
    resource: AuditResource.MetadataHttpProvider,
    getResourceId: (req) => Number(req.params.id),
    description: (_req, res: unknown) => `Updated metadata provider '${providerName(res)}'`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMetadataHttpProviderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Auditable({
    action: AuditAction.MetadataHttpProviderDelete,
    resource: AuditResource.MetadataHttpProvider,
    getResourceId: (req) => Number(req.params.id),
    description: (req) =>
      `Removed metadata provider #${req.params.id}${(req.query as Record<string, unknown> | undefined)?.purge === 'true' ? ' and its stored data' : ''}`,
  })
  remove(@Param('id', ParseIntPipe) id: number, @Query() query: DeleteMetadataHttpProviderQueryDto) {
    return this.service.remove(id, query.purge === true);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseIntPipe) id: number, @Body() dto: TestMetadataHttpProviderDto) {
    return this.service.test(id, dto.query);
  }
}
