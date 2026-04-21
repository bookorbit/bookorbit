import { Permission } from '@bookorbit/types';
import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { SendBookDto } from './dto/send-book.dto';
import { EmailSendOrchestrator } from './email-send-orchestrator.service';

@Controller('email/send')
@RequirePermission(Permission.EmailSend)
export class EmailSendController {
  constructor(private readonly orchestrator: EmailSendOrchestrator) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  send(@Body() dto: SendBookDto, @CurrentUser() user: RequestUser) {
    return this.orchestrator.send(dto, user);
  }

  @Post('quick/:bookId')
  @HttpCode(HttpStatus.ACCEPTED)
  quickSend(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser) {
    return this.orchestrator.quickSend(bookId, user);
  }
}
