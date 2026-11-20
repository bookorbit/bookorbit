import { Module } from '@nestjs/common';

import { ChapterEditorModule } from '../chapter-editor/chapter-editor.module';
import { JobsModule } from '../jobs/jobs.module';
import { LibraryModule } from '../library/library.module';
import { ChapterHealthController } from './chapter-health.controller';
import { ChapterHealthRepository } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';
import { ChapterLookupJobSource } from './chapter-lookup-job-source';
import { ChapterLookupWorker } from './chapter-lookup.worker';

@Module({
  imports: [ChapterEditorModule, JobsModule, LibraryModule],
  controllers: [ChapterHealthController],
  providers: [ChapterHealthRepository, ChapterHealthService, ChapterLookupJobSource, ChapterLookupWorker],
})
export class ChapterHealthModule {}
