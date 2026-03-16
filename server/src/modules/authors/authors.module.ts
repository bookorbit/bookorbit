import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { AuthModule } from '../auth/auth.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { AuthorImageStorageService } from './author-image-storage.service';
import { AuthorEnrichmentConfigService } from './author-enrichment-config.service';
import { AuthorEnrichmentExecutorService } from './author-enrichment-executor.service';
import { AuthorEnrichmentGateway } from './author-enrichment.gateway';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';
import { AuthorEnrichmentRepository } from './author-enrichment.repository';
import { AuthorsController } from './authors.controller';
import { AuthorMetadataFetchService } from './metadata/author-metadata-fetch.service';
import { AUTHOR_METADATA_PROVIDERS } from './metadata/constants';
import { AuthorMetadataProviderRegistry } from './metadata/provider-registry';
import { AudnexusAuthorMetadataProvider } from './metadata/providers/audnexus/audnexus.provider';
import { AuthorMetadataProvider } from './metadata/providers/author-metadata-provider';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';
import { AuthorsRepository } from './authors.repository';
import { AuthorsService } from './authors.service';

const AUTHOR_PROVIDER_CLASSES = [AudnexusAuthorMetadataProvider];

@Module({
  imports: [
    BookModule,
    LibraryModule,
    AppSettingsModule,
    MetadataModule,
    AuthModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('auth.jwtSecret'),
        signOptions: { expiresIn: config.getOrThrow<StringValue | number>('auth.jwtExpiresIn') },
      }),
    }),
  ],
  controllers: [AuthorsController],
  providers: [
    AuthorEnrichmentConfigService,
    AuthorEnrichmentSessionService,
    ...AUTHOR_PROVIDER_CLASSES,
    {
      provide: AUTHOR_METADATA_PROVIDERS,
      useFactory: (...providers: AuthorMetadataProvider[]) => providers,
      inject: AUTHOR_PROVIDER_CLASSES,
    },
    AuthorMetadataProviderRegistry,
    AuthorMetadataFetchService,
    AuthorImageStorageService,
    AuthorEnrichmentGateway,
    AuthorEnrichmentExecutorService,
    AuthorEnrichmentOrchestratorService,
    AuthorEnrichmentRepository,
    AuthorsService,
    AuthorsRepository,
  ],
})
export class AuthorsModule {}
