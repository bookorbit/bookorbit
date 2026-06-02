import { Global, Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { SeriesIdentityService } from './services/series-identity.service';

@Global()
@Module({
  imports: [DbModule],
  providers: [SeriesIdentityService],
  exports: [SeriesIdentityService],
})
export class SeriesIdentityModule {}
