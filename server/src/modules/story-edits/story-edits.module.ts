import { Module } from '@nestjs/common';

import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { StoryEditsController } from './story-edits.controller';
import { StoryEditsRepository } from './story-edits.repository';
import { StoryEditsService } from './story-edits.service';

@Module({
  imports: [AppAttestModule, BookModule],
  controllers: [StoryEditsController],
  providers: [StoryEditsService, StoryEditsRepository],
  exports: [StoryEditsService],
})
export class StoryEditsModule {}
