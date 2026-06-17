import { Global, Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { SeriesIdentityService } from './services/series-identity.service';
import { SeriesMembershipService } from './services/series-membership.service';

@Global()
@Module({
  imports: [DbModule],
  providers: [SeriesIdentityService, SeriesMembershipService],
  exports: [SeriesIdentityService, SeriesMembershipService],
})
export class SeriesIdentityModule {}
