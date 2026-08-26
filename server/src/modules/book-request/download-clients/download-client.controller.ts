import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { Auditable } from '../../../common/decorators/auditable.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { DownloadClientConfigService } from './download-client-config.service';
import { CreateDownloadClientDto, TestPathMappingDto, UpdateDownloadClientDto } from './dto/download-client.dto';

/**
 * Gated on `ManageAppSettings`, not `ManageBookRequests`: moderating a queue and holding seedbox
 * credentials are different levels of trust, and an approver should not get the second by having
 * the first.
 */
@Controller('admin/download-clients')
@RequirePermission(Permission.ManageAppSettings)
export class DownloadClientController {
  constructor(private readonly service: DownloadClientConfigService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @Auditable({
    action: AuditAction.DownloadClientCreate,
    resource: AuditResource.DownloadClient,
    getResourceId: (_req, res: unknown) => (res as { id?: number })?.id,
    description: (_req, res: unknown) => `Created download client '${(res as { name?: string })?.name ?? 'unknown'}'`,
  })
  create(@Body() dto: CreateDownloadClientDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Auditable({
    action: AuditAction.DownloadClientUpdate,
    resource: AuditResource.DownloadClient,
    getResourceId: (req) => Number(req.params.id),
    description: (req) => `Updated download client #${req.params.id}`,
  })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDownloadClientDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.DownloadClientDelete,
    resource: AuditResource.DownloadClient,
    getResourceId: (req) => Number(req.params.id),
    description: (req) => `Deleted download client #${req.params.id}`,
  })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.service.test(id);
  }

  /**
   * Answers whether an import from this path can hardlink into the Book Dock or will have to
   * copy. Read-only, and a "no" is a supported configuration rather than an error.
   */
  @Post(':id/test-path-mapping')
  @HttpCode(HttpStatus.OK)
  testPathMapping(@Param('id', ParseIntPipe) id: number, @Body() dto: TestPathMappingDto) {
    return this.service.testHardlink(id, dto.mappingId);
  }
}
