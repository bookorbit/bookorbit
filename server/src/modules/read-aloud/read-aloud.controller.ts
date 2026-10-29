import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CreateReadAloudJobDto } from './dto/create-read-aloud-job.dto';
import { ResyncReadAloudJobDto } from './dto/resync-read-aloud-job.dto';
import { ReadAloudService } from './read-aloud.service';

const JOB_ID = new ParseUUIDPipe({ version: '4' });

@Controller()
@RequirePermission(Permission.LibraryGenerateReadAloud)
@ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot generate read-aloud books')
export class ReadAloudController {
  constructor(private readonly readAloud: ReadAloudService) {}

  @Get('books/:bookId/read-aloud')
  capability(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.readAloud.capability(bookId, user);
  }

  @Post('books/:bookId/read-aloud-jobs')
  create(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateReadAloudJobDto, @CurrentUser() user: RequestUser) {
    return this.readAloud.create(bookId, dto, user);
  }

  @Get('read-aloud-jobs/:jobId')
  get(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.get(jobId, user);
  }

  @Delete('read-aloud-jobs/:jobId')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.cancel(jobId, user);
  }

  @Post('read-aloud-jobs/:jobId/publish')
  @HttpCode(HttpStatus.OK)
  publish(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.publish(jobId, user);
  }

  @Post('read-aloud-jobs/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.retry(jobId, user);
  }

  @Post('read-aloud-jobs/:jobId/resync')
  @HttpCode(HttpStatus.OK)
  resync(@Param('jobId', JOB_ID) jobId: string, @Body() dto: ResyncReadAloudJobDto, @CurrentUser() user: RequestUser) {
    return this.readAloud.resync(jobId, dto, user);
  }

  @Post('read-aloud-jobs/:jobId/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.dismiss(jobId, user);
  }

  @Get('read-aloud-jobs/:jobId/report')
  report(@Param('jobId', JOB_ID) jobId: string, @CurrentUser() user: RequestUser) {
    return this.readAloud.report(jobId, user);
  }

  @Get('read-aloud-jobs/:jobId/events')
  events(
    @Param('jobId', JOB_ID) jobId: string,
    @Query('after', new ParseIntPipe({ optional: true })) after: number | undefined,
    @CurrentUser() user: RequestUser,
  ) {
    return this.readAloud.events(jobId, after ?? null, user);
  }
}
