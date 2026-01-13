import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppSettingsService } from './app-settings.service';
import { UpdateAppSettingDto } from './dto/update-app-setting.dto';
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
      const doc = await res.json();
      return { success: true, issuer: doc.issuer, authorizationEndpoint: doc.authorization_endpoint };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
