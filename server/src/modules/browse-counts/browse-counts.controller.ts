import { Controller, Get } from '@nestjs/common';

import type { BrowseCounts } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BrowseCountsService } from './browse-counts.service';

@Controller('browse-counts')
export class BrowseCountsController {
  constructor(private readonly browseCountsService: BrowseCountsService) {}

  @Get()
  getCounts(@CurrentUser() user: RequestUser): Promise<BrowseCounts> {
    return this.browseCountsService.getCounts(user);
  }
}
