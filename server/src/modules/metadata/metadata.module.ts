import { RegexMetadataService } from './regex/regex-metadata.service';
import { Module } from '@nestjs/common';
import { DjvuDocumentModule } from '../djvu/djvu-document.module';

import { AudiobookChaptersModule } from '../audiobook-chapters/audiobook-chapters.module';
import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { NarratorModule } from '../narrator/narrator.module';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { CoverSlotReconciler } from './cover-slot-reconciler.service';
import { MetadataExtractionService } from './metadata-extraction.service';
import { MetadataEventsService } from './metadata-events.service';
import { MetadataService } from './metadata.service';

@Module({
  imports: [
    AudiobookChaptersModule,
    BookMetadataLockModule,
    BookCoverStoreModule,
    EmbeddingModule,
    MetadataScoreModule,
    NarratorModule,
    DjvuDocumentModule,
  ],
  providers: [RegexMetadataService, MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository, CoverSlotReconciler],
  exports: [RegexMetadataService, MetadataService, MetadataExtractionService, MetadataEventsService, ComicMetadataRepository, CoverSlotReconciler],
})
export class MetadataModule {}
