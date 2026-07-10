import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { CbzModule } from '../reader/cbz/cbz.module';
import { UserModule } from '../user/user.module';
import { CommonModule } from '../../common/common.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsPageCountService } from './opds-page-count.service';
import { OpdsPageStreamService } from './opds-page-stream.service';
import { OpdsPdfPageService } from './opds-pdf-page.service';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

@Module({
  imports: [AppSettingsModule, BookModule, CbzModule, UserModule, CommonModule],
  controllers: [OpdsController, OpdsUserController],
  providers: [
    OpdsService,
    OpdsBookService,
    OpdsUserService,
    OpdsAuthGuard,
    OpdsEnabledGuard,
    OpdsPageCountService,
    OpdsPageStreamService,
    OpdsPdfPageService,
  ],
  exports: [OpdsBookService],
})
export class OpdsModule {}
