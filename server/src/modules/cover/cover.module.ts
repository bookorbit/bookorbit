import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { MetadataScoreModule } from '../metadata-score/metadata-score.module';
import { COVER_PROVIDERS } from './constants';
import { CoverController } from './cover.controller';
import { CoverService } from './cover.service';
import { CoverSlotBackfillService } from './cover-slot-backfill.service';
import type { CoverProvider } from './providers/cover-provider';
import { AudiobookCoversCoverProvider } from './providers/audiobookcovers-cover-provider';
import { DuckDuckGoCoverProvider } from './providers/duckduckgo-cover-provider';
import { ITunesCoverProvider } from './providers/itunes-cover-provider';
import { CoverProviderRegistry } from './provider-registry';

const PROVIDER_CLASSES = [DuckDuckGoCoverProvider, ITunesCoverProvider, AudiobookCoversCoverProvider];

@Module({
  imports: [
    AppSettingsModule,
    BookModule,
    BookCoverStoreModule,
    BookMetadataLockModule,
    FileWriteModule,
    LibraryModule,
    MetadataModule,
    MetadataPreferencesModule,
    MetadataScoreModule,
  ],
  controllers: [CoverController],
  providers: [
    ...PROVIDER_CLASSES,
    {
      provide: COVER_PROVIDERS,
      useFactory: (...providers: CoverProvider[]) => providers,
      inject: PROVIDER_CLASSES,
    },
    CoverProviderRegistry,
    CoverService,
    CoverSlotBackfillService,
  ],
  exports: [CoverService],
})
export class CoverModule {}
