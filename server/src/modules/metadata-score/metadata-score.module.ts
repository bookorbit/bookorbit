import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { MetadataScoreController } from './metadata-score.controller';
import { MetadataScoreService } from './metadata-score.service';

@Module({
  imports: [AppSettingsModule],
  providers: [MetadataScoreService],
  controllers: [MetadataScoreController],
  exports: [MetadataScoreService],
})
export class MetadataScoreModule {}
