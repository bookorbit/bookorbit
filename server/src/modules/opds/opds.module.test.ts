import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookModule } from '../book/book.module';
import { CbzModule } from '../reader/cbz/cbz.module';
import { UserModule } from '../user/user.module';
import { OpdsAuthGuard } from './opds-auth.guard';
import { OpdsBookService } from './opds-book.service';
import { OpdsController } from './opds.controller';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsModule } from './opds.module';
import { OpdsPageCountService } from './opds-page-count.service';
import { OpdsPageStreamService } from './opds-page-stream.service';
import { OpdsPdfPageService } from './opds-pdf-page.service';
import { OpdsService } from './opds.service';
import { OpdsUserController } from './opds-user.controller';
import { OpdsUserService } from './opds-user.service';

describe('OpdsModule', () => {
  it('registers expected module wiring', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, OpdsModule)).toEqual([AppSettingsModule, BookModule, CbzModule, UserModule, CommonModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, OpdsModule)).toEqual([OpdsController, OpdsUserController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, OpdsModule)).toEqual([
      OpdsService,
      OpdsBookService,
      OpdsUserService,
      OpdsAuthGuard,
      OpdsEnabledGuard,
      OpdsPageCountService,
      OpdsPageStreamService,
      OpdsPdfPageService,
    ]);
  });
});
