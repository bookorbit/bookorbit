import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';

import type { GlobalFileWriteSettings } from '@projectx/types';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingDto } from './dto/update-app-setting.dto';
import { UpdateFilePatternDto } from './dto/update-file-pattern.dto';
import { UpdateOidcConfigDto } from './dto/update-oidc-config.dto';

@Controller('app-settings')
@RequirePermission('manage_app_settings')
export class AppSettingsController {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  @Get()
  findAll() {
    return this.appSettingsService.findAll();
  }

  @Patch(':key')
  @HttpCode(HttpStatus.OK)
  update(@Param('key') key: string, @Body() dto: UpdateAppSettingDto) {
    return this.appSettingsService.update(key, dto.value);
  }

  @Get('upload-pattern')
  async getUploadPattern() {
    return { pattern: await this.appSettingsService.getUploadPattern() };
  }

  @Put('upload-pattern')
  @HttpCode(HttpStatus.OK)
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
  updateOidcConfig(@Body() dto: UpdateOidcConfigDto) {
    return this.appSettingsService.updateOidcConfig(dto);
  }

  @Post('oidc/test')
  @HttpCode(HttpStatus.OK)
  async testOidcConnection(@Query('issuerUri') issuerUri?: string) {
    const uri = issuerUri || (await this.appSettingsService.getOidcConfig()).issuerUri;
    if (!uri) {
      return { success: false, error: 'Issuer URI is not configured' };
    }
    try {
      const url = `${uri.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const res = await fetch(url);
      if (!res.ok) return { success: false, error: `Provider returned HTTP ${res.status}` };
      const json: unknown = await res.json();
      const doc = json as { issuer: string; authorization_endpoint: string };
      return { success: true, issuer: doc.issuer, authorizationEndpoint: doc.authorization_endpoint };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  @Get('file-write-settings')
  getFileWriteSettings() {
    return this.appSettingsService.getFileWriteSettings();
  }

  @Put('file-write-settings')
  @HttpCode(HttpStatus.OK)
  updateFileWriteSettings(@Body() patch: Partial<GlobalFileWriteSettings>) {
    return this.appSettingsService.updateFileWriteSettings(patch);
  }
}
