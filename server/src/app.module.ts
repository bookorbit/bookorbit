import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import { appConfig, authConfig, dbConfig, emailConfig, fileWriteConfig, storageConfig } from './config/config';
import { validateEnv } from './config/env.validation';
import { loggerConfig } from './common/logger.config';
import { CommonModule } from './common/common.module';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LibraryAccessGuard } from './common/guards/library-access.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { DbModule } from './db/db.module';
import { AnnotationModule } from './modules/annotation/annotation.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthModule } from './modules/health/health.module';
import { AppSettingsModule } from './modules/app-settings/app-settings.module';
import { CollectionModule } from './modules/collection/collection.module';
import { AuthModule } from './modules/auth/auth.module';
import { CbzModule } from './modules/reader/cbz/cbz.module';
import { BookmarkModule } from './modules/bookmark/bookmark.module';
import { BookModule } from './modules/book/book.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CoverModule } from './modules/cover/cover.module';
import { KoboModule } from './modules/kobo/kobo.module';
import { LibraryModule } from './modules/library/library.module';
import { LensModule } from './modules/lens/lens.module';
import { OpdsModule } from './modules/opds/opds.module';
import { PathModule } from './modules/path/path.module';
import { MetadataFetchModule } from './modules/metadata-fetch/metadata-fetch.module';
import { MetadataPreferencesModule } from './modules/metadata-preferences/metadata-preferences.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { NarratorModule } from './modules/narrator/narrator.module';
import { ReaderPreferencesModule } from './modules/reader-preferences/reader-preferences.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { SeedModule } from './modules/seed/seed.module';
import { EmailModule } from './modules/email/email.module';
import { EpubModule } from './modules/reader/epub/epub.module';
import { StagingModule } from './modules/staging/staging.module';
import { UploadModule } from './modules/upload/upload.module';
import { UserModule } from './modules/user/user.module';
import { AuthorsModule } from './modules/authors/authors.module';
import { BookMetadataFetchModule } from './modules/book-metadata-fetch/book-metadata-fetch.module';
import { MetadataScoreModule } from './modules/metadata-score/metadata-score.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { UserStatisticsModule } from './modules/user-statistics/user-statistics.module';
import { ReadingSessionModule } from './modules/reading-session/reading-session.module';
import { UserBookStatusModule } from './modules/user-book-status/user-book-status.module';
import { AuditModule } from './modules/audit/audit.module';
import { MigrationModule } from './modules/migration/migration.module';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      load: [appConfig, dbConfig, authConfig, storageConfig, fileWriteConfig, emailConfig],
    }),
    ScheduleModule.forRoot(),
    DbModule,
    CommonModule,
    SeedModule,
    AuthModule,
    AppSettingsModule,
    UserModule,
    AuthorsModule,
    BookMetadataFetchModule,
    LibraryModule,
    PathModule,
    BookModule,
    CatalogModule,
    CoverModule,
    CollectionModule,
    LensModule,
    ScannerModule,
    MetadataModule,
    NarratorModule,
    UploadModule,
    MetadataFetchModule,
    MetadataPreferencesModule,
    RecommendationModule,
    KoboModule,
    OpdsModule,
    BookmarkModule,
    AnnotationModule,
    DashboardModule,
    HealthModule,
    CbzModule,
    ReaderPreferencesModule,
    EpubModule,
    StagingModule,
    EmailModule,
    MetadataScoreModule,
    StatisticsModule,
    UserStatisticsModule,
    ReadingSessionModule,
    UserBookStatusModule,
    AuditModule,
    MigrationModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: LibraryAccessGuard },
  ],
})
export class AppModule {}
