import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { JOB_LIST_DEFAULT_LIMIT, JOBS_VIEW_PERMISSIONS, type JobActionResponse, type JobList, type JobsSummary } from '@bookorbit/types';

import { InteractiveOnly } from '../../common/decorators/api-key-policy.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-any-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { JobActionDto, JobListQueryDto } from './dto/jobs.dto';
import { JobsService } from './jobs.service';

/**
 * The Jobs area's list and actions, for signed-in sessions only in this release. Holding any of the
 * view permissions opens the routes; each type then decides which of its rows the viewer sees.
 */
@Controller('jobs')
@InteractiveOnly()
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** One page of a view. `403` for `scope=everyone` without that grant on any type; `400` for a cursor from another list. */
  @Get()
  @RequireAnyPermission(...JOBS_VIEW_PERMISSIONS)
  list(@Query() query: JobListQueryDto, @CurrentUser() user: RequestUser): Promise<JobList> {
    return this.jobs.list(user, {
      view: query.view ?? 'queue',
      type: query.type ?? null,
      scope: query.scope ?? 'mine',
      cursor: query.cursor ?? null,
      limit: query.limit ?? JOB_LIST_DEFAULT_LIMIT,
      counts: query.counts === true,
    });
  }

  /** The viewer's own running, waiting, needs-you and failed counts, and which ownerless work is running. */
  @Get('summary')
  @RequireAnyPermission(...JOBS_VIEW_PERMISSIONS)
  summary(@CurrentUser() user: RequestUser): Promise<JobsSummary> {
    return this.jobs.summary(user);
  }

  /** One action on up to 100 jobs of any types, with what happened to each. */
  @Post('actions')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(...JOBS_VIEW_PERMISSIONS)
  act(@Body() dto: JobActionDto, @CurrentUser() user: RequestUser): Promise<JobActionResponse> {
    return this.jobs.act(user, dto.action, dto.ids);
  }
}
