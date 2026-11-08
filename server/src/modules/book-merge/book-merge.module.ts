import { Module } from '@nestjs/common';

import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { AchievementModule } from '../achievement/achievement.module';
import { BookConsolidationModule } from '../book-consolidation/book-consolidation.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { BookModule } from '../book/book.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { ScannerModule } from '../scanner/scanner.module';
import { StoryEditsModule } from '../story-edits/story-edits.module';
import { ReadingAttemptEventsModule } from '../user-book-status/reading-attempt-events.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { UserStatisticsModule } from '../user-statistics/user-statistics.module';
import { BookMergeController } from './book-merge.controller';
import { BookMergeEffectsService } from './book-merge-effects.service';
import { BookMergeExecutor } from './book-merge.executor';
import { BookMergePlanner } from './book-merge.planner';
import { BookMergeRecoveryService } from './book-merge-recovery.service';
import { BookMergeRepository } from './book-merge.repository';
import { BookMergeService } from './book-merge.service';

@Module({
  imports: [
    BookModule,
    BookConsolidationModule,
    BookCoverStoreModule,
    ScannerModule,
    FileWriteModule,
    SelfWriteRegistryModule,
    MetadataScoreModule,
    EmbeddingModule,
    AchievementModule,
    ReadingAttemptEventsModule,
    UserBookStatusModule,
    StoryEditsModule,
    UserStatisticsModule,
  ],
  controllers: [BookMergeController],
  providers: [BookMergeService, BookMergePlanner, BookMergeExecutor, BookMergeEffectsService, BookMergeRecoveryService, BookMergeRepository],
  exports: [BookMergeService],
})
export class BookMergeModule {}
