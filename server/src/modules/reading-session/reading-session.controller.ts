import { Body, Controller, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SaveReadingSessionDto } from './dto/save-reading-session.dto';
import { ReadingSessionService } from './reading-session.service';

@Controller('books/files')
export class ReadingSessionController {
  constructor(private readonly service: ReadingSessionService) {}

  @Post(':fileId/sessions')
  @HttpCode(204)
  async saveSession(@Param('fileId', ParseIntPipe) fileId: number, @Body() dto: SaveReadingSessionDto, @CurrentUser() user: RequestUser) {
    await this.service.save(fileId, dto, user);
  }
}
