import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';

import { Permission, AuditAction, AuditResource } from '@projectx/types';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingDto } from './dto/update-app-setting.dto';
import { UpdateFilePatternDto } from './dto/update-file-pattern.dto';
import { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';

@Controller('app-settings')
@RequirePermission(Permission.ManageAppSettings)
export class AppSettingsController {
  constructor(private readonly appSettingsService: AppSettingsService) {}

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

  @Public()
  @Get('oidc/public')
  async getOidcPublicConfig() {
    const config = await this.appSettingsService.getOidcConfig();
    return {
      enabled: config.enabled,
      providerName: config.providerName,
      issuerUri: config.issuerUri,
      clientId: config.clientId,
      scopes: config.scopes,
    };
  }

  @Get('oidc')
  async getOidcConfig() {
    const config = await this.appSettingsService.getOidcConfig();
    return { ...config, clientSecret: config.clientSecret ? '***' : '' };
  }

  @Put('oidc')
  @Auditable({ action: AuditAction.AppSettingsUpdate, resource: AuditResource.AppSettings, description: 'Updated OIDC configuration' })
  updateOidcConfig(@Body() dto: UpdateOidcConfigDto) {
    return this.appSettingsService.updateOidcConfig(dto);
  }

  @Post('oidc/test')
  @HttpCode(HttpStatus.OK)
  testOidcConnection(@Query('issuerUri') issuerUri?: string) {
    return this.appSettingsService.testOidcConnection(issuerUri);
  }
}
