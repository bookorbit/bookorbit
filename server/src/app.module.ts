import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { appConfig, authConfig, dbConfig, storageConfig } from './config/config';
import { DbModule } from './db/db.module';
import { AnnotationModule } from './modules/annotation/annotation.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookmarkModule } from './modules/bookmark/bookmark.module';
import { BookModule } from './modules/book/book.module';
import { KoboModule } from './modules/kobo/kobo.module';
import { LibraryModule } from './modules/library/library.module';
import { MetadataModule } from './modules/metadata/metadata.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { UserModule } from './modules/user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, dbConfig, authConfig, storageConfig],
    }),
    DbModule,
    AuthModule,
    UserModule,
    LibraryModule,
    BookModule,
    ScannerModule,
    MetadataModule,
    KoboModule,
    BookmarkModule,
    AnnotationModule,
  ],
})
export class AppModule {}
