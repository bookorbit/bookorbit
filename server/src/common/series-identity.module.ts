import { Global, Module } from '@nestjs/common';

import { DbModule } from '../db/db.module';
import { SeriesExpectedCountResetService } from './services/series-expected-count-reset.service';
import { SeriesExpectedCountService } from './services/series-expected-count.service';
import { SeriesIdentityService } from './services/series-identity.service';
import { SeriesMembershipService } from './services/series-membership.service';

@Global()
@Module({
  imports: [DbModule],
  providers: [SeriesIdentityService, SeriesMembershipService, SeriesExpectedCountService, SeriesExpectedCountResetService],
  exports: [SeriesIdentityService, SeriesMembershipService, SeriesExpectedCountService],
})
export class SeriesIdentityModule {}
