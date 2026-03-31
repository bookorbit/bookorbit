import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { MetadataScoreController } from './metadata-score.controller';
import { MetadataScoreRepository } from './metadata-score.repository';
import { MetadataScoreScorer } from './metadata-score.scorer';
import { MetadataScoreService } from './metadata-score.service';

@Module({
  imports: [AppSettingsModule],
  providers: [MetadataScoreService, MetadataScoreRepository, MetadataScoreScorer],
  controllers: [MetadataScoreController],
  exports: [MetadataScoreService],
})
export class MetadataScoreModule {}
