import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateDryRunPlanDto } from './dto/create-dry-run-plan.dto';
import { CreateMigrationProfileDto } from './dto/create-migration-profile.dto';
import { CreateMigrationSourceDto } from './dto/create-migration-source.dto';
import { ResolveDuplicateMatchesDto } from './dto/resolve-duplicate-matches.dto';
import { StartLiveRunDto } from './dto/start-live-run.dto';
import { TestMigrationSourceDto } from './dto/test-migration-source.dto';
import { ValidatePathMappingsDto } from './dto/validate-path-mappings.dto';
import { MigrationSourceService } from './migration-source.service';
import { MigrationProfileService } from './migration-profile.service';
import { MigrationService } from './migration.service';

@Controller('migration')
@RequirePermission(Permission.ManageAppSettings)
export class MigrationController {
  constructor(
    private readonly sourceService: MigrationSourceService,
    private readonly profileService: MigrationProfileService,
    private readonly runService: MigrationService,
  ) {}

  @Get('supported-types')
  listSupportedTypes() {
    return this.sourceService.listSupportedSourceTypes();
  }

  @Post('sources/test')
  testSource(@Body() dto: TestMigrationSourceDto) {
    return this.sourceService.testSource(dto);
  }

  @Get('state')
  getWorkflowState() {
    return this.runService.getWorkflowState();
  }

  @Get('target-users')
  listTargetUsers() {
    return this.profileService.listTargetUsers();
  }

  @Post('sources')
  createSource(@Body() dto: CreateMigrationSourceDto, @CurrentUser() user: RequestUser) {
    return this.sourceService.createSource(dto, user.id);
  }

  @Post('sources/:id/validate')
  @HttpCode(HttpStatus.OK)
  validateSourceById(@Param('id', ParseIntPipe) sourceId: number) {
    return this.sourceService.validateSourceById(sourceId);
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetSource(@Param('id', ParseIntPipe) sourceId: number) {
    return this.sourceService.resetSource(sourceId);
  }

  @Get('sources/:id/path-prefixes')
  getSourcePathPrefixes(@Param('id', ParseIntPipe) sourceId: number) {
    return this.sourceService.getSourcePathPrefixes(sourceId);
  }

  @Get('sources/:id/user-mapping-suggestions')
  suggestUserMappings(@Param('id', ParseIntPipe) sourceId: number) {
    return this.profileService.suggestUserMappings(sourceId);
  }

  @Post('sources/:id/path-mappings/validate')
  validatePathMappings(@Param('id', ParseIntPipe) sourceId: number, @Body() dto: ValidatePathMappingsDto) {
    return this.profileService.validatePathMappings(sourceId, dto);
  }

  @Post('profiles')
  createProfile(@Body() dto: CreateMigrationProfileDto, @CurrentUser() user: RequestUser) {
    return this.profileService.createProfile(dto, user.id);
  }

  @Post('plans/dry-run')
  createDryRunPlan(@Body() dto: CreateDryRunPlanDto, @CurrentUser() user: RequestUser) {
    return this.runService.createDryRunPlan(dto, user.id);
  }

  @Post('plans/:id/resolve-duplicates')
  @HttpCode(HttpStatus.OK)
  resolveDuplicateMatches(@Param('id', ParseIntPipe) artifactId: number, @Body() dto: ResolveDuplicateMatchesDto) {
    return this.runService.resolveDuplicateMatches(artifactId, dto);
  }

  @Post('runs/live')
  startLiveRun(@Body() dto: StartLiveRunDto, @CurrentUser() user: RequestUser) {
    return this.runService.startLiveRun(dto, user.id);
  }

  @Post('runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRun(@Param('id', ParseIntPipe) runId: number) {
    return this.runService.cancelRun(runId);
  }

  @Post('runs/:id/retry')
  @HttpCode(HttpStatus.OK)
  retryRun(@Param('id', ParseIntPipe) runId: number) {
    return this.runService.retryFailedRun(runId);
  }

  @Get('runs/:id/progress')
  getRunProgress(@Param('id', ParseIntPipe) runId: number) {
    return this.runService.getRunProgress(runId);
  }

  @Get('runs/:id/report')
  getRunReport(@Param('id', ParseIntPipe) runId: number) {
    return this.runService.getRunReport(runId);
  }

  @Get('runs/:id/report/export')
  async exportRunReport(@Param('id', ParseIntPipe) runId: number, @Query('format') format: string | undefined, @Res() reply: FastifyReply) {
    const result = await this.runService.exportRunReport(runId, format);
    return reply
      .header('Content-Type', result.contentType)
      .header('Content-Disposition', `attachment; filename="${result.fileName}"`)
      .send(result.content);
  }
}
