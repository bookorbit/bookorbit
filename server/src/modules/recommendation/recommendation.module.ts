import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { LibraryModule } from '../library/library.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { RecommendationController } from './recommendation.controller';
import { RecommendationRepository } from './recommendation.repository';
import { RecommendationService } from './recommendation.service';

@Module({
  imports: [BookModule, LibraryModule, EmbeddingModule, UserBookStatusModule],
  controllers: [RecommendationController],
  providers: [RecommendationService, RecommendationRepository],
  exports: [RecommendationService],
})
export class RecommendationModule {}
