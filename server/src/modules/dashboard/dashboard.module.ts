import { Module } from '@nestjs/common';

import { LensModule } from '../lens/lens.module';
import { LibraryModule } from '../library/library.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [LibraryModule, LensModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class DashboardModule {}
