import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { CoverSweepStore } from './cover-sweep.store';
import { MissingResourcesController } from './missing-resources.controller';
import { MissingResourcesRepository } from './missing-resources.repository';
import { MissingResourcesService } from './missing-resources.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [MissingResourcesController],
  providers: [MissingResourcesService, MissingResourcesRepository, CoverSweepStore],
})
export class MaintenanceModule {}
