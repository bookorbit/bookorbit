import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditAction, AuditResource, Permission, type AiConnection, type AiSlotsUpdateResult } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { AiAdminService, type AiActor } from './ai-admin.service';
import {
  AiTryDto,
  AiUsageQueryDto,
  CreateAiConnectionDto,
  TestAiConnectionDto,
  TestSavedAiConnectionDto,
  UpdateAiBudgetDto,
  UpdateAiConnectionDto,
  UpdateAiFeatureDto,
  UpdateAiSlotsDto,
} from './dto/ai-admin.dto';

const ONE_MINUTE_MS = 60_000;
/** Tests and Try it each send a paid request, so they are limited. */
const PAID_REQUEST_THROTTLE = { default: { limit: 10, ttl: ONE_MINUTE_MS } };

/**
 * The AI provider settings: connections with their keys, the slots features use, each feature's
 * switch and limits, the budget, and usage. A signed-in session only, since the connections hold
 * provider credentials.
 */
@Controller('admin/ai')
@RequirePermission(Permission.ManageAppSettings)
@InteractiveOnly()
export class AiAdminController {
  constructor(private readonly service: AiAdminService) {}

  @Get()
  overview() {
    return this.service.overview();
  }

  @Get('connections')
  listConnections() {
    return this.service.listConnections();
  }

  @Post('connections')
  @Auditable({
    action: AuditAction.AiConnectionCreate,
    resource: AuditResource.AiConnection,
    getResourceId: (_req, res) => (res as AiConnection | undefined)?.id,
    getMeta: (_req, res) => ({ apiType: (res as AiConnection | undefined)?.apiType, hasKey: (res as AiConnection | undefined)?.hasKey }),
    description: (_req, res) => `Added AI connection '${(res as AiConnection | undefined)?.name ?? 'unknown'}'`,
  })
  createConnection(@Body() dto: CreateAiConnectionDto) {
    return this.service.createConnection(dto);
  }

  /** Audited by the service, which knows which fields changed and whether the key did. */
  @Patch('connections/:id')
  updateConnection(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAiConnectionDto,
    @CurrentUser() user: RequestUser,
    @Req() req: FastifyRequest,
  ) {
    return this.service.updateConnection(id, dto, actorOf(user, req));
  }

  @Delete('connections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auditable({
    action: AuditAction.AiConnectionDelete,
    resource: AuditResource.AiConnection,
    getResourceId: (req) => Number(req.params.id),
    description: (req) => `Deleted AI connection #${req.params.id}`,
  })
  deleteConnection(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteConnection(id);
  }

  @Post('connections/test')
  @HttpCode(HttpStatus.OK)
  @Throttle(PAID_REQUEST_THROTTLE)
  testDraft(@Body() dto: TestAiConnectionDto) {
    return this.service.testDraft(dto);
  }

  @Post('connections/:id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle(PAID_REQUEST_THROTTLE)
  testSaved(@Param('id', ParseIntPipe) id: number, @Body() dto: TestSavedAiConnectionDto) {
    return this.service.testSaved(id, dto.model);
  }

  @Get('connections/:id/models')
  listModels(@Param('id', ParseIntPipe) id: number) {
    return this.service.listModels(id);
  }

  @Get('settings')
  getSettings() {
    return this.service.getSettings();
  }

  @Put('settings/slots')
  @Auditable({
    action: AuditAction.AiSlotsUpdate,
    resource: AuditResource.AiSettings,
    getMeta: (_req, res) => ({ slots: (res as AiSlotsUpdateResult).changed }),
    description: (_req, res) => `Changed the AI ${(res as AiSlotsUpdateResult).changed.join(' and ')} slot`,
    when: (_req, res) => (res as AiSlotsUpdateResult).changed.length > 0,
  })
  updateSlots(@Body() dto: UpdateAiSlotsDto) {
    return this.service.updateSlots(dto);
  }

  /** Audited by the service: the switch, the limits and the privacy confirmation are separate entries. */
  @Put('settings/features/:feature')
  updateFeature(@Param('feature') feature: string, @Body() dto: UpdateAiFeatureDto, @CurrentUser() user: RequestUser, @Req() req: FastifyRequest) {
    return this.service.updateFeature(feature, dto, actorOf(user, req));
  }

  @Put('settings/budget')
  @Auditable({
    action: AuditAction.AiBudgetUpdate,
    resource: AuditResource.AiSettings,
    getMeta: (req) => ({ fields: Object.keys((req.body as Record<string, unknown> | undefined) ?? {}) }),
    description: 'Changed the AI budget',
  })
  updateBudget(@Body() dto: UpdateAiBudgetDto) {
    return this.service.updateBudget(dto);
  }

  @Post('try')
  @HttpCode(HttpStatus.OK)
  @Throttle(PAID_REQUEST_THROTTLE)
  tryIt(@Body() dto: AiTryDto) {
    return this.service.tryIt(dto.slot);
  }

  @Get('usage')
  usage(@Query() query: AiUsageQueryDto) {
    return this.service.usage(query.from, query.to);
  }

  @Get('usage.csv')
  async usageCsv(@Query() query: AiUsageQueryDto, @Res() reply: FastifyReply) {
    const { filename, csv } = await this.service.usageCsv(query.from, query.to);
    reply.type('text/csv; charset=utf-8');
    reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, filename));
    reply.header('Cache-Control', 'no-store');
    reply.send(csv);
  }
}

function actorOf(user: RequestUser, req: FastifyRequest): AiActor {
  return { userId: user.id, username: user.username, ip: req.ip };
}
