import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderAnnotationExchangeService } from './koreader-annotation-exchange.service';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderPluginAnnotationService } from './koreader-plugin-annotation.service';
import { KoreaderPluginService } from './koreader-plugin.service';
import { KoreaderStatsService } from './koreader-stats.service';
import {
  AnnotationExchangeAckDto,
  AnnotationExchangeDto,
  AnnotationsUploadDto,
  BookStatesUploadDto,
  BulkProgressDto,
  MatchCheckDto,
  PageStatsUploadDto,
  SweepCompleteDto,
} from './dto';

@Public()
@UseGuards(KoreaderAuthGuard)
@Controller('koreader/plugin')
export class KoreaderPluginController {
  constructor(
    private readonly pluginService: KoreaderPluginService,
    private readonly statsService: KoreaderStatsService,
    private readonly annotationService: KoreaderPluginAnnotationService,
    private readonly annotationExchangeService: KoreaderAnnotationExchangeService,
    private readonly packageService: KoreaderPackageService,
  ) {}

  @Post('match-check')
  matchCheck(@CurrentUser() user: RequestUser, @Body() dto: MatchCheckDto) {
    return this.pluginService.matchCheck(user, dto);
  }

  @Post('page-stats')
  uploadPageStats(@CurrentUser() user: RequestUser, @Body() dto: PageStatsUploadDto) {
    return this.statsService.uploadPageStats(user, dto);
  }

  /** Deprecated one-way upload kept for plugin 0.3.x; 0.4+ uses the exchange below. */
  @Post('annotations')
  uploadAnnotations(@CurrentUser() user: RequestUser, @Body() dto: AnnotationsUploadDto) {
    return this.annotationService.uploadAnnotations(user, dto);
  }

  @Post('annotations/exchange')
  exchangeAnnotations(@CurrentUser() user: RequestUser, @Body() dto: AnnotationExchangeDto) {
    return this.annotationExchangeService.exchange(user, dto);
  }

  @Post('annotations/exchange-ack')
  exchangeAnnotationsAck(@CurrentUser() user: RequestUser, @Body() dto: AnnotationExchangeAckDto) {
    return this.annotationExchangeService.exchangeAck(user, dto);
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

  @Get('version')
  getVersion() {
    return this.packageService.getVersionInfo();
  }

  @Get('package')
  async downloadUpdatePackage(@CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    const zip = await this.packageService.buildRawPluginPackage(user.id);
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', 'attachment; filename="bookorbit.koplugin.zip"')
      .header('Cache-Control', 'no-store')
      .send(zip);
  }
}
