import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { MetadataModule } from '../metadata/metadata.module';
import { SeriesUnitBackfillRepository } from './series-unit-backfill.repository';
import { SeriesUnitBackfillService } from './series-unit-backfill.service';

@Module({
  imports: [AppSettingsModule, MetadataModule],
  providers: [SeriesUnitBackfillRepository, SeriesUnitBackfillService],
})
export class SeriesUnitBackfillModule {}
