import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Permission } from '@projectx/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateDryRunPlanDto } from './dto/create-dry-run-plan.dto';
import { CreateMigrationProfileDto } from './dto/create-migration-profile.dto';
import { CreateMigrationSourceDto } from './dto/create-migration-source.dto';
import { StartLiveRunDto } from './dto/start-live-run.dto';
import { TestMigrationSourceDto } from './dto/test-migration-source.dto';
import { ValidatePathMappingsDto } from './dto/validate-path-mappings.dto';
import { MigrationService } from './migration.service';

@Controller('migration')
@RequirePermission(Permission.ManageAppSettings)
export class MigrationController {
  constructor(private readonly service: MigrationService) {}

  @Get('supported-types')
  listSupportedTypes() {
    return this.service.listSupportedSourceTypes();
  }

  @Post('sources/test')
  testSource(@Body() dto: TestMigrationSourceDto) {
    return this.service.testSource(dto);
  }

  @Get('state')
  getWorkflowState() {
    return this.service.getWorkflowState();
  }

  @Get('target-users')
  listTargetUsers() {
    return this.service.listTargetUsers();
  }

  @Post('sources')
  createSource(@Body() dto: CreateMigrationSourceDto, @CurrentUser() user: RequestUser) {
    return this.service.createSource(dto, user.id);
  }

  @Post('sources/:id/validate')
  @HttpCode(HttpStatus.OK)
  validateSourceById(@Param('id', ParseIntPipe) sourceId: number) {
    return this.service.validateSourceById(sourceId);
  }

  @Get('sources/:id/path-prefixes')
  getSourcePathPrefixes(@Param('id', ParseIntPipe) sourceId: number) {
    return this.service.getSourcePathPrefixes(sourceId);
  }

  @Get('sources/:id/user-mapping-suggestions')
  suggestUserMappings(@Param('id', ParseIntPipe) sourceId: number) {
    return this.service.suggestUserMappings(sourceId);
  }

  @Post('sources/:id/path-mappings/validate')
  validatePathMappings(@Param('id', ParseIntPipe) sourceId: number, @Body() dto: ValidatePathMappingsDto) {
    return this.service.validatePathMappings(sourceId, dto);
  }

  @Post('profiles')
  createProfile(@Body() dto: CreateMigrationProfileDto, @CurrentUser() user: RequestUser) {
    return this.service.createProfile(dto, user.id);
  }

  @Post('plans/dry-run')
  createDryRunPlan(@Body() dto: CreateDryRunPlanDto, @CurrentUser() user: RequestUser) {
    return this.service.createDryRunPlan(dto, user.id);
  }

  @Post('runs/live')
  startLiveRun(@Body() dto: StartLiveRunDto, @CurrentUser() user: RequestUser) {
    return this.service.startLiveRun(dto, user.id);
  }

  @Get('runs/:id/progress')
  getRunProgress(@Param('id', ParseIntPipe) runId: number) {
    return this.service.getRunProgress(runId);
  }

  @Get('runs/:id/report')
  getRunReport(@Param('id', ParseIntPipe) runId: number) {
    return this.service.getRunReport(runId);
  }

  @Get('runs/:id/report/export')
  exportRunReport(@Param('id', ParseIntPipe) runId: number, @Query('format') format?: string) {
    return this.service.exportRunReport(runId, format);
  }
}
