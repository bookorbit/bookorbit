import { Permission } from '@projectx/types';
import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateProviderConfigDto } from './dto/update-provider-config.dto';
import { ProviderConfigService } from './provider-config.service';

@Controller('metadata-preferences/providers')
@RequirePermission(Permission.ManageMetadataConfig)
export class ProviderConfigController {
  constructor(private readonly service: ProviderConfigService) {}

  @Get()
  async getConfig() {
    const config = await this.service.getConfig();
    const statuses = await this.service.getProviderStatuses(config);
    return { config, statuses };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdateProviderConfigDto) {
    return this.service.updateConfig(dto);
  }
}
