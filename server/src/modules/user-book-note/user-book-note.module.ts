import { Module } from '@nestjs/common';

import { UserBookNoteRepository } from './user-book-note.repository';
import { UserBookNoteService } from './user-book-note.service';

@Module({
  providers: [UserBookNoteService, UserBookNoteRepository],
  exports: [UserBookNoteService],
})
export class UserBookNoteModule {}
