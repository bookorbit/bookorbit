import { Module, forwardRef } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { NotificationModule } from '../notification/notification.module';
import { PathModule } from '../path/path.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BulkRenameService } from './bulk-rename.service';
import { LibraryController } from './library.controller';
import { LibraryRepository } from './library.repository';
import { LibraryService } from './library.service';

@Module({
  imports: [
    ScannerModule,
    AchievementModule,
    forwardRef(() => BookModule),
    FileWriteModule,
    forwardRef(() => NotificationModule),
    AppSettingsModule,
    PathModule,
  ],
  controllers: [LibraryController],
  providers: [LibraryService, LibraryRepository, BulkRenameService],
  exports: [LibraryService, LibraryRepository],
})
export class LibraryModule {}
