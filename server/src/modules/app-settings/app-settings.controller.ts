import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';

import { Permission, AuditAction, AuditResource } from '@projectx/types';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { AppSettingsService } from './app-settings.service';
import { OidcProviderService } from './oidc-provider.service';
import { UpdateAppSettingDto } from './dto/update-app-setting.dto';
import { UpdateFilePatternDto } from './dto/update-file-pattern.dto';
import { CreateOidcProviderDto } from './dto/create-oidc-provider.dto';
import { UpdateOidcProviderDto } from './dto/update-oidc-provider.dto';
import { CreateGroupMappingDto } from './dto/create-group-mapping.dto';
import { UpdateGroupMappingDto } from './dto/update-group-mapping.dto';

@Controller('app-settings')
@RequirePermission(Permission.ManageAppSettings)
export class AppSettingsController {
  constructor(
    private readonly appSettingsService: AppSettingsService,
    private readonly oidcProviderService: OidcProviderService,
  ) {}

  @Get()
  listSettings() {
    return this.appSettingsService.listSettings();
  }

  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => `Updated app setting '${req.params['key']}'`,
  })
  update(@Param('key') key: string, @Body() dto: UpdateAppSettingDto) {
    return this.appSettingsService.update(key, dto.value);
  }

  @Get('upload-pattern')
  async getUploadPattern() {
    return { pattern: await this.appSettingsService.getUploadPattern() };
  }

  @Put('upload-pattern')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Updated upload file pattern' })
  async setUploadPattern(@Body() dto: UpdateFilePatternDto) {
    await this.appSettingsService.setUploadPattern(dto.pattern);
    return { pattern: dto.pattern };
  }

  @Get('download-pattern')
  async getDownloadPattern() {
    return { pattern: await this.appSettingsService.getDownloadPattern() };
  }

  @Put('download-pattern')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Updated download file pattern' })
  async setDownloadPattern(@Body() dto: UpdateFilePatternDto) {
    await this.appSettingsService.setDownloadPattern(dto.pattern);
    return { pattern: dto.pattern };
  }

  // --- OIDC Provider CRUD ---

  @Public()
  @Get('oidc/providers/public')
  async getOidcProvidersPublic() {
    const providers = await this.oidcProviderService.findEnabled();
    return providers.map((p) => ({
      slug: p.slug,
      displayName: p.displayName,
      enabled: p.enabled,
      iconUrl: p.iconUrl,
      clientId: p.clientId,
      scopes: p.scopes,
    }));
  }

  @Get('oidc/providers')
  listOidcProviders() {
    return this.oidcProviderService.findAll();
  }

  @Get('oidc/providers/:slug')
  async getOidcProvider(@Param('slug') slug: string) {
    const provider = await this.oidcProviderService.findBySlugOrFail(slug);
    return { ...provider, clientSecret: provider.clientSecret ? '***' : '' };
  }

  @Post('oidc/providers')
  @HttpCode(HttpStatus.CREATED)
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => {
      const slug = (req.body as Record<string, unknown> | undefined)?.slug;
      return `Created OIDC provider '${typeof slug === 'string' ? slug : 'unknown'}'`;
    },
  })
  createOidcProvider(@Body() dto: CreateOidcProviderDto) {
    return this.oidcProviderService.create(dto);
  }

  @Put('oidc/providers/:slug')
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => `Updated OIDC provider '${req.params['slug']}'`,
  })
  updateOidcProvider(@Param('slug') slug: string, @Body() dto: UpdateOidcProviderDto) {
    return this.oidcProviderService.update(slug, dto);
  }

  @Delete('oidc/providers/:slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.AppSettingsUpdate,
    resource: AuditResource.AppSettings,
    description: (req) => `Deleted OIDC provider '${req.params['slug']}'`,
  })
  deleteOidcProvider(@Param('slug') slug: string) {
    return this.oidcProviderService.remove(slug);
  }

  @Post('oidc/providers/:slug/test')
  @HttpCode(HttpStatus.OK)
  async testOidcProviderConnection(@Param('slug') slug: string, @Query('issuerUri') issuerUri?: string) {
    const uri = issuerUri || (await this.oidcProviderService.findBySlugOrFail(slug)).issuerUri;
    return this.oidcProviderService.testConnection(uri);
  }

  @Put('oidc/providers/reorder')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Reordered OIDC providers' })
  reorderOidcProviders(@Body() body: { slugs: string[] }) {
    return this.oidcProviderService.reorder(body.slugs);
  }

  // --- Provider-scoped group mappings ---

  @Get('oidc/providers/:slug/group-mappings')
  listProviderGroupMappings(@Param('slug') slug: string) {
    return this.oidcProviderService.listGroupMappings(slug);
  }

  @Post('oidc/providers/:slug/group-mappings')
  @HttpCode(HttpStatus.CREATED)
  createProviderGroupMapping(@Param('slug') slug: string, @Body() dto: CreateGroupMappingDto) {
    return this.oidcProviderService.createGroupMapping(slug, dto.oidcGroupClaim, dto.permissionName);
  }

  @Put('oidc/providers/:slug/group-mappings/:id')
  @HttpCode(HttpStatus.OK)
  updateProviderGroupMapping(@Param('slug') slug: string, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGroupMappingDto) {
    return this.oidcProviderService.updateGroupMapping(slug, id, dto.permissionName);
  }

  @Delete('oidc/providers/:slug/group-mappings/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProviderGroupMapping(@Param('slug') slug: string, @Param('id', ParseIntPipe) id: number) {
    return this.oidcProviderService.deleteGroupMapping(slug, id);
  }
}
