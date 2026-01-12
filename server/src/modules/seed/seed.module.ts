import { Module } from '@nestjs/common';

import { CleanupService } from './cleanup.service';
import { SeedService } from './seed.service';

@Module({
  providers: [SeedService, CleanupService],
})
export class SeedModule {}
