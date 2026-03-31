import { HealthIndicatorService } from '@nestjs/terminus';

import { DATABASE_HEALTH_INDICATOR, HEALTH_ERROR_MESSAGE_MAX_LENGTH, UNKNOWN_HEALTH_ERROR_MESSAGE } from './health.constants';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const up = vi.fn();
  const down = vi.fn();
  const healthIndicatorService = {
    check: vi.fn().mockReturnValue({ up, down }),
  } satisfies Pick<HealthIndicatorService, 'check'>;

  const healthRepository = {
    pingDatabase: vi.fn(),
  } satisfies Pick<HealthRepository, 'pingDatabase'>;

  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    up.mockReturnValue({ [DATABASE_HEALTH_INDICATOR]: { status: 'up' } });
    down.mockImplementation((data: Record<string, unknown>) => ({
      [DATABASE_HEALTH_INDICATOR]: { status: 'down', ...data },
    }));
    service = new HealthService(healthRepository as never, healthIndicatorService as never);
  });

  it('returns an up indicator when database ping succeeds', async () => {
    healthRepository.pingDatabase.mockResolvedValue(undefined);

    await expect(service.checkDatabase()).resolves.toEqual({
      [DATABASE_HEALTH_INDICATOR]: { status: 'up' },
    });

    expect(healthIndicatorService.check).toHaveBeenCalledWith(DATABASE_HEALTH_INDICATOR);
    expect(up).toHaveBeenCalledTimes(1);
    expect(down).not.toHaveBeenCalled();
  });

  it('returns a down indicator with a sanitized error message on ping failure', async () => {
    healthRepository.pingDatabase.mockRejectedValue(new Error('db "timeout"\nretry'));

    await expect(service.checkDatabase()).resolves.toEqual({
      [DATABASE_HEALTH_INDICATOR]: { status: 'down', message: 'db timeout retry' },
    });

    expect(down).toHaveBeenCalledWith({ message: 'db timeout retry' });
  });

  it('falls back to a stable message when ping throws an empty/unknown error', async () => {
    healthRepository.pingDatabase.mockRejectedValue(null);

    await expect(service.checkDatabase()).resolves.toEqual({
      [DATABASE_HEALTH_INDICATOR]: { status: 'down', message: UNKNOWN_HEALTH_ERROR_MESSAGE },
    });
  });

  it('caps large error messages to the configured maximum length', async () => {
    healthRepository.pingDatabase.mockRejectedValue(new Error('x'.repeat(HEALTH_ERROR_MESSAGE_MAX_LENGTH + 50)));

    const result = await service.checkDatabase();
    const message = result[DATABASE_HEALTH_INDICATOR].message as string;

    expect(message).toHaveLength(HEALTH_ERROR_MESSAGE_MAX_LENGTH);
    expect(message).toBe('x'.repeat(HEALTH_ERROR_MESSAGE_MAX_LENGTH));
  });
});
