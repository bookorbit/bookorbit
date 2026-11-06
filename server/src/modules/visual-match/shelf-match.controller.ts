import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { ShelfMatchResponse } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { ShelfMatchDto } from './dto/shelf-match.dto';
import { VisualMatchService } from './visual-match.service';

@Controller('mobile/shelf-match')
@RequireAppAttest()
export class ShelfMatchController {
  constructor(private readonly visualMatch: VisualMatchService) {}

  /** POST because the spines' lines are a body, not an addressable resource. Read-only. */
  @Post()
  @HttpCode(HttpStatus.OK)
  match(@Body() dto: ShelfMatchDto, @CurrentUser() user: RequestUser): Promise<ShelfMatchResponse> {
    return this.visualMatch.matchShelf(user, dto);
  }
}
