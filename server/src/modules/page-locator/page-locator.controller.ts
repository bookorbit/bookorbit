import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import type { LocateTextResponse } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { RequireAppAttest } from '../app-attest/app-attest.guard';
import { LocateTextDto } from './dto/locate-text.dto';
import { PageLocatorService } from './page-locator.service';

@Controller('mobile/books/files')
@RequireAppAttest()
export class PageLocatorController {
  constructor(private readonly pageLocator: PageLocatorService) {}

  @Post(':fileId/locate-text')
  @HttpCode(HttpStatus.OK)
  locateText(
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() dto: LocateTextDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LocateTextResponse> {
    return this.pageLocator.locateText(fileId, dto.text, user);
  }
}
