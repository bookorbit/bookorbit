import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { SmartScopeModule } from '../smart-scope/smart-scope.module';
import { LibraryModule } from '../library/library.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';
import { DashboardWidgetRepository } from './dashboard-widget.repository';
import { DashboardWidgetService } from './dashboard-widget.service';

@Module({
  imports: [BookModule, BookCoverStoreModule, LibraryModule, SmartScopeModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository, DashboardWidgetService, DashboardWidgetRepository],
  exports: [DashboardService, DashboardWidgetService],
})
export class DashboardModule {}
