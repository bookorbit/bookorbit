import { Controller, Get } from '@nestjs/common';
import { Permission, type SetupOverview } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SetupOverviewService } from './setup-overview.service';

/**
 * How this install is set up, read back as flows.
 *
 * Every card describes the server rather than one account, so it needs the grant that opens the
 * settings it summarises. Nothing here writes; each row links to the page that owns the setting.
 */
@Controller('setup-overview')
export class SetupOverviewController {
  constructor(private readonly service: SetupOverviewService) {}

  @Get()
  @RequirePermission(Permission.ManageAppSettings)
  get(@CurrentUser() user: RequestUser): Promise<SetupOverview> {
    return this.service.get(user);
  }
}
