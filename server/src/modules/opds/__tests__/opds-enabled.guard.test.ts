import { ForbiddenException } from '@nestjs/common';

import { OpdsEnabledGuard } from '../opds-enabled.guard';
import type { AppSettingsService } from '../../app-settings/app-settings.service';

function makeGuard(settings: { key: string; value: string }[]) {
  const appSettingsService = { findAll: vi.fn().mockResolvedValue(settings) } as unknown as AppSettingsService;
  return new OpdsEnabledGuard(appSettingsService);
}

describe('OpdsEnabledGuard', () => {
  it('passes when opds_enabled is true', async () => {
    const guard = makeGuard([{ key: 'opds_enabled', value: 'true' }]);
    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('throws ForbiddenException when opds_enabled is false', async () => {
    const guard = makeGuard([{ key: 'opds_enabled', value: 'false' }]);
    await expect(guard.canActivate()).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when opds_enabled setting is missing', async () => {
    const guard = makeGuard([]);
    await expect(guard.canActivate()).rejects.toThrow(ForbiddenException);
  });
});
