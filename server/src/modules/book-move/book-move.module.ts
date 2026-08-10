import { Module, forwardRef } from '@nestjs/common';

import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { NotificationModule } from '../notification/notification.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookMoveController } from './book-move.controller';
import { BookMoveExecutorService } from './book-move-executor.service';
import { BookMovePlannerService } from './book-move-planner.service';
import { BookMoveRepository } from './book-move.repository';
import { BookMoveService } from './book-move.service';

@Module({
  imports: [BookModule, ScannerModule, FileWriteModule, AppSettingsModule, SelfWriteRegistryModule, forwardRef(() => NotificationModule)],
  controllers: [BookMoveController],
  providers: [BookMoveService, BookMovePlannerService, BookMoveExecutorService, BookMoveRepository],
  exports: [BookMoveService],
})
export class BookMoveModule {}
