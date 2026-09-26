import { Controller, Get } from '@nestjs/common';

import { ProviderConfigService } from './provider-config.service';

@Controller('metadata-preferences/provider-links')
export class ProviderLinkSettingsController {
  constructor(private readonly service: ProviderConfigService) {}

  @Get()
  getSettings() {
    return this.service.getLinkSettings();
  }
}
