import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ReadwiseSettingsService } from './readwise-settings.service';

const mockRepo = {
  findSettings: vi.fn(),
  userHasReadwiseSyncPermission: vi.fn(),
  findLatestAnnotationId: vi.fn(),
  upsertSettings: vi.fn(),
};

const mockClient = {
  validateToken: vi.fn(),
};

const mockScheduler = {
  requestSync: vi.fn(),
};

function makeService() {
  return new ReadwiseSettingsService(mockRepo as any, mockClient as any, mockScheduler as any);
}

describe('ReadwiseSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.userHasReadwiseSyncPermission.mockResolvedValue(true);
    mockRepo.findLatestAnnotationId.mockResolvedValue(42);
    mockRepo.upsertSettings.mockResolvedValue(undefined);
    mockScheduler.requestSync.mockClear();
  });

  describe('getSettings', () => {
    it('returns defaults when no settings row exists', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      const result = await makeService().getSettings(1);
      expect(result.tokenConfigured).toBe(false);
      expect(result.enabled).toBe(false);
      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('missing_token');
      expect(result.lastSyncedAt).toBeNull();
    });

    it('composes effectiveEnabled = hasPermission && tokenConfigured && enabled (all true)', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'secret', enabled: true, disabledReason: null, lastSyncedAt: null });
      const result = await makeService().getSettings(1);
      expect(result.effectiveEnabled).toBe(true);
      expect(result.disabledReason).toBeNull();
    });

    it('effectiveEnabled is false when permission is denied even if token+enabled', async () => {
      mockRepo.userHasReadwiseSyncPermission.mockResolvedValue(false);
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'secret', enabled: true, disabledReason: null, lastSyncedAt: null });
      const result = await makeService().getSettings(1);
      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('permission_denied');
    });

    it('effectiveEnabled is false when token configured+permission but not enabled', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'secret', enabled: false, disabledReason: null, lastSyncedAt: null });
      const result = await makeService().getSettings(1);
      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('user_disabled');
    });

    it('returns the STORED disabledReason over the derived one (round-trip)', async () => {
      // enabled=false would normally derive 'user_disabled', but a stored 'invalid_token' must win.
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'secret', enabled: false, disabledReason: 'invalid_token', lastSyncedAt: null });
      const result = await makeService().getSettings(1);
      expect(result.disabledReason).toBe('invalid_token');
    });

    it('derives missing_token when no token and stored reason is null', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: null, enabled: false, disabledReason: null, lastSyncedAt: null });
      const result = await makeService().getSettings(1);
      expect(result.disabledReason).toBe('missing_token');
    });

    it('serialises lastSyncedAt to ISO string', async () => {
      const when = new Date('2026-01-02T03:04:05.000Z');
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'secret', enabled: true, disabledReason: null, lastSyncedAt: when });
      const result = await makeService().getSettings(1);
      expect(result.lastSyncedAt).toBe('2026-01-02T03:04:05.000Z');
    });
  });

  describe('upsertSettings', () => {
    it('throws BadRequestException when no existing token and no token in payload', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().upsertSettings(1, { enabled: true })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.upsertSettings).not.toHaveBeenCalled();
    });

    it('preserves existing token when payload omits it (only enabled changes)', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: true, disabledReason: null, lastSyncedAt: null })
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: false, disabledReason: null, lastSyncedAt: null });
      await makeService().upsertSettings(1, { enabled: false });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.apiToken).toBeUndefined();
      expect(data.enabled).toBe(false);
      expect(mockScheduler.requestSync).not.toHaveBeenCalled();
    });

    it('sets disabledReason null and trims when a new token is provided', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ apiToken: 'fresh-token', enabled: true, disabledReason: null, lastSyncedAt: null });
      await makeService().upsertSettings(1, { apiToken: '  fresh-token  ' });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.apiToken).toBe('fresh-token');
      expect(data.disabledReason).toBeNull();
      expect(data.lastSyncedAnnotationId).toBe(42);
      expect(mockScheduler.requestSync).toHaveBeenCalledWith(1);
    });

    it('seeds the watermark when enabling an existing disabled integration', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: false, disabledReason: null, lastSyncedAt: null })
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: true, disabledReason: null, lastSyncedAt: null });
      await makeService().upsertSettings(1, { enabled: true });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.enabled).toBe(true);
      expect(data.lastSyncedAnnotationId).toBe(42);
      expect(mockScheduler.requestSync).toHaveBeenCalledWith(1);
    });

    it('does not seed the watermark when recovering from invalid_token auto-disable', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: false, disabledReason: 'invalid_token', lastSyncedAt: null })
        .mockResolvedValueOnce({ apiToken: 'fresh-token', enabled: true, disabledReason: null, lastSyncedAt: null });
      await makeService().upsertSettings(1, { apiToken: 'fresh-token', enabled: true });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.apiToken).toBe('fresh-token');
      expect('lastSyncedAnnotationId' in data).toBe(false);
      expect(mockScheduler.requestSync).toHaveBeenCalledWith(1);
    });

    it('sets disabledReason null when enabled:true is provided', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'existing', enabled: false, disabledReason: 'invalid_token', lastSyncedAt: null });
      await makeService().upsertSettings(1, { enabled: true });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect(data.enabled).toBe(true);
      expect(data.disabledReason).toBeNull();
    });

    it('does not clear disabledReason when only disabling (enabled:false)', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: true, disabledReason: null, lastSyncedAt: null })
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: false, disabledReason: null, lastSyncedAt: null });
      await makeService().upsertSettings(1, { enabled: false });
      const data = mockRepo.upsertSettings.mock.calls[0][1];
      expect('disabledReason' in data).toBe(false);
      expect(mockScheduler.requestSync).not.toHaveBeenCalled();
    });

    it('returns fresh settings via getSettings after upsert', async () => {
      mockRepo.findSettings
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: false, disabledReason: null, lastSyncedAt: null })
        .mockResolvedValueOnce({ apiToken: 'existing', enabled: true, disabledReason: null, lastSyncedAt: null });
      const result = await makeService().upsertSettings(1, { enabled: true });
      expect(result.enabled).toBe(true);
      expect(result.effectiveEnabled).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('uses the passed token when present', async () => {
      mockClient.validateToken.mockResolvedValue(true);
      const result = await makeService().validateToken(1, '  passed-token ');
      expect(mockClient.validateToken).toHaveBeenCalledWith(1, 'passed-token');
      expect(mockRepo.findSettings).not.toHaveBeenCalled();
      expect(result).toEqual({ valid: true });
    });

    it('falls back to the stored token when none passed', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'stored-token' });
      mockClient.validateToken.mockResolvedValue(false);
      const result = await makeService().validateToken(1);
      expect(mockClient.validateToken).toHaveBeenCalledWith(1, 'stored-token');
      expect(result).toEqual({ valid: false });
    });

    it('returns {valid:false} when neither passed nor stored token exists', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      const result = await makeService().validateToken(1);
      expect(result).toEqual({ valid: false });
      expect(mockClient.validateToken).not.toHaveBeenCalled();
    });
  });
});
