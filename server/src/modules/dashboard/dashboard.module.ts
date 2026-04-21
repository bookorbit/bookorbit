import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { SmartScopeModule } from '../smart-scope/smart-scope.module';
import { LibraryModule } from '../library/library.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [BookModule, LibraryModule, SmartScopeModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
