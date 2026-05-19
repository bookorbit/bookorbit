import { describe, expect, it, vi, beforeEach } from 'vitest';

import { HardcoverAdminController } from './hardcover-admin.controller';

const mockSettingsService = {
  getAdminSettings: vi.fn(),
  setFeatureEnabled: vi.fn(),
};

function makeController() {
  return new HardcoverAdminController(mockSettingsService as any);
}

describe('HardcoverAdminController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getAdminSettings delegates to the settings service', async () => {
    mockSettingsService.getAdminSettings.mockResolvedValue({ featureEnabled: true });

    const result = await makeController().getAdminSettings();

    expect(result).toEqual({ featureEnabled: true });
    expect(mockSettingsService.getAdminSettings).toHaveBeenCalledTimes(1);
  });

  it('setFeatureEnabled delegates the enabled flag', async () => {
    mockSettingsService.setFeatureEnabled.mockResolvedValue(undefined);

    await makeController().setFeatureEnabled({ enabled: false });

    expect(mockSettingsService.setFeatureEnabled).toHaveBeenCalledWith(false);
  });
});
