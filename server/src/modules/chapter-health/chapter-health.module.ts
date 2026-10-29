import { Module } from '@nestjs/common';

import { ChapterEditorModule } from '../chapter-editor/chapter-editor.module';
import { LibraryModule } from '../library/library.module';
import { ChapterHealthController } from './chapter-health.controller';
import { ChapterHealthRepository } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';
import { ChapterLookupWorker } from './chapter-lookup.worker';

@Module({
  imports: [ChapterEditorModule, LibraryModule],
  controllers: [ChapterHealthController],
  providers: [ChapterHealthRepository, ChapterHealthService, ChapterLookupWorker],
})
export class ChapterHealthModule {}
