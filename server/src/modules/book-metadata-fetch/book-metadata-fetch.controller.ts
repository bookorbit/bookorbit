import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { type BookMetadataFetchConfig, type BookMetadataFetchConfigOverride, Permission } from '@projectx/types';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';
import { PreviewCountDto, UpdateBookMetadataFetchConfigDto, UpdateLibraryBookMetadataFetchConfigDto } from './dto/update-config.dto';

@Controller('book-metadata-fetch')
export class BookMetadataFetchController {
  constructor(
    private readonly configService: BookMetadataFetchConfigService,
    private readonly orchestrator: BookMetadataFetchOrchestratorService,
    private readonly queueRepo: BookMetadataFetchQueueRepository,
    private readonly session: BookMetadataFetchSessionService,
  ) {}

  @Get('config')
  @RequirePermission(Permission.ManageMetadataConfig)
  getConfig() {
    return this.configService.getGlobalConfig();
  }

  @Put('config')
  @RequirePermission(Permission.ManageMetadataConfig)
  async updateConfig(@Body() dto: UpdateBookMetadataFetchConfigDto) {
    await this.configService.setGlobalConfig(dto as unknown as BookMetadataFetchConfig);
    return this.configService.getGlobalConfig();
  }

  @Get('config/libraries/:id')
  @RequirePermission(Permission.ManageMetadataConfig)
  getLibraryConfig(@Param('id', ParseIntPipe) libraryId: number) {
    return this.configService.getLibraryConfigWithLastRun(libraryId);
  }

  @Put('config/libraries/:id')
  @RequirePermission(Permission.ManageMetadataConfig)
  async updateLibraryConfig(@Param('id', ParseIntPipe) libraryId: number, @Body() dto: UpdateLibraryBookMetadataFetchConfigDto) {
    const override = Object.keys(dto).length === 0 ? null : (dto as unknown as BookMetadataFetchConfigOverride);
    await this.configService.setLibraryOverride(libraryId, override);
    return this.configService.getEffectiveConfig(libraryId);
  }

  @Get('status')
  @RequirePermission(Permission.ManageMetadataConfig)
  async getStatus() {
    const [summary, paused] = await Promise.all([this.queueRepo.getStatusSummary(), this.configService.isPaused()]);
    return { ...summary, paused, ...this.session.getSnapshot() };
  }

  @Post('run')
  @RequirePermission(Permission.ManageMetadataConfig)
  async triggerGlobal() {
    const queued = await this.orchestrator.triggerGlobal();
    return { queued };
  }

  @Post('run/:libraryId')
  @RequirePermission(Permission.ManageMetadataConfig)
  async triggerForLibrary(@Param('libraryId', ParseIntPipe) libraryId: number) {
    const queued = await this.orchestrator.triggerForLibrary(libraryId);
    return { queued };
  }

  @Post('pause')
  @RequirePermission(Permission.ManageMetadataConfig)
  async pause() {
    await this.orchestrator.pause();
    return { paused: true };
  }

  @Post('resume')
  @RequirePermission(Permission.ManageMetadataConfig)
  async resume() {
    await this.orchestrator.resume();
    return { paused: false };
  }

  @Post('cancel')
  @RequirePermission(Permission.ManageMetadataConfig)
  async cancel() {
    await this.orchestrator.cancelPending();
    return { cancelled: true };
  }

  @Post('retry-failed')
  @RequirePermission(Permission.ManageMetadataConfig)
  async retryFailed() {
    const requeued = await this.orchestrator.requeueFailed();
    return { requeued };
  }

  @Post('preview-count')
  @RequirePermission(Permission.ManageMetadataConfig)
  async previewCount(@Body() dto: PreviewCountDto) {
    const config: BookMetadataFetchConfig = {
      enabled: true,
      triggerOnImport: false,
      conditions: dto.conditions as BookMetadataFetchConfig['conditions'],
    };
    const count = await this.queueRepo.countEligibleBooks(config, dto.libraryId);
    return { count };
  }

  @Get('failed')
  @RequirePermission(Permission.ManageMetadataConfig)
  async getFailedItems(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    const safeLimit = Math.min(limit, 100);
    const { items, total } = await this.queueRepo.getFailedItems(page, safeLimit);
    return { items, total, page, limit: safeLimit };
  }
}
