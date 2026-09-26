import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { AchievementCatalogueResponse, AchievementCelebrationClaim } from '@bookorbit/types';

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

  @Post('celebrations/claim')
  async claimCelebration(@CurrentUser() user: RequestUser): Promise<AchievementCelebrationClaim | null> {
    return this.service.claimCelebration(user);
  }

  @Post('celebrations/:claimId/acknowledge')
  @HttpCode(HttpStatus.NO_CONTENT)
  async acknowledgeCelebration(@CurrentUser() user: RequestUser, @Param('claimId', new ParseUUIDPipe()) claimId: string): Promise<void> {
    await this.service.acknowledgeCelebration(user, claimId);
  }

  @Post('admin/backfill')
  async backfill(@CurrentUser() user: RequestUser): Promise<BackfillResult> {
    return this.backfillService.runBackfill(user);
  }
}
