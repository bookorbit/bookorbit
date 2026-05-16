import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { AchievementCatalogueResponse } from '@bookorbit/types';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AchievementService } from './achievement.service';
import { AchievementBackfillService, type BackfillResult } from './achievement-backfill.service';

@Controller('achievements')
@UseGuards(JwtAuthGuard)
export class AchievementController {
  constructor(
    private readonly service: AchievementService,
    private readonly backfillService: AchievementBackfillService,
  ) {}

  @Get()
  async getCatalogue(@CurrentUser() user: RequestUser): Promise<AchievementCatalogueResponse> {
    return this.service.getCatalogue(user);
  }

  @Post('admin/backfill')
  async backfill(@CurrentUser() user: RequestUser): Promise<BackfillResult> {
    return this.backfillService.runBackfill(user);
  }
}
