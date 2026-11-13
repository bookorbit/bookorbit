import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  AuditAction,
  AuditResource,
  Permission,
  type StoryGuideHistory,
  type StoryGuideList,
  type StoryGuideSpeedResetResponse,
  type StoryGuideSpeeds,
  type StoryGuidesSummary,
} from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { StoryGuideDeleteAllDto, StoryGuideListQueryDto, StoryGuideSpeedResetDto } from './dto/story-guide.dto';
import { StoryGuideEstimator } from './story-guide-estimator.service';
import { StoryGuidesService } from './story-guides.service';

/**
 * Story guides on the AI settings page and the AI area: how many are stored with how many fixes, each
 * stored guide and what its build took, deleting them all, and how fast each model has been.
 */
@Controller('admin/ai/features/story-guides')
@RequirePermission(Permission.ManageAppSettings)
@InteractiveOnly()
export class StoryGuidesAdminController {
  constructor(
    private readonly service: StoryGuidesService,
    private readonly estimator: StoryGuideEstimator,
  ) {}

  @Get()
  summary(): Promise<StoryGuidesSummary> {
    return this.service.summary();
  }

  /** A page of stored guides, each with its book and the build that made it. */
  @Get('guides')
  guides(@Query() query: StoryGuideListQueryDto): Promise<StoryGuideList> {
    return this.service.listGuides({
      search: query.q?.trim() || null,
      sort: query.sort ?? 'built',
      direction: query.direction ?? 'desc',
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
    });
  }

  /** What the stored guides took to build: the total spent, the middle build time, and each pair of models. */
  @Get('history')
  history(): Promise<StoryGuideHistory> {
    return this.service.history();
  }

  /**
   * Cancels every unfinished build and deletes every guide, and every fix made for everyone with
   * `fixes: delete`. `count` must equal the number stored now; otherwise nothing is deleted and the
   * answer is `409` with the current count.
   */
  @Post('delete-all')
  async deleteAll(@Body() dto: StoryGuideDeleteAllDto, @CurrentUser() user: RequestUser, @Res() reply: FastifyReply): Promise<void> {
    const result = await this.service.removeAll(dto.count, dto.fixes, user);
    if ('countChanged' in result) {
      reply.status(HttpStatus.CONFLICT).send({ count: result.countChanged });
      return;
    }
    reply.status(HttpStatus.OK).send(result);
  }

  /** What each model has managed in finished builds, which build times are estimated from. */
  @Get('speeds')
  speeds(): Promise<StoryGuideSpeeds> {
    return this.estimator.speeds();
  }

  /** Forgets one model's speed on one connection, at one effort or all; estimates leave out the time until a build finishes on it again. */
  @Post('speeds/reset')
  @HttpCode(HttpStatus.OK)
  @Auditable({
    action: AuditAction.AiSpeedsReset,
    resource: AuditResource.AiSettings,
    getMeta: (req, res) => ({
      connectionId: (req.body as StoryGuideSpeedResetDto | undefined)?.connectionId,
      model: (req.body as StoryGuideSpeedResetDto | undefined)?.model,
      effort: (req.body as StoryGuideSpeedResetDto | undefined)?.effort,
      removed: (res as StoryGuideSpeedResetResponse | undefined)?.removed,
    }),
    description: 'Reset the learned speed of an AI model for story guides',
    when: (_req, res) => ((res as StoryGuideSpeedResetResponse | undefined)?.removed ?? 0) > 0,
  })
  resetSpeed(@Body() dto: StoryGuideSpeedResetDto): Promise<StoryGuideSpeedResetResponse> {
    return this.estimator.resetSpeed(dto);
  }
}
