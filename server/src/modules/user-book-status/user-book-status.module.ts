import { Module } from '@nestjs/common';

import { UserBookStatusRepository } from './user-book-status.repository';
import { UserBookStatusService } from './user-book-status.service';

@Module({
  providers: [UserBookStatusService, UserBookStatusRepository],
  exports: [UserBookStatusService],
})
export class UserBookStatusModule {}
