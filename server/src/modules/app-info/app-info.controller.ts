import { Controller, Get } from '@nestjs/common';

import type { AppInfoResponse } from '@bookorbit/types';

import { APP_INFO_ROUTE } from './app-info.constants';
import { AppInfoService } from './app-info.service';

@Controller(APP_INFO_ROUTE)
export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  @Get()
  async getAppInfo(): Promise<AppInfoResponse> {
    return this.appInfoService.getAppInfo();
  }
}
