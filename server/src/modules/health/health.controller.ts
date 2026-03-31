import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { Public } from '../../common/decorators/public.decorator';
import { HEALTH_ROUTE } from './health.constants';
import { HealthService } from './health.service';

@Controller(HEALTH_ROUTE)
@Public()
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly healthService: HealthService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.healthCheckService.check([() => this.healthService.checkDatabase()]);
  }
}
