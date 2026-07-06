import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { BookMetadataLockModule } from '../book-metadata-lock/book-metadata-lock.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataPreferencesModule } from '../metadata-preferences/metadata-preferences.module';
import { COVER_PROVIDERS } from './constants';
import { CoverController } from './cover.controller';
import { CoverService } from './cover.service';
import type { CoverProvider } from './providers/cover-provider';
import { AudiobookCoversCoverProvider } from './providers/audiobookcovers-cover-provider';
import { DuckDuckGoCoverProvider } from './providers/duckduckgo-cover-provider';
import { ITunesCoverProvider } from './providers/itunes-cover-provider';
import { CoverProviderRegistry } from './provider-registry';

const PROVIDER_CLASSES = [DuckDuckGoCoverProvider, ITunesCoverProvider, AudiobookCoversCoverProvider];

@Module({
  imports: [BookModule, BookMetadataLockModule, FileWriteModule, LibraryModule, MetadataPreferencesModule],
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
  ],
  exports: [CoverService],
})
export class CoverModule {}
