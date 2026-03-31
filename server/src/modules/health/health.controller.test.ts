import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { HealthCheckResult } from '@nestjs/terminus';

import { DATABASE_HEALTH_INDICATOR, HEALTH_ROUTE } from './health.constants';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('keeps the expected route contract for the health endpoint', () => {
    const classPath = Reflect.getMetadata(PATH_METADATA, HealthController);
    const methodType = Reflect.getMetadata(METHOD_METADATA, HealthController.prototype.check);

    expect(classPath).toBe(HEALTH_ROUTE);
    expect(methodType).toBe(RequestMethod.GET);
  });

  it('delegates health checks to HealthCheckService and HealthService', async () => {
    const expected: HealthCheckResult = {
      status: 'ok',
      info: { [DATABASE_HEALTH_INDICATOR]: { status: 'up' } },
      details: { [DATABASE_HEALTH_INDICATOR]: { status: 'up' } },
    };
    const healthCheckService = {
      check: vi.fn().mockResolvedValue(expected),
    };
    const healthService = {
      checkDatabase: vi.fn().mockResolvedValue({ [DATABASE_HEALTH_INDICATOR]: { status: 'up' } }),
    };
    const controller = new HealthController(healthCheckService as never, healthService as never);

    await expect(controller.check()).resolves.toEqual(expected);

    expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    const [healthIndicators] = healthCheckService.check.mock.calls[0] as [Array<() => Promise<unknown>>];
    expect(healthIndicators).toHaveLength(1);
    await healthIndicators[0]();
    expect(healthService.checkDatabase).toHaveBeenCalledTimes(1);
  });
});
