import { Body, Controller, Get, Patch, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import {
  ReadingInsightsAccessHistoryQueryDto,
  SharedReadingInsightsQueryDto,
  UpdateReadingInsightsSharingDto,
} from './dto/shared-reading-insights.dto';
import { SharedReadingInsightsService } from './shared-reading-insights.service';

@Controller('reading-insights-sharing')
export class ReadingInsightsSharingController {
  constructor(private readonly service: SharedReadingInsightsService) {}

  @Get('me')
  getMySettings(@CurrentUser() user: RequestUser) {
    return this.service.getMySettings(user.id);
  }

  @Patch('me')
  updateMySettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateReadingInsightsSharingDto) {
    return this.service.updateMySettings(user, dto.sharingLevel);
  }

  @Get('me/preview')
  getMyPreview(@CurrentUser() user: RequestUser, @Query() query: SharedReadingInsightsQueryDto) {
    return this.service.getMyPreview(user.id, query.days);
  }

  @Get('me/access-history')
  getMyAccessHistory(@CurrentUser() user: RequestUser, @Query() query: ReadingInsightsAccessHistoryQueryDto) {
    return this.service.getMyAccessHistory(user.id, query.page, query.pageSize);
  }
}
