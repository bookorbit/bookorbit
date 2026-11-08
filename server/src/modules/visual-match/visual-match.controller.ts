import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { VisualMatchResponse } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { VisualMatchDto } from './dto/visual-match.dto';
import { VisualMatchService } from './visual-match.service';

@Controller('mobile/visual-match')
@RequireAppAttest()
export class VisualMatchController {
  constructor(private readonly visualMatch: VisualMatchService) {}

  /** POST because the recognised lines are a body, not an addressable resource. Read-only. */
  @Post()
  @HttpCode(HttpStatus.OK)
  match(@Body() dto: VisualMatchDto, @CurrentUser() user: RequestUser): Promise<VisualMatchResponse> {
    return this.visualMatch.match(user, dto);
  }
}
