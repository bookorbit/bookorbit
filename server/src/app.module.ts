import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { appConfig, authConfig, dbConfig, mailerConfig, storageConfig } from './config/config';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LibraryAccessGuard } from './common/guards/library-access.guard';
import { PermissionGuard } from './common/guards/permission.guard';
import { DbModule } from './db/db.module';
import { AnnotationModule } from './modules/annotation/annotation.module';
import { AppSettingsModule } from './modules/app-settings/app-settings.module';
import { AuthModule } from './modules/auth/auth.module';
import { CbzModule } from './modules/cbz/cbz.module';
import { BookmarkModule } from './modules/bookmark/bookmark.module';
import { BookModule } from './modules/book/book.module';
import { KoboModule } from './modules/kobo/kobo.module';
import { LibraryModule } from './modules/library/library.module';
import { PathModule } from './modules/path/path.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { RoleModule } from './modules/role/role.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { SeedModule } from './modules/seed/seed.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, dbConfig, authConfig, storageConfig, mailerConfig],
    }),
    ScheduleModule.forRoot(),
    DbModule,
    CommonModule,
    SeedModule,
    AuthModule,
    AppSettingsModule,
    UserModule,
    RoleModule,
    LibraryModule,
    PathModule,
    BookModule,
    ScannerModule,
    MetadataModule,
    KoboModule,
    BookmarkModule,
    AnnotationModule,
    CbzModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: LibraryAccessGuard },
  ],
})
export class AppModule {}
