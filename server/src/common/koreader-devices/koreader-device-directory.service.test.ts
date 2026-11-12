import { describe, expect, it, vi } from 'vitest';

import { exchangeDeviceId } from '../utils/koreader-exchange-device.utils';
import { buildSessionId, koreaderSessionDeviceKey } from '../utils/koreader-session-id.utils';
import type { KoreaderDeviceDirectoryRepository } from './koreader-device-directory.repository';
import { KoreaderDeviceDirectoryService } from './koreader-device-directory.service';

const PHONE = 'a1b2c3d4-0000-4000-8000-000000000001';
const KOBO = 'f0e0d0c0-0000-4000-8000-000000000002';

function makeService(overrides: Partial<Record<keyof KoreaderDeviceDirectoryRepository, unknown>> = {}) {
  const repo = {
    findPageStatDevices: vi.fn().mockResolvedValue([]),
    findNames: vi.fn().mockResolvedValue(new Map()),
    findProgressModels: vi.fn().mockResolvedValue([]),
    findSweepModels: vi.fn().mockResolvedValue([]),
    findKnownDeviceIds: vi.fn().mockResolvedValue([]),
    findBookHashes: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { service: new KoreaderDeviceDirectoryService(repo as unknown as KoreaderDeviceDirectoryRepository), repo };
}

describe('KoreaderDeviceDirectoryService', () => {
  describe('describeDevices', () => {
    it('queries nothing when there are no devices', async () => {
      const { service, repo } = makeService();

      await expect(service.describeDevices(7, [])).resolves.toEqual(new Map());
      expect(repo.findNames).not.toHaveBeenCalled();
      expect(repo.findProgressModels).not.toHaveBeenCalled();
      expect(repo.findSweepModels).not.toHaveBeenCalled();
    });

    it('prefers the model reported with progress, falls back to the sweep, and adds the given name', async () => {
      const { service, repo } = makeService({
        findNames: vi.fn().mockResolvedValue(new Map([[PHONE, 'Pixel']])),
        findProgressModels: vi.fn().mockResolvedValue([{ deviceId: PHONE, model: 'husky' }]),
        findSweepModels: vi.fn().mockResolvedValue([
          { deviceId: PHONE, model: 'Android' },
          { deviceId: KOBO, model: 'Kobo_io' },
        ]),
      });

      const result = await service.describeDevices(7, [PHONE, KOBO, PHONE]);

      expect(result).toEqual(
        new Map([
          [PHONE, { deviceId: PHONE, model: 'husky', name: 'Pixel' }],
          [KOBO, { deviceId: KOBO, model: 'Kobo_io', name: null }],
        ]),
      );
      expect(repo.findNames).toHaveBeenCalledWith(7, [PHONE, KOBO]);
      expect(repo.findProgressModels).toHaveBeenCalledWith(7, [PHONE, KOBO]);
      expect(repo.findSweepModels).toHaveBeenCalledWith(7, [PHONE, KOBO]);
    });

    it('describes a device nothing is known about with no model and no name', async () => {
      const { service } = makeService();

      await expect(service.describeDevices(7, [PHONE])).resolves.toEqual(new Map([[PHONE, { deviceId: PHONE, model: null, name: null }]]));
    });
  });

  describe('describeSessionDevices', () => {
    it('queries nothing for ids that are not derived KOReader sessions', async () => {
      const { service, repo } = makeService();

      await expect(
        service.describeSessionDevices(7, ['3f1c2f9e-0d6b-4d5e-9a51-2b2c1d8e7f60', `ks-${'a'.repeat(12)}-${'b'.repeat(32)}`]),
      ).resolves.toEqual(new Map());
      expect(repo.findPageStatDevices).not.toHaveBeenCalled();
      expect(repo.findNames).not.toHaveBeenCalled();
    });

    it('attributes each session to the device that read its file', async () => {
      const phoneSession = buildSessionId(PHONE, 42, 1_780_000_000);
      const koboSession = buildSessionId(KOBO, 42, 1_780_100_000);
      const { service, repo } = makeService({
        findPageStatDevices: vi.fn().mockResolvedValue([
          { bookFileId: 42, deviceId: PHONE },
          { bookFileId: 42, deviceId: KOBO },
        ]),
        findProgressModels: vi.fn().mockResolvedValue([
          { deviceId: PHONE, model: 'husky' },
          { deviceId: KOBO, model: 'Kobo_io' },
        ]),
      });

      const result = await service.describeSessionDevices(7, [phoneSession, koboSession]);

      expect(result.get(phoneSession)).toEqual({ deviceId: PHONE, model: 'husky', name: null });
      expect(result.get(koboSession)).toEqual({ deviceId: KOBO, model: 'Kobo_io', name: null });
      expect(repo.findPageStatDevices).toHaveBeenCalledWith(7, [42]);
    });

    it('only considers devices that read the same file', async () => {
      const sessionId = buildSessionId(PHONE, 42, 1_780_000_000);
      const { service, repo } = makeService({
        findPageStatDevices: vi.fn().mockResolvedValue([{ bookFileId: 43, deviceId: PHONE }]),
      });

      await expect(service.describeSessionDevices(7, [sessionId])).resolves.toEqual(new Map());
      expect(repo.findNames).not.toHaveBeenCalled();
    });

    it('attributes a legacy session only when one device fits its key', async () => {
      const unique = `kor:${KOBO.slice(0, 8)}:42:1780000000`;
      const shared = `kor:${PHONE.slice(0, 8)}:42:1780000500`;
      const { service } = makeService({
        findPageStatDevices: vi.fn().mockResolvedValue([
          { bookFileId: 42, deviceId: PHONE },
          { bookFileId: 42, deviceId: `${PHONE.slice(0, 8)}-second-device` },
          { bookFileId: 42, deviceId: KOBO },
        ]),
      });

      const result = await service.describeSessionDevices(7, [unique, shared]);

      expect([...result.keys()]).toEqual([unique]);
      expect(result.get(unique)?.deviceId).toBe(KOBO);
    });

    it('reads page stats once per file, however many sessions share it', async () => {
      const { service, repo } = makeService({
        findPageStatDevices: vi.fn().mockResolvedValue([{ bookFileId: 42, deviceId: PHONE }]),
      });

      await service.describeSessionDevices(7, [
        buildSessionId(PHONE, 42, 1),
        buildSessionId(PHONE, 42, 2),
        `kor:${koreaderSessionDeviceKey(PHONE)}:9:3`,
      ]);

      expect(repo.findPageStatDevices).toHaveBeenCalledTimes(1);
      expect(repo.findPageStatDevices).toHaveBeenCalledWith(7, [42, 9]);
      expect(repo.findNames).toHaveBeenCalledWith(7, [PHONE]);
    });
  });

  describe('describeExchangeDevices', () => {
    const HASH_A = '0123456789abcdef0123456789abcdef';
    const HASH_B = 'fedcba9876543210fedcba9876543210';

    it('queries nothing when no id is an exchange id', async () => {
      const { service, repo } = makeService();

      await expect(service.describeExchangeDevices(7, 5, [PHONE, '12'])).resolves.toEqual(new Map());
      expect(repo.findKnownDeviceIds).not.toHaveBeenCalled();
      expect(repo.findBookHashes).not.toHaveBeenCalled();
    });

    it('rebuilds each exchange id from a known device and a hash of the book', async () => {
      const phoneOnA = exchangeDeviceId(PHONE, HASH_A);
      const koboOnB = exchangeDeviceId(KOBO, HASH_B.toUpperCase());
      const { service, repo } = makeService({
        findKnownDeviceIds: vi.fn().mockResolvedValue([PHONE, KOBO]),
        findBookHashes: vi.fn().mockResolvedValue([HASH_A, HASH_B]),
        findNames: vi.fn().mockResolvedValue(new Map([[PHONE, 'Pixel']])),
        findSweepModels: vi.fn().mockResolvedValue([{ deviceId: KOBO, model: 'Kobo_io' }]),
      });

      const result = await service.describeExchangeDevices(7, 5, [phoneOnA, koboOnB, PHONE]);

      expect(result).toEqual(
        new Map([
          [phoneOnA, { deviceId: PHONE, model: null, name: 'Pixel' }],
          [koboOnB, { deviceId: KOBO, model: 'Kobo_io', name: null }],
        ]),
      );
      expect(repo.findKnownDeviceIds).toHaveBeenCalledWith(7);
      expect(repo.findBookHashes).toHaveBeenCalledWith(7, 5);
    });

    it('leaves an exchange id unnamed when no known device and book hash produce it', async () => {
      const removedDevice = exchangeDeviceId('removed-device', HASH_A);
      const otherBook = exchangeDeviceId(PHONE, HASH_B);
      const { service, repo } = makeService({
        findKnownDeviceIds: vi.fn().mockResolvedValue([PHONE]),
        findBookHashes: vi.fn().mockResolvedValue([HASH_A]),
      });

      await expect(service.describeExchangeDevices(7, 5, [removedDevice, otherBook])).resolves.toEqual(new Map());
      expect(repo.findNames).not.toHaveBeenCalled();
    });
  });
});
