import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AccountActivityService } from './account-activity.service';
import { ListAccountActivityDto } from './dto/list-account-activity.dto';

@Controller('account-activity')
@RequirePermission(Permission.ViewUserActivity)
export class AccountActivityController {
  constructor(private readonly service: AccountActivityService) {}

  @Get()
  list(@Query() query: ListAccountActivityDto) {
    return this.service.list(query);
  }

  @Get('summary')
  getSummary() {
    return this.service.getSummary();
  }

  @Get(':userId')
  getDetail(@Param('userId', ParseIntPipe) userId: number) {
    return this.service.getDetail(userId);
  }
}
