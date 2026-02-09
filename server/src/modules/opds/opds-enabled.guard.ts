import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

import { AppSettingsService } from '../app-settings/app-settings.service';

@Injectable()
export class OpdsEnabledGuard implements CanActivate {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  async canActivate(): Promise<boolean> {
    const settings = await this.appSettingsService.findAll();
    const opdsRow = settings.find((s) => s.key === 'opds_enabled');
    if (opdsRow?.value !== 'true') {
      throw new ForbiddenException('OPDS server is disabled');
    }
    return true;
  }
}
