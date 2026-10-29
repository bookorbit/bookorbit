import { Module } from '@nestjs/common';

import { AudiobookChaptersModule } from '../audiobook-chapters/audiobook-chapters.module';
import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { BookModule } from '../book/book.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { UserModule } from '../user/user.module';
import { EpubModule } from '../reader/epub/epub.module';
import { ChapterJobRepository } from './chapter-job.repository';
import { ChapterJobService } from './chapter-job.service';
import { ChapterEditorController } from './chapter-editor.controller';
import { ChapterEditorRepository } from './chapter-editor.repository';
import { ChapterEditorService } from './chapter-editor.service';
import { ChapterLookupService } from './chapter-lookup.service';
import { ChapterPauseService } from './chapter-pause.service';

@Module({
  imports: [
    UserModule,
    AudiobookChaptersModule,
    BookMetadataLockModule,
    BookModule,
    EpubModule,
    FileWriteModule,
    MetadataModule,
    MetadataPreferencesModule,
  ],
  controllers: [ChapterEditorController],
  providers: [ChapterJobRepository, ChapterJobService, ChapterEditorRepository, ChapterEditorService, ChapterLookupService, ChapterPauseService],
  exports: [ChapterEditorService],
})
export class ChapterEditorModule {}
