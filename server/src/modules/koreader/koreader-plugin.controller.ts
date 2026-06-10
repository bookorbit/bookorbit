import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderPluginAnnotationService } from './koreader-plugin-annotation.service';
import { KoreaderPluginService } from './koreader-plugin.service';
import { KoreaderStatsService } from './koreader-stats.service';
import { AnnotationsUploadDto, BookStatesUploadDto, BulkProgressDto, MatchCheckDto, PageStatsUploadDto, SweepCompleteDto } from './dto';

@Public()
@UseGuards(KoreaderAuthGuard)
@Controller('koreader/plugin')
export class KoreaderPluginController {
  constructor(
    private readonly pluginService: KoreaderPluginService,
    private readonly statsService: KoreaderStatsService,
    private readonly annotationService: KoreaderPluginAnnotationService,
  ) {}

  @Post('match-check')
  matchCheck(@CurrentUser() user: RequestUser, @Body() dto: MatchCheckDto) {
    return this.pluginService.matchCheck(user, dto);
  }

  @Post('page-stats')
  uploadPageStats(@CurrentUser() user: RequestUser, @Body() dto: PageStatsUploadDto) {
    return this.statsService.uploadPageStats(user, dto);
  }

  @Post('annotations')
  uploadAnnotations(@CurrentUser() user: RequestUser, @Body() dto: AnnotationsUploadDto) {
    return this.annotationService.uploadAnnotations(user, dto);
  }

  @Post('book-states')
  uploadBookStates(@CurrentUser() user: RequestUser, @Body() dto: BookStatesUploadDto) {
    return this.pluginService.uploadBookStates(user, dto);
  }

  @Post('progress')
  bulkProgress(@CurrentUser() user: RequestUser, @Body() dto: BulkProgressDto) {
    return this.pluginService.bulkProgress(user, dto);
  }

  @Post('sweeps')
  sweepComplete(@CurrentUser() user: RequestUser, @Body() dto: SweepCompleteDto) {
    return this.pluginService.sweepComplete(user, dto);
  }
}
