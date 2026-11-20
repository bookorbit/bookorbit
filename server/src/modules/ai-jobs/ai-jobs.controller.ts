import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { Permission, type AiJobActionResponse, type AiJobList } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-any-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AiJobQueueService } from './ai-job-queue.service';
import { AiJobActionDto, AiJobListQueryDto } from './dto/ai-job-queue.dto';

/**
 * The AI area's job lists. Those who may build see and act on the jobs they asked for; those who
 * manage the server's settings see every account's (`scope=all`) and act on any of them.
 */
@Controller('ai/jobs')
export class AiJobsController {
  constructor(private readonly queue: AiJobQueueService) {}

  /** One page of a view, with how many jobs each view holds. `403` for `scope=all` without managing settings. */
  @Get()
  @RequireAnyPermission(Permission.ManageAppSettings, Permission.LibraryGenerateStoryGuide)
  list(@Query() query: AiJobListQueryDto, @CurrentUser() user: RequestUser): Promise<AiJobList> {
    return this.queue.list(user, {
      view: query.view ?? 'queue',
      scope: query.scope ?? 'mine',
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
    });
  }

  /** One action on up to 100 jobs, with what happened to each. */
  @Post('actions')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(Permission.ManageAppSettings, Permission.LibraryGenerateStoryGuide)
  act(@Body() dto: AiJobActionDto, @CurrentUser() user: RequestUser): Promise<AiJobActionResponse> {
    return this.queue.act(user, dto.action, dto.ids);
  }
}
